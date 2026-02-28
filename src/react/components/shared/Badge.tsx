import React from 'react'

import type { BadgeColor } from '../../../core/types.js'

interface BadgeProps {
  color?: BadgeColor
  children: React.ReactNode
  className?: string
  classPrefix?: 'ss-dash' | 'ss-dbg'
}

/**
 * Colored pill badge for status indicators.
 */
export function Badge({ color = 'muted', children, className = '', classPrefix = 'ss-dash' }: BadgeProps) {
  return <span className={`${classPrefix}-badge ${classPrefix}-badge-${color} ${className}`}>{children}</span>
}

interface MethodBadgeProps {
  method: string
  className?: string
  classPrefix?: 'ss-dash' | 'ss-dbg'
}

/**
 * HTTP method pill badge (GET, POST, PUT, DELETE, etc.).
 */
export function MethodBadge({ method, className = '', classPrefix = 'ss-dash' }: MethodBadgeProps) {
  return (
    <span className={`${classPrefix}-method ${classPrefix}-method-${method.toLowerCase()} ${className}`}>{method}</span>
  )
}

interface StatusBadgeProps {
  code: number
  className?: string
  classPrefix?: 'ss-dash' | 'ss-dbg'
}

/**
 * HTTP status code badge with color coding.
 */
export function StatusBadge({ code, className = '', classPrefix = 'ss-dash' }: StatusBadgeProps) {
  let colorClass = `${classPrefix}-status-2xx`
  if (code >= 500) colorClass = `${classPrefix}-status-5xx`
  else if (code >= 400) colorClass = `${classPrefix}-status-4xx`
  else if (code >= 300) colorClass = `${classPrefix}-status-3xx`

  return <span className={`${classPrefix}-status ${colorClass} ${className}`}>{code}</span>
}
