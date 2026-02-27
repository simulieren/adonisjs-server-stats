import React, { useState, useCallback, useMemo, useEffect, Suspense, lazy } from 'react'

import { useFeatures } from '../../hooks/useFeatures.js'
import { useTheme } from '../../hooks/useTheme.js'
import { ThemeToggle } from '../shared/ThemeToggle.js'

import type { DashboardHookOptions, DashboardSection, DebugPane } from '../../../core/types.js'

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
}

export function DashboardPage(props: DashboardPageProps) {
  const {
    baseUrl = '',
    dashboardEndpoint = '/__stats/api',
    debugEndpoint,
    authToken,
    backUrl = '/',
  } = props

  const { features } = useFeatures({ baseUrl, debugEndpoint, authToken })
  const { theme, toggleTheme } = useTheme()

  const [activeSection, setActiveSection] = useState<DashboardSection>('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('ss-dash-sidebar') === 'collapsed'
  })
  const [isConnected] = useState(false) // Placeholder for live connection status

  // Parse hash for deep linking on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.replace('#', '').split('?')[0]
    if (hash) {
      setActiveSection(hash as DashboardSection)
    }
  }, [])

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

  const customPanes = features.customPanes || []

  const dashOptions: DashboardHookOptions = useMemo(
    () => ({ baseUrl, dashboardEndpoint, authToken }),
    [baseUrl, dashboardEndpoint, authToken]
  )

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
      <Suspense fallback={<div className="ss-dash-empty">Loading...</div>}>
        {sectionMap[activeSection] || <div className="ss-dash-empty">Unknown section</div>}
      </Suspense>
    )
  }, [activeSection, dashOptions])

  return (
    <div className="ss-dash" data-ss-theme={theme} id="ss-dash">
      {/* Header */}
      <header className="ss-dash-header">
        <div className="ss-dash-header-left">
          <span className="ss-dash-logo">
            server-stats <span className="ss-dash-logo-sub">dashboard</span>
          </span>
        </div>
        <div className="ss-dash-header-center">
          <div className={`ss-dash-live-dot ${isConnected ? 'ss-dash-connected' : ''}`} />
          <span className={`ss-dash-live-label ${isConnected ? 'ss-dash-connected' : ''}`}>
            {isConnected ? 'Live' : 'Polling'}
          </span>
        </div>
        <div className="ss-dash-header-right">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <a href={backUrl} className="ss-dash-back-link">
            Back to App
          </a>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="ss-dash-body">
        {/* Sidebar */}
        <nav className={`ss-dash-sidebar ${sidebarCollapsed ? 'ss-dash-collapsed' : ''}`}>
          <div className="ss-dash-nav">
            {visibleSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`ss-dash-nav-item ${activeSection === section.id ? 'ss-dash-active' : ''}`}
                onClick={() => setActiveSection(section.id)}
                title={sidebarCollapsed ? section.label : undefined}
              >
                <div className="ss-dash-nav-icon">
                  {SECTION_ICONS[section.id] || SECTION_ICONS.config}
                </div>
                {!sidebarCollapsed && <span>{section.label}</span>}
              </button>
            ))}

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
                <div className="ss-dash-nav-icon">{SECTION_ICONS.config}</div>
                {!sidebarCollapsed && <span>{pane.label}</span>}
              </button>
            ))}
          </div>

          {/* Collapse toggle */}
          <button
            type="button"
            className="ss-dash-sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '\u00BB' : '\u00AB'}
          </button>
        </nav>

        {/* Main content */}
        <main className="ss-dash-main">{renderSection()}</main>
      </div>
    </div>
  )
}
