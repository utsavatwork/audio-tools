import { defineConfig, type Connect, type Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = import.meta.dirname

// Serve tool pages at clean URLs locally (/audio-cutter -> /audio-cutter/index.html),
// the same way the CloudFront function does in production.
const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
  const [path, query] = (req.url ?? '').split('?')
  if (path !== '/' && !path.endsWith('/') && existsSync(resolve(root, path.slice(1), 'index.html'))) {
    req.url = path + '/' + (query ? '?' + query : '')
  }
  next()
}
const cleanUrls: Plugin = {
  name: 'clean-urls',
  configureServer: server => void server.middlewares.use(rewrite),
  configurePreviewServer: server => void server.middlewares.use(rewrite),
}

// Multi-page build: each HTML file here becomes its own page in dist/
export default defineConfig({
  plugins: [cleanUrls],
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        audioCutter: resolve(root, 'audio-cutter/index.html'),
        privacy: resolve(root, 'privacy.html'),
        notFound: resolve(root, '404.html'),
      },
    },
  },
})
