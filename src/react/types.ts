export type { ServerStats } from '../types.js'

export interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  collectingLabel?: string
}

export interface TooltipPopupProps {
  title: string
  unit?: string
  currentValue: string
  history?: number[]
  historyColor?: string
  details?: string
  maxHistory?: number
}

export interface StatBadgeProps {
  label: string
  value: string
  color?: string
  tooltipTitle: string
  tooltipUnit?: string
  tooltipDetails?: string
  history?: number[]
  historyColor?: string
  href?: string
}

export interface UseServerStatsOptions {
  endpoint?: string
  channel?: string
  maxHistory?: number
  staleTimeout?: number
}
