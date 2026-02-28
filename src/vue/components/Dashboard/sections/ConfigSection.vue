<script setup lang="ts">
/**
 * App config viewer section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React ConfigSection / ConfigContent.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { useDashboardData } from '../../../composables/useDashboardData.js'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const baseUrl = inject<string>('ss-base-url', '')
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)

interface RedactedValue {
  __redacted: true
  __value: string | number | boolean | null
}

type ConfigValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RedactedValue
  | ConfigValue[]
  | { [key: string]: ConfigValue }

interface ConfigNode {
  key: string
  value: ConfigValue
  redacted?: boolean
  type: string
}

const {
  data,
  loading,
} = useDashboardData(() => 'config', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const searchInput = ref('')
const search = ref('')
const activeTab = ref<'app' | 'env'>('app')
const expandedSections = ref(new Set<string>())
const revealedKeys = ref(new Set<string>())
const copyLabel = ref('Copy JSON')

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput(val: string) {
  searchInput.value = val
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = val
  }, 200)
}

const configData = computed(() => {
  const d = data.value as Record<string, unknown> | null
  if (!d) return { app: {} as Record<string, unknown>, env: {} as Record<string, unknown> }
  const inner = (d.data || d) as Record<string, unknown>
  return {
    app: (inner.app || d.app || {}) as Record<string, unknown>,
    env: (inner.env || d.env || {}) as Record<string, unknown>,
  }
})

function getActiveData(): Record<string, unknown> {
  return activeTab.value === 'app' ? configData.value.app : configData.value.env
}

function flattenConfig(obj: Record<string, unknown>, prefix = ''): ConfigNode[] {
  const nodes: ConfigNode[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const isRedacted =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '__redacted' in (value as Record<string, unknown>) &&
      (value as RedactedValue).__redacted
    if (value && typeof value === 'object' && !Array.isArray(value) && !isRedacted) {
      nodes.push({ key: fullKey, value: value as ConfigValue, type: 'section' })
    } else {
      nodes.push({
        key: fullKey,
        value: isRedacted ? (value as RedactedValue).__value : (value as ConfigValue),
        redacted: isRedacted || false,
        type: typeof value,
      })
    }
  }
  return nodes
}

const filteredNodes = computed(() => {
  const d = getActiveData()
  const nodes = flattenConfig(d)
  if (!search.value.trim()) return nodes
  const term = search.value.toLowerCase()
  return nodes.filter((n) => n.key.toLowerCase().includes(term))
})

function toggleSection(key: string) {
  if (expandedSections.value.has(key)) {
    expandedSections.value.delete(key)
  } else {
    expandedSections.value.add(key)
  }
}

function toggleReveal(key: string) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

function formatValue(node: ConfigNode): string {
  if (node.redacted && !revealedKeys.value.has(node.key)) return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'
  if (node.value === null) return 'null'
  if (node.value === undefined) return 'undefined'
  if (typeof node.value === 'boolean') return node.value ? 'true' : 'false'
  if (typeof node.value === 'number') return String(node.value)
  if (Array.isArray(node.value)) return `[${node.value.length} items]`
  if (typeof node.value === 'object') return `{${Object.keys(node.value as Record<string, unknown>).length} keys}`
  return String(node.value)
}

function valueClass(node: ConfigNode): string {
  if (node.redacted && !revealedKeys.value.has(node.key)) return 'ss-dash-config-redacted'
  if (node.value === true) return 'ss-dash-config-val-true'
  if (node.value === false) return 'ss-dash-config-val-false'
  if (typeof node.value === 'number') return 'ss-dash-config-val-number'
  if (Array.isArray(node.value)) return 'ss-dash-config-val-array'
  if (node.value === null) return 'ss-dash-config-val-null'
  return 'ss-dash-config-val'
}

function copyConfig() {
  const d = getActiveData()
  navigator.clipboard?.writeText(JSON.stringify(d, null, 2)).then(() => {
    copyLabel.value = 'Copied!'
    setTimeout(() => {
      copyLabel.value = 'Copy JSON'
    }, 1500)
  })
}

function collectTopLevelObjectKeys(obj: Record<string, unknown>): string[] {
  const keys: string[] = []
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !('__redacted' in (value as Record<string, unknown>))) {
      keys.push(key)
    }
  }
  return keys
}

function expandAll() {
  const source = activeTab.value === 'app' ? configData.value.app : configData.value.env
  const allKeys = collectTopLevelObjectKeys(source)
  expandedSections.value = new Set(allKeys)
}

function collapseAll() {
  expandedSections.value = new Set()
}
</script>

<template>
  <div>
    <div v-if="loading && !data" class="ss-dash-empty">Loading config...</div>

    <template v-else>
      <div class="ss-dash-config-toolbar">
        <button
          type="button"
          :class="`ss-dash-config-tab${activeTab === 'app' ? ' ss-dash-active' : ''}`"
          @click="activeTab = 'app'"
        >
          App Config
        </button>
        <button
          type="button"
          :class="`ss-dash-config-tab${activeTab === 'env' ? ' ss-dash-active' : ''}`"
          @click="activeTab = 'env'"
        >
          Env
        </button>

        <div style="position: relative; flex: 1">
          <input
            type="text"
            class="ss-dash-search"
            placeholder="Search keys and values..."
            :value="searchInput"
            style="width: 100%"
            @input="onSearchInput(($event.target as HTMLInputElement).value)"
          />
          <button
            v-if="searchInput"
            type="button"
            style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: var(--ss-dim); padding: 0 2px; line-height: 1"
            @click="searchInput = ''; search = ''"
          >
            &times;
          </button>
        </div>

        <template v-if="activeTab === 'app' && !search">
          <button type="button" class="ss-dash-btn" @click="expandAll">Expand All</button>
          <button type="button" class="ss-dash-btn" @click="collapseAll">Collapse All</button>
        </template>
        <button type="button" class="ss-dash-btn" @click="copyConfig">{{ copyLabel }}</button>
      </div>

      <div v-if="filteredNodes.length === 0" class="ss-dash-empty">No config entries</div>

      <div v-else class="ss-dash-config-sections">
        <div v-for="node in filteredNodes" :key="node.key" class="ss-dash-config-section">
          <div
            v-if="node.type === 'section'"
            class="ss-dash-config-section-header"
            @click="toggleSection(node.key)"
          >
            <span class="ss-dash-config-toggle">
              {{ expandedSections.has(node.key) ? '\u25BC' : '\u25B6' }}
            </span>
            <span class="ss-dash-config-key">{{ node.key }}</span>
            <span class="ss-dash-config-count">
              {{ Object.keys(node.value as Record<string, unknown>).length }} keys
            </span>
          </div>
          <div v-else class="ss-dash-config-section-header ss-dash-config-leaf">
            <span class="ss-dash-config-toggle" style="visibility: hidden">&bull;</span>
            <span class="ss-dash-config-key">{{ node.key }}</span>
            <span :class="valueClass(node)" style="margin-left: auto">
              {{ formatValue(node) }}
            </span>
            <button
              v-if="node.redacted"
              class="ss-dash-reveal-btn"
              @click="toggleReveal(node.key)"
            >
              {{ revealedKeys.has(node.key) ? 'Hide' : 'Reveal' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
