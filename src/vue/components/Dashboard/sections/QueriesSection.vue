<script setup lang="ts">
/**
 * Query analysis section for the dashboard.
 *
 * Supports list view, grouped view, and EXPLAIN.
 */
import { ref, computed } from 'vue'
import { formatDuration, durationSeverity, timeAgo } from '../../../../core/index.js'
import type { QueryRecord, GroupedQuery } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const props = defineProps<{
  data: any
  page: number
  perPage: number
  total: number
  onExplainQuery?: (queryId: number) => Promise<any>
  onFetchGrouped?: () => Promise<any>
}>()

const emit = defineEmits<{
  goToPage: [page: number]
  search: [term: string]
}>()

const search = ref('')
const viewMode = ref<'list' | 'grouped'>('list')
const groupedData = ref<GroupedQuery[]>([])
const explainResult = ref<any>(null)
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
    if (result) groupedData.value = result.data || result || []
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
      <div class="ss-dash-view-toggle">
        <button
          :class="['ss-dash-view-btn', { 'ss-dash-view-active': viewMode === 'list' }]"
          @click="viewMode = 'list'"
        >
          List
        </button>
        <button
          :class="['ss-dash-view-btn', { 'ss-dash-view-active': viewMode === 'grouped' }]"
          @click="switchToGrouped"
        >
          Grouped
        </button>
      </div>
    </div>

    <!-- List view -->
    <template v-if="viewMode === 'list'">
      <div v-if="queries.length === 0" class="ss-dash-empty">
        No queries found
      </div>

      <table v-else class="ss-dash-table">
        <thead>
          <tr>
            <th style="width: 30px;">#</th>
            <th>SQL</th>
            <th style="width: 60px;">Method</th>
            <th style="width: 80px;">Model</th>
            <th style="width: 70px;">Duration</th>
            <th style="width: 80px;">Time</th>
            <th style="width: 60px;"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="q in queries" :key="q.id">
            <tr>
              <td style="color: var(--ss-dim);">{{ q.id }}</td>
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
              <td style="color: var(--ss-text-secondary);">{{ q.model || '-' }}</td>
              <td>
                <span :class="['ss-dash-duration', durationClass(q.duration)]">
                  {{ formatDuration(q.duration) }}
                </span>
              </td>
              <td class="ss-dash-event-time">{{ timeAgo(q.timestamp) }}</td>
              <td>
                <button
                  v-if="q.method === 'select'"
                  class="ss-dash-action-btn"
                  @click="handleExplain(q.id)"
                >
                  {{ explainQueryId === q.id ? 'Hide' : 'EXPLAIN' }}
                </button>
              </td>
            </tr>
            <!-- EXPLAIN result -->
            <tr v-if="explainQueryId === q.id && explainResult">
              <td colspan="7" style="padding: 8px 12px;">
                <pre class="ss-dash-explain-result">{{ JSON.stringify(explainResult, null, 2) }}</pre>
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
      <div v-if="groupedData.length === 0" class="ss-dash-empty">
        No query patterns found
      </div>

      <table v-else class="ss-dash-table">
        <thead>
          <tr>
            <th>Pattern</th>
            <th style="width: 60px;">Count</th>
            <th style="width: 70px;">Avg</th>
            <th style="width: 70px;">Min</th>
            <th style="width: 70px;">Max</th>
            <th style="width: 80px;">Total</th>
            <th style="width: 60px;">% Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, i) in groupedData" :key="i">
            <td class="ss-dash-sql">{{ g.pattern }}</td>
            <td style="text-align: center;">{{ g.count }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.avgDuration) }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.minDuration) }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.maxDuration) }}</td>
            <td class="ss-dash-duration">{{ formatDuration(g.totalDuration) }}</td>
            <td style="text-align: center;">{{ g.percentOfTotal.toFixed(1) }}%</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
