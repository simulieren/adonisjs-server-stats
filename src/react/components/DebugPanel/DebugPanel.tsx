import React, { useState, useCallback, useMemo, useEffect, Suspense, lazy } from 'react'

import { useFeatures } from '../../hooks/useFeatures.js'
import { useTheme } from '../../hooks/useTheme.js'
import { ThemeToggle } from '../shared/ThemeToggle.js'

import type {
  DebugPanelProps as DebugPanelPropsBase,
  DebugTab,
  DebugPane,
} from '../../../core/types.js'

// Lazy-loaded tabs
const QueriesTab = lazy(() => import('./tabs/QueriesTab.js'))
const EventsTab = lazy(() => import('./tabs/EventsTab.js'))
const EmailsTab = lazy(() => import('./tabs/EmailsTab.js'))
const RoutesTab = lazy(() => import('./tabs/RoutesTab.js'))
const LogsTab = lazy(() => import('./tabs/LogsTab.js'))
const TimelineTab = lazy(() => import('./tabs/TimelineTab.js'))
const CacheTab = lazy(() => import('./tabs/CacheTab.js'))
const JobsTab = lazy(() => import('./tabs/JobsTab.js'))
const ConfigTab = lazy(() => import('./tabs/ConfigTab.js'))
const InternalsTab = lazy(() => import('./tabs/InternalsTab.js'))
const CustomPaneTab = lazy(() => import('./tabs/CustomPaneTab.js'))

interface DebugPanelProps extends DebugPanelPropsBase {
  /** Initial open state. */
  defaultOpen?: boolean
  /** Dashboard path for deep links. */
  dashboardPath?: string
  /** Controlled open state (used when parent manages toggle via StatsBar wrench). */
  isOpen?: boolean
  /** Callback when open state changes. */
  onOpenChange?: (open: boolean) => void
  /** Whether the stats bar is connected via Transmit (SSE) for live updates. */
  isLive?: boolean
}

