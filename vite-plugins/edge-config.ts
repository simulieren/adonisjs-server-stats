import { resolve } from 'node:path'

import { discardCssPlugin } from './discard-css.js'

import type { Plugin, UserConfig } from 'vite'

interface EdgeConfigOptions {
  /** Framework-specific Vite plugins (e.g. preact(), vue()). */
  plugins: Plugin[]
  /** Map of entry names to file paths relative to the project root. */
  entries: Record<string, string>
  /** Output directory relative to the project root. */
  outDir: string
  /** Extra Vite `define` replacements (e.g. Vue needs process.env.NODE_ENV). */
  define?: Record<string, unknown>
}

/**
 * Factory that produces the shared Vite config used by every edge build
 * (Preact, Vue, etc.).  Only framework-specific knobs are parameterised;
 * everything else (IIFE format, external list, CSS handling, …) is fixed.
 */
export function createEdgeConfig(options: EdgeConfigOptions): UserConfig {
  const name = process.env.ENTRY || 'stats-bar'

  return {
    plugins: [discardCssPlugin(), ...options.plugins],

    ...(options.define ? { define: options.define } : {}),

    build: {
      lib: {
        entry: options.entries[name],
        formats: ['iife'],
        name: `ssEdge_${name.replace(/-/g, '_')}`,
        fileName: () => `${name}.js`,
      },
      outDir: resolve(__dirname, '..', options.outDir),
      emptyOutDir: false,
      cssCodeSplit: false,
      minify: 'esbuild',

      rollupOptions: {
        external: (id: string) => id.includes('@adonisjs/transmit-client'),
        output: {
          inlineDynamicImports: true,
          format: 'iife' as const,
        },
      },
    },
  }
}
