<script setup lang="ts">
/**
 * Events table tab for the debug panel.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { timeAgo, formatTime } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import { TAB_ICONS } from '../../../../core/icons.js'
import type { EventRecord } from '../../../../core/index.js'
import JsonViewer from '../../shared/JsonViewer.vue'

const props = defineProps<{
  data: { events?: EventRecord[] } | EventRecord[] | null
  dashboardPath?: string
}>()

const search = ref('')

const events = computed<EventRecord[]>(() => {
  const d = props.data
  const arr = d ? (Array.isArray(d) ? d : d.events) || [] : []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter(
    (e: EventRecord) =>
      e.event.toLowerCase().includes(term) || (e.data && e.data.toLowerCase().includes(term))
  )
})

const summary = computed(() => {
  const d = props.data
  const arr = d ? (Array.isArray(d) ? d : d.events) || [] : []
  return `${arr.length} events`
})

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
    <div class="ss-dbg-search-bar">
      <input v-model="search" class="ss-dbg-search" placeholder="Filter events..." type="text" />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="events.length === 0" class="ss-dbg-empty">No events captured</div>

    <table v-else ref="tableRef" class="ss-dbg-table">
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
          <td class="ss-dbg-c-dim" style="white-space: nowrap">{{ e.id }}</td>
          <td class="ss-dbg-event-name">
            {{ e.event }}
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
                :viewBox="TAB_ICONS['open-external'].viewBox"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                v-html="TAB_ICONS['open-external'].elements.join('')"
              ></svg>
            </a>
          </td>
          <td class="ss-dbg-event-data">
            <JsonViewer :value="e.data" class-prefix="ss-dbg" />
          </td>
          <td class="ss-dbg-event-time" :title="formatTime(e.timestamp)">{{ timeAgo(e.timestamp) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
