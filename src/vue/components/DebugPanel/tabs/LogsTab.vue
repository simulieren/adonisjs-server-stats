<script setup lang="ts">
/**
 * Logs with level filter tab for the debug panel.
 */
import { ref, computed } from 'vue'
import { formatTime, timeAgo } from '../../../../core/index.js'
import { TAB_ICONS } from '../../../../core/icons.js'

interface LogEntry {
  id?: number
  level: string | number
  levelName?: string
  level_name?: string
  msg?: string
  message?: string
  requestId?: string
  request_id?: string
  'x-request-id'?: string
  time?: number
  timestamp?: number
  data?: Record<string, unknown>
  [key: string]: unknown
}

const props = defineProps<{
  data: { logs?: LogEntry[]; entries?: LogEntry[] } | LogEntry[] | null
  dashboardPath?: string
}>()

const emit = defineEmits<{
  filterByRequestId: [requestId: string]
}>()

const activeLevel = ref('all')
const search = ref('')
const requestIdFilter = ref('')

const LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

/** Resolve the log level string from whichever field the backend provides. */
function resolveLevel(l: LogEntry): string {
  return (
    (l.levelName as string) ||
    (l.level_name as string) ||
    (typeof l.level === 'string' ? l.level : '') ||
    'info'
  ).toLowerCase()
}

/** Resolve the message from whichever field the backend provides. */
function resolveMsg(l: LogEntry): string {
  return (l.msg as string) || (l.message as string) || JSON.stringify(l)
}

/** Resolve the timestamp from whichever field the backend provides. */
function resolveTime(l: LogEntry): number {
  return (l.time as number) || (l.timestamp as number) || 0
}

/** Resolve the request ID from whichever field the backend provides. */
function resolveReqId(l: LogEntry): string {
  return (l.requestId as string) || (l.request_id as string) || (l['x-request-id'] as string) || ''
}

const logs = computed<LogEntry[]>(() => {
  const d = props.data
  let arr: LogEntry[] = d ? (Array.isArray(d) ? d : d.logs || d.entries) || [] : []

  if (activeLevel.value !== 'all') {
    const level = activeLevel.value
    arr = arr.filter((l) => {
      const resolved = resolveLevel(l)
      if (level === 'error') return resolved === 'error' || resolved === 'fatal'
      return resolved === level
    })
  }

  if (requestIdFilter.value.trim()) {
    const rid = requestIdFilter.value.trim().toLowerCase()
    arr = arr.filter((l) => {
      const reqId = resolveReqId(l)
      return reqId && reqId.toLowerCase().includes(rid)
    })
  }

  if (search.value.trim()) {
    const s = search.value.trim().toLowerCase()
    arr = arr.filter((l) => resolveMsg(l).toLowerCase().includes(s))
  }

  return arr
})

const summary = computed(() => {
  const d = props.data
  const all = d ? (Array.isArray(d) ? d : d.logs || d.entries) || [] : []
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
        type="button"
        :class="['ss-dbg-log-filter', { 'ss-dbg-active': activeLevel === level }]"
        @click="activeLevel = level"
      >
        {{ level }}
      </button>
      <button
        v-if="requestIdFilter"
        type="button"
        class="ss-dbg-log-filter ss-dbg-active"
        @click="requestIdFilter = ''"
      >
        req: {{ requestIdFilter.slice(0, 8) }} x
      </button>
      <span class="ss-dbg-summary" style="margin-left: auto">{{ logs.length }} entries</span>
    </div>

    <div class="ss-dbg-search-bar">
      <input
        v-model="search"
        class="ss-dbg-search"
        placeholder="Filter log messages..."
        type="text"
      />
      <input
        v-model="requestIdFilter"
        class="ss-dbg-search ss-dbg-reqid-input"
        placeholder="Filter by request ID..."
        type="text"
      />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="logs.length === 0" class="ss-dbg-empty">No log entries</div>

    <div v-else>
      <div v-for="(log, i) in logs" :key="log.id || i" class="ss-dbg-log-entry">
        <span :class="['ss-dbg-log-level', levelClass(resolveLevel(log))]">
          {{ resolveLevel(log).toUpperCase() }}
        </span>
        <span class="ss-dbg-log-time" :title="resolveTime(log) ? formatTime(resolveTime(log)) : ''">{{ resolveTime(log) ? timeAgo(resolveTime(log)) : '-' }}</span>
        <span
          v-if="resolveReqId(log)"
          class="ss-dbg-log-reqid"
          role="button"
          tabindex="0"
          :title="resolveReqId(log)"
          @click="filterByReqId(resolveReqId(log))"
          @keydown.enter="filterByReqId(resolveReqId(log))"
        >
          {{ resolveReqId(log).slice(0, 8) }}
        </span>
        <span v-else class="ss-dbg-log-reqid-empty">-</span>
        <span class="ss-dbg-log-msg">{{ resolveMsg(log) }}</span>
        <a
          v-if="dashboardPath && resolveReqId(log)"
          :href="`${dashboardPath}#logs?requestId=${resolveReqId(log)}`"
          target="_blank"
          class="ss-dbg-deeplink"
        >
          <svg
            :viewBox="TAB_ICONS['open-external'].viewBox"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            v-html="TAB_ICONS['open-external'].elements.join('')"
          ></svg>
        </a>
      </div>
    </div>
  </div>
</template>
