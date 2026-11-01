import { test, expect } from '@playwright/test'

for (const kind of ['rewrite', 'transcribe'] as const)
  test(`web chooses Groq for ${kind}, waits for key and memory acknowledgement, and returns to local`, async ({
    page,
  }) => {
    if (kind === 'transcribe')
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
        })
        class Recorder {
          static isTypeSupported() {
            return true
          }
          mimeType = 'audio/webm'
          state = 'inactive'
          ondataavailable?: (e: { data: Blob }) => void
          onstop?: () => void
          start() {
            this.state = 'recording'
          }
          stop() {
            this.state = 'inactive'
            this.ondataavailable?.({ data: new Blob(['audio-test'], { type: this.mimeType }) })
            this.onstop?.()
          }
        }
        Object.defineProperty(window, 'MediaRecorder', { value: Recorder })
      })
    const stamp = () => new Date().toISOString()
    const uid = '10000000-0000-4000-8000-000000000001',
      nid = '20000000-0000-4000-8000-000000000001'
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
    const note = {
      id: nid,
      owner_id: uid,
      title: 'Note moteur',
      content: 'Texte original',
      category: 'pro',
      created_at: stamp(),
      updated_at: stamp(),
    }
    let provider = 'local',
      revision = 0,
      settingsCalls = 0
    let pc = {
      label: 'PC',
      last_seen: stamp(),
      provider: 'local',
      revision: 0,
      state: 'ready',
      groq_configured: false,
      local_models_unloaded: false,
      error: null as string | null,
    }
    let jobs: any[] = [],
      submitted: any[] = []
    const selections: string[] = []
    await page.route('https://qa.supabase.co/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const body = route.request().postDataJSON()
      let data: any = []
      if (path.includes('/auth/v1/token')) data = session
      else if (path.includes('/auth/v1/user')) data = user
      else if (path.endsWith('/rpc/can_access_atelier')) data = true
      else if (path.endsWith('/rpc/atelier_schema_version')) data = 8
      else if (path.endsWith('/rpc/assistant_settings')) {
        settingsCalls++
        data = { provider, revision, pcs: [{ ...pc, last_seen: stamp() }] }
      } else if (path.endsWith('/rpc/pc_status'))
        data = [
          {
            label: 'PC',
            last_seen: stamp(),
            capabilities:
              pc.state === 'ready' && pc.revision === revision && pc.provider === provider
                ? ['summarize', 'rewrite', 'transcribe', 'search']
                : [],
          },
        ]
      else if (path.endsWith('/rpc/set_assistant_provider')) {
        selections.push(body.p_provider)
        provider = body.p_provider
        revision++
        data = null
      } else if (path.endsWith('/rpc/submit_job')) {
        submitted.push(body)
        data = body.p_id
        jobs = [
          {
            id: body.p_id,
            kind: body.p_kind,
            provider: body.p_provider,
            status: 'done',
            context: body.p_input.context,
            result: { text: 'Résultat vérifié' },
            error: null,
            created_at: stamp(),
          },
        ]
      } else if (path.endsWith('/notes')) data = [note]
      else if (path.endsWith('/ai_jobs')) data = jobs
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { Date: new Date().toUTCString(), 'Access-Control-Expose-Headers': 'Date' },
        body: JSON.stringify(data),
      })
    })
    await page.goto('/')
    await page.getByLabel('Adresse e-mail').fill(user.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill('qa-password')
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
    const desktop = page.getByRole('navigation', { name: 'Navigation principale' })
    const nav = (await desktop.isVisible())
      ? desktop
      : page.getByRole('navigation', { name: 'Navigation mobile' })
    await nav.getByRole('button', { name: /Notes/ }).click()
    await page.getByRole('button', { name: /Note moteur/ }).click()
    await page
      .getByRole('button', { name: /Assistant PC/ })
      .last()
      .click()
    const chooser = page.getByLabel('Moteur des notes, dictées et recherches')
    await expect(chooser).toHaveValue('local')
    const action = page.getByRole('button', {
      name: kind === 'rewrite' ? 'Réécrire' : 'Dicter',
      exact: true,
    })
    if (kind === 'rewrite')
      await page.getByLabel('Instructions personnalisées').fill('Rends le texte clair')
    await expect(action).toBeEnabled()
    await chooser.selectOption('groq')
    await expect(
      page.getByText(
        'Vos notes, dictées et le contenu des documents et tickets utilisés pour vos recherches seront envoyés à Groq via le PC.',
        { exact: false },
      ),
    ).toBeVisible()
    expect(selections).toEqual([])
    expect(submitted).toEqual([])
    await page.getByRole('button', { name: 'Utiliser Groq', exact: true }).click()
    await expect(page.getByText('Passage à Groq en cours', { exact: false })).toBeVisible()
    await expect(action).toBeDisabled()
    await expect(
      page.getByText('Groq prêt. Qwen déchargé, Whisper arrêté.', { exact: true }),
    ).toHaveCount(0)
    const refresh = async () => {
      const before = settingsCalls
      await page.evaluate(() => window.dispatchEvent(new Event('atelier-pc-refresh')))
      await expect.poll(() => settingsCalls).toBeGreaterThan(before)
    }
    pc = {
      ...pc,
      provider: 'groq',
      revision,
      state: 'blocked',
      groq_configured: false,
      local_models_unloaded: true,
      error: 'Clé Groq absente sur le PC.',
    }
    await refresh()
    await expect(page.getByText('Clé Groq absente sur le PC.', { exact: true })).toBeVisible()
    await expect(action).toBeDisabled()
    pc = { ...pc, state: 'ready', groq_configured: true, error: null }
    await refresh()
    await expect(
      page.getByText('Groq prêt. Qwen déchargé, Whisper arrêté.', { exact: true }),
    ).toBeVisible()
    await expect(action).toBeEnabled()
    const request = async () => {
      const count = submitted.length
      await action.click()
      if (kind === 'transcribe')
        await page.getByRole('button', { name: 'Arrêter (90 s max)', exact: true }).click()
      await expect.poll(() => submitted.length).toBe(count + 1)
      await expect(page.getByText('Résultat prêt à vérifier', { exact: true })).toBeVisible()
    }
    await request()
    expect(submitted[0].p_provider).toBe('groq')
    expect(submitted[0].p_kind).toBe(kind)
    expect(JSON.stringify(submitted[0])).not.toContain('API_KEY')
    if (kind === 'transcribe')
      expect(Buffer.from(submitted[0].p_input.audio_base64, 'base64').toString()).toBe('audio-test')
    await chooser.selectOption('local')
    await page.getByRole('button', { name: 'Utiliser les modèles locaux', exact: true }).click()
    await expect(
      page.getByText('Retour aux modèles locaux en cours…', { exact: true }),
    ).toBeVisible()
    await expect(action).toBeDisabled()
    pc = { ...pc, provider: 'local', revision, state: 'ready', local_models_unloaded: false }
    await refresh()
    await expect(page.getByText('Modèles locaux prêts.', { exact: false })).toBeVisible()
    await expect(action).toBeEnabled()
    await request()
    expect(submitted[1].p_provider).toBe('local')
    expect(selections).toEqual(['groq', 'local'])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
