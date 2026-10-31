import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  testDir: './e2e-connected',
  webServer: {
    command:
      'VITE_SUPABASE_URL=https://qa.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_QA npm run dev -- --port 5174',
    url: 'http://127.0.0.1:5174',
  },
  use: { ...base.use, baseURL: 'http://127.0.0.1:5174' },
  outputDir: 'artifacts/connected-tests',
})
