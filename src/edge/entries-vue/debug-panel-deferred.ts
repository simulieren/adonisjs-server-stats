import { createApp, h } from 'vue'

import DebugPanel from '../../vue/components/DebugPanel/DebugPanel.vue'

import type { EdgeDebugConfig } from '../types.js'

// DeferredDebugPanel + Window augmentation live in ../types.ts

/**
 * Deferred debug panel entry for Vue.
 *
 * This IIFE is embedded in the page as `<script type="text/plain">` and only
 * evaluated when the user opens the debug panel for the first time. It exposes
 * a `window.__ssDebugPanel` object with `mount` / `unmount` helpers that the
 * slim stats-bar entry calls after promoting the inert script.
 */

let app: ReturnType<typeof createApp> | null = null

window.__ssDebugPanel = {
  mount(container: HTMLElement, config: EdgeDebugConfig, isLive: boolean) {
    if (app) {
      app.unmount()
    }

    app = createApp({
      setup() {
        return () =>
          h(DebugPanel, {
            debugEndpoint: config.debugEndpoint,
            authToken: config.authToken,
            dashboardPath: config.dashboardPath || undefined,
            isLive,
            defaultOpen: true,
          })
      },
    })

    app.mount(container)
  },

  unmount(_container: HTMLElement) {
    if (app) {
      app.unmount()
      app = null
    }
  },
}
