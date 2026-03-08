import { render } from 'preact'
import { useState, useCallback, useEffect, useMemo, useRef } from 'preact/hooks'

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

/** Mount the debug panel into the deferred container. */
function mountDebugPanel(
  debugConfig: EdgeDebugConfig,
  isLiveRef: { current: boolean },
  debugLoadedRef: { current: boolean }
) {
  if (!debugLoadedRef.current) {
    debugLoadedRef.current = loadDeferredDebugPanel()
  }
  if (!window.__ssDebugPanel) return
  const container = getOrCreateDebugContainer()
  try {
    window.__ssDebugPanel.mount(container, debugConfig, isLiveRef.current)
  } catch (error) {
    console.error('[server-stats] Debug panel mount failed:', error)
  }
}

/** Unmount the debug panel from its container. */
function unmountDebugPanel() {
  const container = document.getElementById('ss-dbg-deferred')
  if (window.__ssDebugPanel && container) {
    try {
      window.__ssDebugPanel.unmount(container)
    } catch (error) {
      console.error('[server-stats] Debug panel unmount failed:', error)
    }
  }
}

/** Custom hook: manage debug panel mount/unmount lifecycle. */
function useDebugPanelEffect(
  debugOpen: boolean,
  debugConfig: EdgeDebugConfig | undefined,
  isLiveRef: { current: boolean }
) {
  const debugLoadedRef = useRef(false)
  useEffect(() => {
    if (!config.showDebug) return
    if (debugOpen && debugConfig) {
      mountDebugPanel(debugConfig, isLiveRef, debugLoadedRef)
    } else {
      unmountDebugPanel()
    }
  }, [debugOpen, debugConfig, isLiveRef])
}

/** Wrapper component to manage shared debug panel open state. */
function StatsBarApp() {
  const [debugOpen, setDebugOpen] = useState(false)
  const isLiveRef = useRef(false)
  const handleConnectionChange = useCallback((connected: boolean) => {
    isLiveRef.current = connected
  }, [])

  const debugConfig = useMemo<EdgeDebugConfig | undefined>(
    () =>
      config.showDebug
        ? {
            debugEndpoint: config.debugEndpoint,
            authToken: config.authToken,
            dashboardPath: config.dashboardPath,
          }
        : undefined,
    [config.showDebug, config.debugEndpoint, config.authToken, config.dashboardPath]
  )

  const debugOptions = useMemo(
    () =>
      config.showDebug
        ? { debugEndpoint: config.debugEndpoint, authToken: config.authToken }
        : undefined,
    [config.showDebug, config.debugEndpoint, config.authToken]
  )

  const handleToggleDebug = useCallback(() => {
    setDebugOpen((prev) => !prev)
  }, [])
  useDebugPanelEffect(debugOpen, debugConfig, isLiveRef)

  return (
    <StatsBar
      endpoint={config.endpoint}
      pollInterval={config.pollInterval}
      channelName={config.channelName}
      authToken={config.authToken}
      featureOptions={debugOptions}
      autoHideOnUnauthorized={false}
      onOpenDebugPanel={config.showDebug ? handleToggleDebug : undefined}
      debugPanelOpen={debugOpen}
      onConnectionChange={handleConnectionChange}
    />
  )
}

const root = document.getElementById('ss-bar')
if (root) {
  render(<StatsBarApp />, root)
}
