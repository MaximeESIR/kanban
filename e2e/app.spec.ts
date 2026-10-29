import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function login(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Remplir les identifiants' }).click()
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
}
async function navigate(page: Page, name: 'Notes' | 'Projects') {
  const nav = page.getByRole('navigation', { name: 'Navigation principale' })
  const menu = (await nav.isVisible())
    ? nav
    : page.getByRole('navigation', { name: 'Navigation mobile' })
  await menu.getByRole('button', { name: new RegExp(name) }).click()
}
async function createTicket(page: Page, title: string, depends = false) {
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Titre du ticket').fill(title)
  await dialog.getByLabel('Description').fill('Un ticket vérifié dans le navigateur.')
  await dialog.getByRole('combobox', { name: 'Priorité', exact: true }).selectOption('high')
  await dialog.getByRole('combobox', { name: 'Difficulté', exact: true }).selectOption('hard')
  if (depends) await dialog.getByLabel('Dépend d’un autre ticket').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Créer le ticket', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

test('authentication, persistent session, and responsive layout', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByLabel('Adresse e-mail').fill('personne@exemple.fr')
  await page.getByLabel('Mot de passe', { exact: true }).fill('incorrect')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('identifiants de démonstration')
  await page.getByLabel('Adresse e-mail').fill('k@k.k')
  await page.getByLabel('Mot de passe', { exact: true }).fill('k')
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Ouvrir Site personnel', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-projects.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
  await page.getByRole('button', { name: 'Ouvrir Site personnel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Site personnel', exact: true })).toBeVisible()
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-board.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const logout = page
    .getByRole('button', { name: 'Se déconnecter', exact: true })
    .filter({ visible: true })
  await logout.click()
  await expect(page.getByRole('heading', { name: 'Retrouvez votre atelier.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('projects and tickets: create, edit, move, dependencies, deletion', async ({
  page,
}, testInfo) => {
  await login(page)
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Nom du projet').fill('Projet de vérification')
  await page
    .getByRole('dialog')
    .getByLabel('Description')
    .fill('Tester toutes les étapes du kanban.')
  await page.getByRole('button', { name: 'Lavande', exact: true }).click()
  await page.getByRole('button', { name: 'Créer le projet', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Projet de vérification', exact: true }),
  ).toBeVisible()
  await createTicket(page, 'Première étape')
  await createTicket(page, 'Deuxième étape', true)
  const first = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Première étape', exact: true }) })
  const second = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Deuxième étape', exact: true }) })
  await expect(second.getByRole('button', { name: /Dépend de/ })).toBeVisible()
  await first.getByLabel('Statut de Première étape').selectOption('in_progress')
  await expect(
    page
      .getByRole('region', { name: 'In progress', exact: true })
      .getByRole('heading', { name: 'Première étape', exact: true }),
  ).toBeVisible()
  if (testInfo.project.name === 'desktop')
    await first.dragTo(page.getByRole('region', { name: 'Done', exact: true }))
  else await first.getByLabel('Statut de Première étape').selectOption('done')
  await expect(
    page
      .getByRole('region', { name: 'Done', exact: true })
      .getByRole('heading', { name: 'Première étape', exact: true }),
  ).toBeVisible()
  await expect(second.getByRole('button', { name: /Dépendance terminée/ })).toBeVisible()
  await first.getByRole('button', { name: /Première étape/ }).click()
  await expect(
    page.getByRole('dialog').getByLabel('Dépend d’un autre ticket').getByRole('option'),
  ).toHaveCount(1)
  await page.getByRole('dialog').getByLabel('Titre du ticket').fill('Première étape terminée')
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Première étape terminée', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Première étape terminée Un ticket/ }).click()
  await page.getByRole('button', { name: 'Supprimer le ticket', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Première étape terminée', exact: true }),
  ).toHaveCount(0)
  await expect(second.getByRole('button', { name: /Dépendance/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Modifier le projet', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Nom du projet').fill('Projet renommé')
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projet renommé', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Modifier le projet', exact: true }).click()
  await page.getByRole('button', { name: 'Supprimer le projet', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ouvrir Projet renommé' })).toHaveCount(0)
})

test('notes autosave even when navigating immediately, export, and deletion', async ({
  page,
}, testInfo) => {
  await login(page)
  await navigate(page, 'Notes')
  await page.getByRole('button', { name: 'Nouvelle note', exact: true }).click()
  await page.getByLabel('Titre de la note', { exact: true }).fill('Mes idées <script>')
  await page
    .getByLabel('Contenu de la note', { exact: true })
    .fill('Une pensée à conserver.\n\n<script>alert("texte seulement")</script>')
  await navigate(page, 'Projects')
  // Leaving the notes view must not cancel its pending save.
  await page.waitForTimeout(1100)
  await page.reload()
  await navigate(page, 'Notes')
  await page.getByRole('button', { name: /Mes idées <script>/ }).click()
  await expect(page.getByLabel('Contenu de la note', { exact: true })).toHaveValue(
    'Une pensée à conserver.\n\n<script>alert("texte seulement")</script>',
  )
  await expect(page.getByRole('status').filter({ hasText: 'Enregistrée' })).toBeVisible()
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-notes.png`, fullPage: true })
  const download = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Exporter mes données', exact: true })
    .filter({ visible: true })
    .click()
  expect((await download).suggestedFilename()).toMatch(/^atelier-.*\.json$/)
  await page.getByRole('button', { name: 'Supprimer la note', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
  await expect(page.getByRole('button', { name: /Mes idées <script>/ })).toHaveCount(0)
})

test('search and modal keyboard dismissal', async ({ page }) => {
  await login(page)
  await page.getByRole('textbox', { name: 'Rechercher un projet' }).fill('introuvable')
  await expect(page.getByRole('heading', { name: 'Aucun projet trouvé.' })).toBeVisible()
  await page.getByRole('button', { name: 'Effacer la recherche' }).click()
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('main screens have no automated WCAG A/AA violations', async ({ page }) => {
  async function audit() {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(
      results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([])
  }
  await page.goto('/')
  await audit()
  await login(page)
  await audit()
  await page.getByRole('button', { name: 'Ouvrir Site personnel', exact: true }).click()
  await audit()
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  await audit()
  await page.keyboard.press('Escape')
  await navigate(page, 'Notes')
  await audit()
})
