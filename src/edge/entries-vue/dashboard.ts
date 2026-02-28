import { createApp } from 'vue'
import DashboardPage from '../../vue/components/Dashboard/DashboardPage.vue'
import { getTheme, onThemeChange } from '../../core/theme.js'

interface DashConfig {
  baseUrl?: string
  dashboardEndpoint?: string
  debugEndpoint?: string
  authToken?: string
  backUrl?: string
  channelName?: string
}

const configEl = document.getElementById('ss-dash-config')
const config: DashConfig = configEl ? JSON.parse(configEl.textContent || '{}') : {}

// Sync theme to <html> so dashboard.css `:root` / `[data-theme]` selectors work.
function syncTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme)
}
syncTheme(getTheme())
onThemeChange(syncTheme)

const root = document.getElementById('ss-dash')
if (root) {
  createApp(DashboardPage, {
    baseUrl: config.baseUrl,
    dashboardEndpoint: config.dashboardEndpoint,
    debugEndpoint: config.debugEndpoint,
    authToken: config.authToken,
    backUrl: config.backUrl,
    channelName: config.channelName,
  }).mount(root)
}
