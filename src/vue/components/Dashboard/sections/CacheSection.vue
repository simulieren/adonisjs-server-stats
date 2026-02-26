<script setup lang="ts">
/**
 * Redis browser section for the dashboard.
 */
import { ref, computed } from 'vue'
import FilterBar from '../shared/FilterBar.vue'

interface CacheKey {
  key: string
  type: string
  ttl: number
  size: number
  value?: any
}

const props = defineProps<{
  data: any
  onDeleteKey?: (key: string) => Promise<boolean>
}>()

const search = ref('')
const selectedKey = ref<CacheKey | null>(null)

const cacheData = computed(() => props.data || {})
const stats = computed(() => cacheData.value.stats || {})

const keys = computed<CacheKey[]>(() => {
  const arr = cacheData.value.data || cacheData.value.keys || []
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

async function handleDelete(key: string) {
  if (props.onDeleteKey) {
    const success = await props.onDeleteKey(key)
    if (success) {
      selectedKey.value = null
    }
  }
}
</script>

<template>
  <div>
    <!-- Stats bar -->
    <div class="ss-dash-cache-stats">
      <span class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Hit Rate:</span>
        <span class="ss-dash-cache-stat-value">{{ (stats.hitRate || 0).toFixed(0) }}%</span>
      </span>
      <span class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Hits:</span>
        <span class="ss-dash-cache-stat-value">{{ stats.totalHits || 0 }}</span>
      </span>
      <span class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Misses:</span>
        <span class="ss-dash-cache-stat-value">{{ stats.totalMisses || 0 }}</span>
      </span>
      <span class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Keys:</span>
        <span class="ss-dash-cache-stat-value">{{ stats.keyCount || 0 }}</span>
      </span>
      <span class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Memory:</span>
        <span class="ss-dash-cache-stat-value">{{ (stats.memoryUsedMb || 0).toFixed(1) }}MB</span>
      </span>
    </div>

    <FilterBar
      v-model="search"
      placeholder="Filter keys..."
      :summary="`${keys.length} keys`"
    />

    <!-- Key detail -->
    <div v-if="selectedKey" class="ss-dash-cache-detail">
      <div class="ss-dash-cache-detail-header">
        <button class="ss-dash-action-btn" @click="selectedKey = null">&larr; Back</button>
        <strong style="margin-left: 8px;">{{ selectedKey.key }}</strong>
        <span style="color: var(--ss-muted); margin-left: 8px;">
          {{ selectedKey.type }} | TTL: {{ formatTtl(selectedKey.ttl) }} | Size: {{ formatSize(selectedKey.size) }}
        </span>
        <button
          v-if="onDeleteKey"
          class="ss-dash-danger-btn"
          @click="handleDelete(selectedKey.key)"
        >
          Delete
        </button>
      </div>
      <pre v-if="selectedKey.value !== undefined" class="ss-dash-cache-value">{{ JSON.stringify(selectedKey.value, null, 2) }}</pre>
    </div>

    <!-- Key list -->
    <template v-else>
      <div v-if="keys.length === 0" class="ss-dash-empty">
        No cache keys found
      </div>

      <table v-else class="ss-dash-table">
        <thead>
          <tr>
            <th>Key</th>
            <th style="width: 60px;">Type</th>
            <th style="width: 80px;">TTL</th>
            <th style="width: 80px;">Size</th>
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
