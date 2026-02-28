<script setup lang="ts">
/**
 * Logs section with structured filtering.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React LogsSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { timeAgo, formatTime } from '../../../../core/index.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'] as const

const {
  data,
  loading,
  error,
  pagination,
  filter: filterState,
  goToPage,
  setSearch,
  setFilter,
  refresh,
} = useDashboardData(() => 'logs', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')
const levelFilter = ref('all')
const reqIdFilter = ref('')
const reqIdInput = ref('')

interface StructuredFilter {
  field: string
  operator: string
  value: string
}

const structuredFilters = ref<StructuredFilter[]>([])
const structuredField = ref('level')
const structuredOp = ref('equals')
const structuredValue = ref('')

const logs = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  const d = data.value as Record<string, unknown>
  return (d.data || d.logs || data.value || []) as Record<string, unknown>[]
})

const hasActiveFilters = computed(() =>
  levelFilter.value !== 'all' || reqIdFilter.value !== '' || structuredFilters.value.length > 0
)

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

function handleLevelFilter(level: string) {
  levelFilter.value = level
  if (level === 'all') {
    setFilter('level', '')
  } else {
    setFilter('level', level)
  }
}

function handleReqIdClick(reqId: string) {
  reqIdFilter.value = reqId
  reqIdInput.value = reqId
  setFilter('request_id', reqId)
}

function handleReqIdInputSubmit() {
  const trimmed = reqIdInput.value.trim()
  reqIdFilter.value = trimmed
  setFilter('request_id', trimmed)
}

function clearReqIdFilter() {
  reqIdFilter.value = ''
  reqIdInput.value = ''
  setFilter('request_id', '')
}

function clearLevelFilter() {
  levelFilter.value = 'all'
  setFilter('level', '')
}

/**
 * Sync the structuredFilters array into the composable's filter state
 * using the same numbered key format as React:
 *   filter_field_0, filter_op_0, filter_value_0, ...
 */
function syncStructuredFilters() {
  const f = filterState as Record<string, string | number | boolean>
  // Remove all existing structured filter keys
  for (const key of Object.keys(f)) {
    if (key.startsWith('filter_field_') || key.startsWith('filter_op_') || key.startsWith('filter_value_')) {
      delete f[key]
    }
  }
  // Re-add from current array
  structuredFilters.value.forEach((sf, idx) => {
    f[`filter_field_${idx}`] = sf.field
    f[`filter_op_${idx}`] = sf.operator
    f[`filter_value_${idx}`] = sf.value
  })
  pagination.page = 1
  refresh()
}

function addStructuredFilter() {
  const trimmed = structuredValue.value.trim()
  if (!trimmed) return
  structuredFilters.value.push({
    field: structuredField.value,
    operator: structuredOp.value,
    value: trimmed,
  })
  structuredValue.value = ''
  syncStructuredFilters()
}

function removeStructuredFilter(index: number) {
  structuredFilters.value.splice(index, 1)
  syncStructuredFilters()
}

/**
 * Extract request ID from a log entry, checking both top-level fields
 * and nested `log.data` fields (matching React's extraction logic).
 */
