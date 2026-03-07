<script setup lang="ts">
/**
 * Route table tab for the debug panel.
 */
import { computed, ref } from 'vue'
import type { RouteRecord } from '../../../../core/index.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'

const props = defineProps<{
  data: { routes?: RouteRecord[] } | RouteRecord[] | null
  currentUrl?: string
}>()

const search = ref('')

const routes = computed<RouteRecord[]>(() => {
  const d = props.data
  const arr = d ? (Array.isArray(d) ? d : d.routes) || [] : []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter(
    (r: RouteRecord) =>
      r.pattern.toLowerCase().includes(term) ||
      r.handler.toLowerCase().includes(term) ||
      r.method.toLowerCase().includes(term) ||
      (r.name && r.name.toLowerCase().includes(term))
  )
})

const summary = computed(() => {
  const d = props.data
  const arr = d ? (Array.isArray(d) ? d : d.routes) || [] : []
  return `${arr.length} routes`
})

function isCurrentRoute(route: RouteRecord): boolean {
  if (!props.currentUrl) return false
  return props.currentUrl.includes(route.pattern.replace(/:[^/]+/g, ''))
}

const { tableRef } = useResizableTable(() => routes.value)
</script>

<template>
  <div>
    <div class="ss-dbg-search-bar">
      <input v-model="search" class="ss-dbg-search" placeholder="Filter routes..." type="text" />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="routes.length === 0" class="ss-dbg-empty">No routes found</div>

    <table v-else ref="tableRef" class="ss-dbg-table">
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
        <tr
          v-for="(r, i) in routes"
          :key="i"
          :class="{ 'ss-dbg-current-route': isCurrentRoute(r) }"
        >
          <td>
            <span :class="`ss-dbg-method ss-dbg-method-${r.method.toLowerCase()}`">
              {{ r.method }}
            </span>
          </td>
          <td class="ss-dbg-c-text">{{ r.pattern }}</td>
          <td class="ss-dbg-c-muted">{{ r.name || '-' }}</td>
          <td class="ss-dbg-c-sql">{{ r.handler }}</td>
          <td class="ss-dbg-c-dim" style="font-size: 10px">
            {{ r.middleware.length > 0 ? r.middleware.join(', ') : '-' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
