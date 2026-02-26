<script setup lang="ts">
/**
 * Route table tab for the debug panel.
 */
import { ref, computed } from 'vue'
import type { RouteRecord } from '../../../../core/index.js'

const props = defineProps<{
  data: any
  currentUrl?: string
}>()

const search = ref('')

const routes = computed<RouteRecord[]>(() => {
  const arr = props.data?.routes || props.data || []
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
  const arr = props.data?.routes || props.data || []
  return `${arr.length} routes`
})

function isCurrentRoute(route: RouteRecord): boolean {
  if (!props.currentUrl) return false
  return props.currentUrl.includes(route.pattern.replace(/:[^/]+/g, ''))
}
</script>

<template>
  <div>
    <div class="ss-dbg-search-bar">
      <input
        v-model="search"
        class="ss-dbg-search"
        placeholder="Filter routes..."
        type="text"
      />
      <span class="ss-dbg-summary">{{ summary }}</span>
    </div>

    <div v-if="routes.length === 0" class="ss-dbg-empty">
      No routes found
    </div>

    <table v-else class="ss-dbg-table">
      <thead>
        <tr>
          <th style="width: 70px;">Method</th>
          <th>Pattern</th>
          <th style="width: 100px;">Name</th>
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
          <td style="color: var(--ss-text);">{{ r.pattern }}</td>
          <td style="color: var(--ss-muted);">{{ r.name || '-' }}</td>
          <td style="color: var(--ss-text-secondary);">{{ r.handler }}</td>
          <td style="color: var(--ss-dim); font-size: 10px;">
            {{ r.middleware.length > 0 ? r.middleware.join(', ') : '-' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
