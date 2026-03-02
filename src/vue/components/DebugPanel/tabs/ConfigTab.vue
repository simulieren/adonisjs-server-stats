<script setup lang="ts">
/**
 * Config tab for the debug panel.
 *
 * Displays application config and environment variables from the
 * dashboard API (`/api/config`). Two sub-tabs: "App Config" (collapsible
 * tree with grouped key-value tables) and "Environment" (flat table).
 *
 * Data is fetched by the parent DebugPanel via useDebugData (routed to
 * the dashboard API because 'config' is in the DASHBOARD_TABS set).
 */
import { ref, computed, watch } from 'vue'
import { matchesConfigSearch, shouldRedact } from '../../../../core/config-utils.js'
import type { ConfigValue } from '../../../../core/config-utils.js'

interface ConfigData {
  app?: Record<string, ConfigValue>
  env?: Record<string, ConfigValue>
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps<{
  data: ConfigData | null
}>()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeSubTab = ref<'app' | 'env'>('app')
const searchRaw = ref('')
const searchDebounced = ref('')
const showRedacted = ref(false)
const expandedSections = ref(new Set<string>())
const copiedKey = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

// Debounce search input by 200ms
watch(searchRaw, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    searchDebounced.value = val.trim().toLowerCase()
  }, 200)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRedacted(key: string): boolean {
  return shouldRedact(key)
}

function formatValue(value: ConfigValue): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return JSON.stringify(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function valueClass(value: ConfigValue): string {
  if (value === null || value === undefined) return 'ss-dbg-config-val-null'
  if (typeof value === 'boolean')
    return value ? 'ss-dbg-config-val-true' : 'ss-dbg-config-val-false'
  if (typeof value === 'number') return 'ss-dbg-config-val-number'
  if (Array.isArray(value)) return 'ss-dbg-config-val-array'
  return 'ss-dbg-config-val'
}

function copyToClipboard(text: string, key: string) {
  navigator.clipboard.writeText(text).then(() => {
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 1500)
  })
}

function copyAllJson() {
  const source = activeSubTab.value === 'app' ? props.data?.app : props.data?.env
  if (!source) return
  copyToClipboard(JSON.stringify(source, null, 2), '__all_json__')
}

/**
 * Check if a key or its string value matches the search term.
 */
function matchesSearch(key: string, value: ConfigValue): boolean {
  return matchesConfigSearch(key, value, searchDebounced.value)
}

/**
 * Highlight matching text in a string.
 * Returns an array of { text, match } segments.
 */
function highlightSegments(text: string): Array<{ text: string; match: boolean }> {
  if (!searchDebounced.value) return [{ text, match: false }]
  const term = searchDebounced.value
  const lower = text.toLowerCase()
  const segments: Array<{ text: string; match: boolean }> = []
  let lastIdx = 0
  let idx = lower.indexOf(term)
  while (idx !== -1) {
    if (idx > lastIdx) {
      segments.push({ text: text.slice(lastIdx, idx), match: false })
    }
    segments.push({ text: text.slice(idx, idx + term.length), match: true })
    lastIdx = idx + term.length
    idx = lower.indexOf(term, lastIdx)
  }
  if (lastIdx < text.length) {
    segments.push({ text: text.slice(lastIdx), match: false })
  }
  return segments.length ? segments : [{ text, match: false }]
}

// ---------------------------------------------------------------------------
// Computed: App Config (grouped tree)
// ---------------------------------------------------------------------------

interface ConfigSection {
  key: string
  entries: Array<{ key: string; value: ConfigValue; fullKey: string }>
  isFlat: boolean
}

const appSections = computed<ConfigSection[]>(() => {
  const app = props.data?.app
  if (!app) return []

  const sections: ConfigSection[] = []

  for (const [sectionKey, sectionValue] of Object.entries(app)) {
    if (sectionValue !== null && typeof sectionValue === 'object' && !Array.isArray(sectionValue)) {
      const record = sectionValue as Record<string, ConfigValue>
      const entries = Object.entries(record)
        .filter(([k, v]) => matchesSearch(k, v))
        .map(([k, v]) => ({ key: k, value: v, fullKey: `${sectionKey}.${k}` }))
      if (entries.length > 0 || !searchDebounced.value) {
        sections.push({ key: sectionKey, entries, isFlat: false })
      }
    } else {
      if (matchesSearch(sectionKey, sectionValue)) {
        sections.push({
          key: sectionKey,
          entries: [{ key: sectionKey, value: sectionValue, fullKey: sectionKey }],
          isFlat: true,
        })
      }
    }
  }

  return sections
})

// ---------------------------------------------------------------------------
// Computed: Env (flat table)
// ---------------------------------------------------------------------------

