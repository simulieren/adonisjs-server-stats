<script setup lang="ts">
/**
 * Query analysis section for the dashboard.
 *
 * Supports list view, grouped view, and EXPLAIN.
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React QueriesSection.
 *
 * Refactored to use shared core utilities:
 * - explain-utils for EXPLAIN plan rendering
 * - queries-columns for column definitions
 * - queries-controller for state management
 * - query-utils for normalization, summary, duplicate counting
 * - field-resolvers for snake_case/camelCase field resolution
 */
import { computed, inject, watch, ref, type Ref } from 'vue'
import { timeAgo, formatTime, durationClassName } from '../../../../core/index.js'
import {
  flattenPlanTree,
  hasNestedPlan,
  getExplainColumns,
  formatCellValue,
} from '../../../../core/explain-utils.js'
import type { PlanNode, FlatPlanNode } from '../../../../core/explain-utils.js'
import {
  getDashboardListColumns,
  getDashboardGroupedColumns,
} from '../../../../core/queries-columns.js'
import type { QueriesColumnDef } from '../../../../core/queries-columns.js'
import { QueriesController } from '../../../../core/queries-controller.js'
import type { ExplainEntry, ExplainResult } from '../../../../core/queries-controller.js'
import {
  buildSqlCounts,
  computeDashboardQuerySummary,
  normalizeDashboardQuery,
} from '../../../../core/query-utils.js'
import type { NormalizedQuery } from '../../../../core/query-utils.js'
import {
  resolveField,
  resolveSqlMethod,
  resolveNormalizedSql,
  resolveTimestamp,
} from '../../../../core/field-resolvers.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

// ---------------------------------------------------------------------------
// State controller (headless, framework-agnostic)
// ---------------------------------------------------------------------------

const ctrl = new QueriesController('list')

// We need reactive wrappers for template reactivity since QueriesController
// mutates plain objects — Vue cannot track in-place mutations on non-reactive
// objects. We keep a reactive "version" counter that we bump after each
// controller mutation to force recomputation.
const stateVersion = ref(0)

function bumpState() {
  stateVersion.value++
}

// Reactive accessors that read from the controller but depend on stateVersion
const viewMode = computed(() => {
  void stateVersion.value
  return ctrl.state.viewMode
})

const expandedIds = computed(() => {
  void stateVersion.value
  return ctrl.state.expandedIds
})

const explainData = computed(() => {
  void stateVersion.value
  return ctrl.state.explainData
})

// ---------------------------------------------------------------------------
// Column definitions from shared queries-columns
// ---------------------------------------------------------------------------

const listColumns = computed<QueriesColumnDef[]>(() => getDashboardListColumns())
const groupedColumns = computed<QueriesColumnDef[]>(() => getDashboardGroupedColumns())

// Use different endpoints for list/grouped views
const endpoint = computed(() => (viewMode.value === 'grouped' ? 'queries/grouped' : 'queries'))

