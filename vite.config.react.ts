import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

import { externalizeCorePlugin } from './vite-plugins/externalize-core.js'

export default defineConfig({
  plugins: [
    externalizeCorePlugin(),
    react(),
    dts({
      tsconfigPath: './tsconfig.react.json',
      outDir: 'dist/react',
      entryRoot: 'src',
    }),
  ],

  build: {
    lib: {
      entry: resolve(__dirname, 'src/react/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist/react',
    emptyOutDir: true,

    // Extract CSS into a separate file
    cssCodeSplit: false,

    rollupOptions: {
      external: (id) => {
        // Externalize React
        if (/^react(-dom)?(\/.*)?$/.test(id)) return true
        if (id === 'react/jsx-runtime') return true

        // Externalize @adonisjs/transmit-client
        if (id.includes('@adonisjs/transmit-client')) return true

        // Externalize bare core specifier (rewritten by plugin above)
        if (id.startsWith('adonisjs-server-stats/core')) return true

        return false
      },
      output: {
        assetFileNames: 'style.[ext]',
      },
    },
  },
})
