/**
 * Public React API for adonisjs-server-stats.
 *
 * Usage:
 *   import { ServerStatsBar, DebugPanel, DashboardPage } from 'adonisjs-server-stats/react'
 *   import { useServerStats, useDebugData } from 'adonisjs-server-stats/react'
 */

// ---------------------------------------------------------------------------
// CSS (extracted by Vite into style.css)
// ---------------------------------------------------------------------------

import '../styles/tokens.css'
import '../styles/components.css'
import '../styles/utilities.css'
import '../styles/stats-bar.css'
import '../styles/debug-panel.css'
import '../styles/dashboard.css'

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export { StatsBar, StatsBar as ServerStatsBar } from './components/StatsBar/StatsBar.js'
export { DebugPanel } from './components/DebugPanel/DebugPanel.js'
export { DashboardPage } from './components/Dashboard/DashboardPage.js'

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export { useServerStats } from './hooks/useServerStats.js'
export { useDebugData } from './hooks/useDebugData.js'
export { useDashboardData } from './hooks/useDashboardData.js'
export { useTheme } from './hooks/useTheme.js'
export { useFeatures } from './hooks/useFeatures.js'

// ---------------------------------------------------------------------------
// Shared UI building blocks (for advanced composition)
// ---------------------------------------------------------------------------

export { ThemeToggle } from './components/shared/ThemeToggle.js'
export { Badge, MethodBadge, StatusBadge } from './components/shared/Badge.js'
export { JsonViewer } from './components/shared/JsonViewer.js'
export { Tooltip } from './components/shared/Tooltip.js'

// ---------------------------------------------------------------------------
// Re-export core types so consumers can import from one place
// ---------------------------------------------------------------------------

export type {
  ServerStats,
  QueryRecord,
  EventRecord,
  EmailRecord,
  RouteRecord,
  TraceSpan,
  TraceRecord,
  DebugPane,
  DebugPaneColumn,
  OverviewMetrics,
  ChartDataPoint,
  PaginatedResponse,
  CacheStats,
  JobRecord,
  FeatureConfig,
  StatsBarProps,
  DebugPanelProps,
  DashboardHookOptions,
  Theme,
  DebugTab,
  DashboardSection,
} from '../core/types.js'
