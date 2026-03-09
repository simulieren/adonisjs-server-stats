import React from 'react'

import { formatTime, timeAgo } from '../../../core/formatters.js'

interface TimeAgoCellProps {
  /** Unix timestamp in milliseconds, or an ISO date string. */
  ts: number | string | null | undefined
  /** CSS class name for the wrapper span. */
  className?: string
  /** Optional inline styles. */
  style?: React.CSSProperties
}

/**
 * Renders a relative time string (e.g. "3s ago") with a tooltip showing
 * the formatted absolute time.
 *
 * Replaces the repeated `<span title={formatTime(ts)}>{timeAgo(ts)}</span>` pattern.
 */
export function TimeAgoCell({ ts, className, style }: TimeAgoCellProps) {
  if (!ts) {
    return (
      <span className={className} style={style}>
        -
      </span>
    )
  }
  return (
    <span className={className} style={style} title={formatTime(ts)}>
      {timeAgo(ts)}
    </span>
  )
}
