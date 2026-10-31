import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  testDir: './e2e-production',
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173' },
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173' },
  outputDir: 'artifacts/production-tests',
})
