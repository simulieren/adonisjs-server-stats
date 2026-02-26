<script setup lang="ts">
/**
 * Redis key browser tab for the debug panel.
 */
import { ref, computed } from 'vue'
import JsonViewer from '../../shared/JsonViewer.vue'

interface CacheKey {
  key: string
  type: string
  ttl: number
  size: number
  value?: any
}

const props = defineProps<{
  data: any
}>()

const search = ref('')
const selectedKey = ref<CacheKey | null>(null)

const cacheData = computed(() => {
  return props.data || {}
})

const stats = computed(() => cacheData.value.stats || {})

const keys = computed<CacheKey[]>(() => {
  const arr = cacheData.value.keys || []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter((k: CacheKey) => k.key.toLowerCase().includes(term))
})

function formatTtl(seconds: number): string {
  if (seconds < 0) return 'no expiry'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
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
      <input
        v-model="search"
        class="ss-dbg-search"
        placeholder="Filter keys..."
        type="text"
      />
      <span class="ss-dbg-summary">{{ keys.length }} keys</span>
    </div>

    <!-- Key detail -->
    <div v-if="selectedKey" class="ss-dbg-cache-detail">
      <button class="ss-dbg-close" @click="selectedKey = null">&larr; Back</button>
      <div style="margin-top: 8px;">
        <strong>{{ selectedKey.key }}</strong>
        <span style="color: var(--ss-muted); margin-left: 8px;">
          {{ selectedKey.type }} &middot; TTL: {{ formatTtl(selectedKey.ttl) }}
        </span>
      </div>
      <pre v-if="selectedKey.value !== undefined">{{ JSON.stringify(selectedKey.value, null, 2) }}</pre>
    </div>

    <!-- Key list -->
    <template v-else>
      <div v-if="keys.length === 0" class="ss-dbg-empty">
        No cache keys found
      </div>

      <table v-else class="ss-dbg-table">
        <thead>
          <tr>
            <th>Key</th>
            <th style="width: 60px;">Type</th>
            <th style="width: 70px;">TTL</th>
            <th style="width: 70px;">Size</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="k in keys"
            :key="k.key"
            style="cursor: pointer;"
            @click="selectedKey = k"
          >
            <td style="color: var(--ss-sql-color);">{{ k.key }}</td>
            <td style="color: var(--ss-muted);">{{ k.type }}</td>
            <td style="color: var(--ss-dim);">{{ formatTtl(k.ttl) }}</td>
            <td style="color: var(--ss-dim);">{{ formatSize(k.size) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
