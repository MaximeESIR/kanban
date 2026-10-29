import { expect, it } from 'vitest'
import { demoAllowed, publicConfigError } from '../src/config'
import { spawnSync } from 'node:child_process'

it('requires an explicit opt-in for a public demo and never falls back from Supabase', () => {
  expect(demoAllowed(undefined, undefined, undefined, 'maximeesir.github.io')).toBe(false)
  expect(demoAllowed(undefined, undefined, 'true', 'maximeesir.github.io')).toBe(true)
  expect(demoAllowed(undefined, undefined, 'false', 'localhost')).toBe(true)
  expect(demoAllowed('https://example.supabase.co', undefined, 'true', 'localhost')).toBe(false)
  expect(demoAllowed(undefined, 'sb_publishable_TEST', 'true', 'localhost')).toBe(false)
  expect(
    demoAllowed(
      'https://example.supabase.co',
      'sb_publishable_TEST',
      'true',
      'maximeesir.github.io',
    ),
  ).toBe(false)
})

it('allows CI to deploy the explicit demo but refuses incomplete or secret Supabase configuration', () => {
  function check(url: string, key: string, demo = 'true') {
    return spawnSync(process.execPath, ['scripts/check-config.mjs'], {
      env: {
        ...process.env,
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
        VITE_PUBLIC_DEMO: demo,
      },
    }).status
  }
  expect(check('', '')).toBe(0)
  expect(check('', '', 'false')).not.toBe(0)
  expect(check('https://example.supabase.co', '')).not.toBe(0)
  expect(check('https://example.supabase.co', 'sb_secret_TEST')).not.toBe(0)
  expect(check('https://example.supabase.co', 'sb_publishable_TEST')).toBe(0)
})

it('rejects secrets before Vite can put them in a public bundle', () => {
  expect(publicConfigError('https://example.supabase.co', 'sb_secret_FAKE_TEST_VALUE')).toContain(
    'secrète',
  )
  const fakeJwt = `eyJ.${btoa(JSON.stringify({ role: 'service_role' }))}.test`
  expect(publicConfigError('https://example.supabase.co', fakeJwt)).toContain('anon')
})
it('accepts public keys but rejects partial or insecure settings', () => {
  expect(publicConfigError()).toBeNull()
  expect(
    publicConfigError('https://example.supabase.co', 'sb_publishable_FAKE_TEST_VALUE'),
  ).toBeNull()
  expect(publicConfigError('https://example.supabase.co')).not.toBeNull()
  expect(publicConfigError('http://example.supabase.co', 'sb_publishable_FAKE')).not.toBeNull()
  expect(
    publicConfigError('https://supabase.co.attacker.example', 'sb_publishable_FAKE'),
  ).not.toBeNull()
})
