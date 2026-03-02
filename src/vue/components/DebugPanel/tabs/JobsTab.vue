<script setup lang="ts">
/**
 * Queue management tab for the debug panel.
 */
import { ref, computed } from 'vue'
import { timeAgo, formatDuration, formatTime } from '../../../../core/index.js'
import { JOB_STATUS_FILTERS, getJobStatusCssClass } from '../../../../core/job-utils.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import JsonViewer from '../../shared/JsonViewer.vue'

import type { JobRecord, JobsApiResponse, JobStats } from '../../../../core/types.js'

const props = defineProps<{
  data: JobsApiResponse | null
}>()

const emit = defineEmits<{
  retryJob: [jobId: string]
}>()

const activeFilter = ref('all')

const jobData = computed(() => props.data || {})
const stats = computed(
  () => jobData.value.stats || jobData.value.overview || ({} as Partial<JobStats>)
)

const jobs = computed<JobRecord[]>(() => {
  const arr = jobData.value.jobs || []
  if (activeFilter.value === 'all') return arr
  return arr.filter((j: JobRecord) => j.status === activeFilter.value)
})

function handleRetry(jobId: string) {
  emit('retryJob', jobId)
}

const { tableRef } = useResizableTable(() => jobs.value)
</script>

<template>
  <div>
    <div class="ss-dbg-job-stats-area">
      <div class="ss-dbg-job-stats">
        <span class="ss-dbg-job-stat">
          <span class="ss-dbg-job-stat-label">Active:</span>
          <span class="ss-dbg-job-stat-value">{{ stats.active ?? 0 }}</span>
        </span>
        <span class="ss-dbg-job-stat">
          <span class="ss-dbg-job-stat-label">Waiting:</span>
          <span class="ss-dbg-job-stat-value">{{ stats.waiting ?? 0 }}</span>
        </span>
        <span class="ss-dbg-job-stat">
          <span class="ss-dbg-job-stat-label">Delayed:</span>
          <span class="ss-dbg-job-stat-value">{{ stats.delayed ?? 0 }}</span>
        </span>
        <span class="ss-dbg-job-stat">
          <span class="ss-dbg-job-stat-label">Completed:</span>
          <span class="ss-dbg-job-stat-value">{{ stats.completed ?? 0 }}</span>
        </span>
        <span class="ss-dbg-job-stat">
          <span class="ss-dbg-job-stat-label">Failed:</span>
          <span class="ss-dbg-job-stat-value ss-dbg-c-red">{{ stats.failed ?? 0 }}</span>
        </span>
      </div>

      <div class="ss-dbg-log-filters">
        <button
          v-for="f in JOB_STATUS_FILTERS"
          :key="f"
          :class="['ss-dbg-job-filter', { 'ss-dbg-active': activeFilter === f }]"
          @click="activeFilter = f"
        >
          {{ f }}
        </button>
      </div>
    </div>

    <div v-if="jobs.length === 0" class="ss-dbg-empty">No jobs found</div>

    <table v-else ref="tableRef" class="ss-dbg-table">
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
        <tr v-for="j in jobs" :key="j.id">
          <td class="ss-dbg-c-dim">{{ j.id }}</td>
          <td class="ss-dbg-c-sql">{{ j.name }}</td>
          <td>
            <span :class="`ss-dbg-badge ${getJobStatusCssClass(j.status)}`">{{ j.status }}</span>
          </td>
          <td>
            <JsonViewer :value="j.payload || j.data" :max-len="60" class-prefix="ss-dbg" />
          </td>
          <td class="ss-dbg-c-muted" style="text-align: center">
            {{ j.attempts }}
          </td>
          <td class="ss-dbg-duration">
            {{ j.duration !== null ? formatDuration(j.duration) : '-' }}
          </td>
          <td class="ss-dbg-event-time" :title="formatTime(j.timestamp || j.createdAt)">
            {{ timeAgo(j.timestamp || j.createdAt) }}
          </td>
          <td>
            <button
              v-if="j.status === 'failed'"
              class="ss-dbg-retry-btn"
              @click="handleRetry(j.id)"
            >
              Retry
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
