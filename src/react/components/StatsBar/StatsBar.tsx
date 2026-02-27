import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'

import { getVisibleMetricGroups } from '../../../core/feature-detect.js'
import { METRIC_DEFINITIONS } from '../../../core/metrics.js'
import { useFeatures } from '../../hooks/useFeatures.js'
import { useServerStats } from '../../hooks/useServerStats.js'
import { useTheme } from '../../hooks/useTheme.js'
import { MetricCard } from './MetricCard.js'

import type { StatsBarProps as StatsBarPropsBase, DebugPanelProps } from '../../../core/types.js'

interface StatsBarProps extends StatsBarPropsBase {
  /** Options for feature detection. */
  featureOptions?: DebugPanelProps
  /** Whether to auto-hide on 403. */
  autoHideOnUnauthorized?: boolean
}

/**
 * Fixed stats bar at the bottom of the viewport.
 *
 * Displays real-time server metrics with sparklines, tooltips,
 * and a show/hide toggle persisted to localStorage.
 */
export function StatsBar(props: StatsBarProps) {
  const { featureOptions, autoHideOnUnauthorized = true, ...statsOptions } = props

  const { stats, getHistory, isStale, unauthorized } = useServerStats(statsOptions)
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

  // Visible metric groups based on features
  const visibleGroups = useMemo(() => getVisibleMetricGroups(features), [features])

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
        <span className="ss-toggle-arrow">{visible ? '\u25BC' : '\u25B2'}</span>
        {visible && <span className="ss-toggle-label">hide stats</span>}
        {!visible && stats && features.process && (
          <div className="ss-toggle-summary" style={{ display: 'flex' }}>
            <span className="ss-label">CPU</span>
            <span
              className={`ss-value ${stats.cpuPercent > 80 ? 'ss-red' : stats.cpuPercent > 50 ? 'ss-amber' : 'ss-green'}`}
            >
              {stats.cpuPercent.toFixed(0)}%
            </span>
          </div>
        )}
      </button>

      {/* Stats bar */}
      <div ref={barRef} className={`ss-bar ${visible ? '' : 'ss-hidden'}`} data-ss-theme={theme}>
        <div className="ss-bar-left">
          <div className={`ss-dot ${isStale ? 'ss-stale' : ''}`} />
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
