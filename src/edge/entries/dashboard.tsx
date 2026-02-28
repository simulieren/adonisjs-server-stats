import { render } from 'preact'
import { DashboardPage } from '../../react/components/Dashboard/DashboardPage.js'
import { readConfig, setupThemeSync } from '../bootstrap.js'
import type { EdgeDashConfig } from '../types.js'

const config = readConfig<EdgeDashConfig>('ss-dash-config')
setupThemeSync()

const root = document.getElementById('ss-dash')
if (root) {
  render(
    <DashboardPage
      baseUrl={config.baseUrl}
      dashboardEndpoint={config.dashboardEndpoint}
      debugEndpoint={config.debugEndpoint}
      authToken={config.authToken}
      backUrl={config.backUrl}
      channelName={config.channelName}
    />,
    root
  )
}
