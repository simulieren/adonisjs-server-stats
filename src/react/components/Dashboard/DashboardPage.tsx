import React, { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from 'react'

import { subscribeToChannel } from '../../../core/transmit-adapter.js'
import { useDashboardData } from '../../hooks/useDashboardData.js'
import { useFeatures } from '../../hooks/useFeatures.js'
import { useTheme } from '../../hooks/useTheme.js'
import { ThemeToggle } from '../shared/ThemeToggle.js'

import type {
  DashboardHookOptions,
  DashboardSection,
  DebugPane,
  OverviewMetrics,
} from '../../../core/types.js'

/** All built-in section IDs used for hash-route validation. */
const VALID_SECTIONS: DashboardSection[] = [
  'overview',
  'requests',
  'queries',
  'events',
  'routes',
  'logs',
  'emails',
  'timeline',
  'cache',
  'jobs',
  'config',
  'internals',
]

// Lazy-loaded sections
const OverviewSection = lazy(() => import('./sections/OverviewSection.js'))
const RequestsSection = lazy(() => import('./sections/RequestsSection.js'))
const QueriesSection = lazy(() => import('./sections/QueriesSection.js'))
const EventsSection = lazy(() => import('./sections/EventsSection.js'))
const RoutesSection = lazy(() => import('./sections/RoutesSection.js'))
const LogsSection = lazy(() => import('./sections/LogsSection.js'))
const EmailsSection = lazy(() => import('./sections/EmailsSection.js'))
const TimelineSection = lazy(() => import('./sections/TimelineSection.js'))
const CacheSection = lazy(() => import('./sections/CacheSection.js'))
const JobsSection = lazy(() => import('./sections/JobsSection.js'))
const ConfigSection = lazy(() => import('./sections/ConfigSection.js'))
const InternalsSection = lazy(() => import('./sections/InternalsSection.js'))

/** Sidebar icon SVGs. */
const SECTION_ICONS: Record<string, React.ReactNode> = {
  overview: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  requests: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  queries: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  events: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  routes: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  logs: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  emails: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  timeline: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  cache: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
  jobs: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  config: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  internals: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  ),
}

interface DashboardPageProps {
  /** Base URL for API requests. */
  baseUrl?: string
  /** Dashboard API base path. */
  dashboardEndpoint?: string
  /** Debug endpoint for feature detection. */
  debugEndpoint?: string
  /** Auth token for API requests. */
  authToken?: string
  /** Link back to the main app. */
  backUrl?: string
  /** Transmit channel name for live updates. */
  channelName?: string
}

