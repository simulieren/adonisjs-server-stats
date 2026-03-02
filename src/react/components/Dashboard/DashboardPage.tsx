import React, { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from 'react'

import { TAB_ICONS } from '../../../core/icons.js'
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

/** Resolve icon key for a dashboard section, using the clock variant for timeline. */
function sectionIconKey(sectionId: string): string {
  return sectionId === 'timeline' ? 'dashboard-timeline' : sectionId
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
      const allValid: string[] = [...VALID_SECTIONS, ...customPanes.map((p: DebugPane) => p.id)]
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
      <div className="ss-dash-pane ss-dash-active" id={`ss-dash-pane-${activeSection}`}>
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
                  onClick={() => {
                    if (section.id !== activeSection) setActiveSection(section.id)
                  }}
                  title={sidebarCollapsed ? section.label : undefined}
                >
                  <span className="ss-dash-nav-icon">
                    <svg
                      width="20"
                      height="20"
                      viewBox={(TAB_ICONS[sectionIconKey(section.id)] || TAB_ICONS.config).viewBox}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dangerouslySetInnerHTML={{
                        __html: (
                          TAB_ICONS[sectionIconKey(section.id)] || TAB_ICONS.config
                        ).elements.join(''),
                      }}
                    />
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
                    viewBox={TAB_ICONS['custom-pane'].viewBox}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dangerouslySetInnerHTML={{ __html: TAB_ICONS['custom-pane'].elements.join('') }}
                  />
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
              <svg
                width="16"
                height="16"
                viewBox={TAB_ICONS['chevron-right'].viewBox}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                dangerouslySetInnerHTML={{ __html: TAB_ICONS['chevron-right'].elements.join('') }}
              />
            ) : (
              <svg
                width="16"
                height="16"
                viewBox={TAB_ICONS['chevron-left'].viewBox}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                dangerouslySetInnerHTML={{ __html: TAB_ICONS['chevron-left'].elements.join('') }}
              />
            )}
          </button>
        </div>

        {/* Main content */}
        <div className="ss-dash-main">{renderSection()}</div>
      </div>
    </div>
  )
}
