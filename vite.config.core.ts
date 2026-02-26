import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.core.json',
      outDir: 'dist/core',
      entryRoot: 'src/core',
    }),
  ],

  build: {
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist/core',
    emptyOutDir: true,

    rollupOptions: {
      external: ['@adonisjs/transmit-client'],
    },
  },
})
