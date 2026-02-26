<script setup lang="ts">
/**
 * Events table tab for the debug panel.
 */
import { ref, computed } from 'vue'
import { timeAgo } from '../../../../core/index.js'
import type { EventRecord } from '../../../../core/index.js'
import JsonViewer from '../../shared/JsonViewer.vue'

const props = defineProps<{
  data: any
  dashboardPath?: string
}>()

const search = ref('')

const events = computed<EventRecord[]>(() => {
  const arr = props.data?.events || props.data || []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter(
    (e: EventRecord) =>
      e.event.toLowerCase().includes(term) || (e.data && e.data.toLowerCase().includes(term))
  )
})

const summary = computed(() => {
  const arr = props.data?.events || props.data || []
  return `${arr.length} events`
})
</script>

<template>
  <div>
    <div class="ss-dbg-search-bar">
      <input v-model="search" class="ss-dbg-search" placeholder="Filter events..." type="text" />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="events.length === 0" class="ss-dbg-empty">No events captured</div>

    <table v-else class="ss-dbg-table">
      <thead>
        <tr>
          <th style="width: 30px">#</th>
          <th>Event</th>
          <th>Data</th>
          <th style="width: 80px">Time</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in events" :key="e.id">
          <td style="color: var(--ss-dim)">{{ e.id }}</td>
          <td>
            <span class="ss-dbg-event-name">{{ e.event }}</span>
            <a
              v-if="dashboardPath"
              :href="`${dashboardPath}#events?id=${e.id}`"
              target="_blank"
              class="ss-dbg-deeplink"
            >
              <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 3H3v10h10v-3M9 1h6v6M7 9L15 1" />
              </svg>
            </a>
          </td>
          <td>
            <JsonViewer :value="e.data" />
          </td>
          <td class="ss-dbg-event-time">{{ timeAgo(e.timestamp) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