export function DashboardPage(props: DashboardPageProps) {
  const {
    baseUrl = '',
    dashboardEndpoint = '/__stats/api',
    debugEndpoint,
    authToken,
    backUrl = '/',
    channelName = 'server-stats/dashboard',
  } = props

  const { features } = useFeatures({ baseUrl, debugEndpoint, authToken })
  const { theme, toggleTheme } = useTheme()

  const [activeSection, setActiveSection] = useState<DashboardSection>('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('ss-dash-sidebar') === 'collapsed'
  })
  const [isConnected, setIsConnected] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshKeyRef = useRef(0)

  // Subscribe to Transmit channel for live updates
  useEffect(() => {
    if (!channelName) return

    const sub = subscribeToChannel({
      baseUrl,
      channelName,
      authToken,
      onMessage: () => {
        // Bump refresh key to trigger section data refetch
        refreshKeyRef.current += 1
        setRefreshKey(refreshKeyRef.current)
      },
      onConnect: () => setIsConnected(true),
      onDisconnect: () => setIsConnected(false),
      onError: () => setIsConnected(false),
    })

    return () => sub.unsubscribe()
  }, [baseUrl, channelName, authToken])

  const customPanes = features.customPanes || []

  /** Resolve a hash fragment to a validated section ID, falling back to 'overview'. */
  const resolveHashSection = useCallback(
    (hash: string): DashboardSection => {
      const section = hash.replace('#', '').split('?')[0]
      if (!section) return 'overview'
      const allValid: string[] = [
        ...VALID_SECTIONS,
        ...customPanes.map((p: DebugPane) => p.id),
      ]
      return allValid.includes(section) ? (section as DashboardSection) : 'overview'
    },
    [customPanes]
  )

  // Parse hash for deep linking on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const section = resolveHashSection(window.location.hash)
    if (section !== 'overview' || window.location.hash) {
      setActiveSection(section)
    }
  }, [resolveHashSection])

  // Handle browser Back/Forward via hashchange
  useEffect(() => {
    const handleHashChange = () => {
      const section = resolveHashSection(window.location.hash)
      if (section !== activeSection) setActiveSection(section)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [activeSection, resolveHashSection])

  // Update hash when section changes
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.location.hash = activeSection
  }, [activeSection])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('ss-dash-sidebar', next ? 'collapsed' : 'expanded')
      return next
    })
  }, [])

  const builtInSections: { id: DashboardSection; label: string; visible: boolean }[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', visible: true },
      { id: 'requests', label: 'Requests', visible: true },
      { id: 'queries', label: 'Queries', visible: true },
      { id: 'events', label: 'Events', visible: true },
      { id: 'routes', label: 'Routes', visible: true },
      { id: 'logs', label: 'Logs', visible: true },
      { id: 'emails', label: 'Emails', visible: true },
      { id: 'timeline', label: 'Timeline', visible: features.tracing },
      { id: 'cache', label: 'Cache', visible: features.cache },
      { id: 'jobs', label: 'Jobs', visible: features.queues },
      { id: 'config', label: 'Config', visible: true },
      { id: 'internals', label: 'Internals', visible: true },
    ],
    [features]
  )

  const visibleSections = useMemo(() => builtInSections.filter((s) => s.visible), [builtInSections])

  const dashOptions: DashboardHookOptions = useMemo(
    () => ({ baseUrl, dashboardEndpoint, authToken, refreshKey }),
    [baseUrl, dashboardEndpoint, authToken, refreshKey]
  )

  // Fetch overview metrics for sidebar nav badges
  const { data: overviewData } = useDashboardData<OverviewMetrics>('overview', dashOptions)

  /** Badge counts for sidebar nav items (mirrors old Edge dashboard behaviour). */
  const navBadges: Partial<Record<DashboardSection, { count: number; variant?: string }>> =
    useMemo(() => {
      if (!overviewData) return {}
      const badges: Partial<Record<DashboardSection, { count: number; variant?: string }>> = {}

      // Requests total
      if (overviewData.totalRequests > 0) {
        badges.requests = { count: overviewData.totalRequests }
      }

      // Queries total
      if (overviewData.queryStats?.total > 0) {
        badges.queries = { count: overviewData.queryStats.total }
      }

      // Logs total (sum of all log levels)
      if (overviewData.logLevelBreakdown) {
        const b = overviewData.logLevelBreakdown
        const totalLogs = b.error + b.warn + b.info + b.debug
        if (totalLogs > 0) {
          badges.logs = { count: totalLogs }
        }
      }

      return badges
    }, [overviewData])

  const renderSection = useCallback(() => {
    const sectionMap: Record<string, React.ReactNode> = {
      overview: <OverviewSection options={dashOptions} />,
      requests: <RequestsSection options={dashOptions} />,
      queries: <QueriesSection options={dashOptions} />,
      events: <EventsSection options={dashOptions} />,
      routes: <RoutesSection options={dashOptions} />,
      logs: <LogsSection options={dashOptions} />,
      emails: <EmailsSection options={dashOptions} />,
      timeline: <TimelineSection options={dashOptions} />,
      cache: <CacheSection options={dashOptions} />,
      jobs: <JobsSection options={dashOptions} />,
      config: <ConfigSection options={dashOptions} />,
      internals: <InternalsSection options={dashOptions} debugEndpoint={debugEndpoint} />,
    }

    return (
      <div
        className="ss-dash-pane ss-dash-active"
        id={`ss-dash-pane-${activeSection}`}
      >
        <div className="ss-dash-pane-inner">
          <Suspense fallback={<div className="ss-dash-empty">Loading...</div>}>
            {sectionMap[activeSection] || <div className="ss-dash-empty">Unknown section</div>}
          </Suspense>
        </div>
      </div>
    )
  }, [activeSection, dashOptions])

  return (
    <div className="ss-dash" data-theme={theme} id="ss-dash">
      {/* Header */}
      <div className="ss-dash-header">
        <div className="ss-dash-header-left">
          <span className="ss-dash-logo">Server Stats</span>
          <span className="ss-dash-logo-sub">Dashboard</span>
        </div>
        <div className="ss-dash-header-center">
          <span
            className={`ss-dash-live-dot ${isConnected ? 'ss-dash-connected' : ''}`}
            id="ss-dash-live-dot"
          />
          <span
            className={`ss-dash-live-label ${isConnected ? 'ss-dash-connected' : ''}`}
            id="ss-dash-live-label"
          >
            {isConnected ? 'Live' : 'Polling'}
          </span>
        </div>
        <div className="ss-dash-header-right">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          {backUrl && (
            <a href={backUrl} className="ss-dash-back-link" title="Back to app">
              &larr; App
            </a>
          )}
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="ss-dash-body">
        {/* Sidebar */}
        <div
          className={`ss-dash-sidebar ${sidebarCollapsed ? 'ss-dash-collapsed' : ''}`}
          id="ss-dash-sidebar"
        >
          <nav className="ss-dash-nav">
            {visibleSections.map((section) => {
              const badge = navBadges[section.id]
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`ss-dash-nav-item ${activeSection === section.id ? 'ss-dash-active' : ''}`}
                  data-ss-section={section.id}
                  onClick={() => { if (section.id !== activeSection) setActiveSection(section.id) }}
                  title={sidebarCollapsed ? section.label : undefined}
                >
                  <span className="ss-dash-nav-icon">
                    {SECTION_ICONS[section.id] || SECTION_ICONS.config}
                  </span>
                  <span className="ss-dash-nav-label">{section.label}</span>
                  {badge && badge.count > 0 && (
                    <span
                      className={`ss-dash-nav-badge${badge.variant ? ' ' + badge.variant : ''}`}
                    >
                      {badge.count}
                    </span>
                  )}
                </button>
              )
            })}

            {/* Separator before custom panes */}
            {customPanes.length > 0 && <div className="ss-dash-nav-sep" />}

            {/* Custom pane nav items */}
            {customPanes.map((pane: DebugPane) => (
              <button
                key={pane.id}
                type="button"
                className={`ss-dash-nav-item ${activeSection === pane.id ? 'ss-dash-active' : ''}`}
                onClick={() => setActiveSection(pane.id)}
                title={sidebarCollapsed ? pane.label : undefined}
              >
                <span className="ss-dash-nav-icon">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18" />
                  </svg>
                </span>
                <span className="ss-dash-nav-label">{pane.label}</span>
              </button>
            ))}
          </nav>

          {/* Collapse toggle */}
          <button
            type="button"
            className="ss-dash-sidebar-toggle"
            id="ss-dash-sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18l6-6-6-6"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6"/></svg>
            )}
          </button>
        </div>

        {/* Main content */}
        <div className="ss-dash-main">{renderSection()}</div>
      </div>
    </div>
  )
}
