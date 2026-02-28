import React, { useMemo } from 'react'

import { buildSparklineData } from '../../../core/sparkline.js'

interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  className?: string
}

/**
 * SVG sparkline chart component.
 *
 * Renders a mini line chart with gradient fill from numeric data.
 */
export function Sparkline({
  data,
  color = '#34d399',
  width = 120,
  height = 32,
  className = '',
}: SparklineProps) {
  const sparkline = useMemo(
    () => buildSparklineData(data, { width, height }),
    [data, width, height]
  )

  const gradientId = useMemo(() => 'ss-grad-' + Math.random().toString(36).slice(2, 8), [])

  const wrapStyle = { '--ss-accent': color } as React.CSSProperties

  if (!sparkline) {
    return (
      <div className={`ss-dash-sparkline ${className}`} style={wrapStyle}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: 'block' }}
        >
          <text x={width / 2} y={height / 2 + 3} textAnchor="middle" fill="#737373" fontSize="9">
            collecting{'\u2026'}
          </text>
        </svg>
      </div>
    )
  }

  const resolvedColor = color || 'var(--ss-accent)'

  return (
    <div className={`ss-dash-sparkline ${className}`} style={wrapStyle}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={resolvedColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={resolvedColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={sparkline.areaPath} fill={`url(#${gradientId})`} />
        <path
          className="ss-dash-sparkline-line"
          d={'M' + sparkline.points.replace(/ /g, ' L')}
          fill="none"
          stroke={resolvedColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
