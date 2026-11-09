import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Remplir les identifiants' }).click()
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click()
  await page.getByLabel('Nom du projet').fill('Outils tickets')
  await page.getByRole('button', { name: 'Créer le projet', exact: true }).click()
}
async function add(page: Page, title: string, priority = 'medium') {
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  await page.getByLabel('Titre du ticket').fill(title)
  await page.getByRole('combobox', { name: 'Priorité', exact: true }).selectOption(priority)
  await page.getByRole('button', { name: 'Créer le ticket', exact: true }).click()
}
const card = (page: Page, title: string) =>
  page
    .locator('article.ticket-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })

test('project sorting preserves manual order and stays scoped to the project', async ({ page }) => {
  await setup(page)
  await add(page, 'Premier', 'low')
  await add(page, 'Urgent', 'urgent')
  await expect(page.locator('article.ticket-card').first()).toContainText('Premier')
  await page.getByLabel('Trier les tickets du projet').selectOption('priority')
  await expect(page.locator('article.ticket-card').first()).toContainText('Urgent')
  await expect(
    card(page, 'Urgent').getByRole('button', { name: 'Descendre Urgent', exact: true }),
  ).toBeDisabled()
  await page.reload()
  await expect(page.getByLabel('Trier les tickets du projet')).toHaveValue('priority')
  await page.getByLabel('Trier les tickets du projet').selectOption('manual')
  await expect(page.locator('article.ticket-card').first()).toContainText('Premier')
  await page.getByLabel('Trier les tickets du projet').selectOption('recent')
  await expect(page.locator('article.ticket-card').first()).toContainText('Urgent')
  await page.getByRole('button', { name: 'Tous les projets', exact: true }).click()
  await page.getByRole('button', { name: 'Ouvrir Site personnel', exact: true }).click()
  await expect(page.getByLabel('Trier les tickets du projet')).toHaveValue('manual')
})

test('Markdown copy, safe ticket links and cross-project duplication do not start execution', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          ;(window as unknown as { copied: string }).copied = text
        },
      },
    }),
  )
  await setup(page)
  await add(page, 'Préparer')
  const number = (await card(page, 'Préparer').locator('.ticket-number').innerText()).replace(
    '#',
    '',
  )
  await add(page, 'Déployer')
  await card(page, 'Déployer').locator('.ticket-open').click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Description')
    .fill(`Voir #${number}. Code : \`#${number}\`. Inconnu #999999. <script>alert('non')</script>`)
  const parent = await dialog
    .getByLabel('Ticket parent')
    .getByRole('option')
    .filter({ hasText: 'Préparer' })
    .getAttribute('value')
  await dialog.getByLabel('Ticket parent').selectOption(parent!)
  await dialog.getByRole('checkbox', { name: /Préparer/ }).check()
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await card(page, 'Déployer').locator('.ticket-open').click()
  await page.getByRole('button', { name: 'Lire la description', exact: true }).click()
  const rich = page.getByRole('dialog').locator('.rich-text').first()
  await expect(rich.locator('a[data-ticket-id]')).toHaveCount(1)
  await expect(rich.locator('code')).toHaveText('#' + number)
  await expect(rich.locator('script')).toHaveCount(0)
  await rich.getByRole('link', { name: '#' + number, exact: true }).click()
  await expect(page.getByLabel('Titre du ticket')).toHaveValue('Préparer')
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await card(page, 'Déployer').locator('.ticket-open').click()
  await page.getByText('Copier ou dupliquer le ticket', { exact: true }).click()
  await page.getByRole('button', { name: 'Copier en Markdown', exact: true }).click()
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied)
  expect(copied).toContain('Déployer')
  expect(copied).toContain('Prérequis :')
  expect(copied).toContain('Parent : #' + number)
  await page.getByLabel('Projet de la copie').selectOption({ label: 'Site personnel' })
  await page.getByRole('button', { name: 'Dupliquer le ticket', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Site personnel')
  await expect(page.getByRole('combobox', { name: 'Statut', exact: true })).toHaveValue('todo')
  await expect(page.getByLabel('Ticket parent')).toHaveValue('')
  await expect(page.getByRole('dialog').locator('input[type=checkbox]:checked')).toHaveCount(0)
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(card(page, 'Déployer')).toContainText('Dépend de')
})

test('assistant instructions survive reload and tiny images respect ticket description limits', async ({
  page,
}) => {
  await setup(page)
  await add(page, 'Images et instructions')
  await card(page, 'Images et instructions').locator('.ticket-open').click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Assistant PC/ })
    .click()
  await page
    .getByLabel('Instructions personnalisées')
    .fill('Structure en étapes courtes sans changer le sens.')
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await page.reload()
  await card(page, 'Images et instructions').locator('.ticket-open').click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Assistant PC/ })
    .click()
  await expect(page.getByLabel('Instructions personnalisées')).toHaveValue(
    'Structure en étapes courtes sans changer le sens.',
  )
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const context = canvas.getContext('2d')!
    context.fillStyle = '#2d674f'
    context.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const image = { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') }
  await page.getByLabel('Image du ticket').setInputFiles(image)
  await expect(page.getByLabel('Description')).toHaveValue(/data:image\/webp;base64/)
  await page.getByRole('button', { name: 'Lire la description', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.rich-text img')).toHaveCount(1)
  await page.getByLabel('Description').fill('a'.repeat(11995))
  await page.getByLabel('Image du ticket').setInputFiles(image)
  await expect(page.getByRole('alert')).toContainText('dépasse la place disponible')
  await expect(page.getByLabel('Description')).toHaveValue('a'.repeat(11995))
})
