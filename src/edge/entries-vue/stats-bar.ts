import { createApp, defineComponent, h, ref, watch } from 'vue'

import StatsBar from '../../vue/components/StatsBar/StatsBar.vue'
import { readConfig } from '../bootstrap.js'

import type { EdgeBarConfig, EdgeDebugConfig } from '../types.js'

const config = readConfig<EdgeBarConfig>('ss-bar-config')

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

function getOrCreateDebugContainer(): HTMLElement {
  let container = document.getElementById('ss-dbg-deferred')
  if (!container) {
    container = document.createElement('div')
    container.id = 'ss-dbg-deferred'
    const bar = document.getElementById('ss-bar')
    if (bar?.parentNode) {
      bar.parentNode.insertBefore(container, bar.nextSibling)
    } else {
      document.body.appendChild(container)
    }
  }
  return container
}

/** Mount the debug panel into the container. */
function mountDebugPanel(
  debugLoaded: { value: boolean },
  debugConfig: EdgeDebugConfig | undefined,
  live: boolean
): void {
  if (!debugLoaded.value) debugLoaded.value = loadDeferredDebugPanel()
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
    window.__ssDebugPanel.mount(container, debugConfig, live)
  } catch (error) {
    console.error('[server-stats] Debug panel mount failed:', error)
  }
}

/** Unmount the debug panel. */
function unmountDebugPanel(): void {
  const container = document.getElementById('ss-dbg-deferred')
  if (!window.__ssDebugPanel || !container) return
  try {
    window.__ssDebugPanel.unmount(container)
  } catch (error) {
    console.error('[server-stats] Debug panel unmount failed:', error)
  }
}

/** Set up the debug panel watch effect. */
function setupDebugWatch(
  debugOpen: { value: boolean },
  isLive: { value: boolean },
  debugLoaded: { value: boolean },
  debugConfig: EdgeDebugConfig | undefined
): void {
  watch(
    [debugOpen, isLive],
    ([open, live]) => {
      if (open) {
        mountDebugPanel(debugLoaded, debugConfig, live)
      } else {
        unmountDebugPanel()
      }
    },
    { flush: 'post' }
  )
}

/** Build the render function for the StatsBar component. */
function buildRender(debugOpen: { value: boolean }, isLive: { value: boolean }) {
  return () =>
    h(StatsBar, {
      endpoint: config.endpoint,
      pollInterval: config.pollInterval,
      channelName: config.channelName,
      authToken: config.authToken,
      debugEndpoint: config.debugEndpoint,
      debugPanelOpen: debugOpen.value,
      onOpenDebugPanel: config.showDebug
        ? () => {
            debugOpen.value = !debugOpen.value
          }
        : undefined,
      onConnectionChange: (connected: boolean) => {
        isLive.value = connected
      },
    })
}

const App = defineComponent({
  setup() {
    const debugOpen = ref(false)
    const isLive = ref(false)
    const debugLoaded = ref(false)

    const debugConfig: EdgeDebugConfig | undefined = config.showDebug
      ? {
          debugEndpoint: config.debugEndpoint,
          authToken: config.authToken,
          dashboardPath: config.dashboardPath,
        }
      : undefined

    if (config.showDebug) setupDebugWatch(debugOpen, isLive, debugLoaded, debugConfig)

    return buildRender(debugOpen, isLive)
  },
})

const root = document.getElementById('ss-bar')
if (root) createApp(App).mount(root)
