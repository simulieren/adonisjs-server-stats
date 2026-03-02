import { createApp, defineComponent, h, ref, watch } from 'vue'

import StatsBar from '../../vue/components/StatsBar/StatsBar.vue'
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
 * The container is created as a sibling of #ss-bar, outside the Vue
 * VDOM tree, so that Vue's patching does not interfere with the
 * separately-mounted debug panel app.
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

/** Wrapper component to bridge StatsBar "openDebugPanel" emit to deferred DebugPanel. */
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

    function handleToggleDebug() {
      debugOpen.value = !debugOpen.value
    }

    // Mount / unmount the deferred debug panel in response to open state
    // changes. Using watch (with flush: 'post') ensures the DOM is fully
    // committed before we interact with it. The container lives outside the
    // Vue VDOM tree to prevent the parent from clearing it during re-renders.
    if (config.showDebug) {
      watch(
        [debugOpen, isLive],
        ([open, live]) => {
          if (open) {
            // Load the deferred debug panel script on first open
            if (!debugLoaded.value) {
              debugLoaded.value = loadDeferredDebugPanel()
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
              window.__ssDebugPanel.mount(container, debugConfig, live)
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
        },
        { flush: 'post' }
      )
    }

    return () =>
      h(StatsBar, {
        endpoint: config.endpoint,
        pollInterval: config.pollInterval,
        channelName: config.channelName,
        authToken: config.authToken,
        debugEndpoint: config.debugEndpoint,
        debugPanelOpen: debugOpen.value,
        onOpenDebugPanel: config.showDebug ? handleToggleDebug : undefined,
        onConnectionChange: (connected: boolean) => {
          isLive.value = connected
        },
      })
  },
})

const root = document.getElementById('ss-bar')
if (root) {
  createApp(App).mount(root)
}
