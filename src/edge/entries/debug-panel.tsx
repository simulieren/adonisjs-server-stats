import { render } from 'preact'
import { DebugPanel } from '../../react/components/DebugPanel/DebugPanel.js'
import { readConfig } from '../bootstrap.js'
import type { EdgeDebugConfig } from '../types.js'

const config = readConfig<EdgeDebugConfig>('ss-dbg-config')

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
