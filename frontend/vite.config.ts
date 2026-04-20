import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Matches the Caddy routing in prod: /api/* -> backend:8080.
      // When running `npm run dev`, this forwards API calls to the Go server
      // so the browser sees same-origin requests and no CORS dance is needed.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
