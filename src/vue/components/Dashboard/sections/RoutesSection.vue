<script setup lang="ts">
/**
 * Routes section for the dashboard.
 */
import { ref, computed } from 'vue'
import type { RouteRecord } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'

const props = defineProps<{
  data: any
}>()

const search = ref('')

const routes = computed<RouteRecord[]>(() => {
  const arr = props.data?.data || props.data?.routes || props.data || []
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

// Group routes by controller
const groupedByController = computed(() => {
  const groups = new Map<string, RouteRecord[]>()
  for (const route of routes.value) {
    const controller = route.handler.split('.')[0] || 'Other'
    if (!groups.has(controller)) groups.set(controller, [])
    groups.get(controller)!.push(route)
  }
  return groups
})

const collapsedGroups = ref(new Set<string>())

function toggleGroup(controller: string) {
  if (collapsedGroups.value.has(controller)) {
    collapsedGroups.value.delete(controller)
  } else {
    collapsedGroups.value.add(controller)
  }
}
</script>

<template>
  <div>
    <FilterBar
      v-model="search"
      placeholder="Filter routes..."
      :summary="`${routes.length} routes`"
    />

    <div v-if="routes.length === 0" class="ss-dash-empty">
      No routes found
    </div>

    <table v-else class="ss-dash-table">
      <thead>
        <tr>
          <th style="width: 70px;">Method</th>
          <th>Pattern</th>
          <th style="width: 120px;">Name</th>
          <th>Handler</th>
          <th>Middleware</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="[controller, groupRoutes] in groupedByController" :key="controller">
          <tr
            style="cursor: pointer;"
            @click="toggleGroup(controller)"
          >
            <td
              colspan="5"
              style="background: var(--ss-surface-alt); font-weight: 600; color: var(--ss-text-secondary); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;"
            >
              {{ collapsedGroups.has(controller) ? '\u25B6' : '\u25BC' }}
              {{ controller }}
              <span style="color: var(--ss-dim); margin-left: 8px;">{{ groupRoutes.length }}</span>
            </td>
          </tr>
          <template v-if="!collapsedGroups.has(controller)">
            <tr v-for="(r, i) in groupRoutes" :key="`${controller}-${i}`">
              <td>
                <span :class="`ss-dash-method ss-dash-method-${r.method.toLowerCase()}`">
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
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>
