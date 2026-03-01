import { render } from 'preact'
import { useState, useCallback, useEffect, useRef } from 'preact/hooks'
import { StatsBar } from '../../react/components/StatsBar/StatsBar.js'
import { readConfig } from '../bootstrap.js'
import type { EdgeBarConfig, EdgeDebugConfig } from '../types.js'

const config = readConfig<EdgeBarConfig>('ss-bar-config')

/**
 * Evaluate the deferred debug-panel script (embedded as
 * `<script type="text/plain" data-ss-deferred="debug-panel">`).
 *
 * Creates a real `<script>` element with the same text content and appends it
 * to `<head>`. The deferred entry self-registers onto `window.__ssDebugPanel`.
 */
function loadDeferredDebugPanel(): boolean {
  if (window.__ssDebugPanel) return true

  const inert = document.querySelector<HTMLScriptElement>(
    'script[type="text/plain"][data-ss-deferred="debug-panel"]'
  )
  if (!inert) {
    console.error('[server-stats] Deferred debug panel script not found')
    return false
  }

  try {
    const s = document.createElement('script')
    s.textContent = inert.textContent
    document.head.appendChild(s)
  } catch (error) {
    console.error('[server-stats] Debug panel script evaluation failed:', error)
    return false
  }

  if (!window.__ssDebugPanel) {
    console.error('[server-stats] Debug panel failed to register after script evaluation')
    return false
  }

  return true
}

/**
 * Get or create the container div for the deferred debug panel.
 * The container is created as a sibling of #ss-bar, outside the Preact
 * VDOM tree, so that Preact's diffing does not interfere with the
 * separately-rendered debug panel.
 */
function getOrCreateDebugContainer(): HTMLElement {
  let container = document.getElementById('ss-dbg-deferred')
  if (!container) {
    container = document.createElement('div')
    container.id = 'ss-dbg-deferred'
    // Insert right after the #ss-bar element
    const bar = document.getElementById('ss-bar')
    if (bar?.parentNode) {
      bar.parentNode.insertBefore(container, bar.nextSibling)
    } else {
      document.body.appendChild(container)
    }
  }
  return container
}

/** Wrapper component to manage shared debug panel open state. */
function StatsBarApp() {
  const [debugOpen, setDebugOpen] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const debugLoadedRef = useRef(false)

  const debugConfig: EdgeDebugConfig | undefined = config.showDebug
    ? {
        debugEndpoint: config.debugEndpoint,
        authToken: config.authToken,
        dashboardPath: config.dashboardPath,
      }
    : undefined

  const debugOptions = config.showDebug
    ? { debugEndpoint: config.debugEndpoint, authToken: config.authToken }
    : undefined

  const handleToggleDebug = useCallback(() => {
    setDebugOpen((prev) => !prev)
  }, [])

  // Mount / unmount the deferred debug panel in response to open state changes.
  // This runs as an effect (after render) so the DOM is fully committed,
  // avoiding issues with calling render() inside a state updater.
  // The container lives outside the Preact VDOM tree to prevent the parent
  // from clearing it during re-renders.
  useEffect(() => {
    if (!config.showDebug) return

    if (debugOpen) {
      // Load the deferred debug panel script on first open
      if (!debugLoadedRef.current) {
        debugLoadedRef.current = loadDeferredDebugPanel()
      }

      if (!window.__ssDebugPanel) {
        console.error('[server-stats] Debug panel not available after load attempt')
        return
      }

      if (!debugConfig) {
        console.error('[server-stats] Debug config is undefined')
        return
      }

      const container = getOrCreateDebugContainer()

      try {
        window.__ssDebugPanel.mount(container, debugConfig, isLive)
      } catch (error) {
        console.error('[server-stats] Debug panel mount failed:', error)
      }
    } else {
      // Unmount the debug panel
      const container = document.getElementById('ss-dbg-deferred')
      if (window.__ssDebugPanel && container) {
        try {
          window.__ssDebugPanel.unmount(container)
        } catch (error) {
          console.error('[server-stats] Debug panel unmount failed:', error)
        }
      }
    }
  }, [debugOpen, isLive, debugConfig])

  return (
    <>
      <StatsBar
        endpoint={config.endpoint}
        pollInterval={config.pollInterval}
        channelName={config.channelName}
        authToken={config.authToken}
        featureOptions={debugOptions}
        autoHideOnUnauthorized={false}
        onOpenDebugPanel={config.showDebug ? handleToggleDebug : undefined}
        debugPanelOpen={debugOpen}
        onConnectionChange={setIsLive}
      />
    </>
  )
}

const root = document.getElementById('ss-bar')
if (root) {
  render(<StatsBarApp />, root)
}
