/**
 * Public exports for the Vue 3 Inertia integration.
 *
 * Usage:
 * ```ts
 * import {
 *   ServerStatsBar,
 *   DebugPanel,
 *   DashboardPage,
 *   useServerStats,
 *   useDebugData,
 *   useDashboardData,
 *   useTheme,
 *   useFeatures,
 * } from 'adonisjs-server-stats/vue'
 * ```
 */

// -- CSS (extracted by Vite into style.css) -----------------------------------

import '../styles/tokens.css'
import '../styles/components.css'
import '../styles/utilities.css'
import '../styles/stats-bar.css'
import '../styles/debug-panel.css'
import '../styles/dashboard.css'

// -- Components ---------------------------------------------------------------

export { default as ServerStatsBar } from './components/StatsBar/StatsBar.vue'
export { default as DebugPanel } from './components/DebugPanel/DebugPanel.vue'
export { default as DashboardPage } from './components/Dashboard/DashboardPage.vue'

// -- Composables --------------------------------------------------------------

export { useServerStats } from './composables/useServerStats.js'
export { useDebugData } from './composables/useDebugData.js'
export { useDashboardData } from './composables/useDashboardData.js'
export { useTheme } from './composables/useTheme.js'
export { useFeatures } from './composables/useFeatures.js'

// -- Re-exports from core (types) --------------------------------------------

export type {
  ServerStats,
  StatsBarConfig,
  DebugPanelConfig,
  DashboardConfig,
  FeatureConfig,
  Theme,
  TimeRange,
  DebugTab,
  DashboardSection,
} from '../core/index.js'
