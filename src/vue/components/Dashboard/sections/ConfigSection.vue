<script setup lang="ts">
/**
 * App config viewer section for the dashboard.
 *
 * Shows sanitized configuration with auto-redacted secrets.
 */
import { ref, computed } from 'vue'
import FilterBar from '../shared/FilterBar.vue'

interface RedactedValue {
  __redacted: true
  __value: string | number | boolean | null
}

type ConfigValue = string | number | boolean | null | undefined | RedactedValue | ConfigValue[] | { [key: string]: ConfigValue }

interface ConfigNode {
  key: string
  value: ConfigValue
  redacted?: boolean
  type: string
}

interface ConfigData {
  config?: Record<string, unknown>
  env?: Record<string, unknown>
  data?: {
    config?: Record<string, unknown>
    env?: Record<string, unknown>
  }
}

const props = defineProps<{
  data: ConfigData | null
}>()

const search = ref('')
const activeTab = ref<'config' | 'env'>('config')
const expandedSections = ref(new Set<string>())
const revealedKeys = ref(new Set<string>())

const configData = computed(() => {
  const d = props.data
  if (!d) return { config: {}, env: {} }
  return {
    config: d.config || d.data?.config || {},
    env: d.env || d.data?.env || {},
  }
})

function getActiveData(): Record<string, unknown> {
  return activeTab.value === 'config' ? configData.value.config : configData.value.env
}

function flattenConfig(obj: Record<string, unknown>, prefix = ''): ConfigNode[] {
  const nodes: ConfigNode[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const isRedacted = value !== null && typeof value === 'object' && !Array.isArray(value) && '__redacted' in value && (value as RedactedValue).__redacted
    if (value && typeof value === 'object' && !Array.isArray(value) && !isRedacted) {
      nodes.push({
        key: fullKey,
        value: value as ConfigValue,
        type: 'section',
      })
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
  const data = getActiveData()
  const nodes = flattenConfig(data)
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
  if (node.redacted && !revealedKeys.value.has(node.key)) {
    return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'
  }
  if (node.value === null) return 'null'
  if (node.value === undefined) return 'undefined'
  if (typeof node.value === 'boolean') return node.value ? 'true' : 'false'
  if (typeof node.value === 'number') return String(node.value)
  if (Array.isArray(node.value)) return `[${node.value.length} items]`
  if (typeof node.value === 'object') {
    const keys = Object.keys(node.value)
    return `{${keys.length} keys}`
  }
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
  const data = getActiveData()
  navigator.clipboard?.writeText(JSON.stringify(data, null, 2))
}
</script>

<template>
  <div>
    <div class="ss-dash-config-tabs">
      <button
        :class="['ss-dash-config-tab', { 'ss-dash-active': activeTab === 'config' }]"
        @click="activeTab = 'config'"
      >
        App Config
      </button>
      <button
        :class="['ss-dash-config-tab', { 'ss-dash-active': activeTab === 'env' }]"
        @click="activeTab = 'env'"
      >
        Environment
      </button>
      <button class="ss-dash-action-btn" @click="copyConfig" style="margin-left: auto">Copy</button>
    </div>

    <FilterBar
      v-model="search"
      placeholder="Filter config keys..."
      :summary="`${filteredNodes.length} entries`"
    />

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
          <span class="ss-dash-config-count"> {{ Object.keys(node.value).length }} keys </span>
        </div>
        <div v-else class="ss-dash-config-section-header ss-dash-config-leaf">
          <span class="ss-dash-config-toggle" style="visibility: hidden">&bull;</span>
          <span class="ss-dash-config-key">{{ node.key }}</span>
          <span :class="valueClass(node)" style="margin-left: auto">
            {{ formatValue(node) }}
          </span>
          <button v-if="node.redacted" class="ss-dash-reveal-btn" @click="toggleReveal(node.key)">
            {{ revealedKeys.has(node.key) ? 'Hide' : 'Reveal' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
