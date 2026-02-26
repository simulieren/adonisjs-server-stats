import React, { useState, useMemo, useCallback } from 'react'

import { timeAgo, formatDuration } from '../../../../core/formatters.js'
import { useDebugData } from '../../../hooks/useDebugData.js'

import type { TraceRecord, TraceSpan, DebugPanelProps } from '../../../../core/types.js'

interface TimelineTabProps {
  options?: DebugPanelProps
}

const BAR_COLORS: Record<string, string> = {
  request: '#1e3a5f',
  middleware: 'rgba(30, 58, 95, 0.7)',
  db: '#6d28d9',
  view: '#0e7490',
  mail: '#059669',
  event: '#b45309',
  custom: '#525252',
}

const LEGEND_ITEMS = [
  { label: 'Request', color: '#1e3a5f' },
  { label: 'Middleware', color: 'rgba(30, 58, 95, 0.7)' },
  { label: 'Database', color: '#6d28d9' },
  { label: 'View', color: '#0e7490' },
  { label: 'Mail', color: '#059669' },
  { label: 'Event', color: '#b45309' },
]

export function TimelineTab({ options }: TimelineTabProps) {
  const { data, isLoading, error } = useDebugData<{ traces: TraceRecord[] }>('timeline', options)
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null)

  const traces = data?.traces || []

  const activeTrace = useMemo(
    () => traces.find((t) => t.id === selectedTrace),
    [traces, selectedTrace]
  )

  const handleSelectTrace = useCallback((id: number) => {
    setSelectedTrace((prev) => (prev === id ? null : id))
  }, [])

  const statusClass = useCallback((code: number) => {
    if (code >= 500) return 'ss-dbg-status-5xx'
    if (code >= 400) return 'ss-dbg-status-4xx'
    if (code >= 300) return 'ss-dbg-status-3xx'
    return 'ss-dbg-status-2xx'
  }, [])

  if (isLoading && !data) {
    return <div className="ss-dbg-empty">Loading traces...</div>
  }

  if (error) {
    return <div className="ss-dbg-empty">Error: {error.message}</div>
  }

  // Waterfall detail view
  if (activeTrace) {
    return (
      <div>
        <div className="ss-dbg-tl-detail-header">
          <button type="button" className="ss-dbg-btn-clear" onClick={() => setSelectedTrace(null)}>
            Back
          </button>
          <span className={`ss-dbg-method ss-dbg-method-${activeTrace.method.toLowerCase()}`}>
            {activeTrace.method}
          </span>
          <span style={{ color: 'var(--ss-text)' }}>{activeTrace.url}</span>
          <span className={`ss-dbg-status ${statusClass(activeTrace.statusCode)}`}>
            {activeTrace.statusCode}
          </span>
          <span className="ss-dbg-tl-meta">
            {formatDuration(activeTrace.totalDuration)} | {activeTrace.spanCount} spans
          </span>
        </div>

        {/* Legend */}
        <div className="ss-dbg-tl-legend">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="ss-dbg-tl-legend-item">
              <div className="ss-dbg-tl-legend-dot" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Waterfall rows */}
        <div style={{ padding: '8px 12px', overflow: 'auto' }}>
          {activeTrace.spans.map((span: TraceSpan) => {
            const left = (span.startOffset / activeTrace.totalDuration) * 100
            const width = Math.max((span.duration / activeTrace.totalDuration) * 100, 0.5)

            return (
              <div key={span.id} className="ss-dbg-tl-row">
                <div className="ss-dbg-tl-label" title={span.label}>
                  {span.label}
                </div>
                <div className="ss-dbg-tl-track">
                  <div
                    className="ss-dbg-tl-bar"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: BAR_COLORS[span.category] || BAR_COLORS.custom,
                    }}
                    title={`${span.label}: ${formatDuration(span.duration)}`}
                  />
                </div>
                <span className="ss-dbg-tl-dur">{formatDuration(span.duration)}</span>
              </div>
            )
          })}
        </div>

        {/* Warnings */}
        {activeTrace.warnings.length > 0 && (
          <div className="ss-dbg-tl-warnings">
            <div className="ss-dbg-tl-warnings-title">Warnings</div>
            {activeTrace.warnings.map((w, i) => (
              <div key={i} className="ss-dbg-tl-warning">
                {w}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Trace list view
  return (
    <div>
      {traces.length === 0 ? (
        <div className="ss-dbg-empty">No traces captured. Enable tracing in config.</div>
      ) : (
        <table className="ss-dbg-table">
          <thead>
            <tr>
              <th style={{ width: '70px' }}>Method</th>
              <th>URL</th>
              <th style={{ width: '60px' }}>Status</th>
              <th style={{ width: '80px' }}>Duration</th>
              <th style={{ width: '50px' }}>Spans</th>
              <th style={{ width: '80px' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => (
              <tr
                key={trace.id}
                onClick={() => handleSelectTrace(trace.id)}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <span className={`ss-dbg-method ss-dbg-method-${trace.method.toLowerCase()}`}>
                    {trace.method}
                  </span>
                </td>
                <td style={{ color: 'var(--ss-text)' }}>{trace.url}</td>
                <td>
                  <span className={`ss-dbg-status ${statusClass(trace.statusCode)}`}>
                    {trace.statusCode}
                  </span>
                </td>
                <td>
                  <span
                    className={`ss-dbg-duration ${trace.totalDuration > 500 ? 'ss-dbg-very-slow' : trace.totalDuration > 100 ? 'ss-dbg-slow' : ''}`}
                  >
                    {formatDuration(trace.totalDuration)}
                  </span>
                </td>
                <td>{trace.spanCount}</td>
                <td className="ss-dbg-event-time">{timeAgo(trace.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default TimelineTab
