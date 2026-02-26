import React from 'react'
import type { BadgeColor } from '../../../core/types.js'

interface BadgeProps {
  color?: BadgeColor
  children: React.ReactNode
  className?: string
}

/**
 * Colored pill badge for status indicators.
 */
export function Badge({ color = 'muted', children, className = '' }: BadgeProps) {
  return (
    <span className={`ss-badge-pill ss-badge-${color} ${className}`}>
      {children}
    </span>
  )
}

interface MethodBadgeProps {
  method: string
  className?: string
}

/**
 * HTTP method pill badge (GET, POST, PUT, DELETE, etc.).
 */
export function MethodBadge({ method, className = '' }: MethodBadgeProps) {
  return (
    <span className={`ss-method ss-method-${method.toLowerCase()} ${className}`}>
      {method}
    </span>
  )
}

interface StatusBadgeProps {
  code: number
  className?: string
}

/**
 * HTTP status code badge with color coding.
 */
export function StatusBadge({ code, className = '' }: StatusBadgeProps) {
  let colorClass = 'ss-status-2xx'
  if (code >= 500) colorClass = 'ss-status-5xx'
  else if (code >= 400) colorClass = 'ss-status-4xx'
  else if (code >= 300) colorClass = 'ss-status-3xx'

  return (
    <span className={`ss-status ${colorClass} ${className}`}>
      {code}
    </span>
  )
}
