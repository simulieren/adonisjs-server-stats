import { useState } from 'react'

import { TooltipPopup } from './tooltip_popup.js'

import type { StatBadgeProps } from './types.js'

export function StatBadge({
  label,
  value,
  color = 'text-emerald-400',
  tooltipTitle,
  tooltipUnit,
  tooltipDetails,
  history,
  historyColor,
  href,
}: StatBadgeProps) {
  const [hovered, setHovered] = useState(false)

  const inner = (
    <>
      <span className="text-[10px] font-medium tracking-wider text-neutral-500">{label}</span>
      <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{value}</span>
      {hovered && (
        <TooltipPopup
          title={tooltipTitle}
          unit={tooltipUnit}
          currentValue={value}
          history={history}
          historyColor={historyColor}
          details={tooltipDetails}
        />
      )}
    </>
  )

  const className = `group relative flex items-center gap-1.5 px-2 py-0.5${href ? ' cursor-pointer hover:bg-neutral-800/60 rounded' : ''}`

  if (href) {
    return (
      <a
        href={href}
        className={className}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {inner}
      </a>
    )
  }

  return (
    <div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {inner}
    </div>
  )
}
