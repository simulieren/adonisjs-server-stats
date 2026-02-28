<script lang="ts">
import { defineComponent, h, type PropType, type VNode } from 'vue'

interface PlanNode {
  'Node Type'?: string
  'Relation Name'?: string
  Alias?: string
  'Index Name'?: string
  'Startup Cost'?: number | null
  'Total Cost'?: number | null
  'Plan Rows'?: number | null
  'Plan Width'?: number | null
  Filter?: string
  'Index Cond'?: string
  'Hash Cond'?: string
  'Join Type'?: string
  'Sort Key'?: string | string[]
  Plans?: PlanNode[]
  [key: string]: unknown
}

function renderPlanNode(node: PlanNode, depth: number): VNode | null {
  if (!node) return null

  const indent = depth * 20
  const nodeType = node['Node Type'] || 'Unknown'
  const relation = node['Relation Name'] || ''
  const alias =
    node['Alias'] && node['Alias'] !== node['Relation Name']
      ? ` (${node['Alias']})`
      : ''
  const indexName = node['Index Name'] || ''

  const metrics: string[] = []
  if (node['Startup Cost'] != null)
    metrics.push(`cost=${node['Startup Cost']}..${node['Total Cost']}`)
  if (node['Plan Rows'] != null) metrics.push(`rows=${node['Plan Rows']}`)
  if (node['Plan Width'] != null) metrics.push(`width=${node['Plan Width']}`)
  if (node['Filter']) metrics.push(`filter: ${node['Filter']}`)
  if (node['Index Cond']) metrics.push(`cond: ${node['Index Cond']}`)
  if (node['Hash Cond']) metrics.push(`hash: ${node['Hash Cond']}`)
  if (node['Join Type']) metrics.push(`join: ${node['Join Type']}`)
  if (node['Sort Key']) {
    const sortKey = Array.isArray(node['Sort Key'])
      ? node['Sort Key'].join(', ')
      : node['Sort Key']
    metrics.push(`sort: ${sortKey}`)
  }

  const childPlans = node['Plans'] || []

  return h(
    'div',
    { class: 'ss-dash-explain-node', style: { marginLeft: `${indent}px` } },
    [
      h('div', { class: 'ss-dash-explain-node-header' }, [
        h('span', { class: 'ss-dash-explain-node-type' }, nodeType),
        relation ? [' on ', h('strong', null, relation)] : null,
        alias || null,
        indexName ? [' using ', h('em', null, indexName)] : null,
      ]),
      metrics.length > 0
        ? h('div', { class: 'ss-dash-explain-metrics' }, metrics.join(' \u00B7 '))
        : null,
      ...childPlans.map((child: PlanNode, i: number) =>
        renderPlanNode(child, depth + 1)
      ),
    ]
  )
}

/**
 * Recursive component for rendering a single EXPLAIN plan node.
 * Defined outside <script setup> so Vue can resolve the self-reference by name.
 */
const ExplainPlanNode = defineComponent({
  name: 'ExplainPlanNode',
  props: {
    node: { type: Object as PropType<PlanNode>, required: true },
    depth: { type: Number, default: 0 },
  },
  setup(props) {
    return (): VNode | null => renderPlanNode(props.node, props.depth)
  },
})

export default { components: { ExplainPlanNode } }
</script>

<script setup lang="ts">
/**
 * Query analysis section for the dashboard.
 *
 * Supports list view, grouped view, and EXPLAIN.
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React QueriesSection.
 */
import { ref, computed, inject, watch, type Ref } from 'vue'
import { timeAgo, formatTime } from '../../../../core/index.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const viewMode = ref<'list' | 'grouped'>('list')
const expandedSql = ref<string | number | null>(null)

interface ExplainData {
  queryId: number
  plan: unknown[]
  error?: string
  message?: string
}

const explainData = ref<ExplainData | null>(null)
const explainLoading = ref<number | null>(null)

// Use different endpoints for list/grouped views
const endpoint = computed(() => viewMode.value === 'grouped' ? 'queries/grouped' : 'queries')

