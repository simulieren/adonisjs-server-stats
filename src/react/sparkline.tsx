import type { SparklineProps } from './types.js'

export function Sparkline({
  data,
  color = '#34d399',
  width = 120,
  height = 32,
  collectingLabel,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="block">
        <text x={width / 2} y={height / 2 + 3} textAnchor="middle" fill="#737373" fontSize="9">
          {collectingLabel ?? 'collecting data\u2026'}
        </text>
      </svg>
    )
  }

  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const dataMin = Math.min(...data)
  const dataMax = Math.max(...data)
  const range = dataMax - dataMin || 1

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w
    const y = pad + h - ((v - dataMin) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const polyline = points.join(' ')
  const areaPath = `M${points[0]} ${points
    .slice(1)
    .map((p) => `L${p}`)
    .join(
      ' '
    )} L${(pad + w).toFixed(1)},${(pad + h).toFixed(1)} L${pad.toFixed(1)},${(pad + h).toFixed(1)} Z`

  return (
    <svg width={width} height={height} className="block">
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#sg-${color.replace('#', '')})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
