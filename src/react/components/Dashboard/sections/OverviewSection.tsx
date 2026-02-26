import React, { useState, useMemo } from 'react'
import type { OverviewMetrics, ChartDataPoint, DashboardHookOptions, TimeRange } from '../../../../core/types.js'
import { useDashboardData } from '../../../hooks/useDashboardData.js'
import { formatDuration } from '../../../../core/formatters.js'
import { Sparkline } from '../../StatsBar/Sparkline.js'
import { TimeRangeSelector } from '../shared/TimeRangeSelector.js'

interface OverviewSectionProps {
  options?: DashboardHookOptions
}

export function OverviewSection({ options = {} }: OverviewSectionProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h')
  const { data: overview, isLoading } = useDashboardData<OverviewMetrics>('overview', options)
  const { data: chartData } = useDashboardData<ChartDataPoint[]>('overview/chart', {
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
    slowestEndpoints: [],
    queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
    recentErrors: [],
  }

  // Extract sparkline data from chart points
  const chartPoints = chartData || []
  const avgResponseTimes = chartPoints.map((p) => p.avgDuration ?? 0)
  const p95ResponseTimes = chartPoints.map((p) => p.p95Duration ?? 0)
  const requestCounts = chartPoints.map((p) => p.requestCount ?? 0)
  const errorCounts = chartPoints.map((p) => p.errorCount ?? 0)

  return (
    <div className="ss-dash-overview">
      {/* Top metric cards */}
      <div className="ss-dash-metric-cards">
        <div className="ss-dash-metric-card">
          <div className="ss-dash-metric-label">Avg Response Time</div>
          <div className="ss-dash-metric-value">{formatDuration(metrics.avgResponseTime)}</div>
          <Sparkline data={avgResponseTimes} color="#34d399" width={160} height={40} />
        </div>
        <div className="ss-dash-metric-card">
          <div className="ss-dash-metric-label">P95 Response Time</div>
          <div className="ss-dash-metric-value">{formatDuration(metrics.p95ResponseTime)}</div>
          <Sparkline data={p95ResponseTimes} color="#60a5fa" width={160} height={40} />
        </div>
        <div className="ss-dash-metric-card">
          <div className="ss-dash-metric-label">Requests/min</div>
          <div className="ss-dash-metric-value">{metrics.requestsPerMinute.toFixed(1)}</div>
          <Sparkline data={requestCounts} color="#34d399" width={160} height={40} />
        </div>
        <div className="ss-dash-metric-card">
          <div className="ss-dash-metric-label">Error Rate</div>
          <div className={`ss-dash-metric-value ${metrics.errorRate > 5 ? 'ss-dash-text-red' : metrics.errorRate > 1 ? 'ss-dash-text-amber' : ''}`}>
            {metrics.errorRate.toFixed(1)}%
          </div>
          <Sparkline data={errorCounts} color="#f87171" width={160} height={40} />
        </div>
      </div>

      {/* Request volume chart */}
      <div className="ss-dash-chart-section">
        <div className="ss-dash-section-header">
          <h3>Request Volume</h3>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>
        <div className="ss-dash-bar-chart">
          {chartPoints.length === 0 ? (
            <div className="ss-dash-empty" style={{ minHeight: '120px' }}>No data for this range</div>
          ) : (
            <svg width="100%" height="160" viewBox={`0 0 ${chartPoints.length * 12} 160`} preserveAspectRatio="none">
              {(() => {
                const maxCount = Math.max(...chartPoints.map((p) => p.requestCount ?? 0), 1)
                return chartPoints.map((point, i) => {
                  const reqCount = point.requestCount ?? 0
                  const errCount = point.errorCount ?? 0
                  const barHeight = (reqCount / maxCount) * 140
                  const errorHeight = (errCount / maxCount) * 140
                  return (
                    <g key={i}>
                      <rect
                        x={i * 12 + 1}
                        y={150 - barHeight}
                        width="10"
                        height={barHeight}
                        rx="1"
                        fill="var(--ss-accent, #34d399)"
                        opacity="0.6"
                      >
                        <title>{`${point.bucket}: ${reqCount} requests`}</title>
                      </rect>
                      {errCount > 0 && (
                        <rect
                          x={i * 12 + 1}
                          y={150 - errorHeight}
                          width="10"
                          height={errorHeight}
                          rx="1"
                          fill="var(--ss-red-fg, #f87171)"
                          opacity="0.8"
                        />
                      )}
                    </g>
                  )
                })
              })()}
            </svg>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="ss-dash-overview-bottom">
        {/* Slowest Endpoints */}
        <div className="ss-dash-card">
          <h4>Slowest Endpoints</h4>
          <div className="ss-dash-card-content">
            {metrics.slowestEndpoints.length === 0 ? (
              <span className="ss-dash-muted">No data</span>
            ) : (
              <table className="ss-dash-mini-table">
                <tbody>
                  {metrics.slowestEndpoints.map((ep, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--ss-text)' }}>{ep.url}</td>
                      <td style={{ textAlign: 'right' }}>{formatDuration(ep.avgDuration)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--ss-dim)' }}>{ep.count}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Query Stats */}
        <div className="ss-dash-card">
          <h4>Query Stats</h4>
          <div className="ss-dash-card-content">
            <div className="ss-dash-stat-row">
              <span>Total Queries</span>
              <span>{metrics.queryStats.total}</span>
            </div>
            <div className="ss-dash-stat-row">
              <span>Avg Duration</span>
              <span>{formatDuration(metrics.queryStats.avgDuration)}</span>
            </div>
            <div className="ss-dash-stat-row">
              <span>Per Request</span>
              <span>{metrics.queryStats.perRequest.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Recent Errors */}
        <div className="ss-dash-card">
          <h4>Recent Errors</h4>
          <div className="ss-dash-card-content">
            {metrics.recentErrors.length === 0 ? (
              <span className="ss-dash-muted">No errors</span>
            ) : (
              metrics.recentErrors.map((err, i) => (
                <div key={i} className="ss-dash-error-entry">
                  <span className="ss-dash-error-level">{err.level}</span>
                  <span className="ss-dash-error-msg">{err.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default OverviewSection
