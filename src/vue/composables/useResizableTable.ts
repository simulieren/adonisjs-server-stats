import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { initResizableColumns } from '../../core/resizable-columns.js'

/**
 * Vue composable that attaches resizable column handles to a table element.
 *
 * Returns a template ref to bind to the `<table>` element.
 * When the optional `dataRef` changes, the resize handles are torn down
 * and re-attached so they stay in sync with the DOM.
 *
 * @param dataRef - Optional reactive source to watch. When it changes,
 *                  resize handles are re-attached after the next tick.
 * @returns An object containing the `tableRef` to bind via `ref="tableRef"`.
 */
export function useResizableTable(dataRef?: WatchSource<unknown>): {
  tableRef: Ref<HTMLTableElement | null>
} {
  const tableRef = ref<HTMLTableElement | null>(null)
  let cleanupResize: (() => void) | null = null

  function attachResize() {
    if (cleanupResize) cleanupResize()
    cleanupResize = null
    nextTick(() => {
      if (tableRef.value) {
        cleanupResize = initResizableColumns(tableRef.value)
      }
    })
  }

  if (dataRef) {
    watch(dataRef, attachResize)
  }

  onMounted(attachResize)

  onBeforeUnmount(() => {
    if (cleanupResize) cleanupResize()
    cleanupResize = null
  })

  return { tableRef }
}
