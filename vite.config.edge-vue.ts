import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

import { createEdgeConfig } from './vite-plugins/edge-config.js'

export default defineConfig(
  createEdgeConfig({
    plugins: [vue()],
    entries: {
      'stats-bar': resolve(__dirname, 'src/edge/entries-vue/stats-bar.ts'),
      'debug-panel': resolve(__dirname, 'src/edge/entries-vue/debug-panel.ts'),
      'debug-panel-deferred': resolve(__dirname, 'src/edge/entries-vue/debug-panel-deferred.ts'),
      'dashboard': resolve(__dirname, 'src/edge/entries-vue/dashboard.ts'),
    },
    outDir: 'src/edge/client-vue',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  }),
)
