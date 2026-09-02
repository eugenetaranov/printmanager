import { defineConfig } from 'vite'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev the SPA is served by Vite, but the JSON API lives on the Python
// scan-web server. Forward the API path prefixes to it. Point VITE_API_TARGET
// at a running backend (a dev box or the Pi), e.g.
//   VITE_API_TARGET=http://printmanager.local npm run dev
const API_TARGET = process.env.VITE_API_TARGET || 'http://printmanager.local'

// `/scan`, `/print`, `/document` are BOTH client-side page routes (a browser
// navigation should load the SPA shell) AND API endpoints (POST /scan, POST
// /print, POST /document/*). Disambiguate by request: an HTML GET navigation is
// a deep link → let Vite serve the SPA; anything else is an API call → proxy it.
const PAGE_ROUTES = ['/scan', '/print', '/document']

// Pure API prefixes — always proxied.
const API_ONLY = [
  '/recent', '/rename', '/remove', '/clear', '/merge',
  '/file', '/thumb', '/templates', '/devices', '/niimbot',
]

function htmlNavBypass(req: IncomingMessage): string | undefined {
  const accept = req.headers.accept || ''
  if (req.method === 'GET' && accept.includes('text/html')) return '/index.html'
  return undefined
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      ...Object.fromEntries(
        PAGE_ROUTES.map((p) => [p, { target: API_TARGET, changeOrigin: true, bypass: htmlNavBypass }]),
      ),
      ...Object.fromEntries(
        API_ONLY.map((p) => [p, { target: API_TARGET, changeOrigin: true }]),
      ),
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
})
