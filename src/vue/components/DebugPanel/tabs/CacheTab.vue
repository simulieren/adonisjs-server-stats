<script setup lang="ts">
/**
 * Redis key browser tab for the debug panel.
 */
import { computed, ref } from 'vue'
import JsonViewer from '../../shared/JsonViewer.vue'
import { formatTtl, formatCacheSize } from '../../../../core/formatters.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import type { CacheStats, CacheEntry } from '../../../../core/types.js'

const props = defineProps<{
  data: { stats?: CacheStats; keys?: CacheEntry[] } | null
}>()

const search = ref('')
const selectedKey = ref<CacheEntry | null>(null)

const cacheData = computed(() => {
  return props.data || {}
})

const stats = computed(() => cacheData.value.stats || ({} as Partial<CacheStats>))

const keys = computed<CacheEntry[]>(() => {
  const arr = cacheData.value.keys || []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter((k: CacheEntry) => k.key.toLowerCase().includes(term))
})

const { tableRef } = useResizableTable(() => keys.value)
</script>

<template>
  <div>
    <div class="ss-dbg-cache-stats">
      <span class="ss-dbg-cache-stat">
        <span class="ss-dbg-cache-stat-label">Hit Rate:</span>
        <span class="ss-dbg-cache-stat-value">{{ (stats.hitRate || 0).toFixed(0) }}%</span>
      </span>
      <span class="ss-dbg-cache-stat">
        <span class="ss-dbg-cache-stat-label">Hits:</span>
        <span class="ss-dbg-cache-stat-value">{{ stats.totalHits || 0 }}</span>
      </span>
      <span class="ss-dbg-cache-stat">
        <span class="ss-dbg-cache-stat-label">Misses:</span>
        <span class="ss-dbg-cache-stat-value">{{ stats.totalMisses || 0 }}</span>
      </span>
      <span class="ss-dbg-cache-stat">
        <span class="ss-dbg-cache-stat-label">Keys:</span>
        <span class="ss-dbg-cache-stat-value">{{ stats.keyCount || 0 }}</span>
      </span>
      <span class="ss-dbg-cache-stat">
        <span class="ss-dbg-cache-stat-label">Memory:</span>
        <span class="ss-dbg-cache-stat-value">{{ (stats.memoryUsedMb || 0).toFixed(1) }}MB</span>
      </span>
    </div>

    <div class="ss-dbg-search-bar">
      <input v-model="search" class="ss-dbg-search" placeholder="Filter keys..." type="text" />
      <span class="ss-dbg-summary">{{ keys.length }} keys</span>
    </div>

    <!-- Key detail -->
    <div v-if="selectedKey" class="ss-dbg-cache-detail">
      <button type="button" class="ss-dbg-btn-clear" @click="selectedKey = null">&larr; Back</button>
      <div style="margin-top: 8px">
        <strong>{{ selectedKey.key }}</strong>
        <span class="ss-dbg-c-muted" style="margin-left: 8px">
          {{ selectedKey.type }} &middot; TTL: {{ formatTtl(selectedKey.ttl) }}
        </span>
      </div>
      <pre v-if="selectedKey.value !== undefined">{{
        JSON.stringify(selectedKey.value, null, 2)
      }}</pre>
    </div>

    <!-- Key list -->
    <template v-else>
      <div v-if="keys.length === 0" class="ss-dbg-empty">No cache keys found</div>

      <table v-else ref="tableRef" class="ss-dbg-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Type</th>
            <th>TTL</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.key" class="ss-dbg-email-row" @click="selectedKey = k">
            <td class="ss-dbg-c-sql">{{ k.key }}</td>
            <td class="ss-dbg-c-muted">{{ k.type }}</td>
            <td class="ss-dbg-c-dim">{{ formatTtl(k.ttl) }}</td>
            <td class="ss-dbg-c-dim">{{ formatCacheSize(k.size) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
