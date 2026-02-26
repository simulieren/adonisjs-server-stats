import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'

/**
 * Vite plugin that rewrites all relative imports to src/core/ to the
 * bare package specifier `adonisjs-server-stats/core` and marks them external.
 * Must run with `enforce: 'pre'` so it intercepts before Vite resolves the path.
 */
function externalizeCorePlugin(): Plugin {
  return {
    name: 'externalize-core',
    enforce: 'pre',
    resolveId(source) {
      if (/(?:\.\.\/)+core(?:\/|$)/.test(source)) {
        return { id: 'adonisjs-server-stats/core', external: true }
      }
      return null
    },
  }
}

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
