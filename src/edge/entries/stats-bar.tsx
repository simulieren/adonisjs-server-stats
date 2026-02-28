import { render } from 'preact'
import { useState } from 'preact/hooks'
import { StatsBar } from '../../react/components/StatsBar/StatsBar.js'
import { DebugPanel } from '../../react/components/DebugPanel/DebugPanel.js'

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

/** Wrapper component to manage shared debug panel open state. */
function StatsBarApp() {
  const [debugOpen, setDebugOpen] = useState(false)
  const [isLive, setIsLive] = useState(false)

  const debugOptions = config.showDebug
    ? { debugEndpoint: config.debugEndpoint, authToken: config.authToken }
    : undefined

  return (
    <>
      <StatsBar
        endpoint={config.endpoint}
        pollInterval={config.pollInterval}
        channelName={config.channelName}
        authToken={config.authToken}
        featureOptions={debugOptions}
        autoHideOnUnauthorized={false}
        onOpenDebugPanel={config.showDebug ? () => setDebugOpen((p) => !p) : undefined}
        debugPanelOpen={debugOpen}
        onConnectionChange={setIsLive}
      />
      {config.showDebug && (
        <DebugPanel
          debugEndpoint={config.debugEndpoint}
          authToken={config.authToken}
          dashboardPath={config.dashboardPath || undefined}
          isOpen={debugOpen}
          onOpenChange={setDebugOpen}
          isLive={isLive}
        />
      )}
    </>
  )
}

const root = document.getElementById('ss-bar')
if (root) {
  render(<StatsBarApp />, root)
}
