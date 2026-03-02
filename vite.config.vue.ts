import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

import { externalizeCorePlugin } from './vite-plugins/externalize-core.js'

export default defineConfig({
  plugins: [
    externalizeCorePlugin(),
    vue(),
    dts({
      tsconfigPath: './tsconfig.vue.json',
      outDir: 'dist/vue',
      entryRoot: 'src/vue',
    }),
  ],

  build: {
    lib: {
      entry: resolve(__dirname, 'src/vue/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist/vue',
    emptyOutDir: true,

    // Extract CSS into a separate file
    cssCodeSplit: false,

    rollupOptions: {
      external: (id) => {
        // Externalize Vue
        if (id === 'vue' || id.startsWith('vue/')) return true

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