function getReqId(log: Record<string, unknown>): string {
  const logData = (log.data || {}) as Record<string, unknown>
  return (
    (log.requestId as string) ||
    (log.request_id as string) ||
    (log['x-request-id'] as string) ||
    (logData.requestId as string) ||
    (logData.request_id as string) ||
    (logData['x-request-id'] as string) ||
    ''
  )
}
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Search logs..."
      :summary="`${pagination.total ?? 0} logs`"
      @update:model-value="handleSearch"
    >
      <div class="ss-dash-log-filters">
        <button
          v-for="level in LOG_LEVELS"
          :key="level"
          type="button"
          :class="`ss-dash-log-filter ${levelFilter === level ? 'ss-dash-active' : ''}`"
          @click="handleLevelFilter(level)"
        >
          {{ level }}
        </button>
        <input
          type="text"
          class="ss-dash-filter-input ss-dash-reqid-input"
          placeholder="Filter by request ID..."
          :value="reqIdInput"
          @input="reqIdInput = ($event.target as HTMLInputElement).value"
          @keydown.enter="handleReqIdInputSubmit"
        />
        <button
          v-if="reqIdInput || reqIdFilter"
          type="button"
          class="ss-dash-btn ss-dash-reqid-clear"
          @click="clearReqIdFilter"
        >
          Clear
        </button>
      </div>
    </FilterBar>

    <!-- Structured search panel -->
    <div class="ss-dash-structured-search">
      <select
        class="ss-dash-filter-select"
        :value="structuredField"
        @change="structuredField = ($event.target as HTMLSelectElement).value"
      >
        <option value="level">level</option>
        <option value="message">message</option>
        <option value="request_id">request_id</option>
        <option value="userId">userId</option>
        <option value="email">email</option>
        <option value="path">path</option>
      </select>
      <select
        class="ss-dash-filter-select"
        :value="structuredOp"
        @change="structuredOp = ($event.target as HTMLSelectElement).value"
      >
        <option value="equals">equals</option>
        <option value="contains">contains</option>
        <option value="starts_with">starts with</option>
      </select>
      <input
        class="ss-dash-filter-input"
        placeholder="Value..."
        :value="structuredValue"
        @input="structuredValue = ($event.target as HTMLInputElement).value"
        @keydown.enter="addStructuredFilter"
      />
      <button type="button" class="ss-dash-btn" @click="addStructuredFilter">
        Add
      </button>
    </div>

    <!-- Active filter chips -->
    <div v-if="hasActiveFilters" class="ss-dash-filter-chips">
      <span v-if="levelFilter !== 'all'" class="ss-dash-filter-chip">
        level: {{ levelFilter }}
        <button type="button" class="ss-dash-filter-chip-remove" @click="clearLevelFilter">
          &times;
        </button>
      </span>
      <span v-if="reqIdFilter" class="ss-dash-filter-chip">
        requestId: {{ reqIdFilter.slice(0, 8) }}...
        <button type="button" class="ss-dash-filter-chip-remove" @click="clearReqIdFilter">
          &times;
        </button>
      </span>
      <span v-for="(sf, idx) in structuredFilters" :key="idx" class="ss-dash-filter-chip">
        {{ sf.field }} {{ sf.operator }} "{{ sf.value }}"
        <button type="button" class="ss-dash-filter-chip-remove" @click="removeStructuredFilter(idx)">
          &times;
        </button>
      </span>
    </div>

    <div v-if="error" class="ss-dash-empty">Failed to load logs</div>

    <div v-else-if="loading && !data" class="ss-dash-empty">Loading logs...</div>

    <template v-else-if="logs.length === 0">
      <div class="ss-dash-empty">
        No log entries{{ reqIdFilter ? ` matching request ${reqIdFilter}` : levelFilter !== 'all' ? ` for ${levelFilter}` : '' }}
      </div>
    </template>

    <template v-else>
      <div class="ss-dash-log-entries">
        <div
          v-for="(log, i) in logs"
          :key="(log.id as string) || i"
          class="ss-dash-log-entry"
        >
          <span :class="`ss-dash-log-level ss-dash-log-level-${((log.level as string) || (log.levelName as string) || (log.level_name as string) || 'info').toLowerCase()}`">
            {{ ((log.level as string) || (log.levelName as string) || (log.level_name as string) || 'info').toUpperCase() }}
          </span>
          <span
            class="ss-dash-log-time"
            :title="formatTime(((log.createdAt || log.created_at || log.time || log.timestamp || 0) as string))"
          >
            {{ (log.createdAt || log.created_at || log.time || log.timestamp) ? timeAgo((log.createdAt || log.created_at || log.time || log.timestamp) as string) : '-' }}
          </span>
          <span
            v-if="getReqId(log)"
            class="ss-dash-log-reqid"
            :title="getReqId(log)"
            role="button"
            tabindex="0"
            @click="handleReqIdClick(getReqId(log))"
            @keydown.enter="handleReqIdClick(getReqId(log))"
          >
            {{ getReqId(log).slice(0, 8) }}
          </span>
          <span v-else class="ss-dash-log-reqid-empty">--</span>
          <span class="ss-dash-log-msg">{{ (log.message as string) || (log.msg as string) || '' }}</span>
        </div>
      </div>
    </template>

    <PaginationControls
      v-if="pagination.totalPages > 1"
      :page="pagination.page"
      :last-page="pagination.totalPages"
      :total="pagination.total"
      @page-change="goToPage"
    />
  </div>
</template>
