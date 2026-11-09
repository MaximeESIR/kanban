import { test, expect } from '@playwright/test'

for (const conflict of [false, true])
  test(`agent history ${conflict ? 'preserves a concurrent description after a version conflict' : 'restores a description and only human approval marks Done'}`, async ({
    page,
  }) => {
    const uid = '10000000-0000-4000-8000-000000000001',
      pid = '20000000-0000-4000-8000-000000000001',
      tid = '30000000-0000-4000-8000-000000000001',
      hid = '40000000-0000-4000-8000-000000000001',
      cid = '50000000-0000-4000-8000-000000000001'
    const versions = ['2026-11-09T08:00:00Z', '2026-11-09T08:01:00Z', '2026-11-09T08:02:00Z']
    const user = {
      id: uid,
      email: 'owner@example.test',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      aud: 'authenticated',
      created_at: versions[0],
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
      name: 'Projet MCP',
      description: '',
      color: 'sage',
      created_at: versions[0],
      updated_at: versions[0],
    }
    let ticket = {
      id: tid,
      owner_id: uid,
      project_id: pid,
      number: 1,
      title: 'Ticket agent',
      description: 'Description proposée par l’agent',
      status: 'in_progress',
      priority: 'high',
      difficulty: 'medium',
      depends_on_id: null,
      prerequisite_ids: [],
      parent_id: null,
      position: 0,
      created_at: versions[0],
      updated_at: versions[0],
    }
    let claim = {
      id: cid,
      ticket_id: tid,
      agent_label: 'Agent Codex',
      state: 'review',
      report: {
        summary: 'Correction prête <script>non exécuté</script>',
        tests: ['Tests unitaires : 3 réussis'],
        limitations: ['Essai matériel à vérifier'],
      },
      created_at: versions[0],
      updated_at: versions[0],
    }
    const history = [
      {
        id: hid,
        ticket_id: tid,
        description: 'Description initiale conservée',
        agent_label: 'Agent Codex',
        created_at: versions[0],
        previous_version: versions[0],
        replaced_version: versions[0],
      },
    ]
    let restores = 0,
      approvals = 0
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    let selectedProjects: string[] = []
    await page.route('https://qa.supabase.co/**', async (route) => {
      const path = new URL(route.request().url()).pathname,
        body = route.request().postDataJSON()
      let data: any = [],
        status = 200
      if (path.includes('/auth/v1/token')) data = session
      else if (path.includes('/auth/v1/user')) data = user
      else if (path.endsWith('/rpc/can_access_atelier')) data = true
      else if (path.endsWith('/rpc/atelier_schema_version')) data = 10
      else if (path.endsWith('/rpc/agent_workspace_state'))
        data = { project_ids: selectedProjects, registered: true }
      else if (path.endsWith('/rpc/set_agent_project')) {
        expect(body).toEqual({ p_project: pid, p_enabled: true })
        selectedProjects = [pid]
        data = { project_ids: selectedProjects, registered: true }
      } else if (path.endsWith('/projects')) data = [project]
      else if (path.endsWith('/tickets')) data = [ticket]
      else if (path.endsWith('/rpc/ticket_agent_activity')) data = { claim, history }
      else if (path.endsWith('/rpc/restore_ticket_description')) {
        restores++
        expect(body).toMatchObject({ p_ticket: tid, p_history: hid, p_version: versions[0] })
        expect(body.p_request).toMatch(/^[0-9a-f-]{36}$/)
        if (conflict) {
          status = 409
          data = { code: '40001', message: 'Le ticket a changé. Actualisez avant de confirmer.' }
        } else {
          ticket = { ...ticket, description: history[0].description, updated_at: versions[1] }
          data = { ticket }
        }
      } else if (path.endsWith('/rpc/approve_agent_review')) {
        approvals++
        expect(body).toMatchObject({ p_ticket: tid, p_claim: cid, p_version: versions[1] })
        ticket = { ...ticket, status: 'done', updated_at: versions[2] }
        claim = { ...claim, state: 'approved', updated_at: versions[2] }
        data = { ticket, claim }
      }
      await route.fulfill({
        status,
        contentType: 'application/json',
        headers: { Date: new Date().toUTCString(), 'Access-Control-Expose-Headers': 'Date' },
        body: JSON.stringify(data),
      })
    })
    await page.goto('/')
    await page.getByLabel('Adresse e-mail').fill(user.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill('qa-password')
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
    await page.getByRole('button', { name: 'Ouvrir Projet MCP', exact: true }).click()
    await page
      .getByRole('button', { name: 'Utiliser ce projet avec les agents', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Retirer l’accès des agents', exact: true }),
    ).toBeVisible()
    await page.locator('.ticket-open').filter({ hasText: 'Ticket agent' }).click()
    const activity = page.getByRole('region', { name: 'Travail des agents et historique' })
    await expect(
      activity.getByText('Agent Codex · Résultat à valider', { exact: true }),
    ).toBeVisible()
    await expect(activity).toContainText('Tests unitaires : 3 réussis')
    await expect(activity.locator('script')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Statut', exact: true })).toHaveValue(
      'in_progress',
    )
    const approve = activity.getByRole('button', {
      name: 'Valider le résultat de l’agent et passer à Done',
      exact: true,
    })
    await expect(approve).toBeEnabled()
    await activity.locator('.ticket-history > summary').click()
    await activity.locator('.ticket-history > details > summary').first().click()
    await expect(activity).toContainText('Description initiale conservée')
    await activity.getByRole('button', { name: 'Restaurer cette description', exact: true }).click()
    if (conflict) {
      await expect(activity.getByRole('alert')).toContainText('Le ticket a changé')
      await expect(page.getByLabel('Description')).toHaveValue('Description proposée par l’agent')
      expect(restores).toBe(1)
      expect(approvals).toBe(0)
    } else {
      await expect(page.getByLabel('Description')).toHaveValue('Description initiale conservée')
      await expect(page.getByRole('combobox', { name: 'Statut', exact: true })).toHaveValue(
        'in_progress',
      )
      expect(approvals).toBe(0)
      await approve.click()
      await expect(
        activity.getByText('Agent Codex · Résultat validé', { exact: true }),
      ).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Statut', exact: true })).toHaveValue('done')
      expect(restores).toBe(1)
      expect(approvals).toBe(1)
    }
    expect(pageErrors).toEqual([])
  })