const envEntries = computed<Array<{ key: string; value: ConfigValue }>>(() => {
  const env = props.data?.env
  if (!env) return []
  return Object.entries(env)
    .filter(([k, v]) => matchesSearch(k, v))
    .map(([k, v]) => ({ key: k, value: v }))
})

// ---------------------------------------------------------------------------
// Expand / Collapse
// ---------------------------------------------------------------------------

function toggleSection(key: string) {
  if (expandedSections.value.has(key)) {
    expandedSections.value.delete(key)
  } else {
    expandedSections.value.add(key)
  }
}

function expandAll() {
  for (const section of appSections.value) {
    if (!section.isFlat) {
      expandedSections.value.add(section.key)
    }
  }
}

function collapseAll() {
  expandedSections.value.clear()
}

// In search mode, auto-expand all matching sections
watch(searchDebounced, (term) => {
  if (term) {
    for (const section of appSections.value) {
      if (!section.isFlat && section.entries.length > 0) {
        expandedSections.value.add(section.key)
      }
    }
  }
})
</script>

<template>
  <div>
    <div v-if="!data" class="ss-dbg-empty">Loading config data...</div>

    <template v-else>
      <!-- Toolbar: sub-tabs + search + actions -->
      <div class="ss-dbg-search-bar">
        <!-- Sub-tabs -->
        <button
          :class="['ss-dbg-config-tab', { 'ss-dbg-active': activeSubTab === 'app' }]"
          @click="activeSubTab = 'app'"
        >
          App Config
        </button>
        <button
          :class="['ss-dbg-config-tab', { 'ss-dbg-active': activeSubTab === 'env' }]"
          @click="activeSubTab = 'env'"
        >
          Environment
        </button>

        <!-- Search -->
        <div class="ss-dbg-config-search-wrap">
          <input
            v-model="searchRaw"
            class="ss-dbg-search"
            placeholder="Search config..."
            type="text"
          />
        </div>

        <!-- Expand/Collapse (App Config only, non-search mode) -->
        <template v-if="activeSubTab === 'app' && !searchDebounced">
          <button class="ss-dbg-btn-clear" @click="expandAll">Expand All</button>
          <button class="ss-dbg-btn-clear" @click="collapseAll">Collapse All</button>
        </template>

        <!-- Redacted toggle -->
        <button
          :class="['ss-dbg-btn-clear', { 'ss-dbg-active': showRedacted }]"
          @click="showRedacted = !showRedacted"
          :title="showRedacted ? 'Hide redacted values' : 'Show redacted values'"
        >
          {{ showRedacted ? 'Hide Secrets' : 'Show Secrets' }}
        </button>

        <!-- Copy JSON -->
        <button class="ss-dbg-btn-clear" @click="copyAllJson" :title="'Copy all as JSON'">
          {{ copiedKey === '__all_json__' ? 'Copied!' : 'Copy JSON' }}
        </button>

        <!-- Summary -->
        <span class="ss-dbg-summary">
          <template v-if="activeSubTab === 'app'"> {{ appSections.length }} sections </template>
          <template v-else> {{ envEntries.length }} variables </template>
        </span>
      </div>

      <!-- App Config view -->
      <template v-if="activeSubTab === 'app'">
        <div v-if="appSections.length === 0" class="ss-dbg-empty">
          {{ searchDebounced ? 'No matching config entries' : 'No app config data' }}
        </div>

        <div v-else class="ss-dbg-config-sections">
          <div v-for="section in appSections" :key="section.key" class="ss-dbg-config-section">
            <!-- Flat (leaf) entry -->
            <template v-if="section.isFlat">
              <div class="ss-dbg-config-section-header ss-dbg-config-leaf">
                <span class="ss-dbg-config-key">
                  <template v-for="(seg, i) in highlightSegments(section.key)" :key="i">
                    <span v-if="seg.match" class="ss-dbg-config-match">{{ seg.text }}</span>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
                <span style="margin: 0 4px; color: var(--ss-dim)">=</span>
                <template v-if="isRedacted(section.key) && !showRedacted">
                  <span class="ss-dbg-config-redacted">
                    <span class="ss-dbg-redacted-wrap">
                      &#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;
                    </span>
                  </span>
                </template>
                <template v-else>
                  <span :class="valueClass(section.entries[0].value)">
                    <template
                      v-for="(seg, i) in highlightSegments(formatValue(section.entries[0].value))"
                      :key="i"
                    >
                      <span v-if="seg.match" class="ss-dbg-config-match">{{ seg.text }}</span>
                      <template v-else>{{ seg.text }}</template>
                    </template>
                  </span>
                </template>
                <button
                  :class="[
                    'ss-dbg-copy-row-btn',
                    { 'ss-dbg-copy-row-ok': copiedKey === section.key },
                  ]"
                  @click.stop="copyToClipboard(formatValue(section.entries[0].value), section.key)"
                  title="Copy value"
                >
                  {{ copiedKey === section.key ? '\u2713' : '\u2398' }}
                </button>
              </div>
            </template>

            <!-- Group (collapsible) -->
            <template v-else>
              <div class="ss-dbg-config-section-header" @click="toggleSection(section.key)">
                <span class="ss-dbg-config-toggle">
                  {{ expandedSections.has(section.key) ? '\u25BC' : '\u25B6' }}
                </span>
                <span class="ss-dbg-config-key">
                  <template v-for="(seg, i) in highlightSegments(section.key)" :key="i">
                    <span v-if="seg.match" class="ss-dbg-config-match">{{ seg.text }}</span>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
                <span class="ss-dbg-config-count">{{ section.entries.length }} keys</span>
              </div>

              <!-- Expanded table -->
              <div v-if="expandedSections.has(section.key)" class="ss-dbg-config-table-wrap">
                <table class="ss-dbg-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Value</th>
                      <th style="width: 40px"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in section.entries" :key="entry.fullKey">
                      <td
                        class="ss-dbg-config-key"
                        style="
                          font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
                          font-size: 11px;
                        "
                      >
                        <template v-for="(seg, i) in highlightSegments(entry.key)" :key="i">
                          <span v-if="seg.match" class="ss-dbg-config-match">{{ seg.text }}</span>
                          <template v-else>{{ seg.text }}</template>
                        </template>
                      </td>
                      <td
                        style="
                          font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
                          font-size: 11px;
                        "
                      >
                        <template v-if="isRedacted(entry.key) && !showRedacted">
                          <span class="ss-dbg-redacted-wrap">
                            &#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;
                            <button
                              class="ss-dbg-redacted-reveal"
                              @click="showRedacted = true"
                              title="Reveal all redacted values"
                            >
                              reveal
                            </button>
                          </span>
                        </template>
                        <template v-else>
                          <span :class="valueClass(entry.value)">
                            <template
                              v-for="(seg, i) in highlightSegments(formatValue(entry.value))"
                              :key="i"
                            >
                              <span v-if="seg.match" class="ss-dbg-config-match">{{
                                seg.text
                              }}</span>
                              <template v-else>{{ seg.text }}</template>
                            </template>
                          </span>
                        </template>
                      </td>
                      <td>
                        <button
                          :class="[
                            'ss-dbg-copy-row-btn',
                            { 'ss-dbg-copy-row-ok': copiedKey === entry.fullKey },
                          ]"
                          @click="copyToClipboard(formatValue(entry.value), entry.fullKey)"
                          title="Copy value"
                        >
                          {{ copiedKey === entry.fullKey ? '\u2713' : '\u2398' }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>
      </template>

      <!-- Environment view -->
      <template v-else>
        <div v-if="envEntries.length === 0" class="ss-dbg-empty">
          {{ searchDebounced ? 'No matching environment variables' : 'No environment data' }}
        </div>

        <div v-else class="ss-dbg-config-table-wrap">
          <table class="ss-dbg-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Value</th>
                <th style="width: 40px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in envEntries" :key="entry.key">
                <td
                  class="ss-dbg-config-key"
                  style="
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
                    font-size: 11px;
                  "
                >
                  <template v-for="(seg, i) in highlightSegments(entry.key)" :key="i">
                    <span v-if="seg.match" class="ss-dbg-config-match">{{ seg.text }}</span>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </td>
                <td
                  style="
                    font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
                    font-size: 11px;
                  "
                >
                  <template v-if="isRedacted(entry.key) && !showRedacted">
                    <span class="ss-dbg-redacted-wrap">
                      &#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;
                      <button
                        class="ss-dbg-redacted-reveal"
                        @click="showRedacted = true"
                        title="Reveal all redacted values"
                      >
                        reveal
                      </button>
                    </span>
                  </template>
                  <template v-else>
                    <span :class="valueClass(entry.value)">
                      <template
                        v-for="(seg, i) in highlightSegments(formatValue(entry.value))"
                        :key="i"
                      >
                        <span v-if="seg.match" class="ss-dbg-config-match">{{ seg.text }}</span>
                        <template v-else>{{ seg.text }}</template>
                      </template>
                    </span>
                  </template>
                </td>
                <td>
                  <button
                    :class="[
                      'ss-dbg-copy-row-btn',
                      { 'ss-dbg-copy-row-ok': copiedKey === `env-${entry.key}` },
                    ]"
                    @click="copyToClipboard(formatValue(entry.value), `env-${entry.key}`)"
                    title="Copy value"
                  >
                    {{ copiedKey === `env-${entry.key}` ? '\u2713' : '\u2398' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
