import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { MetricDefinition } from '../../../core/types.js'
import type { ServerStats } from '../../../core/types.js'
import { formatStatNum } from '../../../core/formatters.js'
import { computeStats } from '../../../core/sparkline.js'
import { Sparkline } from './Sparkline.js'

/** Map color class to hex for sparklines. */
const COLOR_MAP: Record<string, string> = {
  'ss-red': '#f87171',
  'ss-amber': '#fbbf24',
  'ss-green': '#34d399',
  'ss-muted': '#737373',
}

interface MetricCardProps {
  metric: MetricDefinition
  stats: ServerStats
  history: number[]
  className?: string
}

/**
 * Individual metric display in the stats bar.
 *
 * Shows a label, value, color coding, and an expandable tooltip
 * with sparkline and statistics on click/hover.
 */
export function MetricCard({ metric, stats, history, className = '' }: MetricCardProps) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Conditional visibility
  if (metric.show && !metric.show(stats)) {
    return null
  }

  const value = metric.value ? metric.value(stats) : metric.format(stats)
  const colorClass = metric.color ? metric.color(stats) : ''
  const hexColor = colorClass ? (COLOR_MAP[colorClass] || '#34d399') : '#34d399'

  const detail = typeof metric.detail === 'function' ? metric.detail(stats) : metric.detail

  const statsInfo = useMemo(() => computeStats(history), [history])

  const showTooltip = pinned || hovered

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setPinned((prev) => !prev)
    },
    []
  )

  // Close pinned tooltip when clicking outside
  useEffect(() => {
    if (!pinned) return

    const handleOutsideClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setPinned(false)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }

    document.addEventListener('click', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('click', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [pinned])

  return (
    <div
      ref={cardRef}
      className={`ss-badge ${pinned ? 'ss-pinned' : ''} ${className}`}
      onClick={handleClick}
      onMouseEnter={() => !pinned && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick(e as any)}
    >
      <span className="ss-label">{metric.label}</span>
      <span className={`ss-value ${colorClass}`}>{value}</span>

      {showTooltip && (
        <div
          className={`ss-tooltip ${pinned ? 'ss-pinned' : ''}`}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '10px',
            zIndex: 180,
          }}
        >
          <div className="ss-tooltip-inner" style={{ position: 'relative' }}>
            {pinned && (
              <button
                className="ss-tooltip-close"
                onClick={(e) => {
                  e.stopPropagation()
                  setPinned(false)
                }}
                type="button"
              >
                {'\u00D7'}
              </button>
            )}
            <div className="ss-tooltip-header">
              <span className="ss-tooltip-title">{metric.title}</span>
              {metric.unit && <span className="ss-tooltip-unit">{metric.unit}</span>}
            </div>
            <div className="ss-tooltip-current">
              <span className="ss-tooltip-current-label">Current: </span>
              <span className="ss-tooltip-current-value">{value}</span>
            </div>
            {statsInfo && (
              <div className="ss-tooltip-stats">
                <span>Min: {formatStatNum(statsInfo.min, metric.unit)}</span>
                <span>Max: {formatStatNum(statsInfo.max, metric.unit)}</span>
                <span>Avg: {formatStatNum(statsInfo.avg, metric.unit)}</span>
              </div>
            )}
            {detail && <div className="ss-tooltip-details">{detail}</div>}
            {history.length > 0 && (
              <>
                <div className="ss-tooltip-sparkline">
                  <Sparkline data={history} color={hexColor} />
                </div>
                <div className="ss-tooltip-samples">
                  Last {Math.min(history.length, 60)} samples (~
                  {Math.round((Math.min(history.length, 60) * 3) / 60)} min)
                </div>
              </>
            )}
          </div>
          <div className="ss-tooltip-arrow" />
        </div>
      )}
    </div>
  )
}
