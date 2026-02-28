import { render } from 'preact'
import { DebugPanel } from '../../react/components/DebugPanel/DebugPanel.js'

interface DebugConfig {
  debugEndpoint?: string
  authToken?: string
  dashboardPath?: string | null
}

const configEl = document.getElementById('ss-dbg-config')
const config: DebugConfig = configEl ? JSON.parse(configEl.textContent || '{}') : {}

const root = document.getElementById('ss-dbg-panel')
if (root) {
  render(
    <DebugPanel
      debugEndpoint={config.debugEndpoint}
      authToken={config.authToken}
      dashboardPath={config.dashboardPath || undefined}
      defaultOpen={false}
    />,
    root
  )
}
