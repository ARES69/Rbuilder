import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { apiProxy } from './server/api-proxy'
import { chatProxy } from './server/chat-proxy'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), chatProxy(env), apiProxy(env)],
    server: {
      port: Number(env.PORT ?? 5173),
      strictPort: false,
    },
    test: {
      environment: 'node',
      // Component tests live beside the rest and are written in JSX, so `.tsx`
      // is collected too; the harness picks the DOM up per file through its own
      // `@vitest-environment jsdom` header. Visual shots are a separate config.
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  }
})
