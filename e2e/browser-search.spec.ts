import { test, expect } from '@playwright/test'

test('search notes and project tickets without PC, AI request or network', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Remplir les identifiants' }).click()
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await page.getByRole('button', { name: 'Ouvrir Site personnel', exact: true }).click()
  await page.getByRole('button', { name: 'Nouveau ticket', exact: true }).click()
  await page.getByLabel('Titre du ticket').fill('Déploiement Jetson')
  await page.getByLabel('Description').fill('Installer le code sur le drone')
  await page.getByRole('button', { name: 'Créer le ticket', exact: true }).click()
  await context.setOffline(true)
  await page.getByLabel('Rechercher sans IA', { exact: true }).fill('jetsn')
  const results = page.getByRole('region', { name: 'Recherche sans IA' })
  await expect(results.getByRole('status')).toHaveText('1 résultat')
  await results.getByRole('button', { name: /Déploiement Jetson/ }).click()
  await expect(page.getByRole('dialog').getByLabel('Titre du ticket')).toHaveValue(
    'Déploiement Jetson',
  )
  await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await page
    .getByRole('button', { name: /^Notes/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Nouvelle note', exact: true }).click()
  await page.getByLabel('Titre de la note').fill('Carnet du drone')
  await page.getByLabel('Contenu de la note').fill('Déploiement Jetson sur le terrain')
  await page.getByLabel('Rechercher sans IA', { exact: true }).fill('deploiement')
  await expect(results.getByRole('button', { name: 'Carnet du drone' })).toBeVisible()
  await page.getByLabel('Rechercher sans IA', { exact: true }).fill('astrophysique')
  await expect(results.getByRole('status')).toContainText('Aucun résultat')
})

test('search engine preference persists and switches both notes and projects', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Remplir les identifiants' }).click()
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await page.getByRole('button', { name: 'Ouvrir Site personnel', exact: true }).click()
  await expect(page.getByLabel('Rechercher sans IA', { exact: true })).toBeVisible()
  await page.getByText('Paramètres de recherche', { exact: true }).click()
  await page.getByLabel('Moteur de recherche').selectOption('pc')
  await expect(page.getByLabel('Rechercher sans IA', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Assistant PC/ }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Rechercher sans IA', { exact: true })).toHaveCount(0)
  await page
    .getByRole('button', { name: /^Notes/ })
    .first()
    .click()
  await expect(page.getByLabel('Rechercher sans IA', { exact: true })).toHaveCount(0)
  await page.getByText('Paramètres de recherche', { exact: true }).click()
  await expect(page.getByLabel('Moteur de recherche')).toHaveValue('pc')
  await page.getByLabel('Moteur de recherche').selectOption('browser')
  await expect(page.getByLabel('Rechercher sans IA', { exact: true })).toBeVisible()
})
