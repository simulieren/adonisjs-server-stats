<script setup lang="ts">
/**
 * Reusable data table component for the dashboard.
 *
 * Supports sortable columns, row click handlers,
 * and slot-based cell rendering.
 */
import { computed } from 'vue'

export interface Column {
  key: string
  label: string
  width?: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
}

const props = defineProps<{
  columns: Column[]
  rows: any[]
  sortColumn?: string
  sortDirection?: 'asc' | 'desc'
  emptyMessage?: string
  clickable?: boolean
}>()

const emit = defineEmits<{
  sort: [column: string]
  rowClick: [row: any, index: number]
}>()

function handleSort(col: Column) {
  if (col.sortable) {
    emit('sort', col.key)
  }
}

function getSortIcon(col: Column): string {
  if (!col.sortable) return ''
  if (props.sortColumn !== col.key) return ' \u2195'
  return props.sortDirection === 'asc' ? ' \u2191' : ' \u2193'
}
</script>

<template>
  <div v-if="rows.length === 0" class="ss-dash-empty">
    {{ emptyMessage || 'No data' }}
  </div>

  <div v-else class="ss-dash-table-wrap">
    <table class="ss-dash-table">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :style="{
              width: col.width || 'auto',
              textAlign: col.align || 'left',
              cursor: col.sortable ? 'pointer' : 'default',
            }"
            @click="handleSort(col)"
          >
            {{ col.label }}{{ getSortIcon(col) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="index"
          :style="{ cursor: clickable ? 'pointer' : 'default' }"
          @click="clickable ? emit('rowClick', row, index) : undefined"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            :style="{ textAlign: col.align || 'left' }"
          >
            <slot :name="`cell-${col.key}`" :value="row[col.key]" :row="row" :index="index">
              {{ row[col.key] ?? '-' }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
