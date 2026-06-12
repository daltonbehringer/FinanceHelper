import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // All backend routes (including /api/auth/*) live under /api, so a single
      // proxy entry keeps cookies same-origin (localhost:3000) in dev.
      '/api': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // echarts changes rarely and is the heaviest dep — split it into its own
        // long-cacheable chunk (and keep the app chunk under the size warning).
        manualChunks: {
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
        },
      },
    },
  },
})
