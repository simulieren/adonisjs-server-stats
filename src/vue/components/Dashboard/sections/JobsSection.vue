<script setup lang="ts">
/**
 * Queue/Jobs section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React JobsSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { timeAgo, formatDuration, formatTime } from '../../../../core/index.js'
import {
  JOB_STATUS_FILTERS,
  getJobStatusBadgeColor,
  extractJobs as extractJobsFromData,
  extractJobStats,
} from '../../../../core/job-utils.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import JsonViewer from '../../shared/JsonViewer.vue'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const { data, loading, error, pagination, goToPage, setSearch, setFilter, refresh, mutate } =
  useDashboardData(() => 'jobs', {
    baseUrl,
    dashboardEndpoint,
    authToken,
    refreshKey,
  })

const search = ref('')
const statusFilter = ref('all')
const retryStates = ref<Record<string, 'pending' | 'success' | 'error'>>({})

const jobs = computed<Record<string, unknown>[]>(() => extractJobsFromData(data.value))

const stats = computed(() => extractJobStats(data.value))

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

function handleStatusFilter(status: string) {
  statusFilter.value = status
  if (status === 'all') {
    setFilter('status', '')
  } else {
    setFilter('status', status)
  }
}

const { tableRef } = useResizableTable(() => jobs.value)

async function handleRetry(jobId: string) {
  retryStates.value[jobId] = 'pending'
  try {
    await mutate(`jobs/${jobId}/retry`)
    retryStates.value[jobId] = 'success'
    setTimeout(() => {
      delete retryStates.value[jobId]
      refresh()
    }, 1000)
  } catch {
    delete retryStates.value[jobId]
  }
}
</script>

<template>
  <div>
    <!-- Stats row -->
    <div v-if="stats" class="ss-dash-job-stats">
      <div class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Active:</span>
        <span class="ss-dash-job-stat-value">{{ stats.active ?? 0 }}</span>
      </div>
      <div class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Waiting:</span>
        <span class="ss-dash-job-stat-value">{{ stats.waiting ?? 0 }}</span>
      </div>
      <div class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Delayed:</span>
        <span class="ss-dash-job-stat-value">{{ stats.delayed ?? 0 }}</span>
      </div>
      <div class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Completed:</span>
        <span class="ss-dash-job-stat-value">{{ stats.completed ?? 0 }}</span>
      </div>
      <div class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Failed:</span>
        <span class="ss-dash-job-stat-value" style="color: var(--ss-red-fg)">{{
          stats.failed ?? 0
        }}</span>
      </div>
    </div>

    <FilterBar
      :model-value="search"
      placeholder="Filter jobs..."
      :summary="`${pagination.total || jobs.length} jobs`"
      @update:model-value="handleSearch"
    >
      <div class="ss-dash-btn-group">
        <button
          v-for="status in JOB_STATUS_FILTERS"
          :key="status"
          type="button"
          :class="`ss-dash-btn ${statusFilter === status ? 'ss-dash-active' : ''}`"
          @click="handleStatusFilter(status)"
        >
          {{ status.charAt(0).toUpperCase() + status.slice(1) }}
        </button>
      </div>
    </FilterBar>

    <div v-if="loading && !data" class="ss-dash-empty">Loading jobs...</div>

    <div v-else-if="error" class="ss-dash-empty">Jobs/Queue not available</div>

    <template v-else>
      <div class="ss-dash-table-wrap">
        <table v-if="jobs.length > 0" ref="tableRef" class="ss-dash-table">
          <colgroup>
            <col style="width: 40px" />
            <col />
            <col style="width: 90px" />
            <col />
            <col style="width: 50px" />
            <col style="width: 75px" />
            <col style="width: 70px" />
            <col style="width: 50px" />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Payload</th>
              <th>Tries</th>
              <th>Duration</th>
              <th>Time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="j in jobs" :key="j.id as string">
              <td>
                <span style="color: var(--ss-dim)">{{ j.id }}</span>
              </td>
              <td>
                <span style="color: var(--ss-text)" :title="j.name as string">{{ j.name }}</span>
              </td>
              <td>
                <span
                  :class="`ss-dash-badge ss-dash-badge-${getJobStatusBadgeColor(j.status as string)}`"
                >
                  {{ j.status }}
                </span>
              </td>
              <td>
                <JsonViewer :value="j.payload || j.data" :max-len="60" />
              </td>
              <td>
                <span style="color: var(--ss-muted); text-align: center; display: block">
                  {{ (j.attempts as number) || (j.attemptsMade as number) || 0 }}
                </span>
              </td>
              <td>
                <span class="ss-dash-duration">
                  {{
                    (j.duration as number) !== null && (j.duration as number) !== undefined
                      ? formatDuration(j.duration as number)
                      : '-'
                  }}
                </span>
              </td>
              <td>
                <span
                  class="ss-dash-event-time"
                  style="white-space: nowrap"
                  :title="
                    formatTime(
                      ((j.timestamp as string) ||
                        (j.createdAt as string) ||
                        (j.processedAt as string) ||
                        (j.created_at as string)) as string
                    )
                  "
                >
                  {{
                    timeAgo(
                      ((j.timestamp as string) ||
                        (j.createdAt as string) ||
                        (j.processedAt as string) ||
                        (j.created_at as string)) as string
                    )
                  }}
                </span>
              </td>
              <td>
                <button
                  v-if="j.status === 'failed'"
                  type="button"
                  class="ss-dash-retry-btn"
                  :disabled="
                    retryStates[j.id as string] === 'pending' ||
                    retryStates[j.id as string] === 'success'
                  "
                  @click.stop="handleRetry(j.id as string)"
                >
                  {{
                    retryStates[j.id as string] === 'pending'
                      ? '...'
                      : retryStates[j.id as string] === 'success'
                        ? 'OK'
                        : 'Retry'
                  }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">No jobs found</div>
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
