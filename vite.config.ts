import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Multi-page build: each HTML file here becomes its own page in dist/
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
        notFound: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
})
