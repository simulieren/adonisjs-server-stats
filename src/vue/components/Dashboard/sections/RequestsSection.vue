<script setup lang="ts">
/**
 * Request history section for the dashboard.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { formatDuration, statusColor, timeAgo } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import type { TraceRecord } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'
import WaterfallChart from '../shared/WaterfallChart.vue'

interface RequestRecord extends TraceRecord {
  status_code?: number
  duration?: number
  span_count?: number
  createdAt?: number
  created_at?: number
}

interface RequestsData {
  data?: RequestRecord[]
  requests?: RequestRecord[]
}

const props = defineProps<{
  data: RequestsData | RequestRecord[] | null
  page: number
  perPage: number
  total: number
}>()

const emit = defineEmits<{
  goToPage: [page: number]
  search: [term: string]
}>()

const search = ref('')
const expandedId = ref<number | null>(null)

const requests = computed(() => {
  const d = props.data
  if (!d) return []
  return d.data || d.requests || d || []
})

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function handleSearch(term: string) {
  search.value = term
  emit('search', term)
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

watch(requests, attachResize)
onMounted(attachResize)
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Filter by URL, method, or status..."
      :summary="`${props.total} requests`"
      @update:model-value="handleSearch"
    />

    <div v-if="requests.length === 0" class="ss-dash-empty">No requests found</div>

    <table v-else ref="tableRef" class="ss-dash-table">
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
        <template v-for="r in requests" :key="r.id">
          <tr style="cursor: pointer" @click="toggleExpand(r.id)">
            <td style="color: var(--ss-dim)">{{ r.id }}</td>
            <td>
              <span :class="`ss-dash-method ss-dash-method-${(r.method || '').toLowerCase()}`">
                {{ r.method }}
              </span>
            </td>
            <td style="color: var(--ss-text)">{{ r.url }}</td>
            <td>
              <span
                :class="`ss-dash-status ss-dash-status-${Math.floor((r.statusCode || r.status_code || 200) / 100)}xx`"
              >
                {{ r.statusCode || r.status_code }}
              </span>
            </td>
            <td class="ss-dash-duration">
              {{ formatDuration(r.totalDuration || r.duration || 0) }}
            </td>
            <td style="color: var(--ss-muted); text-align: center">
              {{ r.spanCount || r.span_count || 0 }}
            </td>
            <td class="ss-dash-event-time">
              {{ timeAgo(r.timestamp || r.createdAt || r.created_at) }}
            </td>
          </tr>
          <!-- Expanded waterfall -->
          <tr v-if="expandedId === r.id && r.spans">
            <td colspan="7" style="padding: 0">
              <WaterfallChart
                :spans="r.spans"
                :total-duration="r.totalDuration || r.duration || 1"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <PaginationControls
      :page="props.page"
      :per-page="props.perPage"
      :total="props.total"
      @go-to-page="emit('goToPage', $event)"
    />
  </div>
</template>
