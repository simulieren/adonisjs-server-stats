import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'

import {
  getVisibleMetricGroups,
  detectMetricGroupsFromStats,
} from '../../../core/feature-detect.js'
import { METRIC_DEFINITIONS } from '../../../core/metrics.js'
import { useFeatures } from '../../hooks/useFeatures.js'
import { useServerStats } from '../../hooks/useServerStats.js'
import { useTheme } from '../../hooks/useTheme.js'
import { MetricCard } from './MetricCard.js'

import type { StatsBarProps as StatsBarPropsBase, DebugPanelProps } from '../../../core/types.js'
import { TAB_ICONS } from '../../../core/icons.js'

interface StatsBarProps extends StatsBarPropsBase {
  /** Options for feature detection. */
  featureOptions?: DebugPanelProps
  /** Whether to auto-hide on 403. */
  autoHideOnUnauthorized?: boolean
  /** Callback to toggle the debug panel (renders wrench button in bar-left). */
  onOpenDebugPanel?: () => void
  /** Whether the debug panel is currently open (controls active styling on wrench). */
  debugPanelOpen?: boolean
  /** Callback invoked when the live (SSE/Transmit) connection state changes. */
  onConnectionChange?: (isConnected: boolean) => void
}

/**
 * Fixed stats bar at the bottom of the viewport.
 *
 * Displays real-time server metrics with sparklines, tooltips,
 * and a show/hide toggle persisted to localStorage.
 */
export function StatsBar(props: StatsBarProps) {
  const {
    featureOptions,
    autoHideOnUnauthorized = true,
    onOpenDebugPanel,
    debugPanelOpen = false,
    onConnectionChange,
    ...statsOptions
  } = props

  const { stats, getHistory, isConnected, isStale, unauthorized } = useServerStats(statsOptions)

  // Report connection state changes to parent
  useEffect(() => {
    onConnectionChange?.(isConnected)
  }, [isConnected, onConnectionChange])
  const { features } = useFeatures(featureOptions)
  const { theme } = useTheme()

  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('admin:stats-bar') !== 'hidden'
  })

  const barRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-hide on unauthorized
  useEffect(() => {
    if (autoHideOnUnauthorized && unauthorized) {
      setVisible(false)
    }
  }, [autoHideOnUnauthorized, unauthorized])

  const toggleVisible = useCallback(() => {
    setVisible((prev) => {
      const next = !prev
      localStorage.setItem('admin:stats-bar', next ? 'visible' : 'hidden')
      return next
    })
  }, [])

  // Horizontal wheel scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Visible metric groups: derive from actual stats data when available,
  // fall back to feature flags from the debug endpoint.
  // This mirrors the old vanilla JS behavior where groups were shown
  // based on what data the server actually sends, not what the debug
  // endpoint reports.
  const visibleGroups = useMemo(() => {
    if (stats) {
      return detectMetricGroupsFromStats(stats as unknown as Record<string, unknown>)
    }
    // Before stats arrive, use feature flags (if available) for initial render
    return getVisibleMetricGroups(features)
  }, [stats, features])

  // Filter metrics by visible groups
  const visibleMetrics = useMemo(
    () => METRIC_DEFINITIONS.filter((m) => visibleGroups.has(m.group || 'core')),
    [visibleGroups]
  )

  // Group metrics for separator display
  const groupedMetrics = useMemo(() => {
    const groups: { group: string; metrics: typeof METRIC_DEFINITIONS }[] = []
    let currentGroup = ''
    for (const metric of visibleMetrics) {
      const metricGroup = metric.group || 'core'
      if (metricGroup !== currentGroup) {
        currentGroup = metricGroup
        groups.push({ group: currentGroup, metrics: [] })
      }
      groups[groups.length - 1].metrics.push(metric)
    }
    return groups
  }, [visibleMetrics])

  if (autoHideOnUnauthorized && unauthorized) {
    return null
  }

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        className={`ss-toggle ${visible ? 'ss-visible' : 'ss-collapsed'}`}
        onClick={toggleVisible}
        title={visible ? 'Hide stats bar' : 'Show stats bar'}
        data-ss-theme={theme}
      >
        {!visible && stats && (
          <span className="ss-toggle-summary" style={{ display: 'flex' }}>
            {visibleGroups.has('process') && (
              <>
                <span
                  className={`ss-value ${stats.cpuPercent > 80 ? 'ss-red' : stats.cpuPercent > 50 ? 'ss-amber' : 'ss-green'}`}
                >
                  {stats.cpuPercent.toFixed(0)}%
                </span>
                <span className="ss-value ss-green">
                  {stats.memHeapUsed !== undefined
                    ? Math.round(stats.memHeapUsed / (1024 * 1024)) + 'M'
                    : '-'}
                </span>
              </>
            )}
            {visibleGroups.has('redis') && stats.redisOk !== undefined && (
              <span className={`ss-value ${stats.redisOk ? 'ss-green' : 'ss-red'}`}>
                {stats.redisOk ? '\u2713' : '\u2717'}
              </span>
            )}
          </span>
        )}
        {visible && <span className="ss-toggle-label" style={{ color: '#737373' }}>hide stats</span>}
        <span className="ss-toggle-arrow">{visible ? '\u25BC' : '\u25B2'}</span>
      </button>

      {/* Stats bar */}
      <div ref={barRef} className={visible ? 'ss-bar' : 'ss-bar ss-hidden'} data-ss-theme={theme}>
        <div className="ss-bar-left">
          {onOpenDebugPanel && (
            <button
              type="button"
              className={`ss-dbg-btn ${debugPanelOpen ? 'ss-dbg-active' : ''}`}
              onClick={onOpenDebugPanel}
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
          <div className={isStale ? 'ss-dot ss-stale' : 'ss-dot'} />
        </div>

        <div ref={scrollRef} className="ss-bar-scroll" id="ss-bar-scroll">
          {stats &&
            groupedMetrics.map((group, gi) => (
              <React.Fragment key={group.group}>
                {gi > 0 && <div className="ss-group-sep" />}
                <div className="ss-group">
                  {group.metrics.map((metric) => (
                    <MetricCard
                      key={metric.id}
                      metric={metric}
                      stats={stats}
                      history={getHistory(metric.historyKey || '')}
                    />
                  ))}
                </div>
              </React.Fragment>
            ))}
        </div>
      </div>
    </>
  )
}
