import React from 'react'

import type { TimeRange } from '../../../../core/types.js'

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  className?: string
}

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
]

/**
 * Time range selector buttons (5m / 15m / 30m / 1h / 6h / 24h / 7d).
 */
export function TimeRangeSelector({ value, onChange, className = '' }: TimeRangeSelectorProps) {
  return (
    <div className={`ss-dash-btn-group ${className}`}>
      {RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          className={`ss-dash-btn ${value === range.value ? 'ss-dash-active' : ''}`}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}
