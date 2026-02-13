import { Sparkline } from './sparkline.js'
import { computeStats, formatStatNum } from './utils.js'

import type { TooltipPopupProps } from './types.js'

const DEFAULT_MAX_HISTORY = 60

export function TooltipPopup({
  title,
  unit,
  currentValue,
  history,
  historyColor,
  details,
  maxHistory = DEFAULT_MAX_HISTORY,
}: TooltipPopupProps) {
  const stats = history ? computeStats(history) : null

  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2.5 -translate-x-1/2">
      <div
        className="rounded-lg bg-neutral-800 px-3 py-2.5 text-[11px] text-neutral-300 shadow-xl ring-1 ring-white/10"
        style={{ minWidth: 160 }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-neutral-100">{title}</span>
          {unit && <span className="text-[10px] text-neutral-500">{unit}</span>}
        </div>
        <div className="mt-1.5 text-[11px] tabular-nums">
          <span className="text-neutral-400">Current: </span>
          <span className="font-semibold text-neutral-100">{currentValue}</span>
        </div>
        {stats && (
          <div className="mt-1 flex gap-3 text-[10px] tabular-nums text-neutral-400">
            <span>Min: {formatStatNum(stats.min, unit)}</span>
            <span>Max: {formatStatNum(stats.max, unit)}</span>
            <span>Avg: {formatStatNum(stats.avg, unit)}</span>
          </div>
        )}
        {details && (
          <div className="mt-1.5 text-[10px] leading-relaxed text-neutral-500">{details}</div>
        )}
        {history && (
          <div className="mt-2 overflow-hidden rounded border border-neutral-700/50 bg-neutral-900/50">
            <Sparkline data={history} color={historyColor || '#34d399'} />
          </div>
        )}
        {history && (
          <div className="mt-1 text-center text-[9px] text-neutral-600">
            Last {Math.min(history.length, maxHistory)} samples (~
            {Math.round((Math.min(history.length, maxHistory) * 5) / 60)} min)
          </div>
        )}
      </div>
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-neutral-800" />
    </div>
  )
}
