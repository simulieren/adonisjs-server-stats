<script setup lang="ts">
/**
 * Timeline/traces section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React TimelineSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { timeAgo, formatTime, durationSeverity } from '../../../../core/index.js'
import { useApiClient } from '../../../composables/useApiClient.js'
import { parseTraceSpans, parseTraceWarnings } from '../../../../core/trace-utils.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'
import WaterfallChart from '../shared/WaterfallChart.vue'

import type { TraceDetail } from '../../../../core/trace-utils.js'

const props = withDefaults(
  defineProps<{
    /** When false, show a "tracing disabled" message instead of fetching. Defaults to true. */
    tracingEnabled?: boolean
  }>(),
  {
    tracingEnabled: true,
  }
)

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const { data, loading, error, pagination, goToPage, setSearch } = useDashboardData(() => 'traces', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')
const selectedId = ref<number | null>(null)
const traceDetail = ref<TraceDetail | null>(null)
const detailLoading = ref(false)

const traces = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  const d = data.value as Record<string, unknown>
  return (d.data || d.traces || data.value || []) as Record<string, unknown>[]
})

const getClient = useApiClient(baseUrl, authToken)

async function selectTrace(id: number) {
  selectedId.value = id
  detailLoading.value = true
  traceDetail.value = null
  try {
    const endpoint = dashboardEndpoint || '/__stats/api'
    const result = await getClient().fetch<TraceDetail>(`${endpoint}/traces/${id}`)
    traceDetail.value = result
  } catch {
    // silently fail
  } finally {
    detailLoading.value = false
  }
}

function handleBack() {
  selectedId.value = null
  traceDetail.value = null
}

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

function dashDurationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dash-very-slow'
  if (sev === 'slow') return 'ss-dash-slow'
  return ''
}

const { tableRef } = useResizableTable(() => traces.value)
</script>

<template>
  <div>
    <!-- Tracing disabled message -->
    <div v-if="!props.tracingEnabled" class="ss-dash-empty">
      Tracing is not enabled. Enable tracing in your server-stats config to use the timeline.
    </div>

    <!-- Trace detail view -->
    <template v-else-if="selectedId && traceDetail">
      <div class="ss-dash-tl-detail-header">
        <button type="button" class="ss-dash-btn" @click="handleBack">&larr; Back</button>
        <span :class="`ss-dash-method ss-dash-method-${(traceDetail.method || '').toLowerCase()}`">
          {{ traceDetail.method }}
        </span>
        <span style="color: var(--ss-text)">{{ traceDetail.url }}</span>
        <span
          :class="`ss-dash-status ss-dash-status-${Math.floor((traceDetail.status_code || traceDetail.statusCode || 0) / 100)}xx`"
        >
          {{ traceDetail.status_code || traceDetail.statusCode || 0 }}
        </span>
        <span class="ss-dash-tl-meta">
          {{ (traceDetail.total_duration || traceDetail.totalDuration || 0).toFixed(1) }}ms &middot;
          {{ traceDetail.spanCount ?? parseTraceSpans(traceDetail.spans).length }} spans
        </span>
      </div>
      <WaterfallChart
        :spans="parseTraceSpans(traceDetail.spans) as any"
        :total-duration="traceDetail.total_duration || traceDetail.totalDuration || 0"
        :warnings="parseTraceWarnings(traceDetail.warnings)"
      />
    </template>

    <!-- Loading detail -->
    <template v-else-if="selectedId && detailLoading">
      <div class="ss-dash-tl-detail-header">
        <button type="button" class="ss-dash-btn" @click="handleBack">&larr; Back</button>
      </div>
      <div class="ss-dash-empty">Loading trace detail...</div>
    </template>

    <!-- List view -->
    <template v-else>
      <FilterBar
        :model-value="search"
        placeholder="Filter traces..."
        :summary="`${pagination.total ?? 0} traces`"
        @update:model-value="handleSearch"
      />

      <div v-if="error" class="ss-dash-empty">Failed to load traces</div>

      <div v-if="loading && !data" class="ss-dash-empty">Loading traces...</div>

      <template v-else>
        <div class="ss-dash-table-wrap">
          <table v-if="traces.length > 0" ref="tableRef" class="ss-dash-table">
            <colgroup>
              <col style="width: 40px" />
              <col style="width: 70px" />
              <col />
              <col style="width: 60px" />
              <col style="width: 80px" />
              <col style="width: 50px" />
              <col style="width: 80px" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>Method</th>
                <th>URL</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Spans</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in traces"
                :key="t.id as number"
                class="ss-dash-clickable"
                @click="selectTrace(t.id as number)"
              >
                <td>
                  <span style="color: var(--ss-dim)">{{ t.id }}</span>
                </td>
                <td>
                  <span
                    :class="`ss-dash-method ss-dash-method-${((t.method as string) || '').toLowerCase()}`"
                  >
                    {{ t.method }}
                  </span>
                </td>
                <td>
                  <span
                    style="
                      color: var(--ss-text);
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    "
                    :title="t.url as string"
                  >
                    {{ t.url }}
                  </span>
                </td>
                <td>
                  <span
                    :class="`ss-dash-status ss-dash-status-${Math.floor(((t.statusCode as number) || (t.status_code as number) || 0) / 100)}xx`"
                  >
                    {{ (t.statusCode as number) || (t.status_code as number) || 0 }}
                  </span>
                </td>
                <td>
                  <span
                    :class="`ss-dash-duration ${dashDurationClass((t.totalDuration as number) || (t.total_duration as number) || 0)}`"
                  >
                    {{
                      ((t.totalDuration as number) || (t.total_duration as number) || 0).toFixed(1)
                    }}ms
                  </span>
                </td>
                <td>
                  <span style="color: var(--ss-muted); text-align: center">
                    {{ (t.spanCount as number) || (t.span_count as number) || 0 }}
                  </span>
                </td>
                <td>
                  <span
                    class="ss-dash-event-time"
                    :title="
                      formatTime(
                        ((t.createdAt as string) ||
                          (t.created_at as string) ||
                          (t.timestamp as string)) as string
                      )
                    "
                  >
                    {{
                      timeAgo(
                        ((t.createdAt as string) ||
                          (t.created_at as string) ||
                          (t.timestamp as string)) as string
                      )
                    }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="ss-dash-empty">No traces recorded</div>
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
