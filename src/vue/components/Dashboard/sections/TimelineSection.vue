<script setup lang="ts">
/**
 * Timeline/traces section for the dashboard.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { formatDuration, timeAgo } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import type { TraceRecord } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'
import WaterfallChart from '../shared/WaterfallChart.vue'

const props = defineProps<{
  data: any
  page: number
  perPage: number
  total: number
}>()

const emit = defineEmits<{
  goToPage: [page: number]
  search: [term: string]
}>()

const search = ref('')
const selectedTraceId = ref<number | null>(null)

const traces = computed<TraceRecord[]>(() => {
  const d = props.data
  if (!d) return []
  return d.data || d.traces || d || []
})

const selectedTrace = computed(() => traces.value.find((t) => t.id === selectedTraceId.value))

function toggleTrace(id: number) {
  selectedTraceId.value = selectedTraceId.value === id ? null : id
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

watch(traces, attachResize)
onMounted(attachResize)
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Filter traces..."
      :summary="`${props.total} traces`"
      @update:model-value="handleSearch"
    />

    <div v-if="traces.length === 0" class="ss-dash-empty">No traces found</div>

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
        <template v-for="t in traces" :key="t.id">
          <tr style="cursor: pointer" @click="toggleTrace(t.id)">
            <td style="color: var(--ss-dim)">{{ t.id }}</td>
            <td>
              <span :class="`ss-dash-method ss-dash-method-${t.method.toLowerCase()}`">
                {{ t.method }}
              </span>
            </td>
            <td style="color: var(--ss-text)">{{ t.url }}</td>
            <td>
              <span :class="`ss-dash-status ss-dash-status-${Math.floor(t.statusCode / 100)}xx`">
                {{ t.statusCode }}
              </span>
            </td>
            <td class="ss-dash-duration">{{ formatDuration(t.totalDuration) }}</td>
            <td style="color: var(--ss-muted); text-align: center">{{ t.spanCount }}</td>
            <td class="ss-dash-event-time">{{ timeAgo(t.timestamp) }}</td>
          </tr>
          <!-- Expanded waterfall -->
          <tr v-if="selectedTraceId === t.id">
            <td colspan="7" style="padding: 0">
              <WaterfallChart :spans="t.spans" :total-duration="t.totalDuration" />
              <div v-if="t.warnings && t.warnings.length > 0" class="ss-dash-warnings">
                <div class="ss-dash-warnings-title">Warnings</div>
                <div v-for="(w, wi) in t.warnings" :key="wi" class="ss-dash-warning">
                  {{ w }}
                </div>
              </div>
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
