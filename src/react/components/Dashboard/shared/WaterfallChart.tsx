import React, { useMemo } from 'react'
import type { TraceSpan } from '../../../../core/types.js'
import { formatDuration } from '../../../../core/formatters.js'

interface WaterfallChartProps {
  spans: TraceSpan[]
  totalDuration: number
  className?: string
}

const CATEGORY_COLORS: Record<string, string> = {
  request: '#1e3a5f',
  middleware: 'rgba(30, 58, 95, 0.7)',
  db: '#6d28d9',
  view: '#0e7490',
  mail: '#059669',
  event: '#b45309',
  custom: '#525252',
}

/**
 * Trace waterfall visualization.
 *
 * Renders horizontal bars positioned by time offset relative to
 * the request start, showing the timeline of operations.
 */
export function WaterfallChart({ spans, totalDuration, className = '' }: WaterfallChartProps) {
  const sortedSpans = useMemo(
    () => [...spans].sort((a, b) => a.startOffset - b.startOffset),
    [spans]
  )

  if (spans.length === 0) {
    return <div className="ss-dash-empty">No spans recorded</div>
  }

  return (
    <div className={`ss-dash-waterfall ${className}`}>
      {/* Legend */}
      <div className="ss-dash-waterfall-legend">
        {Object.entries(CATEGORY_COLORS)
          .filter(([cat]) => spans.some((s) => s.category === cat))
          .map(([cat, color]) => (
            <div key={cat} className="ss-dash-waterfall-legend-item">
              <div
                className="ss-dash-waterfall-legend-dot"
                style={{ background: color }}
              />
              <span>{cat}</span>
            </div>
          ))}
      </div>

      {/* Rows */}
      <div className="ss-dash-waterfall-rows">
        {sortedSpans.map((span) => {
          const left = totalDuration > 0 ? (span.startOffset / totalDuration) * 100 : 0
          const width = totalDuration > 0 ? Math.max((span.duration / totalDuration) * 100, 0.5) : 1

          return (
            <div key={span.id} className="ss-dash-waterfall-row">
              <div className="ss-dash-waterfall-label" title={span.label}>
                {span.label}
              </div>
              <div className="ss-dash-waterfall-track">
                <div
                  className="ss-dash-waterfall-bar"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: CATEGORY_COLORS[span.category] || CATEGORY_COLORS.custom,
                  }}
                  title={`${span.label}: ${formatDuration(span.duration)} (offset: ${formatDuration(span.startOffset)})`}
                />
              </div>
              <span className="ss-dash-waterfall-dur">
                {formatDuration(span.duration)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
