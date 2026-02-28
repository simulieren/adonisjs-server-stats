<script setup lang="ts">
/**
 * Logs with level filter tab for the debug panel.
 */
import { ref, computed } from 'vue'
import { formatTime, timeAgo } from '../../../../core/index.js'
import { TAB_ICONS } from '../../../../core/icons.js'
import {
  LOG_LEVELS,
  resolveLogLevel,
  resolveLogMessage,
  resolveLogTimestamp,
  resolveLogRequestId,
  getLogLevelCssClass,
  filterLogsByLevel,
} from '../../../../core/log-utils.js'

import type { LogEntry } from '../../../../core/log-utils.js'

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

const logs = computed<LogEntry[]>(() => {
  const d = props.data
  let arr: LogEntry[] = d ? (Array.isArray(d) ? d : d.logs || d.entries) || [] : []

  arr = filterLogsByLevel(arr, activeLevel.value)

  if (requestIdFilter.value.trim()) {
    const rid = requestIdFilter.value.trim().toLowerCase()
    arr = arr.filter((l) => {
      const reqId = resolveLogRequestId(l)
      return reqId && reqId.toLowerCase().includes(rid)
    })
  }

  if (search.value.trim()) {
    const s = search.value.trim().toLowerCase()
    arr = arr.filter((l) => resolveLogMessage(l).toLowerCase().includes(s))
  }

  return arr
})

const summary = computed(() => {
  const d = props.data
  const all = d ? (Array.isArray(d) ? d : d.logs || d.entries) || [] : []
  return `${logs.value.length} of ${all.length} entries`
})

function filterByReqId(reqId: string) {
  requestIdFilter.value = reqId
  emit('filterByRequestId', reqId)
}
</script>

<template>
  <div>
    <div class="ss-dbg-log-filters">
      <button
        v-for="level in LOG_LEVELS"
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
        <span :class="['ss-dbg-log-level', getLogLevelCssClass(resolveLogLevel(log))]">
          {{ resolveLogLevel(log).toUpperCase() }}
        </span>
        <span class="ss-dbg-log-time" :title="resolveLogTimestamp(log) ? formatTime(resolveLogTimestamp(log)) : ''">{{ resolveLogTimestamp(log) ? timeAgo(resolveLogTimestamp(log)) : '-' }}</span>
        <span
          v-if="resolveLogRequestId(log)"
          class="ss-dbg-log-reqid"
          role="button"
          tabindex="0"
          :title="resolveLogRequestId(log)"
          @click="filterByReqId(resolveLogRequestId(log))"
          @keydown.enter="filterByReqId(resolveLogRequestId(log))"
        >
          {{ resolveLogRequestId(log).slice(0, 8) }}
        </span>
        <span v-else class="ss-dbg-log-reqid-empty">-</span>
        <span class="ss-dbg-log-msg">{{ resolveLogMessage(log) }}</span>
        <a
          v-if="dashboardPath && resolveLogRequestId(log)"
          :href="`${dashboardPath}#logs?requestId=${resolveLogRequestId(log)}`"
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
