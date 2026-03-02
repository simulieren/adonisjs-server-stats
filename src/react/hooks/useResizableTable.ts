import { useRef, useEffect, useCallback } from 'react'

import { initResizableColumns } from '../../core/resizable-columns.js'

/**
 * React hook that attaches resizable column handles to a table element.
 *
 * Returns a ref callback to attach to the `<table>` element.
 * When the provided `deps` change, the resize handles are torn down
 * and re-attached so they stay in sync with the DOM.
 *
 * @param deps - Optional dependency array that triggers re-attachment
 *               (e.g. the filtered data array driving the table rows).
 * @returns A React ref callback for the `<table>` element.
 */
export function useResizableTable(deps: unknown[] = []): React.RefCallback<HTMLTableElement> {
  const tableRef = useRef<HTMLTableElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Re-attach resize handles whenever deps change
  useEffect(() => {
    if (tableRef.current) {
      cleanupRef.current?.()
      cleanupRef.current = initResizableColumns(tableRef.current)
    }
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Ref callback: stores the table element and attaches resize on mount
  const refCallback = useCallback((node: HTMLTableElement | null) => {
    // Cleanup previous element
    cleanupRef.current?.()
    cleanupRef.current = null

    tableRef.current = node

    if (node) {
      cleanupRef.current = initResizableColumns(node)
    }
  }, [])

  return refCallback
}
