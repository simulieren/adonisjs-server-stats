import React, { useMemo } from 'react'

import type { TraceSpan } from '../../../../core/types.js'

interface WaterfallChartProps {
  spans: TraceSpan[]
  totalDuration: number
  className?: string
  warnings?: string[]
}

const CATEGORY_COLORS: Record<string, string> = {
  request: '#1e3a5f',
  middleware: 'rgba(30, 58, 95, 0.7)',
  db: '#6d28d9',
  view: '#0e7490',
  mail: '#059669',
  event: '#b45309',
  custom: 'var(--ss-dim)',
}

const CATEGORY_LABELS: Record<string, string> = {
  request: 'Request',
  middleware: 'Middleware',
  db: 'DB',
  mail: 'Mail',
  event: 'Event',
  view: 'View',
  custom: 'Custom',
}

/**
 * Trace waterfall visualization.
 *
 * Renders horizontal bars positioned by time offset relative to
 * the request start, showing the timeline of operations.
 */
export function WaterfallChart({
  spans,
  totalDuration,
  className = '',
  warnings,
}: WaterfallChartProps) {
  const safeSpans = spans || []

  const sortedSpans = useMemo(
    () => [...safeSpans].sort((a, b) => a.startOffset - b.startOffset),
    [safeSpans]
  )

  const depthMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of sortedSpans) {
      map[s.id] = s.parentId ? (map[s.parentId] || 0) + 1 : 0
    }
    return map
  }, [sortedSpans])

  if (safeSpans.length === 0) {
    return <div className="ss-dash-empty">No spans recorded</div>
  }

  return (
    <div className={`ss-dash-tl-waterfall ${className}`}>
      {/* Legend */}
      <div className="ss-dash-tl-legend">
        {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
          <div key={cat} className="ss-dash-tl-legend-item">
            <span
              className="ss-dash-tl-legend-dot"
              style={{
                background: CATEGORY_COLORS[cat] || CATEGORY_COLORS.custom,
              }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Rows */}
      {sortedSpans.map((span) => {
        const left = totalDuration > 0 ? (span.startOffset / totalDuration) * 100 : 0
        const width = totalDuration > 0 ? Math.max((span.duration / totalDuration) * 100, 0.5) : 1
        const depth = depthMap[span.id] || 0
        const truncatedLabel = span.label.length > 50 ? span.label.slice(0, 50) + '...' : span.label

        const catLabel = span.category === 'db' ? 'DB' : span.category
        const badgeCat =
          span.category === 'db'
            ? 'purple'
            : span.category === 'mail'
              ? 'green'
              : span.category === 'event'
                ? 'amber'
                : span.category === 'view'
                  ? 'blue'
                  : 'muted'

        const metaStr = span.metadata
          ? Object.entries(span.metadata)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')
          : ''
        const tooltip = metaStr
          ? `${span.label} (${span.duration.toFixed(2)}ms)\n${metaStr}`
          : `${span.label} (${span.duration.toFixed(2)}ms)`

        return (
          <div key={span.id} className="ss-dash-tl-row">
            <div
              className="ss-dash-tl-label"
              title={tooltip}
              style={{ paddingLeft: 8 + depth * 16 + 'px' }}
            >
              <span
                className={`ss-dash-badge ss-dash-badge-${badgeCat}`}
                style={{ fontSize: '9px', marginRight: '4px' }}
              >
                {catLabel}
              </span>
              {truncatedLabel}
            </div>
            <div className="ss-dash-tl-track">
              <div
                className={`ss-dash-tl-bar ss-dash-tl-bar-${span.category || 'custom'}`}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                }}
                title={tooltip}
              />
            </div>
            <span className="ss-dash-tl-dur">{span.duration.toFixed(2)}ms</span>
          </div>
        )
      })}

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="ss-dash-tl-warnings">
          <div className="ss-dash-tl-warnings-title">Warnings ({warnings.length})</div>
          {warnings.map((w, i) => (
            <div key={i} className="ss-dash-tl-warning">
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
