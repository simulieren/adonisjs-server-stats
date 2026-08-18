import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.core.json',
      outDir: 'dist/core',
      // entryRoot at `src` (not `src/core`) so that the shared type files the
      // core barrel re-exports (`../types.js` → src/types.ts, `../debug/types.js`
      // → src/debug/types.ts, plus src/collectors/collector.ts) are emitted
      // *inside* dist/core, preserving the relative import paths. With
      // entryRoot at `src/core` those files fall outside the root and
      // vite-plugin-dts refuses to write them ("Outside emitted"), leaving the
      // `../types.js` re-exports in dist/core/types.d.ts dangling (TS2307 for
      // any consumer of `adonisjs-server-stats/core`).
      entryRoot: 'src',
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

    minify: 'esbuild',

    rollupOptions: {
      external: ['@adonisjs/transmit-client'],
    },
  },
})
