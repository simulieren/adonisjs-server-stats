<script setup lang="ts">
/**
 * Config-driven custom pane tab for the debug panel.
 *
 * Renders a table based on DebugPane column definitions
 * with support for search, formatting, and badge colors.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import {
  ApiClient,
  compactPreview,
  formatTime,
  timeAgo,
  formatDuration,
} from '../../../../core/index.js'
import type { DebugPane, DebugPaneColumn } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'

const props = defineProps<{
  pane: DebugPane
  baseUrl?: string
  authToken?: string
}>()

const data = ref<any[]>([])
const loading = ref(false)
const search = ref('')

const client = new ApiClient({ baseUrl: props.baseUrl || '', authToken: props.authToken })
let fetched = false

async function fetchData() {
  if (props.pane.fetchOnce && fetched) return
  loading.value = true
  try {
    const result = await client.fetch(props.pane.endpoint)
    // Extract data using dataKey or pane id
    const dataKey = props.pane.dataKey || props.pane.id
    const parts = dataKey.split('.')
    let extracted: any = result
    for (const part of parts) {
      extracted = extracted?.[part]
    }
    data.value = Array.isArray(extracted) ? extracted : []
    fetched = true
  } catch {
    data.value = []
  } finally {
    loading.value = false
  }
}

const filteredData = computed(() => {
  if (!search.value.trim()) return data.value
  const term = search.value.toLowerCase()
  const searchableCols = props.pane.columns.filter((c) => c.searchable).map((c) => c.key)
  if (searchableCols.length === 0) return data.value
  return data.value.filter((row) =>
    searchableCols.some((key) => {
      const val = row[key]
      if (val === null || val === undefined) return false
      return String(val).toLowerCase().includes(term)
    })
  )
})

function formatCell(value: any, col: DebugPaneColumn): string {
  if (value === null || value === undefined) return '-'
  const fmt = col.format || 'text'
  switch (fmt) {
    case 'time':
      return formatTime(value)
    case 'timeAgo':
      return timeAgo(value)
    case 'duration':
      return formatDuration(typeof value === 'number' ? value : parseFloat(value))
    case 'method':
      return String(value).toUpperCase()
    case 'json':
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {}
      }
      return compactPreview(value, 100)
    case 'badge':
      return String(value)
    default:
      return String(value)
  }
}

function cellClass(value: any, col: DebugPaneColumn): string {
  if (col.format === 'duration') {
    const ms = typeof value === 'number' ? value : parseFloat(value)
    if (ms > 500) return 'ss-dbg-very-slow'
    if (ms > 100) return 'ss-dbg-slow'
  }
  return ''
}

function badgeColor(value: any, col: DebugPaneColumn): string {
  if (col.format === 'badge' && col.badgeColorMap) {
    const sv = String(value).toLowerCase()
    return col.badgeColorMap[sv] || 'muted'
  }
  return ''
}

function methodClass(value: any): string {
  return `ss-dbg-method ss-dbg-method-${String(value).toLowerCase()}`
}

function handleClear() {
  data.value = []
}

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

watch(filteredData, attachResize)
onMounted(() => {
  fetchData()
  attachResize()
})
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
</script>

<template>
  <div>
    <div v-if="pane.search" class="ss-dbg-search-bar">
      <input
        v-model="search"
        class="ss-dbg-search"
        :placeholder="pane.search.placeholder"
        type="text"
      />
      <span class="ss-dbg-summary">{{ filteredData.length }} items</span>
      <button v-if="pane.clearable" class="ss-dbg-btn-clear" @click="handleClear">Clear</button>
    </div>

    <div v-if="loading" class="ss-dbg-empty">Loading...</div>
    <div v-else-if="filteredData.length === 0" class="ss-dbg-empty">No data</div>

    <table v-else ref="tableRef" class="ss-dbg-table">
      <thead>
        <tr>
          <th v-for="col in pane.columns" :key="col.key">
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in filteredData" :key="i">
          <td
            v-for="col in pane.columns"
            :key="col.key"
            :class="[cellClass(row[col.key], col), { 'ss-dbg-filterable': col.filterable }]"
            @click="col.filterable ? (search = String(row[col.key])) : undefined"
          >
            <template v-if="col.format === 'badge'">
              <span :class="`ss-dbg-badge ss-dbg-badge-${badgeColor(row[col.key], col)}`">
                {{ formatCell(row[col.key], col) }}
              </span>
            </template>
            <template v-else-if="col.format === 'method'">
              <span :class="methodClass(row[col.key])">
                {{ formatCell(row[col.key], col) }}
              </span>
            </template>
            <template v-else>
              {{ formatCell(row[col.key], col) }}
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
