import React, { useState, useRef, useCallback, useEffect } from 'react'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  position?: 'top' | 'bottom'
  className?: string
}

/**
 * Hover tooltip component.
 *
 * Renders content in a positioned floating element that appears
 * on hover over the children element.
 */
export function Tooltip({ content, children, position = 'top', className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ left: 0, bottom: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    setVisible(false)
  }, [])

  useEffect(() => {
    if (!visible || !triggerRef.current || !tipRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tipRect = tipRef.current.getBoundingClientRect()

    let left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2
    let bottom: number | undefined

    // Clamp to viewport
    if (left < 8) left = 8
    if (left + tipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - 8 - tipRect.width
    }

    if (position === 'top') {
      bottom = window.innerHeight - triggerRect.top + 8
    }

    setCoords({ left, bottom: bottom ?? 0 })
  }, [visible, position])

  return (
    <div
      ref={triggerRef}
      className={`ss-tooltip-trigger ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ display: 'inline-flex', position: 'relative' }}
    >
      {children}
      {visible && (
        <div
          ref={tipRef}
          className="ss-tooltip"
          style={{
            position: 'fixed',
            left: `${coords.left}px`,
            bottom: position === 'top' ? `${coords.bottom}px` : undefined,
            zIndex: 200,
            pointerEvents: 'none',
          }}
        >
          <div className="ss-tooltip-inner">{content}</div>
          <div className="ss-tooltip-arrow" />
        </div>
      )}
    </div>
  )
}
