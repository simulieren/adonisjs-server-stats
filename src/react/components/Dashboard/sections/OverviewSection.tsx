import React, { useCallback, useEffect, useRef, useState } from 'react'

import { durationSeverity, formatDuration, formatTime, timeAgo } from '../../../../core/formatters.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { Sparkline } from '../../StatsBar/Sparkline.js'
import { TimeRangeSelector } from '../shared/TimeRangeSelector.js'

import type {
  OverviewMetrics,
  ChartDataPoint,
  DashboardHookOptions,
  TimeRange,
} from '../../../../core/types.js'

interface OverviewSectionProps {
  options?: DashboardHookOptions
}

/* ── Helpers for the area chart (mirrors old Edge dashboard.js) ──────── */

/** Compute nice Y-axis tick values */
function niceYTicks(max: number, count: number): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const nice = raw / mag
  let step: number
  if (nice <= 1) step = mag
  else if (nice <= 2) step = 2 * mag
  else if (nice <= 5) step = 5 * mag
  else step = 10 * mag
  const ticks: number[] = []
  for (let v = step; v <= max + step * 0.5; v += step) ticks.push(Math.round(v))
  if (ticks.length === 0) ticks.push(Math.ceil(max))
  return ticks
}

/** Format a bucket timestamp to HH:MM */
function bucketLabel(bucket: string): string {
  try {
    const d = new Date(bucket)
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/** Build a smooth SVG path through a set of points (monotone cubic) */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`

  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const cpx = (p0.x + p1.x) / 2
    d += ` C${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`
  }
  return d
}

/** Compute a CSS class for a duration value */
function durationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dash-very-slow'
  if (sev === 'slow') return 'ss-dash-slow'
  return ''
}

/* ── OverviewChart (area chart matching old Edge style) ───────────── */

interface OverviewChartProps {
  chartPoints: ChartDataPoint[]
}

function OverviewChart({ chartPoints }: OverviewChartProps) {
  const pad = { top: 12, right: 12, bottom: 28, left: 38 }
  const h = 220

  // Measure actual container width via ResizeObserver
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setMeasuredWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const w = measuredWidth || 600
  const cw = w - pad.left - pad.right
  const ch = h - pad.top - pad.bottom
  const baseline = pad.top + ch

  // Handle both camelCase and snake_case field names from different API versions
  const totals = chartPoints.map((p) => {
    const raw = p as unknown as Record<string, unknown>
    const rc = (p.requestCount ?? 0) + (Number(raw.request_count) || 0)
    return rc || p.total || 0
  })
  const errors = chartPoints.map((p) => {
    const raw = p as unknown as Record<string, unknown>
    return (p.errorCount ?? 0) + (Number(raw.error_count) || 0)
  })
  const maxCount = Math.max(...totals, 1)
  const maxVal = Math.ceil(maxCount * 1.1)
  const hasErrors = errors.some((e) => e > 0)

  const yTicks = niceYTicks(maxVal, 4)
  const yMax = yTicks.length > 0 ? yTicks[yTicks.length - 1] : maxVal

  const toX = (i: number) => pad.left + (i / Math.max(chartPoints.length - 1, 1)) * cw
  const toY = (v: number) => pad.top + ch - (v / (yMax || 1)) * ch

  // Build point arrays
  const totalPoints = chartPoints.map((_, i) => ({ x: toX(i), y: toY(totals[i]) }))
  const errorPoints = chartPoints.map((_, i) => ({ x: toX(i), y: toY(errors[i]) }))

  // Build area paths
  const totalLine = smoothPath(totalPoints)
  const errorLine = hasErrors ? smoothPath(errorPoints) : ''

  const totalArea =
    totalPoints.length > 1
      ? `${totalLine} L${totalPoints[totalPoints.length - 1].x.toFixed(1)},${baseline} L${totalPoints[0].x.toFixed(1)},${baseline} Z`
      : ''

  const errorArea =
    hasErrors && errorPoints.length > 1
      ? `${errorLine} L${errorPoints[errorPoints.length - 1].x.toFixed(1)},${baseline} L${errorPoints[0].x.toFixed(1)},${baseline} Z`
      : ''

  // X-axis label interval
  const maxLabels = Math.min(10, chartPoints.length)
  const labelInterval = Math.max(1, Math.ceil(chartPoints.length / maxLabels))

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    visible: boolean
    x: number
    idx: number
  }>({ visible: false, x: 0, idx: -1 })

  const handleMouseEnter = useCallback(
    (i: number) => {
      const cx = totalPoints[i].x
      setTooltip({ visible: true, x: cx, idx: i })
    },
    [totalPoints]
  )

  const handleMouseLeave = useCallback(() => {
    setTooltip({ visible: false, x: 0, idx: -1 })
  }, [])

  // Clamp tooltip pixel position within container
  const tooltipWidth = 120
  const clampedLeft =
    tooltip.visible
      ? Math.max(tooltipWidth / 2, Math.min(tooltip.x, w - tooltipWidth / 2))
      : 0

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="ss-dash-chart-svg">
        {/* Gradient definitions */}
        <defs>
          <linearGradient id="ss-cg-total" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ss-accent)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--ss-accent)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="ss-cg-error" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ss-red-fg)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--ss-red-fg)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines + Y-axis labels */}
        {yTicks.map((val) => {
          const yy = toY(val)
          return (
            <g key={`ytick-${val}`}>
              <line
                x1={pad.left}
                y1={yy}
                x2={w - pad.right}
                y2={yy}
                stroke="var(--ss-border-faint)"
                strokeWidth={0.5}
                strokeDasharray="3,3"
              />
              <text
                x={pad.left - 6}
                y={yy}
                textAnchor="end"
                fill="var(--ss-dim)"
                fontSize={9}
                dominantBaseline="middle"
              >
                {val}
              </text>
            </g>
          )
        })}

        {/* Total requests: gradient fill + line */}
        {totalArea && <path d={totalArea} fill="url(#ss-cg-total)" />}
        {totalLine && (
          <path
            d={totalLine}
            fill="none"
            stroke="var(--ss-accent)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Error requests: gradient fill + dashed line */}
        {errorArea && <path d={errorArea} fill="url(#ss-cg-error)" />}
        {errorLine && (
          <path
            d={errorLine}
            fill="none"
            stroke="var(--ss-red-fg)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="4,2"
          />
        )}

        {/* Hover zones + data point dots */}
        {chartPoints.map((_, i) => {
          const total = totals[i]
          const errCount = errors[i]
          const cx = totalPoints[i].x
          const cy = totalPoints[i].y
          const sliceW = cw / (chartPoints.length || 1)
          const isHovered = tooltip.visible && tooltip.idx === i
          const isDimmed = tooltip.visible && tooltip.idx !== i

          return (
            <g key={i}>
              {/* Invisible hover target */}
              <rect
                x={cx - sliceW / 2}
                y={pad.top}
                width={sliceW}
                height={ch}
                fill="transparent"
                className="ss-dash-chart-hover-zone"
                data-idx={i}
                onMouseEnter={() => handleMouseEnter(i)}
                onMouseLeave={handleMouseLeave}
              />
              {/* Request dot */}
              {total > 0 && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 4 : 2.5}
                  fill="var(--ss-accent)"
                  stroke="var(--ss-surface)"
                  strokeWidth={1}
                  className="ss-dash-chart-dot"
                  data-idx={i}
                  opacity={isDimmed ? 0.3 : 1}
                />
              )}
              {/* Error dot */}
              {errCount > 0 && (
                <circle
                  cx={cx}
                  cy={errorPoints[i].y}
                  r={isHovered ? 3.5 : 2}
                  fill="var(--ss-red-fg)"
                  stroke="var(--ss-surface)"
                  strokeWidth={1}
                  className="ss-dash-chart-dot ss-dash-chart-dot-err"
                  data-idx={i}
                  opacity={isDimmed ? 0.3 : 1}
                />
              )}
            </g>
          )
        })}

        {/* X-axis labels */}
        {chartPoints.map((point, i) => {
          if (i % labelInterval !== 0 && i !== chartPoints.length - 1) return null
          const label = bucketLabel(point.bucket)
          if (!label) return null
          return (
            <text
              key={`xlabel-${i}`}
              x={toX(i)}
              y={h - 6}
              textAnchor="middle"
              fill="var(--ss-dim)"
              fontSize={9}
            >
              {label}
            </text>
          )
        })}
      </svg>

      {/* Floating tooltip */}
      {tooltip.visible && tooltip.idx >= 0 && (
        <div
          className="ss-dash-chart-tooltip"
          style={{
            left: clampedLeft,
            top: pad.top - 4,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div>{bucketLabel(chartPoints[tooltip.idx].bucket)}</div>
          <div>Requests: {totals[tooltip.idx]}</div>
          {errors[tooltip.idx] > 0 && (
            <div style={{ color: 'var(--ss-red-fg)' }}>Errors: {errors[tooltip.idx]}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function OverviewSection({ options = {} }: OverviewSectionProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h')
  const { data: overview, isLoading } = useDashboardData<OverviewMetrics>('overview', options)
  const { data: chartResponse } = useDashboardData<{
    buckets: ChartDataPoint[]
  }>('overview/chart', {
    ...options,
    timeRange,
  })

  if (isLoading && !overview) {
    return <div className="ss-dash-empty">Loading overview...</div>
  }

  const metrics = overview || {
    avgResponseTime: 0,
    p95ResponseTime: 0,
    requestsPerMinute: 0,
    errorRate: 0,
    totalRequests: 0,
    slowestEndpoints: [],
    queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
    recentErrors: [],
    topEvents: [],
    emailActivity: { sent: 0, queued: 0, failed: 0 },
    logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
    cacheStats: null,
    jobQueueStatus: null,
    statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    slowestQueries: [],
  }

  // Support both camelCase and snake_case API field names
  const raw = metrics as unknown as Record<string, unknown>
  const avgResponseTime = metrics.avgResponseTime || Number(raw.avg_response_time) || 0
  const p95ResponseTime = metrics.p95ResponseTime || Number(raw.p95_response_time) || 0
  const requestsPerMinute = metrics.requestsPerMinute || Number(raw.requests_per_minute) || 0
  const errorRate = metrics.errorRate || Number(raw.error_rate) || 0
  const totalRequests = metrics.totalRequests || Number(raw.total_requests) || 0

  const hasData = totalRequests > 0

  // Extract sparkline data: prefer pre-computed sparklines from API, fall back to chart points
  const chartPoints = chartResponse?.buckets || []
  const avgResponseTimes = metrics.sparklines?.avgResponseTime ?? chartPoints.map((p) => p.avgDuration ?? 0)
  const p95ResponseTimes = metrics.sparklines?.p95ResponseTime ?? chartPoints.map((p) => p.p95Duration ?? 0)
  const requestCounts = metrics.sparklines?.requestsPerMinute ?? chartPoints.map((p) => p.requestCount ?? 0)
  const errorCounts = metrics.sparklines?.errorRate ?? chartPoints.map((p) => p.errorCount ?? 0)

  return (
    <div className="ss-dash-overview">
      {/* Top metric cards */}
      <div className="ss-dash-cards">
        <div className="ss-dash-card">
          <div className="ss-dash-card-title">Avg Response Time</div>
          <div
            className={`ss-dash-card-value ${!hasData ? 'ss-dash-dim' : avgResponseTime > 500 ? 'ss-dash-red' : avgResponseTime > 200 ? 'ss-dash-amber' : 'ss-dash-accent'}`}
          >
            {hasData ? formatDuration(avgResponseTime) : '-'}
          </div>
          <div className="ss-dash-sparkline">
            <Sparkline data={avgResponseTimes} color="#34d399" width={160} height={40} />
          </div>
        </div>
        <div className="ss-dash-card">
          <div className="ss-dash-card-title">P95 Response Time</div>
          <div
            className={`ss-dash-card-value ${!hasData ? 'ss-dash-dim' : p95ResponseTime > 500 ? 'ss-dash-red' : p95ResponseTime > 200 ? 'ss-dash-amber' : 'ss-dash-accent'}`}
          >
            {hasData ? formatDuration(p95ResponseTime) : '-'}
          </div>
          <div className="ss-dash-sparkline">
            <Sparkline data={p95ResponseTimes} color="#60a5fa" width={160} height={40} />
          </div>
        </div>
        <div className="ss-dash-card">
          <div className="ss-dash-card-title">Requests / min</div>
          <div className={`ss-dash-card-value ${!hasData ? 'ss-dash-dim' : 'ss-dash-accent'}`}>
            {hasData ? requestsPerMinute.toFixed(1) : '-'}
          </div>
          <div className="ss-dash-sparkline">
            <Sparkline data={requestCounts} color="#34d399" width={160} height={40} />
          </div>
        </div>
        <div className="ss-dash-card">
          <div className="ss-dash-card-title">Error Rate</div>
          <div
            className={`ss-dash-card-value ${!hasData ? 'ss-dash-dim' : errorRate > 5 ? 'ss-dash-red' : errorRate > 1 ? 'ss-dash-amber' : 'ss-dash-accent'}`}
          >
            {hasData ? `${errorRate.toFixed(1)}%` : '-'}
          </div>
          <div className="ss-dash-sparkline">
            <Sparkline data={errorCounts} color="#f87171" width={160} height={40} />
          </div>
        </div>
      </div>

      {/* Request volume chart */}
      <div className="ss-dash-chart-container">
        <div className="ss-dash-chart-header">
          <span className="ss-dash-chart-title">Request Volume</span>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>
        <div className="ss-dash-chart" id="ss-dash-chart-area">
          {chartPoints.length === 0 ? (
            <div className="ss-dash-empty" style={{ minHeight: '120px' }}>
              No data for this range
            </div>
          ) : (
            <OverviewChart chartPoints={chartPoints} />
          )}
        </div>
        <div className="ss-dash-chart-legend" id="ss-dash-chart-legend">
          <span className="ss-dash-chart-legend-item">
            <span
              className="ss-dash-legend-dot"
              style={{ background: 'var(--ss-accent)' }}
            />
            Requests
          </span>
          {chartPoints.some((p) => (p.errorCount ?? 0) > 0) && (
            <span className="ss-dash-chart-legend-item">
              <span
                className="ss-dash-legend-dot"
                style={{ background: 'var(--ss-red-fg)' }}
              />
              Errors
            </span>
          )}
        </div>
      </div>

      {/* Secondary cards */}
      <div className="ss-dash-secondary-cards">
        {/* Slowest Endpoints */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#requests" className="ss-dash-widget-link">Slowest Endpoints</a>
          </div>
          {metrics.slowestEndpoints.length === 0 ? (
            <div className="ss-dash-empty" style={{ minHeight: '60px' }}>No data yet</div>
          ) : (
            <ul className="ss-dash-secondary-list">
              {metrics.slowestEndpoints.slice(0, 5).map((ep, i) => {
                const epUrl = ep.url || ep.pattern || '-'
                return (
                  <li key={i}>
                    <a href={`#requests?url=${encodeURIComponent(epUrl)}`} className="ss-dash-widget-row-link">
                      <span title={epUrl}>{epUrl}</span>
                      <span className={`ss-dash-secondary-list-value ss-dash-duration ${durationClass(ep.avgDuration)}`}>
                        {formatDuration(ep.avgDuration)}
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Query Stats */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#queries" className="ss-dash-widget-link">Query Stats</a>
          </div>
          <ul className="ss-dash-secondary-list">
            <li>
              <span>Total Queries</span>
              <span className="ss-dash-secondary-list-value">{metrics.queryStats.total}</span>
            </li>
            <li>
              <span>Avg Duration</span>
              <span className="ss-dash-secondary-list-value">
                {formatDuration(metrics.queryStats.avgDuration)}
              </span>
            </li>
            <li>
              <span>Queries / Request</span>
              <span className="ss-dash-secondary-list-value">
                {metrics.queryStats.perRequest.toFixed(1)}
              </span>
            </li>
          </ul>
        </div>

        {/* Recent Errors */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#logs?level=error" className="ss-dash-widget-link">Recent Errors</a>
          </div>
          {metrics.recentErrors.length === 0 ? (
            <div className="ss-dash-empty" style={{ minHeight: '60px' }}>No recent errors</div>
          ) : (
            <ul className="ss-dash-secondary-list">
              {metrics.recentErrors.map((err, i) => (
                <li key={i}>
                  <a href={`#logs?id=${err.id ?? ''}`} className="ss-dash-widget-row-link">
                    <span style={{ color: 'var(--ss-red-fg)' }} title={err.message}>
                      {err.message}
                    </span>
                    {err.timestamp && (
                      <span className="ss-dash-secondary-list-value" style={{ color: 'var(--ss-dim)' }} title={formatTime(err.timestamp)}>
                        {timeAgo(err.timestamp)}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top Events */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#events" className="ss-dash-widget-link">Top Events</a>
          </div>
          {metrics.topEvents.length === 0 ? (
            <div className="ss-dash-empty" style={{ minHeight: '60px' }}>No events yet</div>
          ) : (
            <ul className="ss-dash-secondary-list">
              {metrics.topEvents.slice(0, 5).map((ev, i) => {
                const evName = ev.name || ev.eventName || ev.event_name || ev.event || ''
                return (
                  <li key={i}>
                    <a href={`#events?event_name=${encodeURIComponent(evName)}`} className="ss-dash-widget-row-link">
                      <span>{evName}</span>
                      <span className="ss-dash-secondary-list-value">{ev.count}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Email Activity */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#emails" className="ss-dash-widget-link">Email Activity</a>
          </div>
          <ul className="ss-dash-secondary-list">
            <li>
              <a href="#emails?status=sent" className="ss-dash-widget-row-link">
                <span>Sent</span>
                <span className="ss-dash-secondary-list-value">{metrics.emailActivity.sent}</span>
              </a>
            </li>
            <li>
              <a href="#emails?status=queued" className="ss-dash-widget-row-link">
                <span>Queued</span>
                <span className="ss-dash-secondary-list-value">{metrics.emailActivity.queued}</span>
              </a>
            </li>
            <li>
              <a href="#emails?status=failed" className="ss-dash-widget-row-link">
                <span>Failed</span>
                <span className="ss-dash-secondary-list-value" style={metrics.emailActivity.failed > 0 ? { color: 'var(--ss-red-fg)' } : undefined}>
                  {metrics.emailActivity.failed}
                </span>
              </a>
            </li>
          </ul>
        </div>

        {/* Log Levels */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#logs" className="ss-dash-widget-link">Log Levels</a>
          </div>
          <ul className="ss-dash-secondary-list">
            <li>
              <a href="#logs?level=error" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-red-fg)' }}>Error</span>
                <span className="ss-dash-secondary-list-value">
                  {metrics.logLevelBreakdown.error}
                </span>
              </a>
            </li>
            <li>
              <a href="#logs?level=warn" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-amber-fg)' }}>Warn</span>
                <span className="ss-dash-secondary-list-value">
                  {metrics.logLevelBreakdown.warn}
                </span>
              </a>
            </li>
            <li>
              <a href="#logs?level=info" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-green-fg)' }}>Info</span>
                <span className="ss-dash-secondary-list-value">{metrics.logLevelBreakdown.info}</span>
              </a>
            </li>
            <li>
              <a href="#logs?level=debug" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-dim)' }}>Debug</span>
                <span className="ss-dash-secondary-list-value">{metrics.logLevelBreakdown.debug}</span>
              </a>
            </li>
          </ul>
        </div>

        {/* Cache */}
        {metrics.cacheStats && metrics.cacheStats.available && (
          <div className="ss-dash-secondary-card">
            <div className="ss-dash-secondary-card-title">
              <a href="#cache" className="ss-dash-widget-link">Cache</a>
            </div>
            <ul className="ss-dash-secondary-list">
              <li>
                <a href="#cache" className="ss-dash-widget-row-link">
                  <span>Keys</span>
                  <span className="ss-dash-secondary-list-value">{metrics.cacheStats.totalKeys}</span>
                </a>
              </li>
              <li>
                <a href="#cache" className="ss-dash-widget-row-link">
                  <span>Hit Rate</span>
                  <span className="ss-dash-secondary-list-value">{metrics.cacheStats.hitRate.toFixed(1)}%</span>
                </a>
              </li>
              <li>
                <a href="#cache" className="ss-dash-widget-row-link">
                  <span>Memory</span>
                  <span className="ss-dash-secondary-list-value">{metrics.cacheStats.memoryUsedHuman}</span>
                </a>
              </li>
            </ul>
          </div>
        )}

        {/* Job Queue */}
        {metrics.jobQueueStatus && metrics.jobQueueStatus.available && (
          <div className="ss-dash-secondary-card">
            <div className="ss-dash-secondary-card-title">
              <a href="#jobs" className="ss-dash-widget-link">Job Queue</a>
            </div>
            <ul className="ss-dash-secondary-list">
              <li>
                <a href="#jobs?status=active" className="ss-dash-widget-row-link">
                  <span>Active</span>
                  <span className="ss-dash-secondary-list-value">{metrics.jobQueueStatus.active}</span>
                </a>
              </li>
              <li>
                <a href="#jobs?status=waiting" className="ss-dash-widget-row-link">
                  <span>Waiting</span>
                  <span className="ss-dash-secondary-list-value">{metrics.jobQueueStatus.waiting}</span>
                </a>
              </li>
              <li>
                <a href="#jobs?status=failed" className="ss-dash-widget-row-link">
                  <span>Failed</span>
                  <span className="ss-dash-secondary-list-value" style={metrics.jobQueueStatus.failed > 0 ? { color: 'var(--ss-red-fg)' } : undefined}>
                    {metrics.jobQueueStatus.failed}
                  </span>
                </a>
              </li>
              <li>
                <a href="#jobs?status=completed" className="ss-dash-widget-row-link">
                  <span>Completed</span>
                  <span className="ss-dash-secondary-list-value">{metrics.jobQueueStatus.completed}</span>
                </a>
              </li>
            </ul>
          </div>
        )}

        {/* Response Status */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#requests" className="ss-dash-widget-link">Response Status</a>
          </div>
          <ul className="ss-dash-secondary-list">
            <li>
              <a href="#requests?status=2xx" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-green-fg)' }}>2xx</span>
                <span className="ss-dash-secondary-list-value">
                  {metrics.statusDistribution['2xx']}
                </span>
              </a>
            </li>
            <li>
              <a href="#requests?status=3xx" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-blue-fg)' }}>3xx</span>
                <span className="ss-dash-secondary-list-value">
                  {metrics.statusDistribution['3xx']}
                </span>
              </a>
            </li>
            <li>
              <a href="#requests?status=4xx" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-amber-fg)' }}>4xx</span>
                <span className="ss-dash-secondary-list-value">
                  {metrics.statusDistribution['4xx']}
                </span>
              </a>
            </li>
            <li>
              <a href="#requests?status=5xx" className="ss-dash-widget-row-link">
                <span style={{ color: 'var(--ss-red-fg)' }}>5xx</span>
                <span className="ss-dash-secondary-list-value">
                  {metrics.statusDistribution['5xx']}
                </span>
              </a>
            </li>
          </ul>
        </div>

        {/* Slowest Queries */}
        <div className="ss-dash-secondary-card">
          <div className="ss-dash-secondary-card-title">
            <a href="#queries" className="ss-dash-widget-link">Slowest Queries</a>
          </div>
          {metrics.slowestQueries.length === 0 ? (
            <div className="ss-dash-empty" style={{ minHeight: '60px' }}>No query data yet</div>
          ) : (
            <ul className="ss-dash-secondary-list">
              {metrics.slowestQueries.slice(0, 5).map((q, i) => {
                const qSql = q.sqlNormalized || q.normalizedSql || q.sql_normalized || q.sql || '-'
                return (
                  <li key={i}>
                    <a href={`#queries?pattern=${encodeURIComponent(qSql)}`} className="ss-dash-widget-row-link">
                      <span title={qSql}>{qSql}</span>
                      <span className={`ss-dash-secondary-list-value ss-dash-duration ${durationClass(q.avgDuration)}`}>
                        {formatDuration(q.avgDuration)}
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default OverviewSection
