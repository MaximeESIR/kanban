import { test, expect } from '@playwright/test'

test('Run tolerates a fast device clock, live events update progress, human approval alone closes ticket', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(Date.now() + 180000))
  const uid = '10000000-0000-4000-8000-000000000001',
    pid = '20000000-0000-4000-8000-000000000001',
    tid = '30000000-0000-4000-8000-000000000001',
    rid = '40000000-0000-4000-8000-000000000001'
  const stamp = () => new Date().toISOString()
  const user = {
    id: uid,
    email: 'owner@example.test',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    aud: 'authenticated',
    created_at: stamp(),
  }
  const token = [
    'eyJhbGciOiJIUzI1NiJ9',
    Buffer.from(
      JSON.stringify({
        sub: uid,
        aal: 'aal2',
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
        amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }],
      }),
    ).toString('base64url'),
    'test',
  ].join('.')
  const session = {
    access_token: token,
    refresh_token: 'qa-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }
  const project = {
    id: pid,
    owner_id: uid,
    name: 'Déploiement Jetson',
    description: '',
    color: 'sage',
    created_at: stamp(),
    updated_at: stamp(),
  }
  let ticket = {
    id: tid,
    owner_id: uid,
    project_id: pid,
    number: 1,
    title: 'Exporter le modèle',
    description: 'Créer un export ONNX et vérifier le résultat.',
    status: 'todo',
    priority: 'high',
    difficulty: 'medium',
    depends_on_id: null,
    prerequisite_ids: [],
    parent_id: null,
    created_at: stamp(),
    updated_at: stamp(),
  }
  let binding: any[] = [],
    run: any = null,
    submitted: any = null,
    notify: (kind: string) => void = () => {}
  await page.routeWebSocket('wss://qa.supabase.co/**', (socket) => {
    socket.onMessage((raw) => {
      const parsed = JSON.parse(String(raw)),
        array = Array.isArray(parsed)
      const m = array
        ? {
            join_ref: parsed[0],
            ref: parsed[1],
            topic: parsed[2],
            event: parsed[3],
            payload: parsed[4],
          }
        : parsed
      const send = (event: string, payload: any, ref = m.ref) =>
        socket.send(
          JSON.stringify(
            array
              ? [m.join_ref, ref, m.topic, event, payload]
              : { topic: m.topic, event, payload, ref },
          ),
        )
      if (m.event === 'phx_join') {
        send('phx_reply', {
          status: 'ok',
          response: {
            postgres_changes: [{ id: 1, event: '*', schema: 'public', table: 'atelier_events' }],
          },
        })
        notify = (kind) =>
          send(
            'postgres_changes',
            {
              ids: [1],
              data: {
                schema: 'public',
                table: 'atelier_events',
                columns: [
                  { name: 'owner_id', type: 'uuid' },
                  { name: 'kind', type: 'text' },
                  { name: 'revision', type: 'int8' },
                ],
                commit_timestamp: stamp(),
                type: 'UPDATE',
                record: { owner_id: uid, kind, revision: Date.now() },
                old_record: {},
                errors: null,
              },
            },
            null,
          )
      } else if (m.event === 'heartbeat') send('phx_reply', { status: 'ok', response: {} })
    })
  })
  await page.route('https://qa.supabase.co/**', async (route) => {
    const p = new URL(route.request().url()).pathname,
      body = route.request().postDataJSON()
    let data: any = []
    if (p.includes('/auth/v1/token')) data = session
    else if (p.includes('/auth/v1/user')) data = user
    else if (p.endsWith('/rpc/can_access_atelier')) data = true
    else if (p.endsWith('/rpc/atelier_schema_version')) data = 6
    else if (p.endsWith('/rpc/pc_status'))
      data = [{ label: 'PC', capabilities: [], last_seen: stamp() }]
    else if (p.endsWith('/projects')) data = [project]
    else if (p.endsWith('/tickets')) data = [ticket]
    else if (p.endsWith('/worker_repositories'))
      data = [
        {
          id: rid,
          label: 'Jetson local',
          local_path: '/home/test/repos/jetson',
          codex_models: [
            {
              id: 'gpt-6.1-sol',
              label: 'GPT-6.1 Sol',
              efforts: ['low', 'high'],
              default_effort: 'low',
            },
            {
              id: 'gpt-6-astra',
              label: 'GPT-6 Astra',
              efforts: ['medium', 'max'],
              default_effort: 'medium',
            },
          ],
          enabled: true,
          last_seen: stamp(),
        },
      ]
    else if (p.endsWith('/project_repositories')) data = binding
    else if (p.endsWith('/development_runs')) data = run ? [run] : []
    else if (p.endsWith('/rpc/bind_project_repository')) {
      expect(body.p_project).toBe(pid)
      expect(body.p_repository).toBe(rid)
      binding = [{ project_id: pid, repository_id: rid }]
      data = null
    } else if (p.endsWith('/rpc/submit_development')) {
      submitted = body
      run = {
        id: body.p_id,
        ticket_id: tid,
        codex_model: body.p_model,
        reasoning_effort: body.p_effort,
        status: 'queued',
        phase: 'En attente',
        result: null,
        error: null,
      }
      data = body.p_id
    } else if (p.endsWith('/rpc/approve_development')) {
      expect(run.status).toBe('review')
      expect(body.p_version).toBe(ticket.updated_at)
      run = { ...run, status: 'approved', phase: 'Validée par vous' }
      ticket = { ...ticket, status: 'done', updated_at: stamp() }
      data = null
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        Date: new Date().toUTCString(),
        'Access-Control-Expose-Headers': 'Date',
      },
      body: JSON.stringify(data),
    })
  })
  await page.goto('/')
  await page.getByLabel('Adresse e-mail').fill('owner@example.test')
  await page.getByLabel('Mot de passe', { exact: true }).fill('qa-test-password')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await page.getByRole('button', { name: 'Ouvrir Déploiement Jetson' }).click()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  await page.locator('.repository-panel summary').click()
  await page.getByLabel('Dépôt du projet').selectOption(rid)
  await expect(page.getByText('/home/test/repos/jetson', { exact: true })).toBeVisible()
  await expect(page.getByText('Suivi en direct connecté', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Lancer avec Codex' })).toBeVisible()
  expect(submitted).toBe(null)
  await expect(page.getByLabel('Modèle Codex')).toHaveValue('gpt-6.1-sol')
  await page.getByLabel('Modèle Codex').selectOption('gpt-6-astra')
  await expect(page.getByLabel('Effort de raisonnement')).toHaveValue('medium')
  await page.getByLabel('Effort de raisonnement').selectOption('max')
  await page.screenshot({ path: 'artifacts/codex-choice-' + test.info().project.name + '.png' })
  await page.getByRole('button', { name: 'Lancer le développement', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Suivi : En attente', exact: true })).toBeVisible()
  expect(submitted.p_ticket).toBe(tid)
  expect(submitted.p_model).toBe('gpt-6-astra')
  expect(submitted.p_effort).toBe('max')
  expect(Object.keys(submitted).sort()).toEqual([
    'p_effort',
    'p_id',
    'p_model',
    'p_ticket',
    'p_version',
  ])
  // The server/PC transition is pushed through the actual browser WebSocket handler.
  run = { ...run, status: 'running', phase: 'Codex travaille et vérifie les changements' }
  ticket = { ...ticket, status: 'in_progress', updated_at: stamp() }
  notify('runs')
  notify('workspace')
  await expect(page.getByLabel('Statut de Exporter le modèle')).toHaveValue('in_progress')
  await expect(page.getByRole('button', { name: /Suivi : Codex travaille/ })).toBeVisible()
  run = {
    ...run,
    status: 'review',
    phase: 'À valider',
    result: {
      summary: 'Export ONNX ajouté.',
      tests: ['pytest : 3 réussis'],
      limitations: ['Test sur Jetson physique à effectuer.'],
      branch: 'atelier/test',
      worktree: '/home/test/worktree',
    },
  }
  notify('runs')
  await page.getByRole('button', { name: 'Suivi : À valider', exact: true }).click()
  await expect(page.getByText('Export ONNX ajouté.', { exact: true })).toBeVisible()
  await expect(page.getByText('pytest : 3 réussis', { exact: true })).toBeVisible()
  expect(ticket.status).toBe('in_progress')
  await page.getByRole('button', { name: 'Valider et passer à Done', exact: true }).click()
  await expect(page.getByText('Validée par vous', { exact: true }).last()).toBeVisible()
  expect(ticket.status).toBe('done')
  await page.screenshot({
    path: `artifacts/execution-${test.info().project.name}.png`,
    fullPage: true,
  })
})
