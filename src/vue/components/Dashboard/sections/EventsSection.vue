<script setup lang="ts">
/**
 * Events section for the dashboard.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { timeAgo } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import type { EventRecord } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'
import JsonViewer from '../../shared/JsonViewer.vue'

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

const events = computed<EventRecord[]>(() => {
  const d = props.data
  if (!d) return []
  return d.data || d.events || d || []
})

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

watch(events, attachResize)
onMounted(attachResize)
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Filter events..."
      :summary="`${props.total} events`"
      @update:model-value="handleSearch"
    />

    <div v-if="events.length === 0" class="ss-dash-empty">No events found</div>

    <table v-else ref="tableRef" class="ss-dash-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Event</th>
          <th>Data</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in events" :key="e.id">
          <td style="color: var(--ss-dim)">{{ e.id }}</td>
          <td class="ss-dash-event-name">{{ e.event }}</td>
          <td>
            <JsonViewer :value="e.data" />
          </td>
          <td class="ss-dash-event-time">{{ timeAgo(e.timestamp) }}</td>
        </tr>
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
