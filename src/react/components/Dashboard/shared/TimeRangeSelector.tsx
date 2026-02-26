import React, { useCallback } from 'react'
import type { TimeRange } from '../../../../core/types.js'

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  className?: string
}

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
]

/**
 * Time range selector buttons (1h / 6h / 24h / 7d).
 */
export function TimeRangeSelector({ value, onChange, className = '' }: TimeRangeSelectorProps) {
  return (
    <div className={`ss-dash-time-range ${className}`}>
      {RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          className={`ss-dash-range-btn ${value === range.value ? 'ss-dash-range-active' : ''}`}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}