const {
  data,
  loading,
  pagination,
  sort,
  goToPage,
  setSearch,
  setSort,
  explainQuery,
} = useDashboardData(() => endpoint.value, {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')

const rawQueries = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  if (viewMode.value === 'grouped') {
    const d = data.value as { groups?: Record<string, unknown>[] }
    return d.groups || []
  }
  const d = data.value as Record<string, unknown>
  return (d.data || data.value || []) as Record<string, unknown>[]
})

// Normalize grouped query fields to match column keys
const queries = computed<Record<string, unknown>[]>(() => {
  if (viewMode.value !== 'grouped') return rawQueries.value

  return rawQueries.value.map((g) => {
    const normalized = { ...g }
    if (normalized.sqlNormalized == null && (g.sql_normalized || g.pattern)) {
      normalized.sqlNormalized = (g.sql_normalized as string) || (g.pattern as string) || ''
    }
    if (normalized.count == null && g.total_count != null) normalized.count = g.total_count
    if (normalized.avgDuration == null && g.avg_duration != null) normalized.avgDuration = g.avg_duration
    if (normalized.maxDuration == null && g.max_duration != null) normalized.maxDuration = g.max_duration
    if (normalized.minDuration == null && g.min_duration != null) normalized.minDuration = g.min_duration
    if (normalized.totalDuration == null && g.total_duration != null) normalized.totalDuration = g.total_duration
    if (normalized.percentOfTotal == null && g.pct_time != null) normalized.percentOfTotal = g.pct_time
    return normalized
  })
})

// Duplicate counts for list view
const sqlCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const q of queries.value) {
    const sql = (q.sqlNormalized as string) || (q.sql as string) || (q.sql_text as string) || ''
    counts.set(sql, (counts.get(sql) || 0) + 1)
  }
  return counts
})

const summary = computed(() => {
  const total = pagination.total ?? queries.value.length
  let slow = 0
  let duplicates = 0
  let totalDur = 0
  let count = 0
  for (const q of queries.value) {
    const dur = (q.duration as number) || 0
    totalDur += dur
    count++
    if (dur > 100) slow++
  }
  for (const c of sqlCounts.value.values()) {
    if (c > 1) duplicates += c
  }
  return { total, slow, duplicates, avgDuration: count > 0 ? totalDur / count : 0 }
})

const queriesSummaryText = computed(() => {
  if (viewMode.value === 'grouped') return `${queries.value.length} query patterns`
  const parts = [`${summary.value.total} queries`]
  if (summary.value.slow > 0) parts.push(`${summary.value.slow} slow`)
  if (summary.value.duplicates > 0) parts.push(`${summary.value.duplicates} dup`)
  parts.push(`avg ${(summary.value.avgDuration || 0).toFixed(1)}ms`)
  return parts.join(', ')
})

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

function handleViewModeChange(mode: 'list' | 'grouped') {
  if (mode === viewMode.value) return
  viewMode.value = mode
  expandedSql.value = null
  explainData.value = null
  explainLoading.value = null
}

function handleSort(key: string) {
  setSort(key)
}

