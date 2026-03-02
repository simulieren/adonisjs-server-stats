/**
 * Lightweight column-resize utility for HTML tables.
 *
 * Works with any `<table>` element — call `initResizableColumns(table)` after
 * the table is rendered in the DOM. Each `<th>` gets a thin drag handle on its
 * right edge; dragging switches the table to `table-layout: fixed` and sets
 * explicit pixel widths so columns resize cleanly.
 *
 * Shared across Edge JS, React, and Vue frontends.
 */

const HANDLE_CLASS = 'ss-col-resize'
const RESIZING_CLASS = 'ss-resizing'

/**
 * Attach drag-to-resize handles to every `<th>` in a table.
 *
 * @param table - The `<table>` DOM element.
 * @returns A cleanup function that removes all handles and listeners.
 */
export function initResizableColumns(table: HTMLTableElement): () => void {
  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'))
  if (headers.length === 0) return () => {}

  const cleanups: (() => void)[] = []

  // Snapshot current computed widths into explicit px values on first resize
  let frozen = false
  function freezeWidths() {
    if (frozen) return
    frozen = true
    for (const th of headers) {
      th.style.width = th.offsetWidth + 'px'
    }
    table.style.tableLayout = 'fixed'
  }

  for (const th of headers) {
    // Skip empty action columns (no label)
    if (!th.textContent?.trim()) continue

    const handle = document.createElement('div')
    handle.className = HANDLE_CLASS
    th.appendChild(handle)

    function onPointerDown(e: PointerEvent) {
      e.preventDefault()
      e.stopPropagation()
      freezeWidths()

      const startX = e.clientX
      const startWidth = th.offsetWidth
      handle.classList.add(RESIZING_CLASS)
      handle.setPointerCapture(e.pointerId)

      function onPointerMove(ev: PointerEvent) {
        const delta = ev.clientX - startX
        const newWidth = Math.max(30, startWidth + delta)
        th.style.width = newWidth + 'px'
      }

      function onPointerUp() {
        handle.classList.remove(RESIZING_CLASS)
        handle.removeEventListener('pointermove', onPointerMove)
        handle.removeEventListener('pointerup', onPointerUp)
      }

      handle.addEventListener('pointermove', onPointerMove)
      handle.addEventListener('pointerup', onPointerUp)
    }

    handle.addEventListener('pointerdown', onPointerDown)

    cleanups.push(() => {
      handle.removeEventListener('pointerdown', onPointerDown)
      handle.remove()
    })
  }

  return () => {
    for (const fn of cleanups) fn()
  }
}
