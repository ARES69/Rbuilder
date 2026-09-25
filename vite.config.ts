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
      include: ['tests/**/*.test.ts'],
    },
  }
})