/** Tab icon SVGs */
const TAB_ICONS: Record<string, React.ReactNode> = {
  queries: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  events: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  emails: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  routes: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  logs: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  timeline: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  cache: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
  jobs: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  config: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  internals: (
    <svg className="ss-dbg-tab-icon" viewBox="0 0 24 24">
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

export function DebugPanel(props: DebugPanelProps) {
  const {
    defaultOpen = false,
    dashboardPath,
    isOpen: controlledOpen,
    onOpenChange,
    isLive = false,
    ...debugOptions
  } = props

  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = (open: boolean) => {
    if (onOpenChange) onOpenChange(open)
    else setInternalOpen(open)
  }
  const [activeTab, setActiveTab] = useState<DebugTab>('queries')
  const { features } = useFeatures(debugOptions)
  const { theme, toggleTheme } = useTheme()

  const customPanes = features.customPanes || []

  // Close panel on Escape key (matches old debug-panel.js behaviour)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  const builtInTabs: { id: DebugTab; label: string; visible: boolean }[] = useMemo(
    () => [
      { id: 'queries', label: 'Queries', visible: true },
      { id: 'events', label: 'Events', visible: true },
      { id: 'emails', label: 'Emails', visible: true },
      { id: 'routes', label: 'Routes', visible: true },
      { id: 'logs', label: 'Logs', visible: true },
      { id: 'timeline', label: 'Timeline', visible: features.tracing },
      { id: 'cache', label: 'Cache', visible: features.cache },
      { id: 'jobs', label: 'Jobs', visible: features.queues },
      { id: 'config', label: 'Config', visible: true },
      { id: 'internals', label: 'Internals', visible: true },
    ],
    [features]
  )

  const visibleTabs = useMemo(() => builtInTabs.filter((t) => t.visible), [builtInTabs])

  // Ensure the active tab is always visible (e.g. when a feature flag changes
  // and the currently-selected tab disappears from the bar).
  useEffect(() => {
    const allVisibleIds = [...visibleTabs.map((t) => t.id), ...customPanes.map((p: DebugPane) => p.id)]
    if (!allVisibleIds.includes(activeTab) && allVisibleIds.length > 0) {
      setActiveTab(allVisibleIds[0] as DebugTab)
    }
  }, [visibleTabs, customPanes, activeTab])

  const togglePanel = useCallback(() => {
    setIsOpen(!isOpen)
  }, [isOpen])

  const renderTabContent = useCallback(() => {
    const tabProps = { options: debugOptions }

    // Check if it's a custom pane
    const customPane = customPanes.find((p: DebugPane) => p.id === activeTab)
    if (customPane) {
      return (
        <Suspense fallback={<div className="ss-dbg-empty">Loading...</div>}>
          <CustomPaneTab pane={customPane} options={debugOptions} />
        </Suspense>
      )
    }

    const tabMap: Record<string, React.ReactNode> = {
      queries: <QueriesTab {...tabProps} />,
      events: <EventsTab {...tabProps} />,
      emails: <EmailsTab {...tabProps} />,
      routes: (
        <RoutesTab
          {...tabProps}
          currentPath={typeof window !== 'undefined' ? window.location.pathname : ''}
        />
      ),
      logs: <LogsTab {...tabProps} />,
      timeline: <TimelineTab {...tabProps} />,
      cache: <CacheTab {...tabProps} dashboardPath={dashboardPath} />,
      jobs: <JobsTab {...tabProps} dashboardPath={dashboardPath} />,
      config: <ConfigTab {...tabProps} dashboardPath={dashboardPath} />,
      internals: <InternalsTab {...tabProps} />,
    }

    return (
      <Suspense fallback={<div className="ss-dbg-empty">Loading...</div>}>
        {tabMap[activeTab] || <div className="ss-dbg-empty">Unknown tab</div>}
      </Suspense>
    )
  }, [activeTab, debugOptions, customPanes])

  return (
    <>
      {/* Wrench button (only when not controlled externally via StatsBar) */}
      {controlledOpen === undefined && (
        <button
          type="button"
          className={`ss-dbg-btn ${isOpen ? 'ss-dbg-active' : ''}`}
          onClick={togglePanel}
          title="Toggle debug panel"
          id="ss-dbg-wrench"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </button>
      )}

      {/* Panel */}
      <div
        className={`ss-dbg-panel ${isOpen ? 'ss-dbg-open' : ''}`}
        data-ss-theme={theme}
        id="ss-dbg-panel"
      >
        {/* Tab bar */}
        <div className="ss-dbg-tabs">
          <div className="ss-dbg-tabs-scroll">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`ss-dbg-tab ${activeTab === tab.id ? 'ss-dbg-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {TAB_ICONS[tab.id] || null}
                {tab.label}
              </button>
            ))}

            {/* Custom pane tabs */}
            {customPanes.map((pane: DebugPane) => (
              <button
                key={pane.id}
                type="button"
                className={`ss-dbg-tab ${activeTab === pane.id ? 'ss-dbg-active' : ''}`}
                onClick={() => setActiveTab(pane.id)}
              >
                {pane.label}
              </button>
            ))}
          </div>

          <div className="ss-dbg-tabs-right">
            <span
              className={`ss-dbg-conn-mode ${isLive ? 'ss-dbg-conn-live' : 'ss-dbg-conn-polling'}`}
              title={
                isLive
                  ? 'Connected via Transmit (SSE) \u2014 real-time updates'
                  : 'Polling every 3s'
              }
            >
              {isLive ? 'live' : 'polling'}
            </span>

            <ThemeToggle theme={theme} onToggle={toggleTheme} classPrefix="ss-dbg" />

            {dashboardPath && (
              <a
                href={dashboardPath}
                target="_blank"
                rel="noopener noreferrer"
                className="ss-dbg-dashboard-link"
                title="Open dashboard"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}

            <button
              type="button"
              className="ss-dbg-close"
              onClick={() => setIsOpen(false)}
              title="Close panel"
            >
              {'\u00D7'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="ss-dbg-content">{isOpen && renderTabContent()}</div>
      </div>
    </>
  )
}
