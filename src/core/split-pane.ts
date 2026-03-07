/**
 * Shared split-pane drag logic (framework-agnostic, DOM-based).
 *
 * Sets up vertical resizing between a top pane and bottom pane inside a
 * flex-column container.  Uses pointer events with setPointerCapture
 * (same pattern as resizable-columns.ts).
 *
 * Persists the split ratio to localStorage so it survives page reloads.
 */

export interface SplitPaneOptions {
  container: HTMLElement
  handle: HTMLElement
  topPane: HTMLElement
  bottomPane: HTMLElement
  storageKey?: string
  minHeight?: number
}

export function initSplitPane(opts: SplitPaneOptions): () => void {
  const { container, handle, topPane, bottomPane, storageKey, minHeight = 60 } = opts

  // Restore saved ratio
  if (storageKey) {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const ratio = parseFloat(saved)
      if (ratio > 0 && ratio < 1) {
        topPane.style.flex = `${ratio}`
        bottomPane.style.flex = `${1 - ratio}`
      }
    }
  }

  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)

    const containerRect = container.getBoundingClientRect()
    const containerHeight = containerRect.height
    const startY = e.clientY
    const startTopHeight = topPane.getBoundingClientRect().height

    function onPointerMove(ev: PointerEvent) {
      const delta = ev.clientY - startY
      let newTopHeight = startTopHeight + delta
      const maxTop = containerHeight - minHeight - handle.offsetHeight
      newTopHeight = Math.max(minHeight, Math.min(newTopHeight, maxTop))

      const ratio = newTopHeight / (containerHeight - handle.offsetHeight)
      topPane.style.flex = `${ratio}`
      bottomPane.style.flex = `${1 - ratio}`
    }

    function onPointerUp() {
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', onPointerUp)

      // Persist ratio
      if (storageKey) {
        const total = container.getBoundingClientRect().height - handle.offsetHeight
        if (total > 0) {
          const ratio = topPane.getBoundingClientRect().height / total
          localStorage.setItem(storageKey, String(ratio))
        }
      }
    }

    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', onPointerUp)
  }

  handle.addEventListener('pointerdown', onPointerDown)

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown)
  }
}
