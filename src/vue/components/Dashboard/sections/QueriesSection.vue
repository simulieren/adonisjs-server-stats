<script setup lang="ts">
/**
 * Query analysis section for the dashboard.
 *
 * Supports list view, grouped view, and EXPLAIN.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { formatDuration, durationSeverity, timeAgo } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import type { QueryRecord, GroupedQuery } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

interface QueriesData {
  data?: QueryRecord[]
  queries?: QueryRecord[]
}

const props = defineProps<{
  data: QueriesData | QueryRecord[] | null
  page: number
  perPage: number
  total: number
  onExplainQuery?: (queryId: number) => Promise<unknown>
  onFetchGrouped?: () => Promise<unknown>
}>()

const emit = defineEmits<{
  goToPage: [page: number]
  search: [term: string]
}>()

const search = ref('')
const viewMode = ref<'list' | 'grouped'>('list')
const groupedData = ref<GroupedQuery[]>([])
const explainResult = ref<unknown>(null)
const explainQueryId = ref<number | null>(null)
const expandedIds = new Set<number>()

const queries = computed<QueryRecord[]>(() => {
  const d = props.data
  if (!d) return []
  return d.data || d.queries || d || []
})

function durationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dash-very-slow'
  if (sev === 'slow') return 'ss-dash-slow'
  return ''
}

function toggleExpand(id: number) {
  if (expandedIds.has(id)) expandedIds.delete(id)
  else expandedIds.add(id)
}

async function switchToGrouped() {
  viewMode.value = 'grouped'
  if (props.onFetchGrouped) {
    const result = await props.onFetchGrouped()
    if (result) {
      const r = result as Record<string, unknown>
      groupedData.value = (r.data as GroupedQuery[]) || (result as GroupedQuery[]) || []
    }
  }
}

async function handleExplain(queryId: number) {
  if (explainQueryId.value === queryId) {
    explainQueryId.value = null
    explainResult.value = null
    return
  }
  explainQueryId.value = queryId
  if (props.onExplainQuery) {
    explainResult.value = await props.onExplainQuery(queryId)
  }
}

function handleSearch(term: string) {
  search.value = term
  emit('search', term)
}

const tableRef = ref<HTMLTableElement | null>(null)
const groupedTableRef = ref<HTMLTableElement | null>(null)
let cleanupResize: (() => void) | null = null
let cleanupGroupedResize: (() => void) | null = null

function attachResize() {
  if (cleanupResize) cleanupResize()
  cleanupResize = null
  nextTick(() => {
    if (tableRef.value) {
      cleanupResize = initResizableColumns(tableRef.value)
    }
  })
}

function attachGroupedResize() {
  if (cleanupGroupedResize) cleanupGroupedResize()
  cleanupGroupedResize = null
  nextTick(() => {
    if (groupedTableRef.value) {
      cleanupGroupedResize = initResizableColumns(groupedTableRef.value)
    }
  })
}

watch(queries, attachResize)
watch(groupedData, attachGroupedResize)
onMounted(() => {
  attachResize()
  attachGroupedResize()
})
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
  if (cleanupGroupedResize) cleanupGroupedResize()
})
</script>

<template>
  <div>
    <div class="ss-dash-section-toolbar">
      <FilterBar
        :model-value="search"
        placeholder="Filter queries..."
        :summary="`${props.total} queries`"
        @update:model-value="handleSearch"
      />
      <div class="ss-dash-btn-group">
        <button
          :class="['ss-dash-btn', { 'ss-dash-active': viewMode === 'list' }]"
          @click="viewMode = 'list'"
        >
          List
        </button>
        <button
          :class="['ss-dash-btn', { 'ss-dash-active': viewMode === 'grouped' }]"
          @click="switchToGrouped"
        >
          Grouped
        </button>
      </div>
    </div>

    <!-- List view -->
    <template v-if="viewMode === 'list'">
      <div v-if="queries.length === 0" class="ss-dash-empty">No queries found</div>

      <table v-else ref="tableRef" class="ss-dash-table">
        <thead>
          <tr>
            <th>#</th>
            <th>SQL</th>
            <th>Method</th>
            <th>Model</th>
            <th>Duration</th>
            <th>Time</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="q in queries" :key="q.id">
            <tr>
              <td style="color: var(--ss-dim)">{{ q.id }}</td>
              <td>
                <span
                  :class="['ss-dash-sql', { 'ss-dash-expanded': expandedIds.has(q.id) }]"
                  @click="toggleExpand(q.id)"
                >
                  {{ q.sql }}
                </span>
              </td>
              <td>
                <span :class="`ss-dash-method ss-dash-method-${q.method.toLowerCase()}`">
                  {{ q.method }}
                </span>
              </td>
              <td style="color: var(--ss-text-secondary)">{{ q.model || '-' }}</td>
              <td>
                <span :class="['ss-dash-duration', durationClass(q.duration)]">
                  {{ formatDuration(q.duration) }}
                </span>
              </td>
              <td class="ss-dash-event-time">{{ timeAgo(q.timestamp) }}</td>
              <td>
                <button
                  v-if="q.method === 'select'"
                  class="ss-dash-explain-btn"
                  @click="handleExplain(q.id)"
                >
                  {{ explainQueryId === q.id ? 'Hide' : 'EXPLAIN' }}
                </button>
              </td>
            </tr>
            <!-- EXPLAIN result -->
            <tr v-if="explainQueryId === q.id && explainResult" class="ss-dash-explain-row">
              <td colspan="7" class="ss-dash-explain">
                <pre class="ss-dash-explain-result">{{
                  JSON.stringify(explainResult, null, 2)
                }}</pre>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <PaginationControls
        :page="props.page"
        :per-page="props.perPage"
        :total="props.total"
        @go-to-page="emit('goToPage', $event)"
      />
    </template>

    <!-- Grouped view -->
    <template v-if="viewMode === 'grouped'">
      <div v-if="groupedData.length === 0" class="ss-dash-empty">No query patterns found</div>

      <table v-else ref="groupedTableRef" class="ss-dash-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th>Count</th>
            <th>Avg</th>
            <th>Min</th>
            <th>Max</th>
            <th>Total</th>
            <th>% Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, i) in groupedData" :key="i">
            <td class="ss-dash-sql">{{ g.pattern }}</td>
            <td style="text-align: center">{{ g.count }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.avgDuration) }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.minDuration) }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.maxDuration) }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.totalDuration) }}</td>
            <td style="text-align: center">{{ g.percentOfTotal.toFixed(1) }}%</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
