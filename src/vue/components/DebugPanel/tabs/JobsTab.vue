<script setup lang="ts">
/**
 * Queue management tab for the debug panel.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { timeAgo, formatDuration, formatTime } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import JsonViewer from '../../shared/JsonViewer.vue'

interface JobEntry {
  id: string
  name: string
  status: string
  data?: unknown
  payload?: unknown
  attempts: number
  duration: number | null
  error?: string
  failedReason?: string | null
  timestamp: number
  createdAt?: number
}

interface JobTabData {
  stats?: { active: number; waiting: number; delayed: number; completed: number; failed: number }
  overview?: { active: number; waiting: number; delayed: number; completed: number; failed: number }
  jobs?: JobEntry[]
}

const props = defineProps<{
  data: JobTabData | null
}>()

const emit = defineEmits<{
  retryJob: [jobId: string]
}>()

const activeFilter = ref('all')

const FILTERS = ['all', 'active', 'waiting', 'delayed', 'completed', 'failed'] as const

const jobData = computed(() => props.data || {})
const stats = computed(() => jobData.value.stats || jobData.value.overview || {})

const jobs = computed<JobEntry[]>(() => {
  const arr = jobData.value.jobs || []
  if (activeFilter.value === 'all') return arr
  return arr.filter((j: JobEntry) => j.status === activeFilter.value)
})

function statusClass(status: string): string {
  return `ss-dbg-badge ss-dbg-job-status-${status}`
}

function handleRetry(jobId: string) {
  emit('retryJob', jobId)
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

watch(jobs, attachResize)
onMounted(attachResize)
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
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
          v-for="f in FILTERS"
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
            <span :class="statusClass(j.status)">{{ j.status }}</span>
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
