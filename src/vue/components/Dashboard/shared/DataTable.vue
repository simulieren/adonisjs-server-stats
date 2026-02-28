<script setup lang="ts">
/**
 * Reusable data table component for the dashboard.
 *
 * Supports sortable columns, row click handlers,
 * and slot-based cell rendering.
 */
import { useResizableTable } from '../../../composables/useResizableTable.js'

export interface Column {
  key: string
  label: string
  width?: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
}

const props = defineProps<{
  columns: Column[]
  rows: Record<string, unknown>[]
  keyField?: string
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
  emptyMessage?: string
  clickable?: boolean
  rowClassName?: string
  className?: string
}>()

const emit = defineEmits<{
  sort: [column: string]
  rowClick: [row: Record<string, unknown>, index: number]
}>()

function handleSort(col: Column) {
  if (col.sortable) {
    emit('sort', col.key)
  }
}

const { tableRef } = useResizableTable(() => props.rows)
</script>

<template>
  <div v-if="rows.length === 0" class="ss-dash-empty">
    {{ emptyMessage || 'No data' }}
  </div>

  <table v-else ref="tableRef" :class="`ss-dash-table ${className || ''}`">
    <colgroup>
      <col
        v-for="col in columns"
        :key="col.key"
        :style="col.width ? { width: col.width } : undefined"
      />
    </colgroup>
    <thead>
      <tr>
        <th
          v-for="col in columns"
          :key="col.key"
          :class="col.sortable ? 'ss-dash-sortable' : ''"
          @click="handleSort(col)"
        >
          {{ col.label }}
          <span v-if="col.sortable && sortColumn === col.key" class="ss-dash-sort-arrow">
            {{ sortDirection === 'asc' ? ' \u25B2' : ' \u25BC' }}
          </span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(row, index) in rows"
        :key="row[keyField || 'id'] ?? index"
        :class="[clickable ? 'ss-dash-clickable' : '', rowClassName || ''].filter(Boolean).join(' ')"
        @click="clickable ? emit('rowClick', row, index) : undefined"
      >
        <td v-for="col in columns" :key="col.key">
          <slot :name="`cell-${col.key}`" :value="row[col.key]" :row="row" :index="index">
            {{ row[col.key] ?? '-' }}
          </slot>
        </td>
      </tr>
    </tbody>
  </table>
</template>
