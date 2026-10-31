import { test, expect } from '@playwright/test'
test('authenticated UI submits a PC rewrite, polls the result, applies and undoes it', async ({
  page,
}) => {
  const uid = '10000000-0000-4000-8000-000000000001',
    nid = '20000000-0000-4000-8000-000000000001'
  const user = {
    id: uid,
    email: 'owner@example.test',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
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
  let note = {
    id: nid,
    owner_id: uid,
    title: 'Ma note',
    content: 'Texte original',
    category: 'pro',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  let job: any = null,
    submitted: any = null
  await page.route('https://qa.supabase.co/**', async (route) => {
    const u = new URL(route.request().url()),
      p = u.pathname
    let data: any = {}
    const body = route.request().postDataJSON()
    if (p.includes('/auth/v1/token')) data = session
    else if (p.includes('/auth/v1/user')) data = user
    else if (p.endsWith('/rpc/can_access_atelier')) data = true
    else if (p.endsWith('/rpc/pc_status'))
      data = [
        {
          label: 'PC de test',
          capabilities: ['rewrite', 'summarize'],
          last_seen: new Date().toISOString(),
        },
      ]
    else if (p.endsWith('/rpc/submit_job')) {
      submitted = body
      data = body.p_id
      job = {
        id: body.p_id,
        kind: body.p_kind,
        status: 'done',
        context: body.p_input.context,
        result: { text: 'Texte réécrit par le moteur simulé' },
        created_at: new Date().toISOString(),
        error: null,
      }
    } else if (p.endsWith('/rpc/sync_write')) {
      note = { ...note, ...body.p_values, updated_at: new Date().toISOString() }
      data = { row: note }
    } else if (p.endsWith('/notes')) data = [note]
    else if (p.endsWith('/ai_jobs')) data = job ? [job] : []
    else if (p.endsWith('/projects') || p.endsWith('/tickets')) data = []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    })
  })
  await page.goto('/')
  await page.getByLabel('Adresse e-mail').fill('owner@example.test')
  await page.getByLabel('Mot de passe', { exact: true }).fill('qa-test-password')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
  const desktop = page.getByRole('navigation', { name: 'Navigation principale' }),
    nav = (await desktop.isVisible())
      ? desktop
      : page.getByRole('navigation', { name: 'Navigation mobile' })
  await nav.getByRole('button', { name: /Notes/ }).click()
  if (await page.getByRole('button', { name: /Ma note/ }).isVisible())
    await page.getByRole('button', { name: /Ma note/ }).click()
  await page
    .getByRole('button', { name: /Assistant PC/ })
    .last()
    .click()
  await page.getByLabel('Instructions personnalisées').fill('Rends le texte clair')
  await expect(page.getByRole('button', { name: 'Réécrire', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Réécrire', exact: true }).click()
  await expect(page.getByText('Résultat prêt à vérifier', { exact: true })).toBeVisible({
    timeout: 10000,
  })
  expect(submitted.p_kind).toBe('rewrite')
  expect(submitted.p_input.text).toBe('Texte original')
  await expect(page.getByLabel('Contenu de la note', { exact: true })).toHaveValue('Texte original')
  await page.getByRole('button', { name: 'Appliquer à la note', exact: true }).click()
  await expect(page.getByLabel('Contenu de la note', { exact: true })).toHaveValue(
    'Texte réécrit par le moteur simulé',
  )
  await page.getByRole('button', { name: 'Annuler la modification', exact: true }).click()
  await expect(page.getByLabel('Contenu de la note', { exact: true })).toHaveValue('Texte original')
  await page.getByLabel('Contenu de la note', { exact: true }).fill('Modifié entre-temps')
  await expect(
    page.getByRole('button', { name: 'Appliquer à la note', exact: true }),
  ).toBeDisabled()
})
