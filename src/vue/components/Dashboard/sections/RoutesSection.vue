<script setup lang="ts">
/**
 * Routes section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React RoutesSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import FilterBar from '../shared/FilterBar.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const {
  data,
  loading,
  error,
  setSearch,
} = useDashboardData(() => 'routes', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')

const routes = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  const raw = data.value as Record<string, unknown> | Record<string, unknown>[]
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw.routes)) return raw.routes as Record<string, unknown>[]
  if (Array.isArray(raw.data)) return raw.data as Record<string, unknown>[]
  return []
})

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

const { tableRef } = useResizableTable(() => routes.value)
</script>

<template>
  <div>
    <FilterBar
      :model-value="search"
      placeholder="Filter routes..."
      :summary="`${routes.length} routes`"
      @update:model-value="handleSearch"
    />

    <div v-if="error" class="ss-dash-empty">Failed to load routes</div>

    <div v-else-if="loading && !data" class="ss-dash-empty">Loading routes...</div>

    <template v-else>
      <div class="ss-dash-table-wrap">
        <table v-if="routes.length > 0" ref="tableRef" class="ss-dash-table">
          <colgroup>
            <col style="width: 70px" />
            <col />
            <col style="width: 120px" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Method</th>
              <th>Pattern</th>
              <th>Name</th>
              <th>Handler</th>
              <th>Middleware</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in routes" :key="(r.pattern as string) || i">
              <td>
                <span :class="`ss-dash-method ss-dash-method-${((r.method as string) || '').toLowerCase()}`">
                  {{ r.method }}
                </span>
              </td>
              <td>
                <span
                  style="color: var(--ss-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  :title="(r.pattern as string)"
                >
                  {{ r.pattern }}
                </span>
              </td>
              <td>
                <span
                  style="color: var(--ss-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  :title="(r.name as string) || '-'"
                >
                  {{ (r.name as string) || '-' }}
                </span>
              </td>
              <td>
                <span
                  style="color: var(--ss-sql-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  :title="(r.handler as string)"
                >
                  {{ r.handler }}
                </span>
              </td>
              <td>
                <span
                  style="color: var(--ss-dim); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
                  :title="(r.middleware as string[])?.length ? (r.middleware as string[]).join(', ') : '-'"
                >
                  {{ (r.middleware as string[])?.length ? (r.middleware as string[]).join(', ') : '-' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">No routes available</div>
      </div>
    </template>
  </div>
</template>
