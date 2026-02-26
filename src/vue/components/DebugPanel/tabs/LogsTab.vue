<script setup lang="ts">
/**
 * Logs with level filter tab for the debug panel.
 */
import { ref, computed } from 'vue'
import { formatTime, shortReqId } from '../../../../core/index.js'

interface LogEntry {
  id?: number
  level: string
  message: string
  requestId?: string
  timestamp: number
  data?: any
}

const props = defineProps<{
  data: any
  dashboardPath?: string
}>()

const emit = defineEmits<{
  filterByRequestId: [requestId: string]
}>()

const activeLevel = ref('all')
const requestIdFilter = ref('')

const LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

const logs = computed<LogEntry[]>(() => {
  let arr: LogEntry[] = props.data?.logs || props.data || []

  if (activeLevel.value !== 'all') {
    const level = activeLevel.value
    arr = arr.filter((l) => {
      if (level === 'error') return l.level === 'error' || l.level === 'fatal'
      return l.level === level
    })
  }

  if (requestIdFilter.value.trim()) {
    const rid = requestIdFilter.value.trim().toLowerCase()
    arr = arr.filter((l) => l.requestId && l.requestId.toLowerCase().includes(rid))
  }

  return arr
})

const summary = computed(() => {
  const all = props.data?.logs || props.data || []
  return `${logs.value.length} of ${all.length} entries`
})

function levelClass(level: string): string {
  const map: Record<string, string> = {
    info: 'ss-dbg-log-level-info',
    warn: 'ss-dbg-log-level-warn',
    error: 'ss-dbg-log-level-error',
    fatal: 'ss-dbg-log-level-fatal',
    debug: 'ss-dbg-log-level-debug',
    trace: 'ss-dbg-log-level-trace',
  }
  return map[level] || 'ss-dbg-log-level-debug'
}

function filterByReqId(reqId: string) {
  requestIdFilter.value = reqId
  emit('filterByRequestId', reqId)
}
</script>

<template>
  <div>
    <div class="ss-dbg-log-filters">
      <button
        v-for="level in LEVELS"
        :key="level"
        :class="['ss-dbg-log-filter', { 'ss-dbg-active': activeLevel === level }]"
        @click="activeLevel = level"
      >
        {{ level }}
      </button>
    </div>

    <div class="ss-dbg-search-bar">
      <input
        v-model="requestIdFilter"
        class="ss-dbg-search ss-dbg-reqid-input"
        placeholder="Filter by request ID..."
        type="text"
      />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="logs.length === 0" class="ss-dbg-empty">
      No log entries
    </div>

    <div v-else>
      <div
        v-for="(log, i) in logs"
        :key="log.id || i"
        class="ss-dbg-log-entry"
      >
        <span :class="['ss-dbg-log-level', levelClass(log.level)]">
          {{ log.level }}
        </span>
        <span class="ss-dbg-log-time">{{ formatTime(log.timestamp) }}</span>
        <span
          v-if="log.requestId"
          class="ss-dbg-log-reqid"
          @click="filterByReqId(log.requestId)"
          :title="log.requestId"
        >
          {{ shortReqId(log.requestId) }}
        </span>
        <span v-else class="ss-dbg-log-reqid-empty">--</span>
        <span class="ss-dbg-log-msg">{{ log.message }}</span>
        <a
          v-if="dashboardPath && log.requestId"
          :href="`${dashboardPath}#logs?requestId=${log.requestId}`"
          target="_blank"
          class="ss-dbg-deeplink"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 3H3v10h10v-3M9 1h6v6M7 9L15 1" />
          </svg>
        </a>
      </div>
    </div>
  </div>
</template>
