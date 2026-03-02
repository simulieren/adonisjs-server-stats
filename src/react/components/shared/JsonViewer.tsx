import React, { useState, useCallback, useMemo } from 'react'

import { compactPreview } from '../../../core/formatters.js'

interface JsonViewerProps {
  data: unknown
  maxPreviewLength?: number
  className?: string
  classPrefix?: 'ss-dash' | 'ss-dbg'
}

/**
 * Compact JSON preview with click-to-expand functionality.
 */
export function JsonViewer({
  data,
  maxPreviewLength = 100,
  className = '',
  classPrefix = 'ss-dash',
}: JsonViewerProps) {
  const [expanded, setExpanded] = useState(false)

  const parsed = useMemo(() => {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data)
      } catch {
        return data
      }
    }
    return data
  }, [data])

  const preview = useMemo(() => {
    if (typeof parsed === 'object' && parsed !== null) {
      return compactPreview(parsed, maxPreviewLength)
    }
    return String(parsed ?? '-')
  }, [parsed, maxPreviewLength])

  const fullJson = useMemo(() => {
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify(parsed, null, 2)
    }
    return String(parsed)
  }, [parsed])

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullJson)
    } catch {
      // Fallback: select text
    }
  }, [fullJson])

  if (!data && data !== 0 && data !== false) {
    return <span className={`ss-dim ${classPrefix}-c-dim`}>-</span>
  }

  return (
    <div className={`${classPrefix}-data-cell ${className}`}>
      <span
        className={`${classPrefix}-data-preview`}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleToggle()}
      >
        {preview}
      </span>
      {expanded && (
        <div className={`${classPrefix}-data-full`} onClick={handleToggle}>
          <button
            className={`${classPrefix}-copy-btn`}
            onClick={(e) => {
              e.stopPropagation()
              handleCopy()
            }}
            title="Copy to clipboard"
            type="button"
          >
            Copy
          </button>
          <pre>{fullJson}</pre>
        </div>
      )}
    </div>
  )
}
