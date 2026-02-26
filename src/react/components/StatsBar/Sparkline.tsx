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

  if (!sparkline) {
    return (
      <svg width={width} height={height} className={className} style={{ display: 'block' }}>
        <text
          x={width / 2}
          y={height / 2 + 3}
          textAnchor="middle"
          fill="#737373"
          fontSize="9"
        >
          collecting...
        </text>
      </svg>
    )
  }

  const gradId = `sg-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

  return (
    <svg
      width={width}
      height={height}
      className={className}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={sparkline.areaPath} fill={`url(#${gradId})`} />
      <polyline
        points={sparkline.points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
