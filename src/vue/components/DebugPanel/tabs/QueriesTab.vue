<script setup lang="ts">
/**
 * SQL queries table tab for the debug panel.
 */
import { ref, computed } from 'vue'
import { formatDuration, durationSeverity, formatTime, timeAgo } from '../../../../core/index.js'
import { filterQueries, countDuplicateQueries, computeQuerySummary } from '../../../../core/query-utils.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import type { QueryRecord } from '../../../../core/index.js'

const props = defineProps<{
  data: { queries?: QueryRecord[] } | QueryRecord[] | null
  dashboardPath?: string
}>()

const search = ref('')
const expandedIds = new Set<number>()

const allQueries = computed<QueryRecord[]>(() => {
  if (!props.data) return []
  const d = props.data
  return (Array.isArray(d) ? d : d.queries) || []
})

const queries = computed<QueryRecord[]>(() => filterQueries(allQueries.value, search.value))
const dupCounts = computed(() => countDuplicateQueries(allQueries.value))
const summaryStats = computed(() => computeQuerySummary(allQueries.value, dupCounts.value))

const summary = computed(() => {
  let s = `${queries.value.length} queries`
  if (summaryStats.value.slowCount > 0) s += ` | ${summaryStats.value.slowCount} slow`
  if (summaryStats.value.dupCount > 0) s += ` | ${summaryStats.value.dupCount} dup`
  if (queries.value.length > 0) s += ` | avg ${formatDuration(summaryStats.value.avgDuration)}`
  return s
})

function toggleExpand(id: number) {
  if (expandedIds.has(id)) {
    expandedIds.delete(id)
  } else {
    expandedIds.add(id)
  }
}

function isExpanded(id: number) {
  return expandedIds.has(id)
}

function durationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dbg-very-slow'
  if (sev === 'slow') return 'ss-dbg-slow'
  return ''
}

const { tableRef } = useResizableTable(() => queries.value)
</script>

<template>
  <div>
    <div class="ss-dbg-search-bar">
      <input v-model="search" class="ss-dbg-search" placeholder="Filter queries..." type="text" />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="queries.length === 0" class="ss-dbg-empty">No queries captured</div>

    <table v-else ref="tableRef" class="ss-dbg-table">
      <thead>
        <tr>
          <th>#</th>
          <th>SQL</th>
          <th>Duration</th>
          <th>Method</th>
          <th>Model</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="q in queries" :key="q.id">
          <td class="ss-dbg-c-dim" style="white-space: nowrap">{{ q.id }}</td>
          <td>
            <span
              :class="['ss-dbg-sql', { 'ss-dbg-expanded': isExpanded(q.id) }]"
              role="button"
              tabindex="0"
              @click="toggleExpand(q.id)"
              @keydown.enter="toggleExpand(q.id)"
            >
              {{ q.sql }}
            </span>
            <span v-if="dupCounts[q.sql] > 1" class="ss-dbg-dup"> x{{ dupCounts[q.sql] }}</span>
            <span v-if="q.inTransaction" class="ss-dbg-dup"> TXN</span>
          </td>
          <td :class="['ss-dbg-duration', durationClass(q.duration)]">
            {{ formatDuration(q.duration) }}
          </td>
          <td>
            <span :class="`ss-dbg-method ss-dbg-method-${q.method.toLowerCase()}`">
              {{ q.method }}
            </span>
          </td>
          <td class="ss-dbg-c-muted">{{ q.model || '-' }}</td>
          <td class="ss-dbg-event-time" :title="formatTime(q.timestamp)">{{ timeAgo(q.timestamp) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
