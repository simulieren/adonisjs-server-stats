import { createApp } from 'vue'
import DebugPanel from '../../vue/components/DebugPanel/DebugPanel.vue'

interface DebugConfig {
  debugEndpoint?: string
  authToken?: string
  dashboardPath?: string | null
}

const configEl = document.getElementById('ss-dbg-config')
const config: DebugConfig = configEl ? JSON.parse(configEl.textContent || '{}') : {}

const root = document.getElementById('ss-dbg-panel')
if (root) {
  createApp(DebugPanel, {
    debugEndpoint: config.debugEndpoint,
    authToken: config.authToken,
    dashboardPath: config.dashboardPath || undefined,
  }).mount(root)
}
