<script setup lang="ts">
/**
 * SQL queries table tab for the debug panel.
 */
import { ref, computed, watch } from 'vue'
import { formatDuration, durationSeverity, timeAgo } from '../../../../core/index.js'
import type { QueryRecord } from '../../../../core/index.js'

const props = defineProps<{
  data: any
  dashboardPath?: string
}>()

const search = ref('')
const expandedIds = new Set<number>()

const queries = computed<QueryRecord[]>(() => {
  if (!props.data) return []
  const arr = props.data.queries || props.data || []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter(
    (q: QueryRecord) =>
      q.sql.toLowerCase().includes(term) ||
      (q.model && q.model.toLowerCase().includes(term)) ||
      q.method.toLowerCase().includes(term)
  )
})

const summary = computed(() => {
  const arr = props.data?.queries || props.data || []
  return `${arr.length} queries`
})

function toggleExpand(id: number) {
  if (expandedIds.has(id)) {
    expandedIds.delete(id)
  } else {
    expandedIds.add(id)
  }
}

function isExpanded(id: number) {
  return expandedIds.has(id)
}

function durationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dbg-very-slow'
  if (sev === 'slow') return 'ss-dbg-slow'
  return ''
}
</script>

<template>
  <div>
    <div class="ss-dbg-search-bar">
      <input v-model="search" class="ss-dbg-search" placeholder="Filter queries..." type="text" />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="queries.length === 0" class="ss-dbg-empty">No queries captured</div>

    <table v-else class="ss-dbg-table">
      <thead>
        <tr>
          <th style="width: 30px">#</th>
          <th>SQL</th>
          <th style="width: 60px">Method</th>
          <th style="width: 80px">Model</th>
          <th style="width: 70px">Duration</th>
          <th style="width: 80px">Time</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="q in queries" :key="q.id">
          <td style="color: var(--ss-dim)">{{ q.id }}</td>
          <td>
            <span
              :class="['ss-dbg-sql', { 'ss-dbg-expanded': isExpanded(q.id) }]"
              @click="toggleExpand(q.id)"
            >
              {{ q.sql }}
            </span>
            <a
              v-if="dashboardPath"
              :href="`${dashboardPath}#queries?id=${q.id}`"
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
            <span :class="`ss-dbg-method ss-dbg-method-${q.method.toLowerCase()}`">
              {{ q.method }}
            </span>
          </td>
          <td style="color: var(--ss-text-secondary)">{{ q.model || '-' }}</td>
          <td>
            <span :class="['ss-dbg-duration', durationClass(q.duration)]">
              {{ formatDuration(q.duration) }}
            </span>
          </td>
          <td class="ss-dbg-event-time">{{ timeAgo(q.timestamp) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
