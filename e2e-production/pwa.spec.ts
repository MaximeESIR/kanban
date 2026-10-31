import { test, expect } from '@playwright/test'
test('installed shell works offline, including a reload and persisted edits', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Remplir les identifiants' }).click()
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      )
  })
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!
    return (await fetch(link.href)).json()
  })
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.length).toBeGreaterThan(1)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'De l’idée au projet.' })).toBeVisible()
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click()
  await page.getByLabel('Nom du projet').fill('Créé sans réseau')
  await page.getByRole('button', { name: 'Créer le projet', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Créé sans réseau', exact: true })).toBeVisible()
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Créé sans réseau', exact: true })).toBeVisible()
})
