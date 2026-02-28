import { createApp, defineComponent, h, ref } from 'vue'
import StatsBar from '../../vue/components/StatsBar/StatsBar.vue'
import DebugPanel from '../../vue/components/DebugPanel/DebugPanel.vue'

interface BarConfig {
  endpoint?: string
  pollInterval?: number
  channelName?: string
  authToken?: string
  showDebug?: boolean
  debugEndpoint?: string
  dashboardPath?: string | null
}

const configEl = document.getElementById('ss-bar-config')
const config: BarConfig = configEl ? JSON.parse(configEl.textContent || '{}') : {}

/** Wrapper component to bridge StatsBar "openDebugPanel" emit to DebugPanel toggle. */
const App = defineComponent({
  setup() {
    const debugPanel = ref<InstanceType<typeof DebugPanel> | null>(null)
    const isLive = ref(false)

    return () => [
      h(StatsBar, {
        endpoint: config.endpoint,
        pollInterval: config.pollInterval,
        channelName: config.channelName,
        authToken: config.authToken,
        debugEndpoint: config.debugEndpoint,
        onOpenDebugPanel: config.showDebug ? () => debugPanel.value?.toggle() : undefined,
        onConnectionChange: (connected: boolean) => {
          isLive.value = connected
        },
      }),
      config.showDebug
        ? h(DebugPanel, {
            ref: debugPanel,
            debugEndpoint: config.debugEndpoint,
            authToken: config.authToken,
            dashboardPath: config.dashboardPath || undefined,
            isLive: isLive.value,
          })
        : null,
    ]
  },
})

const root = document.getElementById('ss-bar')
if (root) {
  createApp(App).mount(root)
}
