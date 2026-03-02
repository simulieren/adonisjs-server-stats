import React, { useState, useCallback, useMemo, useEffect, Suspense, lazy } from 'react'

import { TAB_ICONS } from '../../../core/icons.js'
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
    const allVisibleIds = [
      ...visibleTabs.map((t) => t.id),
      ...customPanes.map((p: DebugPane) => p.id),
    ]
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
            viewBox={TAB_ICONS.wrench.viewBox}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: TAB_ICONS.wrench.elements.join('') }}
          />
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
                {TAB_ICONS[tab.id] ? (
                  <svg
                    className="ss-dbg-tab-icon"
                    viewBox={TAB_ICONS[tab.id].viewBox}
                    dangerouslySetInnerHTML={{ __html: TAB_ICONS[tab.id].elements.join('') }}
                  />
                ) : null}
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
                  viewBox={TAB_ICONS['external-link'].viewBox}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dangerouslySetInnerHTML={{ __html: TAB_ICONS['external-link'].elements.join('') }}
                />
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
