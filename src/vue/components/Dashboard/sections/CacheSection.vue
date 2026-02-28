<script setup lang="ts">
/**
 * Cache inspector section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React CacheSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { ApiClient, DashboardApi } from '../../../../core/index.js'
import JsonViewer from '../../shared/JsonViewer.vue'
import FilterBar from '../shared/FilterBar.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

interface CacheStats {
  connected?: boolean
  hits?: number
  misses?: number
  hitRate?: number
  memoryUsedBytes?: number
  memoryUsedHuman?: string
  connectedClients?: number
  totalKeys?: number
  keyCount?: number
}

interface CacheKeyEntry {
  key: string
  type: string
  ttl: number
  size?: number | null
}

interface CacheResponse {
  available?: boolean
  stats?: CacheStats | null
  keys?: CacheKeyEntry[]
  data?: CacheKeyEntry[]
  cursor?: string
}

const {
  data,
  loading,
  setSearch,
  mutate,
} = useDashboardData(() => 'cache', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const cacheClient = new ApiClient({ baseUrl: baseUrl || '', authToken })
const cacheApi = new DashboardApi(cacheClient, dashboardEndpoint || '/__stats/api')

const search = ref('')
const selectedKey = ref<string | null>(null)
const keyValue = ref<unknown>(null)
const keyValueLoading = ref(false)
const keyValueError = ref<string | null>(null)

const cacheData = computed<CacheResponse | null>(() => {
  return data.value as CacheResponse | null
})

const keys = computed<CacheKeyEntry[]>(() => {
  return cacheData.value?.keys || cacheData.value?.data || []
})

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

async function handleDelete(key: string) {
  if (!confirm(`Delete cache key "${key}"?`)) return
  try {
    await mutate(`cache/${encodeURIComponent(key)}`, 'delete')
    if (selectedKey.value === key) {
      selectedKey.value = null
      keyValue.value = null
      keyValueError.value = null
    }
  } catch {
    // silently fail
  }
}

async function handleKeyClick(key: string) {
  if (selectedKey.value === key) {
    selectedKey.value = null
    keyValue.value = null
    keyValueError.value = null
    return
  }
  selectedKey.value = key
  keyValue.value = null
  keyValueError.value = null
  keyValueLoading.value = true
  try {
    const result = await cacheApi.fetchCacheKey(key)
    keyValue.value =
      result.value !== undefined ? result.value :
      result.data !== undefined ? result.data : result
    keyValueError.value = null
  } catch {
    keyValue.value = null
    keyValueError.value = 'Failed to fetch key value'
  } finally {
    keyValueLoading.value = false
  }
}
</script>

<template>
  <div>
    <!-- Stats -->
    <div v-if="cacheData?.available && cacheData?.stats" class="ss-dash-cache-stats">
      <div class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Hit Rate:</span>
        <span class="ss-dash-cache-stat-value">{{ (cacheData.stats.hitRate ?? 0).toFixed(1) }}%</span>
      </div>
      <div class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Hits:</span>
        <span class="ss-dash-cache-stat-value">{{ cacheData.stats.hits ?? 0 }}</span>
      </div>
      <div class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Misses:</span>
        <span class="ss-dash-cache-stat-value">{{ cacheData.stats.misses ?? 0 }}</span>
      </div>
      <div class="ss-dash-cache-stat">
        <span class="ss-dash-cache-stat-label">Keys:</span>
        <span class="ss-dash-cache-stat-value">
          {{ cacheData.stats.totalKeys || cacheData.stats.keyCount || keys.length || 0 }}
        </span>
      </div>
    </div>

    <FilterBar
      :model-value="search"
      placeholder="Filter cache keys..."
      :summary="`${keys.length} keys`"
      @update:model-value="handleSearch"
    />

    <div v-if="loading && !data" class="ss-dash-empty">Loading cache...</div>

    <div v-else-if="!cacheData || !cacheData.available" class="ss-dash-empty">
      Cache inspector not available
    </div>

    <template v-else>
      <div class="ss-dash-table-wrap">
        <table v-if="keys.length > 0" class="ss-dash-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Type</th>
              <th>Size</th>
              <th>TTL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="k in keys"
              :key="k.key"
              class="ss-dash-clickable"
              @click="handleKeyClick(k.key)"
            >
              <td>
                <span
                  :title="k.key"
                  style="color: var(--ss-sql-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block"
                >
                  {{ k.key }}
                </span>
              </td>
              <td><span style="color: var(--ss-muted)">{{ k.type }}</span></td>
              <td>{{ k.size !== null && k.size !== undefined ? k.size + 'B' : '-' }}</td>
              <td>{{ k.ttl > 0 ? `${k.ttl}s` : '-' }}</td>
              <td>
                <button
                  type="button"
                  class="ss-dash-retry-btn"
                  @click.stop="handleDelete(k.key)"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="ss-dash-empty">No cache keys found</div>
      </div>
    </template>

    <!-- Key value detail -->
    <div v-if="selectedKey" class="ss-dash-cache-detail">
      <h4>Key: {{ selectedKey }}</h4>
      <div v-if="keyValueLoading" class="ss-dash-empty">Loading value...</div>
      <div v-else-if="keyValueError" class="ss-dash-empty" style="color: var(--ss-red-fg)">
        {{ keyValueError }}
      </div>
      <JsonViewer v-else :value="keyValue" />
    </div>
  </div>
</template>
