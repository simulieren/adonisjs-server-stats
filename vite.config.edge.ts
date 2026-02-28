import { resolve } from 'node:path'

import preact from '@preact/preset-vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Vite plugin that discards CSS imports so they are not injected into
 * the JS bundle.  Edge templates serve CSS separately via readFileSync.
 */
function discardCssPlugin(): Plugin {
  return {
    name: 'discard-css',
    transform(_code, id) {
      if (id.endsWith('.css')) return { code: '', map: null }
      return null
    },
  }
}

const entries: Record<string, string> = {
  'stats-bar': resolve(__dirname, 'src/edge/entries/stats-bar.tsx'),
  'debug-panel': resolve(__dirname, 'src/edge/entries/debug-panel.tsx'),
  'dashboard': resolve(__dirname, 'src/edge/entries/dashboard.tsx'),
}

const name = process.env.ENTRY || 'stats-bar'

export default defineConfig({
  plugins: [discardCssPlugin(), preact()],

  build: {
    lib: {
      entry: entries[name],
      formats: ['iife'],
      name: `ssEdge_${name.replace(/-/g, '_')}`,
      fileName: () => `${name}.js`,
    },
    outDir: resolve(__dirname, 'src/edge/client'),
    emptyOutDir: false,
    cssCodeSplit: false,
    minify: 'esbuild',

    rollupOptions: {
      external: (id) => id.includes('@adonisjs/transmit-client'),
      output: {
        inlineDynamicImports: true,
        format: 'iife',
      },
    },
  },
})