const { data, loading, pagination, sort, goToPage, setSearch, setSort, explainQuery } =
  useDashboardData(() => endpoint.value, {
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

// Normalize grouped query fields to match column keys using resolveField
const queries = computed<Record<string, unknown>[]>(() => {
  if (viewMode.value !== 'grouped') return rawQueries.value

  return rawQueries.value.map((g) => {
    const normalized = { ...g }
    if (normalized.sqlNormalized === null || normalized.sqlNormalized === undefined) {
      normalized.sqlNormalized = resolveField<string>(g, 'sql_normalized', 'pattern') ?? ''
    }
    if (normalized.count === null || normalized.count === undefined) {
      normalized.count = resolveField<number>(g, 'total_count') ?? undefined
    }
    if (normalized.avgDuration === null || normalized.avgDuration === undefined) {
      normalized.avgDuration = resolveField<number>(g, 'avg_duration') ?? undefined
    }
    if (normalized.maxDuration === null || normalized.maxDuration === undefined) {
      normalized.maxDuration = resolveField<number>(g, 'max_duration') ?? undefined
    }
    if (normalized.minDuration === null || normalized.minDuration === undefined) {
      normalized.minDuration = resolveField<number>(g, 'min_duration') ?? undefined
    }
    if (normalized.totalDuration === null || normalized.totalDuration === undefined) {
      normalized.totalDuration = resolveField<number>(g, 'total_duration') ?? undefined
    }
    if (normalized.percentOfTotal === null || normalized.percentOfTotal === undefined) {
      normalized.percentOfTotal = resolveField<number>(g, 'pct_time') ?? undefined
    }
    return normalized
  })
})

// Normalized list queries using normalizeDashboardQuery
const normalizedListQueries = computed<NormalizedQuery[]>(() => {
  if (viewMode.value !== 'list') return []
  return rawQueries.value.map((row) => normalizeDashboardQuery(row))
})

// Duplicate counts for list view using buildSqlCounts
const sqlCounts = computed(() => {
  return buildSqlCounts(rawQueries.value)
})

// Summary using computeDashboardQuerySummary
const summary = computed(() => {
  return computeDashboardQuerySummary(rawQueries.value, {
    total: pagination.total,
  })
})

const queriesSummaryText = computed(() => {
  if (viewMode.value === 'grouped') return `${queries.value.length} query patterns`
  const parts = [`${summary.value.totalCount} queries`]
  if (summary.value.slowCount > 0) parts.push(`${summary.value.slowCount} slow`)
  if (summary.value.dupCount > 0) parts.push(`${summary.value.dupCount} dup`)
  parts.push(`avg ${(summary.value.avgDuration || 0).toFixed(1)}ms`)
  return parts.join(', ')
})

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

function handleViewModeChange(mode: 'list' | 'grouped') {
  if (mode === viewMode.value) return
  ctrl.setViewMode(mode)
  bumpState()
}

function handleSort(key: string) {
  setSort(key)
}

function isRowExpanded(id: number | string): boolean {
  void stateVersion.value
  return ctrl.isExpanded(id)
}

function toggleRowExpand(id: number | string) {
  ctrl.toggleExpand(id)
  bumpState()
}

async function handleExplain(queryId: number) {
  // Toggle off if already showing
  const existing = ctrl.getExplainState(queryId)
  if (existing && !existing.loading) {
    ctrl.state.explainData.delete(queryId)
    bumpState()
    return
  }

  ctrl.startExplain(queryId)
  bumpState()

  try {
    const result = (await explainQuery(queryId)) as ExplainResult | null
    if (result && result.error) {
      ctrl.completeExplain(queryId, { rows: [], error: result.error, message: result.message })
    } else {
      ctrl.completeExplain(queryId, {
        plan: result?.plan as PlanNode[] | undefined,
        rows: result?.rows,
      })
    }
  } catch (err) {
    ctrl.failExplain(queryId, err instanceof Error ? err.message : String(err))
  }
  bumpState()
}

function getExplainEntry(queryId: number): ExplainEntry | undefined {
  void stateVersion.value
  return ctrl.getExplainState(queryId)
}

function isExplainLoading(queryId: number): boolean {
  void stateVersion.value
  const entry = ctrl.getExplainState(queryId)
  return entry?.loading ?? false
}

function isExplainActive(queryId: number): boolean {
  void stateVersion.value
  const entry = ctrl.getExplainState(queryId)
  return !!entry && !entry.loading && !entry.error && !!entry.result
}

function closeExplain(queryId: number) {
  ctrl.state.explainData.delete(queryId)
  bumpState()
}

// ---------------------------------------------------------------------------
// EXPLAIN plan rendering helpers using shared explain-utils
// ---------------------------------------------------------------------------

function getExplainPlanNodes(queryId: number): FlatPlanNode[] {
  const entry = getExplainEntry(queryId)
  if (!entry?.result) return []
  const plan = entry.result.plan || entry.result.rows
  if (!plan || plan.length === 0) return []
  const first = plan[0] as Record<string, unknown>
  if (!first || typeof first !== 'object') return []
  if ('Plan' in first) {
    return flattenPlanTree(first['Plan'] as PlanNode)
  }
  return []
}

function getExplainTableCols(queryId: number): string[] {
  const entry = getExplainEntry(queryId)
  if (!entry?.result) return []
  const rows = entry.result.plan || entry.result.rows
  if (!rows || rows.length === 0) return []
  return getExplainColumns(rows as Record<string, unknown>[])
}

function getExplainRows(queryId: number): Record<string, unknown>[] {
  const entry = getExplainEntry(queryId)
  if (!entry?.result) return []
  return (entry.result.plan || entry.result.rows || []) as Record<string, unknown>[]
}

function explainHasNestedPlanForQuery(queryId: number): boolean {
  const entry = getExplainEntry(queryId)
  if (!entry?.result) return false
  const plan = entry.result.plan || entry.result.rows
  if (!plan || plan.length === 0) return false
  return hasNestedPlan(plan[0])
}

function explainHasRows(queryId: number): boolean {
  const entry = getExplainEntry(queryId)
  if (!entry?.result) return false
  const rows = entry.result.plan || entry.result.rows
  return !!rows && rows.length > 0 && typeof rows[0] === 'object'
}

function dashDurationClass(ms: number): string {
  return durationClassName(ms, 'ss-dash')
}

// Field resolver helpers for template
function getQuerySql(q: Record<string, unknown>): string {
  return resolveField<string>(q, 'sql', 'sql_text') ?? ''
}

function getQueryNormalizedSql(q: Record<string, unknown>): string {
  return resolveNormalizedSql(q)
}

function getQueryMethod(q: Record<string, unknown>): string {
  return resolveSqlMethod(q)
}

function getQueryTimestamp(q: Record<string, unknown>): string {
  return String(resolveTimestamp(q) ?? '')
}

const { tableRef } = useResizableTable(() => queries.value)
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
        <table v-if="queries.length > 0" ref="tableRef" class="ss-dash-table">
          <thead>
            <tr>
              <th
                v-for="col in groupedColumns"
                :key="col.key"
                :class="col.sortable ? 'ss-dash-sortable' : ''"
                @click="col.sortable ? handleSort(col.key) : undefined"
              >
                {{ col.label }}
                <span
                  v-if="col.sortable && sort.column === col.key"
                  class="ss-dash-sort-arrow"
                >{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(g, i) in queries" :key="i">
              <td>
                <span
                  :class="`ss-dash-sql ${isRowExpanded(g.sqlNormalized as string) ? 'ss-dash-expanded' : ''}`"
                  title="Click to expand"
                  role="button"
                  tabindex="0"
                  @click.stop="toggleRowExpand(g.sqlNormalized as string)"
                  @keydown.enter="toggleRowExpand(g.sqlNormalized as string)"
                >
                  {{ g.sqlNormalized }}
                </span>
                <span v-if="((g.count as number) || 0) >= 3" class="ss-dash-dup">DUP</span>
              </td>
              <td>
                <span style="color: var(--ss-muted); text-align: center; display: block">{{
                  (g.count as number) || 0
                }}</span>
              </td>
              <td>
                <span
                  :class="`ss-dash-duration ${dashDurationClass((g.avgDuration as number) || 0)}`"
                >
                  {{ ((g.avgDuration as number) || 0).toFixed(2) }}ms
                </span>
              </td>
              <td>
                <span class="ss-dash-duration"
                  >{{ ((g.minDuration as number) || 0).toFixed(2) }}ms</span
                >
              </td>
              <td>
                <span
                  :class="`ss-dash-duration ${dashDurationClass((g.maxDuration as number) || 0)}`"
                >
                  {{ ((g.maxDuration as number) || 0).toFixed(2) }}ms
                </span>
              </td>
              <td>
                <span class="ss-dash-duration"
                  >{{ ((g.totalDuration as number) || 0).toFixed(1) }}ms</span
                >
              </td>
              <td>
                <span style="color: var(--ss-muted); text-align: center; display: block"
                  >{{ ((g.percentOfTotal as number) || 0).toFixed(1) }}%</span
                >
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">
          <span>No queries recorded</span>
          <span class="ss-empty-hint">
            Queries require <code>debug: true</code> on your Lucid connections in
            <code>config/database.ts</code>
          </span>
        </div>
      </div>
    </template>

    <!-- List view -->
    <template v-else>
      <div class="ss-dash-table-wrap">
        <table v-if="normalizedListQueries.length > 0" ref="tableRef" class="ss-dash-table">
          <colgroup>
            <col
              v-for="col in listColumns"
              :key="col.key + col.type"
              :style="col.width ? { width: col.width } : {}"
            />
          </colgroup>
          <thead>
            <tr>
              <template v-for="col in listColumns" :key="col.key + col.type">
                <th
                  v-if="col.sortable"
                  class="ss-dash-sortable"
                  @click="handleSort(col.key)"
                >
                  {{ col.label }}
                  <span
                    v-if="sort.column === col.key"
                    class="ss-dash-sort-arrow"
                  >{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
                </th>
                <th v-else>{{ col.label }}</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <template v-for="(q, idx) in normalizedListQueries" :key="q.id">
              <tr>
                <td>
                  <span style="color: var(--ss-dim)">{{ q.id }}</span>
                </td>
                <td>
                  <div>
                    <span
                      :class="`ss-dash-sql ${isRowExpanded(q.id) ? 'ss-dash-expanded' : ''}`"
                      title="Click to expand"
                      role="button"
                      tabindex="0"
                      @click.stop="toggleRowExpand(q.id)"
                      @keydown.enter="toggleRowExpand(q.id)"
                    >
                      {{ q.sql }}
                    </span>
                    <span
                      v-if="(sqlCounts.get(q.sqlNormalized) ?? 0) > 1"
                      class="ss-dash-dup"
                    >
                      &times;{{ sqlCounts.get(q.sqlNormalized) }}
                    </span>
                  </div>
                </td>
                <td>
                  <span
                    :class="`ss-dash-duration ${dashDurationClass(q.duration)}`"
                  >
                    {{ q.duration.toFixed(2) }}ms
                  </span>
                </td>
                <td>
                  <span
                    :class="`ss-dash-method ss-dash-method-${q.method.toLowerCase()}`"
                  >
                    {{ q.method }}
                  </span>
                </td>
                <td>
                  <span
                    style="
                      color: var(--ss-muted);
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    "
                    :title="q.model"
                  >
                    {{ q.model || '-' }}
                  </span>
                </td>
                <td>
                  <span
                    style="
                      color: var(--ss-dim);
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    "
                  >
                    {{ q.connection || '-' }}
                  </span>
                </td>
                <td>
                  <span
                    class="ss-dash-event-time"
                    :title="formatTime(String(q.timestamp))"
                  >
                    {{ timeAgo(String(q.timestamp)) }}
                  </span>
                </td>
                <td>
                  <button
                    v-if="q.method === 'select'"
                    type="button"
                    :class="`ss-dash-explain-btn${isExplainActive(q.id as number) ? ' ss-dash-explain-btn-active' : ''}`"
                    :disabled="isExplainLoading(q.id as number)"
                    @click.stop="handleExplain(q.id as number)"
                  >
                    {{ isExplainLoading(q.id as number) ? '...' : 'EXPLAIN' }}
                  </button>
                </td>
              </tr>
              <!-- EXPLAIN result row -->
              <tr
                v-if="getExplainEntry(q.id as number)"
                class="ss-dash-explain-row"
              >
                <td colspan="8" class="ss-dash-explain">
                  <div style="display: flex; justify-content: space-between; align-items: start">
                    <div style="flex: 1">
                      <div
                        v-if="getExplainEntry(q.id as number)?.error"
                        class="ss-dash-explain-result ss-dash-explain-error"
                      >
                        <strong>Error:</strong> {{ getExplainEntry(q.id as number)?.error }}
                        <br v-if="getExplainEntry(q.id as number)?.result?.message" />
                        {{ getExplainEntry(q.id as number)?.result?.message }}
                      </div>
                      <div
                        v-else-if="explainHasNestedPlanForQuery(q.id as number)"
                        class="ss-dash-explain-result"
                      >
                        <!-- Flat iteration instead of recursion -->
                        <div
                          v-for="(planNode, ni) in getExplainPlanNodes(q.id as number)"
                          :key="ni"
                          class="ss-dash-explain-node"
                          :style="{ marginLeft: `${planNode.depth * 20}px` }"
                        >
                          <div class="ss-dash-explain-node-header">
                            <span class="ss-dash-explain-node-type">{{ planNode.nodeType }}</span>
                            <template v-if="planNode.relationName">
                              {{ ' on ' }}<strong>{{ planNode.relationName }}</strong>
                            </template>
                            <template v-if="planNode.alias">{{ ` (${planNode.alias})` }}</template>
                            <template v-if="planNode.indexName">
                              {{ ' using ' }}<em>{{ planNode.indexName }}</em>
                            </template>
                          </div>
                          <div v-if="planNode.metrics.length > 0" class="ss-dash-explain-metrics">
                            {{ planNode.metrics.join(' \u00B7 ') }}
                          </div>
                        </div>
                      </div>
                      <div
                        v-else-if="explainHasRows(q.id as number)"
                        class="ss-dash-explain-result"
                      >
                        <table>
                          <thead>
                            <tr>
                              <th
                                v-for="col in getExplainTableCols(q.id as number)"
                                :key="col"
                              >{{ col }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="(row, ri) in getExplainRows(q.id as number)"
                              :key="ri"
                            >
                              <td
                                v-for="col in getExplainTableCols(q.id as number)"
                                :key="col"
                              >
                                {{ formatCellValue(row[col]) }}
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
                      @click="closeExplain(q.id as number)"
                    >
                      Close
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">
          <span>No queries recorded</span>
          <span class="ss-empty-hint">
            Queries require <code>debug: true</code> on your Lucid connections in
            <code>config/database.ts</code>
          </span>
        </div>
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
