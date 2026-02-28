import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
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
  'stats-bar': resolve(__dirname, 'src/edge/entries-vue/stats-bar.ts'),
  'debug-panel': resolve(__dirname, 'src/edge/entries-vue/debug-panel.ts'),
  'dashboard': resolve(__dirname, 'src/edge/entries-vue/dashboard.ts'),
}

const name = process.env.ENTRY || 'stats-bar'

export default defineConfig({
  plugins: [discardCssPlugin(), vue()],

  // Vue's runtime checks process.env.NODE_ENV which doesn't exist in the
  // browser.  Vite skips the replacement in library mode, so define it here.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },

  build: {
    lib: {
      entry: entries[name],
      formats: ['iife'],
      name: `ssEdge_${name.replace(/-/g, '_')}`,
      fileName: () => `${name}.js`,
    },
    outDir: resolve(__dirname, 'src/edge/client-vue'),
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
