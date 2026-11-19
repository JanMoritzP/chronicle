import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false, ws: true } },
  },
  // ASCII-only output: a proxy or shell that serves the bundle without a charset can then never garble characters like × or …
  esbuild: { charset: 'ascii' },
  build: { chunkSizeWarningLimit: 1500 },
})
