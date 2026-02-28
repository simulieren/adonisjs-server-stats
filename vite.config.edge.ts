import { resolve } from 'node:path'

import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

import { createEdgeConfig } from './vite-plugins/edge-config.js'

export default defineConfig(
  createEdgeConfig({
    plugins: [preact()],
    entries: {
      'stats-bar': resolve(__dirname, 'src/edge/entries/stats-bar.tsx'),
      'debug-panel': resolve(__dirname, 'src/edge/entries/debug-panel.tsx'),
      'dashboard': resolve(__dirname, 'src/edge/entries/dashboard.tsx'),
    },
    outDir: 'src/edge/client',
  }),
)
