import { createApp } from 'vue'
import DebugPanel from '../../vue/components/DebugPanel/DebugPanel.vue'
import { readConfig } from '../bootstrap.js'
import type { EdgeDebugConfig } from '../types.js'

const config = readConfig<EdgeDebugConfig>('ss-dbg-config')

const root = document.getElementById('ss-dbg-panel')
if (root) {
  createApp(DebugPanel, {
    debugEndpoint: config.debugEndpoint,
    authToken: config.authToken,
    dashboardPath: config.dashboardPath || undefined,
  }).mount(root)
}
