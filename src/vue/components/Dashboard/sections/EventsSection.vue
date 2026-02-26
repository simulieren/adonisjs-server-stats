<script setup lang="ts">
/**
 * Events section for the dashboard.
 */
import { ref, computed } from 'vue'
import { timeAgo } from '../../../../core/index.js'
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

    <table v-else class="ss-dash-table">
      <thead>
        <tr>
          <th style="width: 30px">#</th>
          <th style="width: 250px">Event</th>
          <th>Data</th>
          <th style="width: 100px">Time</th>
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
