import type { Plugin } from 'vite'

/**
 * Vite plugin that rewrites all relative imports to src/core/ to the
 * bare package specifier `adonisjs-server-stats/core` and marks them external.
 * Must run with `enforce: 'pre'` so it intercepts before Vite resolves the path.
 */
export function externalizeCorePlugin(): Plugin {
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
