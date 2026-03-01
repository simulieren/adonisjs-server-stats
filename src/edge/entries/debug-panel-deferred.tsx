import { render } from 'preact'
import { DebugPanel } from '../../react/components/DebugPanel/DebugPanel.js'

import type { EdgeDebugConfig } from '../types.js'

// DeferredDebugPanel + Window augmentation live in ../types.ts

/**
 * Deferred debug panel entry for Preact.
 *
 * This IIFE is embedded in the page as `<script type="text/plain">` and only
 * evaluated when the user opens the debug panel for the first time. It exposes
 * a `window.__ssDebugPanel` object with `mount` / `unmount` helpers that the
 * slim stats-bar entry calls after promoting the inert script.
 */

window.__ssDebugPanel = {
  mount(container: HTMLElement, config: EdgeDebugConfig, isLive: boolean) {
    render(
      <DebugPanel
        debugEndpoint={config.debugEndpoint}
        authToken={config.authToken}
        dashboardPath={config.dashboardPath || undefined}
        isOpen={true}
        isLive={isLive}
      />,
      container
    )
  },

  unmount(container: HTMLElement) {
    render(null, container)
  },
}
