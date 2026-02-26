<script setup lang="ts">
/**
 * Logs section with structured filtering and saved presets.
 */
import { ref, computed } from 'vue'
import { formatTime, shortReqId } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

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
  page: number
  perPage: number
  total: number
}>()

const emit = defineEmits<{
  goToPage: [page: number]
  search: [term: string]
  filter: [key: string, value: string | number | boolean]
}>()

const search = ref('')
const activeLevel = ref('all')

const LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

const logs = computed<LogEntry[]>(() => {
  const d = props.data
  if (!d) return []
  return d.data || d.logs || d || []
})

function levelClass(level: string): string {
  const map: Record<string, string> = {
    info: 'ss-dash-log-level-info',
    warn: 'ss-dash-log-level-warn',
    error: 'ss-dash-log-level-error',
    fatal: 'ss-dash-log-level-fatal',
    debug: 'ss-dash-log-level-debug',
    trace: 'ss-dash-log-level-trace',
  }
  return map[level] || 'ss-dash-log-level-debug'
}

function handleLevelFilter(level: string) {
  activeLevel.value = level
  if (level === 'all') {
    emit('filter', 'level', '')
  } else {
    emit('filter', 'level', level)
  }
}

function handleSearch(term: string) {
  search.value = term
  emit('search', term)
}

function filterByRequestId(reqId: string) {
  emit('filter', 'requestId', reqId)
}
</script>

<template>
  <div>
    <div class="ss-dash-log-filters">
      <button
        v-for="level in LEVELS"
        :key="level"
        :class="['ss-dash-log-filter', { 'ss-dash-active': activeLevel === level }]"
        @click="handleLevelFilter(level)"
      >
        {{ level }}
      </button>
    </div>

    <FilterBar
      :model-value="search"
      placeholder="Search logs..."
      :summary="`${props.total} entries`"
      @update:model-value="handleSearch"
    />

    <div v-if="logs.length === 0" class="ss-dash-empty">No log entries</div>

    <div v-else class="ss-dash-log-list">
      <div v-for="(log, i) in logs" :key="log.id || i" class="ss-dash-log-entry">
        <span :class="['ss-dash-log-level', levelClass(log.level)]">
          {{ log.level }}
        </span>
        <span class="ss-dash-log-time">{{ formatTime(log.timestamp) }}</span>
        <span
          v-if="log.requestId"
          class="ss-dash-log-reqid"
          @click="filterByRequestId(log.requestId)"
          :title="log.requestId"
        >
          {{ shortReqId(log.requestId) }}
        </span>
        <span v-else class="ss-dash-log-reqid-empty">--</span>
        <span class="ss-dash-log-msg">{{ log.message }}</span>
      </div>
    </div>

    <PaginationControls
      :page="props.page"
      :per-page="props.perPage"
      :total="props.total"
      @go-to-page="emit('goToPage', $event)"
    />
  </div>
</template>