async function handleExplain(queryId: number) {
  if (explainData.value && explainData.value.queryId === queryId) {
    explainData.value = null
    return
  }
  explainLoading.value = queryId
  try {
    const result = (await explainQuery(queryId)) as {
      plan?: unknown[]
      rows?: unknown[]
      error?: string
      message?: string
    }
    if (result && result.error) {
      explainData.value = { queryId, plan: [], error: result.error, message: result.message }
    } else {
      explainData.value = { queryId, plan: (result?.plan || result?.rows || []) as unknown[] }
    }
  } catch (err) {
    explainData.value = {
      queryId,
      plan: [],
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    explainLoading.value = null
  }
}
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Filter queries..."
      :summary="queriesSummaryText"
      @update:model-value="handleSearch"
    >
      <div class="ss-dash-btn-group">
        <button
          type="button"
          :class="`ss-dash-btn ${viewMode === 'list' ? 'ss-dash-active' : ''}`"
          @click="handleViewModeChange('list')"
        >
          List
        </button>
        <button
          type="button"
          :class="`ss-dash-btn ${viewMode === 'grouped' ? 'ss-dash-active' : ''}`"
          @click="handleViewModeChange('grouped')"
        >
          Grouped
        </button>
      </div>
    </FilterBar>

    <div v-if="loading && !data" class="ss-dash-empty">Loading queries...</div>

    <!-- Grouped view -->
    <template v-else-if="viewMode === 'grouped'">
      <div class="ss-dash-table-wrap">
        <table v-if="queries.length > 0" class="ss-dash-table">
          <thead>
            <tr>
              <th>Pattern</th>
              <th class="ss-dash-sortable" @click="handleSort('count')">
                Count
                <span v-if="sort.column === 'count'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
              </th>
              <th class="ss-dash-sortable" @click="handleSort('avgDuration')">
                Avg
                <span v-if="sort.column === 'avgDuration'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
              </th>
              <th>Min</th>
              <th>Max</th>
              <th class="ss-dash-sortable" @click="handleSort('totalDuration')">
                Total
                <span v-if="sort.column === 'totalDuration'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
              </th>
              <th>% Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(g, i) in queries" :key="i">
              <td>
                <span
                  :class="`ss-dash-sql ${expandedSql === (g.sqlNormalized as string) ? 'ss-dash-expanded' : ''}`"
                  title="Click to expand"
                  role="button"
                  tabindex="0"
                  @click.stop="expandedSql = expandedSql === (g.sqlNormalized as string) ? null : (g.sqlNormalized as string)"
                  @keydown.enter="expandedSql = expandedSql === (g.sqlNormalized as string) ? null : (g.sqlNormalized as string)"
                >
                  {{ g.sqlNormalized }}
                </span>
                <span v-if="((g.count as number) || 0) >= 3" class="ss-dash-dup">DUP</span>
              </td>
              <td><span style="color: var(--ss-muted); text-align: center; display: block">{{ (g.count as number) || 0 }}</span></td>
              <td>
                <span :class="`ss-dash-duration ${((g.avgDuration as number) || 0) > 500 ? 'ss-dash-very-slow' : ((g.avgDuration as number) || 0) > 100 ? 'ss-dash-slow' : ''}`">
                  {{ ((g.avgDuration as number) || 0).toFixed(2) }}ms
                </span>
              </td>
              <td><span class="ss-dash-duration">{{ ((g.minDuration as number) || 0).toFixed(2) }}ms</span></td>
              <td>
                <span :class="`ss-dash-duration ${((g.maxDuration as number) || 0) > 500 ? 'ss-dash-very-slow' : ((g.maxDuration as number) || 0) > 100 ? 'ss-dash-slow' : ''}`">
                  {{ ((g.maxDuration as number) || 0).toFixed(2) }}ms
                </span>
              </td>
              <td><span class="ss-dash-duration">{{ ((g.totalDuration as number) || 0).toFixed(1) }}ms</span></td>
              <td><span style="color: var(--ss-muted); text-align: center; display: block">{{ ((g.percentOfTotal as number) || 0).toFixed(1) }}%</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">No queries recorded</div>
      </div>
    </template>

    <!-- List view -->
    <template v-else>
      <div class="ss-dash-table-wrap">
        <table v-if="queries.length > 0" class="ss-dash-table">
          <colgroup>
            <col style="width: 40px" />
            <col />
            <col style="width: 70px" />
            <col style="width: 60px" />
            <col style="width: 90px" />
            <col style="width: 80px" />
            <col style="width: 90px" />
            <col style="width: 70px" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>SQL</th>
              <th class="ss-dash-sortable" @click="handleSort('duration')">
                Duration
                <span v-if="sort.column === 'duration'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
              </th>
              <th>Method</th>
              <th>Model</th>
              <th>Connection</th>
              <th class="ss-dash-sortable" @click="handleSort('createdAt')">
                Time
                <span v-if="sort.column === 'createdAt'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="q in queries" :key="(q.id as number)">
              <tr>
                <td><span style="color: var(--ss-dim)">{{ q.id }}</span></td>
                <td>
                  <div>
                    <span
                      :class="`ss-dash-sql ${expandedSql === (q.id as number) ? 'ss-dash-expanded' : ''}`"
                      title="Click to expand"
                      role="button"
                      tabindex="0"
                      @click.stop="expandedSql = expandedSql === (q.id as number) ? null : (q.id as number)"
                      @keydown.enter="expandedSql = expandedSql === (q.id as number) ? null : (q.id as number)"
                    >
                      {{ (q.sql as string) || (q.sql_text as string) || '' }}
                    </span>
                    <span
                      v-if="(sqlCounts.get(((q.sqlNormalized as string) || (q.sql as string) || (q.sql_text as string)) ?? '') ?? 0) > 1"
                      class="ss-dash-dup"
                    >
                      &times;{{ sqlCounts.get(((q.sqlNormalized as string) || (q.sql as string) || (q.sql_text as string)) ?? '') }}
                    </span>
                  </div>
                </td>
                <td>
                  <span :class="`ss-dash-duration ${((q.duration as number) || 0) > 500 ? 'ss-dash-very-slow' : ((q.duration as number) || 0) > 100 ? 'ss-dash-slow' : ''}`">
                    {{ ((q.duration as number) || 0).toFixed(2) }}ms
                  </span>
                </td>
                <td>
                  <span :class="`ss-dash-method ss-dash-method-${((q.method as string) || (q.sql_method as string) || '').toLowerCase()}`">
                    {{ (q.method as string) || (q.sql_method as string) || '' }}
                  </span>
                </td>
                <td>
                  <span
                    style="color: var(--ss-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                    :title="(q.model as string)"
                  >
                    {{ (q.model as string) || '-' }}
                  </span>
                </td>
                <td>
                  <span style="color: var(--ss-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                    {{ (q.connection as string) || '-' }}
                  </span>
                </td>
                <td>
                  <span
                    class="ss-dash-event-time"
                    :title="formatTime(((q.createdAt as string) || (q.created_at as string) || (q.timestamp as string) || '') as string)"
                  >
                    {{ timeAgo(((q.createdAt as string) || (q.created_at as string) || (q.timestamp as string) || '') as string) }}
                  </span>
                </td>
                <td>
                  <button
                    v-if="((q.method as string) || (q.sql_method as string) || '') === 'select'"
                    type="button"
                    :class="`ss-dash-explain-btn${explainData?.queryId === (q.id as number) && !explainData?.error ? ' ss-dash-explain-btn-active' : ''}`"
                    :disabled="explainLoading === (q.id as number)"
                    @click.stop="handleExplain(q.id as number)"
                  >
                    {{ explainLoading === (q.id as number) ? '...' : 'EXPLAIN' }}
                  </button>
                </td>
              </tr>
              <!-- EXPLAIN result row -->
              <tr
                v-if="explainData && explainData.queryId === (q.id as number)"
                class="ss-dash-explain-row"
              >
                <td colspan="8" class="ss-dash-explain">
                  <div style="display: flex; justify-content: space-between; align-items: start">
                    <div style="flex: 1">
                      <div v-if="explainData.error" class="ss-dash-explain-result ss-dash-explain-error">
                        <strong>Error:</strong> {{ explainData.error }}
                        <br v-if="explainData.message" />
                        {{ explainData.message }}
                      </div>
                      <div v-else-if="explainData.plan && explainData.plan.length > 0 && (explainData.plan[0] as Record<string, unknown>)?.['Plan']" class="ss-dash-explain-result">
                        <ExplainPlanNode :node="((explainData.plan[0] as Record<string, unknown>)['Plan'] as Record<string, unknown>)" :depth="0" />
                      </div>
                      <div v-else-if="explainData.plan && explainData.plan.length > 0 && typeof explainData.plan[0] === 'object'" class="ss-dash-explain-result">
                        <table>
                          <thead>
                            <tr>
                              <th v-for="col in Object.keys(explainData.plan[0] as Record<string, unknown>)" :key="col">{{ col }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(row, ri) in explainData.plan" :key="ri">
                              <td v-for="col in Object.keys(explainData.plan[0] as Record<string, unknown>)" :key="col">
                                {{ (row as Record<string, unknown>)[col] != null ? String((row as Record<string, unknown>)[col]) : '-' }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div v-else class="ss-dash-explain-result">No plan data returned</div>
                    </div>
                    <button
                      type="button"
                      class="ss-dash-explain-btn"
                      style="margin-left: 8px; flex-shrink: 0"
                      @click="explainData = null"
                    >
                      Close
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">No queries recorded</div>
      </div>
      <PaginationControls
        v-if="pagination.totalPages > 1"
        :page="pagination.page"
        :last-page="pagination.totalPages"
        :total="pagination.total"
        @page-change="goToPage"
      />
    </template>
  </div>
</template>
