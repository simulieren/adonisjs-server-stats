<script setup lang="ts">
/**
 * Events section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React EventsSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { timeAgo, formatTime } from '../../../../core/index.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'
import JsonViewer from '../../shared/JsonViewer.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const { data, loading, pagination, goToPage, setSearch } = useDashboardData(() => 'events', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')

const events = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  const d = data.value as Record<string, unknown>
  return (d.data || d.events || data.value || []) as Record<string, unknown>[]
})

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

const { tableRef } = useResizableTable(() => events.value)
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Filter events..."
      :summary="`${pagination.total ?? 0} events`"
      @update:model-value="handleSearch"
    />

    <div v-if="loading && !data" class="ss-dash-empty">Loading events...</div>

    <template v-else>
      <div class="ss-dash-table-wrap">
        <table v-if="events.length > 0" ref="tableRef" class="ss-dash-table">
          <colgroup>
            <col style="width: 40px" />
            <col />
            <col />
            <col style="width: 80px" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Event</th>
              <th>Data</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in events" :key="e.id as string">
              <td>
                <span style="color: var(--ss-dim)">{{ e.id }}</span>
              </td>
              <td>
                <span
                  class="ss-dash-event-name"
                  :title="
                    ((e.event_name as string) ||
                      (e.eventName as string) ||
                      (e.event as string) ||
                      '') as string
                  "
                  style="
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    display: block;
                  "
                >
                  {{
                    (e.event_name as string) || (e.eventName as string) || (e.event as string) || ''
                  }}
                </span>
              </td>
              <td>
                <JsonViewer :value="e.data" class="ss-dash-event-data" />
              </td>
              <td>
                <span
                  class="ss-dash-event-time"
                  :title="
                    formatTime(
                      ((e.createdAt as string) ||
                        (e.created_at as string) ||
                        (e.timestamp as string)) as string
                    )
                  "
                >
                  {{
                    timeAgo(
                      ((e.createdAt as string) ||
                        (e.created_at as string) ||
                        (e.timestamp as string)) as string
                    )
                  }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">No events recorded yet</div>
      </div>
      <PaginationControls
        v-if="pagination.totalPages > 1"
        :page="pagination.page"
        :last-page="pagination.totalPages"
        :total="pagination.total"
        @page-change="goToPage"
      />
    </template>
  </div>
</template>
