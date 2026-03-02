import type { Plugin } from 'vite'

/**
 * Vite plugin that discards CSS imports so they are not injected into
 * the JS bundle.  Edge templates serve CSS separately via readFileSync.
 */
export function discardCssPlugin(): Plugin {
  return {
    name: 'discard-css',
    transform(_code, id) {
      if (id.endsWith('.css')) return { code: '', map: null }
      return null
    },
  }
}
