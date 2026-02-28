<script setup lang="ts">
/**
 * Request history section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data
 * via useDashboardData. CSS classes match the React RequestsSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { timeAgo, formatTime, durationSeverity } from '../../../../core/index.js'
import { useApiClient } from '../../../composables/useApiClient.js'
import { normalizeTraceFields } from '../../../../core/trace-utils.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'
import WaterfallChart from '../shared/WaterfallChart.vue'

import type { NormalizedTrace, TraceDetail } from '../../../../core/trace-utils.js'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const {
  data,
  loading,
  error,
  pagination,
  sort,
  goToPage,
  setSearch,
  setSort,
} = useDashboardData(() => 'requests', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')
const selectedTrace = ref<Record<string, unknown> | null>(null)
const detailLoading = ref(false)

const traceDetail = ref<NormalizedTrace | null>(null)

const requests = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  const d = data.value as Record<string, unknown>
  return (d.data || d.requests || data.value || []) as Record<string, unknown>[]
})

const getClient = useApiClient(baseUrl, authToken)

async function handleRowClick(row: Record<string, unknown>) {
  const id = row.id as number
  detailLoading.value = true
  try {
    const endpoint = dashboardEndpoint || '/__stats/api'
    const result = await getClient().fetch<TraceDetail>(`${endpoint}/requests/${id}`)
    traceDetail.value = normalizeTraceFields(result as unknown as Record<string, unknown>)
    selectedTrace.value = row
  } catch {
    // silently fail
  } finally {
    detailLoading.value = false
  }
}

function handleBack() {
  selectedTrace.value = null
  traceDetail.value = null
}

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

function handleSort(key: string) {
  setSort(key)
}

function dashDurationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dash-very-slow'
  if (sev === 'slow') return 'ss-dash-slow'
  return ''
}

</script>

<template>
  <div>
    <!-- Trace detail view -->
    <template v-if="traceDetail && selectedTrace">
      <div class="ss-dash-tl-detail-header">
        <button type="button" class="ss-dash-btn" @click="handleBack">
          &larr; Back to Requests
        </button>
        <span :class="`ss-dash-method ss-dash-method-${(traceDetail.method || '').toLowerCase()}`">
          {{ traceDetail.method }}
        </span>
        <span style="color: var(--ss-text)">{{ traceDetail.url }}</span>
        <span :class="`ss-dash-status ss-dash-status-${Math.floor((traceDetail.statusCode || 200) / 100)}xx`">
          {{ traceDetail.statusCode }}
        </span>
        <span class="ss-dash-tl-meta">
          {{ traceDetail.totalDuration.toFixed(1) }}ms
          &middot;
          {{ traceDetail.spanCount }} spans
        </span>
      </div>
      <WaterfallChart
        :spans="traceDetail.spans as any"
        :total-duration="traceDetail.totalDuration"
        :warnings="traceDetail.warnings"
      />
    </template>

    <!-- Loading detail -->
    <template v-else-if="detailLoading">
      <div class="ss-dash-tl-detail-header">
        <button type="button" class="ss-dash-btn" @click="detailLoading = false">
          &larr; Back to Requests
        </button>
      </div>
      <div class="ss-dash-empty">Loading request detail...</div>
    </template>

    <!-- List view -->
    <template v-else>
      <FilterBar
        :model-value="search"
        placeholder="Filter requests..."
        :summary="`${pagination.total ?? 0} requests`"
        @update:model-value="handleSearch"
      />

      <div v-if="error" class="ss-dash-empty">Failed to load requests</div>

      <div v-if="loading && !data" class="ss-dash-empty">Loading requests...</div>

      <template v-else>
        <div class="ss-dash-table-wrap">
          <table v-if="requests.length > 0" class="ss-dash-table">
            <colgroup>
              <col style="width: 40px" />
              <col style="width: 70px" />
              <col />
              <col style="width: 60px" />
              <col style="width: 80px" />
              <col style="width: 50px" />
              <col style="width: 40px" />
              <col style="width: 80px" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th class="ss-dash-sortable" @click="handleSort('method')">
                  Method
                  <span v-if="sort.column === 'method'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
                </th>
                <th class="ss-dash-sortable" @click="handleSort('url')">
                  URL
                  <span v-if="sort.column === 'url'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
                </th>
                <th class="ss-dash-sortable" @click="handleSort('statusCode')">
                  Status
                  <span v-if="sort.column === 'statusCode'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
                </th>
                <th class="ss-dash-sortable" @click="handleSort('duration')">
                  Duration
                  <span v-if="sort.column === 'duration'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
                </th>
                <th>Spans</th>
                <th>&#x26A0;</th>
                <th class="ss-dash-sortable" @click="handleSort('createdAt')">
                  Time
                  <span v-if="sort.column === 'createdAt'" class="ss-dash-sort-arrow">{{ sort.direction === 'asc' ? ' \u25B2' : ' \u25BC' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in requests"
                :key="(r.id as number)"
                class="ss-dash-clickable"
                @click="handleRowClick(r)"
              >
                <td><span style="color: var(--ss-dim)">{{ r.id }}</span></td>
                <td>
                  <span :class="`ss-dash-method ss-dash-method-${((r.method as string) || '').toLowerCase()}`">
                    {{ r.method }}
                  </span>
                </td>
                <td>
                  <span
                    style="color: var(--ss-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                    :title="(r.url as string)"
                  >
                    {{ r.url }}
                  </span>
                </td>
                <td>
                  <span :class="`ss-dash-status ss-dash-status-${Math.floor(((r.status_code as number) || (r.statusCode as number) || 200) / 100)}xx`">
                    {{ r.status_code || r.statusCode }}
                  </span>
                </td>
                <td>
                  <span
                    :class="`ss-dash-duration ${dashDurationClass((r.total_duration as number) || (r.totalDuration as number) || (r.duration as number) || 0)}`"
                  >
                    {{ ((r.total_duration as number) || (r.totalDuration as number) || (r.duration as number) || 0).toFixed(1) }}ms
                  </span>
                </td>
                <td>
                  <span style="color: var(--ss-muted); text-align: center">
                    {{ (r.span_count as number) || (r.spanCount as number) || 0 }}
                  </span>
                </td>
                <td>
                  <span
                    v-if="((r.warning_count as number) || (r.warningCount as number) || 0) > 0"
                    style="color: var(--ss-amber-fg); text-align: center; display: block"
                  >
                    {{ (r.warning_count as number) || (r.warningCount as number) || 0 }}
                  </span>
                  <span v-else style="color: var(--ss-dim); text-align: center; display: block">-</span>
                </td>
                <td>
                  <span
                    class="ss-dash-event-time"
                    :title="formatTime(((r.createdAt as string) || (r.created_at as string) || (r.timestamp as string) || '') as string)"
                  >
                    {{ timeAgo(((r.createdAt as string) || (r.created_at as string) || (r.timestamp as string) || '') as string) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="ss-dash-empty">No requests recorded yet</div>
        </div>
        <PaginationControls
          v-if="pagination.totalPages > 1"
          :page="pagination.page"
          :last-page="pagination.totalPages"
          :total="pagination.total"
          @page-change="goToPage"
        />
      </template>
    </template>
  </div>
</template>
