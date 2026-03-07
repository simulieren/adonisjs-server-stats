import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

import { formatStatNum } from '../../../core/formatters.js'
import { computeStats } from '../../../core/sparkline.js'
import { Sparkline } from './Sparkline.js'

import type { MetricDefinition } from '../../../core/types.js'
import type { ServerStats } from '../../../core/types.js'

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
 * Compute tooltip position relative to .ss-bar, matching the old
 * vanilla JS `positionTooltip` behaviour:
 *   left = badge centre relative to bar left
 *   bottom = 100% (above the bar)
 *   edge-clamp so the tooltip never overflows the viewport.
 */
function useTooltipPosition(
  badgeRef: React.RefObject<HTMLDivElement | null>,
  tooltipRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean
) {
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: '10px',
    zIndex: 180,
  })

  useEffect(() => {
    if (!visible) return

    const update = () => {
      const badge = badgeRef.current
      const tip = tooltipRef.current
      if (!badge || !tip) return

      // Walk up to find the .ss-bar container
      const bar = badge.closest('.ss-bar') as HTMLElement | null
      if (!bar) return

      const badgeRect = badge.getBoundingClientRect()
      const barRect = bar.getBoundingClientRect()

      // Centre the tooltip on the badge, relative to the bar
      const leftPos = badgeRect.left - barRect.left + badgeRect.width / 2

      setStyle({
        position: 'absolute',
        bottom: '100%',
        left: `${leftPos}px`,
        transform: 'translateX(-50%)',
        marginBottom: '10px',
        zIndex: 180,
      })

      // After the browser paints, edge-clamp so the tooltip
      // stays within 8px of the viewport edges.
      requestAnimationFrame(() => {
        const tipRect = tip.getBoundingClientRect()
        let shift = 0
        if (tipRect.left < 8) {
          shift = 8 - tipRect.left
        } else if (tipRect.right > window.innerWidth - 8) {
          shift = window.innerWidth - 8 - tipRect.right
        }
        if (shift) {
          setStyle((prev) => ({
            ...prev,
            transform: `translateX(calc(-50% + ${shift}px))`,
          }))
        }
      })
    }

    // Initial position
    update()

    // Re-position when the scroll container scrolls (badge moves
    // horizontally while the bar stays put).
    const scrollEl = badgeRef.current?.closest('.ss-bar-scroll')
    scrollEl?.addEventListener('scroll', update)
    window.addEventListener('resize', update)

    return () => {
      scrollEl?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [visible, badgeRef, tooltipRef])

  return style
}

/**
 * Individual metric display in the stats bar.
 *
 * Shows a label, value, color coding, and an expandable tooltip
 * with sparkline and statistics on click/hover.
 *
 * The tooltip is rendered via a React portal into the nearest
 * `.ss-bar` ancestor so it is not clipped by the scroll container
 * (`overflow-x: auto` on `.ss-bar-scroll`). Position is calculated
 * relative to the badge, matching the old vanilla JS behaviour.
 */
export function MetricCard({ metric, stats, history, className = '' }: MetricCardProps) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Conditional visibility
  if (metric.show && !metric.show(stats)) {
    return null
  }

  const value = metric.value ? metric.value(stats) : metric.format(stats)
  const colorClass = metric.color ? metric.color(stats) : ''
  const hexColor = colorClass ? COLOR_MAP[colorClass] || '#34d399' : '#34d399'

  const detail = typeof metric.detail === 'function' ? metric.detail(stats) : metric.detail

  const statsInfo = useMemo(() => computeStats(history), [history])

  const showTooltip = pinned || hovered

  const tooltipStyle = useTooltipPosition(cardRef, tooltipRef, showTooltip)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setPinned((prev) => !prev)
  }, [])

  // Close pinned tooltip when clicking outside
  useEffect(() => {
    if (!pinned) return

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        cardRef.current &&
        !cardRef.current.contains(target) &&
        tooltipRef.current &&
        !tooltipRef.current.contains(target)
      ) {
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

  // Resolve the portal target: the closest .ss-bar ancestor
  const portalTarget = cardRef.current?.closest('.ss-bar') as HTMLElement | null

  const tooltip =
    showTooltip && portalTarget
      ? createPortal(
          <div
            ref={tooltipRef}
            className={`ss-tooltip ${pinned ? 'ss-pinned' : ''}`}
            style={tooltipStyle}
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
          </div>,
          portalTarget
        )
      : null

  return (
    <>
      <div
        ref={cardRef}
        className={`ss-badge ${pinned ? 'ss-pinned' : ''} ${className}`}
        onClick={handleClick}
        onMouseEnter={() => !pinned && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick(e as unknown as React.MouseEvent)}
      >
        <span className="ss-label">{metric.label}</span>
        <span className={`ss-value ${colorClass}`}>{value}</span>
      </div>
      {tooltip}
    </>
  )
}
