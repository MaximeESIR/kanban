import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
async function setup(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Remplir les identifiants' }).click()
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click()
  await page.getByLabel('Nom du projet').fill('Jetson')
  await page.getByRole('button', { name: 'Créer le projet', exact: true }).click()
}
async function add(
  page: Page,
  title: string,
  prerequisites: string[] = [],
  parent?: string,
  priority = 'medium',
) {
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Titre du ticket').fill(title)
  await dialog.getByRole('combobox', { name: 'Priorité', exact: true }).selectOption(priority)
  if (parent) {
    const value = await dialog
      .getByLabel('Ticket parent')
      .getByRole('option')
      .filter({ hasText: parent })
      .getAttribute('value')
    await dialog.getByLabel('Ticket parent').selectOption(value!)
  }
  for (const p of prerequisites) await dialog.getByRole('checkbox', { name: new RegExp(p) }).check()
  await dialog.getByRole('button', { name: 'Créer le ticket', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}
const card = (page: Page, title: string) =>
  page
    .locator('article.ticket-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })

test('parents, shared prerequisites, readiness and filtering stay consistent', async ({
  page,
}, testInfo) => {
  await setup(page)
  await add(page, 'Préparer Linux')
  await add(page, 'Exporter modèle')
  await add(page, 'Déployer', ['Préparer Linux', 'Exporter modèle'])
  await add(page, 'Documenter', ['Préparer Linux'], 'Déployer')
  await expect(card(page, 'Documenter')).toHaveAttribute('data-depth', '1')
  await expect(card(page, 'Déployer')).toContainText('Bloqué · 0/2')
  await card(page, 'Préparer Linux').getByLabel('Statut de Préparer Linux').selectOption('done')
  await expect(card(page, 'Déployer')).toContainText('Bloqué · 1/2')
  await expect(card(page, 'Documenter')).toContainText('Prêt · 1/1')
  await card(page, 'Exporter modèle').getByLabel('Statut de Exporter modèle').selectOption('done')
  await expect(card(page, 'Déployer')).toContainText('Prêt · 2/2')
  await expect(page.getByRole('status').filter({ hasText: 'Prêt(s) : Déployer' })).toBeVisible()
  await page.getByLabel('Rechercher un ticket').fill('Documenter')
  await expect(card(page, 'Documenter')).toHaveAttribute('data-depth', '0')
  await page.getByLabel('Rechercher un ticket').fill('')
  await card(page, 'Déployer').locator('.ticket-open').click()
  await expect(
    page.getByLabel('Ticket parent').getByRole('option').filter({ hasText: 'Documenter' }),
  ).toHaveCount(0)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-ticket-relations.png`,
    fullPage: true,
  })
  await page.getByRole('dialog').evaluate((dialog) => {
    dialog.scrollTop = dialog.scrollHeight
  })
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-ticket-relations-bottom.png` })
  await page.getByRole('button', { name: 'Nouveau sous-ticket', exact: true }).click()
  await expect(page.getByLabel('Ticket parent').locator('option:checked')).toContainText('Déployer')
  await page.getByLabel('Titre du ticket').fill('Mesurer les performances')
  await page.getByRole('button', { name: 'Créer le ticket', exact: true }).click()
  await page.reload()
  await expect(card(page, 'Déployer')).toContainText('Sous-tickets : 0/2')
  await expect(card(page, 'Mesurer les performances')).toHaveAttribute('data-depth', '1')
})

test('global recent/priority sort persists and reacts to a ticket edit', async ({ page }) => {
  await setup(page)
  await add(page, 'Urgence Jetson', [], undefined, 'urgent')
  await add(page, 'Dernière idée', [], undefined, 'low')
  await page.getByRole('button', { name: 'Tous les projets', exact: true }).click()
  await page.getByRole('button', { name: 'Tous les tickets', exact: true }).click()
  const global = page.getByRole('region', { name: 'Tous les tickets', exact: true })
  await expect(global.locator('article').first()).toContainText('Urgence Jetson')
  await page.getByLabel('Trier tous les tickets').selectOption('recent')
  await expect(global.locator('article').first()).toContainText('Dernière idée')
  await global.getByRole('button', { name: 'Urgence Jetson', exact: true }).click()
  await page.getByLabel('Description').fill('Retouché récemment')
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(global.locator('article').first()).toContainText('Urgence Jetson')
  await page.reload()
  await page.getByRole('button', { name: 'Tous les tickets', exact: true }).click()
  await expect(page.getByLabel('Trier tous les tickets')).toHaveValue('recent')
})

test('ticket saves on close/background and recovers an interrupted draft', async ({ page }) => {
  await setup(page)
  await add(page, 'Brouillon')
  await card(page, 'Brouillon').locator('.ticket-open').click()
  await page.getByLabel('Description').fill('Sauvé en fermant')
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(card(page, 'Brouillon')).toContainText('Sauvé en fermant')
  await card(page, 'Brouillon').locator('.ticket-open').click()
  await page.getByLabel('Description').fill('Sauvé en arrière-plan')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Prêt.')
  await page.evaluate(() =>
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }),
  )
  await page.getByLabel('Description').fill('Saisie interrompue à récupérer')
  await page.reload()
  await expect(card(page, 'Brouillon')).toContainText('Sauvé en arrière-plan')
  await card(page, 'Brouillon').locator('.ticket-open').click()
  await page.getByRole('button', { name: 'Reprendre le brouillon' }).click()
  await expect(page.getByLabel('Description')).toHaveValue('Saisie interrompue à récupérer')
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(card(page, 'Brouillon')).toContainText('Saisie interrompue à récupérer')
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  await page.getByLabel('Titre du ticket').fill('Nouveau brouillon')
  await page.reload()
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  await page.getByRole('button', { name: 'Reprendre le brouillon' }).click()
  await expect(page.getByLabel('Titre du ticket')).toHaveValue('Nouveau brouillon')
  await page.getByRole('button', { name: 'Créer le ticket', exact: true }).click()
  await expect(card(page, 'Nouveau brouillon')).toBeVisible()
})

test('a concurrent edit cannot be overwritten by a stale ticket form', async ({ page }) => {
  await setup(page)
  await add(page, 'Concurrent')
  await card(page, 'Concurrent').locator('.ticket-open').click()
  await page.getByLabel('Description').fill('Ma version')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => {
      try {
        return Array.isArray(JSON.parse(localStorage.getItem(k)!).tickets)
      } catch {
        return false
      }
    })!
    const data = JSON.parse(localStorage.getItem(key)!)
    const t = data.tickets.find((t: { title: string }) => t.title === 'Concurrent')
    t.description = 'Autre appareil'
    t.updated_at = '2099-01-01T00:00:00Z'
    localStorage.setItem(key, JSON.stringify(data))
    window.dispatchEvent(new Event('focus'))
  })
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('a changé')
  await expect(page.getByLabel('Description')).toHaveValue('Ma version')
  await page.getByRole('button', { name: 'Créer une copie du brouillon' }).click()
  await expect(
    page.locator('article.ticket-card').filter({ hasText: 'Autre appareil' }),
  ).toBeVisible()
  await expect(page.locator('article.ticket-card').filter({ hasText: 'Ma version' })).toBeVisible()
})
