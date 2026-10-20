import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      // The app calls /api on its own origin; Vite forwards it to the API in development.
      // Same origin = first-party session cookie, no CORS, exactly like production.
      proxy: {
        '/api': { target: env.API_PROXY_TARGET || 'http://localhost:5000', changeOrigin: false },
      },
    },
    build: {
      // react-dom + recharts + gsap are inherently chunky; routes are already split.
      chunkSizeWarningLimit: 700,
    },
  }
})
