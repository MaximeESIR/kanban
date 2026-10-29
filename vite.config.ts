import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { publicConfigError } from './src/config.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const error = publicConfigError(
    env.VITE_SUPABASE_URL?.trim(),
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim(),
  )
  if (error) throw new Error(error)
  return {
    plugins: [react()],
    base: './',
    server: { port: 5173, strictPort: true },
    build: { sourcemap: false },
    test: { include: ['tests/**/*.test.ts'] },
  }
})
