<script setup lang="ts">
/**
 * App config viewer section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React ConfigSection / ConfigContent.
 *
 * This is a faithful Vue port of React's ConfigContent.tsx.
 */
import { ref, computed, inject, watch, type Ref } from 'vue'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { TAB_ICONS } from '../../../../core/icons.js'
import {
  isRedactedValue,
  flattenConfig,
  formatFlatValue,
  countLeaves,
  collectTopLevelObjectKeys,
  copyWithFeedback,
} from '../../../../core/config-utils.js'
import type { ConfigValue, RedactedValue, FlatEntry } from '../../../../core/config-utils.js'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const baseUrl = inject<string>('ss-base-url', '')
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)

const p = 'ss-dash'

const {
  data,
  loading,
} = useDashboardData(() => 'config', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

// -- State ------------------------------------------------------------------

const searchInput = ref('')
const search = ref('')
const activeTab = ref<'app' | 'env'>('app')
const expandedPaths = ref(new Set<string>())
const copyLabel = ref('Copy JSON')

// Per-key reveal state for redacted values
const revealedKeys = ref(new Set<string>())

// Button refs for copy-with-feedback
const copyBtnRefs = ref(new Map<string, HTMLButtonElement | null>())

// Debounce search by 200ms
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput(val: string) {
  searchInput.value = val
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = val
  }, 200)
}

// -- Data accessors ---------------------------------------------------------

const config = computed(() => {
  const d = data.value as { app?: Record<string, ConfigValue>; env?: Record<string, ConfigValue> } | null
  return d ?? null
})

// -- Env table --------------------------------------------------------------

const envEntries = computed(() => {
  const env = config.value?.env ?? {}
  const term = search.value.toLowerCase()
  return Object.entries(env).filter(([key, value]) => {
    if (!term) return true
    const valStr = isRedactedValue(value)
      ? value.display
      : value === null || value === undefined
        ? ''
        : String(value)
    return (
      key.toLowerCase().includes(term) || valStr.toLowerCase().includes(term)
    )
  })
})

// -- Flat search entries for app config -------------------------------------

const flatSearchEntries = computed(() => {
  const source = config.value?.app ?? {}
  const term = search.value.toLowerCase()
  const allEntries = flattenConfig(source, '')
  return allEntries.filter((item) => {
    const valStr = isRedactedValue(item.value)
      ? (item.value as RedactedValue).display
      : item.value === null || item.value === undefined
        ? ''
        : String(item.value)
    return (
      item.path.toLowerCase().includes(term) ||
      valStr.toLowerCase().includes(term)
    )
  })
})

const flatSearchTotal = computed(() => {
  const source = config.value?.app ?? {}
  return flattenConfig(source, '').length
})

// -- Config tree (top-level keys) -------------------------------------------

const appKeys = computed(() => {
  const app = config.value?.app
  if (!app || typeof app !== 'object' || Array.isArray(app) || isRedactedValue(app)) {
    return [] as string[]
  }
  return Object.keys(app)
})

// -- Actions ----------------------------------------------------------------

function togglePath(path: string) {
  const next = new Set(expandedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedPaths.value = next
}

function expandAll() {
  if (!config.value) return
  const source = activeTab.value === 'app' ? config.value.app : config.value.env
  if (!source) return
  const allKeys = collectTopLevelObjectKeys(source as ConfigValue)
  expandedPaths.value = new Set(allKeys)
}

function collapseAll() {
  expandedPaths.value = new Set()
}

function handleCopy() {
  if (!config.value) return
  const content = activeTab.value === 'app' ? config.value.app : config.value.env
  navigator.clipboard?.writeText(JSON.stringify(content, null, 2)).then(() => {
    copyLabel.value = 'Copied!'
    setTimeout(() => {
      copyLabel.value = 'Copy JSON'
    }, 1500)
  }).catch(() => {
    // Silently fail
  })
}

function toggleReveal(key: string) {
  const next = new Set(revealedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  revealedKeys.value = next
}

function setCopyBtnRef(key: string, el: HTMLButtonElement | null) {
  copyBtnRefs.value.set(key, el)
}

function onCopyRow(text: string, key: string, event: Event) {
  event.stopPropagation()
  copyWithFeedback(text, copyBtnRefs.value.get(key) ?? null, p)
}

// -- Helpers for template ---------------------------------------------------

function isObject(value: ConfigValue): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !isRedactedValue(value)
  )
}

function getInnerEntries(value: ConfigValue, prefix: string): FlatEntry[] {
  return flattenConfig(value, prefix)
}

function getRelPath(fullPath: string, prefix: string): string {
  return fullPath.indexOf(prefix + '.') === 0
    ? fullPath.slice(prefix.length + 1)
    : fullPath
}

/** Get formatted value text and optional color from core utility. */
function getFmt(value: ConfigValue): { text: string; color?: string } {
  return formatFlatValue(value)
}

/** Get the display value for an env table cell. */
function getEnvDisplayVal(value: ConfigValue): string {
  if (isRedactedValue(value)) return value.display
  if (value === null || value === undefined) return 'null'
  return String(value)
}

/** Eye icon SVG elements as joined HTML. */
const eyeIconHtml = computed(() => TAB_ICONS.eye.elements.join(''))
const eyeOffIconHtml = computed(() => TAB_ICONS['eye-off'].elements.join(''))
</script>

<template>
  <div>
    <!-- Toolbar -->
    <div
      :class="`${p}-config-toolbar`"
      :style="{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px' }"
    >
      <!-- Left side: tab toggle buttons -->
      <button
        type="button"
        :class="`${p}-config-tab${activeTab === 'app' ? ` ${p}-active` : ''}`"
        @click="activeTab = 'app'"
      >
        App Config
      </button>
      <button
        type="button"
        :class="`${p}-config-tab${activeTab === 'env' ? ` ${p}-active` : ''}`"
        @click="activeTab = 'env'"
      >
        Env
      </button>

      <!-- Middle: search input -->
      <div :style="{ position: 'relative', flex: 1 }">
        <input
          type="text"
          :class="`${p}-search`"
          placeholder="Search keys and values..."
          :value="searchInput"
          style="width: 100%"
          @input="onSearchInput(($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="searchInput"
          type="button"
          :style="{
            position: 'absolute',
            right: '6px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            color: 'var(--ss-dim)',
            padding: '0 2px',
            lineHeight: 1,
          }"
          @click="searchInput = ''; search = ''"
        >
          &times;
        </button>
      </div>

      <!-- Right side: expand/collapse + copy -->
      <template v-if="activeTab === 'app' && !search">
        <button type="button" :class="`${p}-btn`" @click="expandAll">Expand All</button>
        <button type="button" :class="`${p}-btn`" @click="collapseAll">Collapse All</button>
      </template>
      <button type="button" :class="`${p}-btn`" @click="handleCopy">{{ copyLabel }}</button>
    </div>

    <!-- Content -->
    <div v-if="loading && !data" :class="`${p}-empty`">Loading config...</div>
    <div v-else-if="!config" :class="`${p}-empty`">Config not available</div>

    <!-- ENV TAB: flat key-value table -->
    <template v-else-if="activeTab === 'env'">
      <div :class="`${p}-config-table-wrap`">
        <table :class="`${p}-table ${p}-config-env-table`">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Value</th>
              <th :style="{ width: '36px' }"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[key, value] in envEntries" :key="key">
              <td :class="`${p}-env-key`">
                <span :class="`${p}-config-key`">{{ key }}</span>
              </td>
              <td :class="`${p}-env-val`">
                <!-- Redacted toggle -->
                <span
                  v-if="isRedactedValue(value)"
                  :class="`${p}-config-redacted`"
                  :style="{ display: 'inline-flex', alignItems: 'center', gap: '4px' }"
                >
                  <span>{{ revealedKeys.has(key) ? (value as RedactedValue).value : (value as RedactedValue).display }}</span>
                  <button
                    type="button"
                    :class="`${p}-btn`"
                    :title="revealedKeys.has(key) ? 'Hide' : 'Reveal'"
                    :style="{ padding: '0 4px', fontSize: '0.85em', lineHeight: 1, minWidth: 'auto' }"
                    @click.stop="toggleReveal(key)"
                  >
                    <svg
                      v-if="revealedKeys.has(key)"
                      width="14"
                      height="14"
                      :viewBox="TAB_ICONS['eye-off'].viewBox"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      v-html="eyeOffIconHtml"
                    />
                    <svg
                      v-else
                      width="14"
                      height="14"
                      :viewBox="TAB_ICONS.eye.viewBox"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      v-html="eyeIconHtml"
                    />
                  </button>
                </span>
                <!-- Normal value -->
                <span v-else :class="`${p}-config-val`">{{ getEnvDisplayVal(value) }}</span>
              </td>
              <td>
                <button
                  v-if="!isRedactedValue(value)"
                  type="button"
                  :class="`${p}-copy-row-btn`"
                  title="Copy"
                  :ref="(el: any) => setCopyBtnRef(`env-${key}`, el)"
                  @click="onCopyRow(`${key}=${getEnvDisplayVal(value)}`, `env-${key}`, $event)"
                >&#x2398;</button>
              </td>
            </tr>
            <tr v-if="envEntries.length === 0">
              <td colspan="3" :style="{ textAlign: 'center', color: 'var(--ss-dim)' }">
                No matching variables
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- APP TAB with search active: flat search table -->
    <template v-else-if="search">
      <div :class="`${p}-config-table-wrap`">
        <table :class="`${p}-table`">
          <thead>
            <tr>
              <th>Path</th>
              <th>Value</th>
              <th :style="{ width: '36px' }"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in flatSearchEntries" :key="item.path">
              <td>
                <span :class="`${p}-config-key`" :style="{ whiteSpace: 'nowrap' }">
                  {{ item.path }}
                </span>
              </td>
              <td>
                <!-- Redacted toggle -->
                <span
                  v-if="isRedactedValue(item.value)"
                  :class="`${p}-config-redacted`"
                  :style="{ display: 'inline-flex', alignItems: 'center', gap: '4px' }"
                >
                  <span>{{ revealedKeys.has(item.path) ? (item.value as RedactedValue).value : (item.value as RedactedValue).display }}</span>
                  <button
                    type="button"
                    :class="`${p}-btn`"
                    :title="revealedKeys.has(item.path) ? 'Hide' : 'Reveal'"
                    :style="{ padding: '0 4px', fontSize: '0.85em', lineHeight: 1, minWidth: 'auto' }"
                    @click.stop="toggleReveal(item.path)"
                  >
                    <svg
                      v-if="revealedKeys.has(item.path)"
                      width="14"
                      height="14"
                      :viewBox="TAB_ICONS['eye-off'].viewBox"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      v-html="eyeOffIconHtml"
                    />
                    <svg
                      v-else
                      width="14"
                      height="14"
                      :viewBox="TAB_ICONS.eye.viewBox"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      v-html="eyeIconHtml"
                    />
                  </button>
                </span>
                <!-- Normal value with color -->
                <span
                  v-else
                  :class="`${p}-config-val`"
                  :style="{ wordBreak: 'break-all', color: getFmt(item.value).color }"
                >{{ getFmt(item.value).text }}</span>
              </td>
              <td>
                <button
                  v-if="!isRedactedValue(item.value)"
                  type="button"
                  :class="`${p}-copy-row-btn`"
                  title="Copy"
                  :ref="(el: any) => setCopyBtnRef(`search-${item.path}`, el)"
                  @click="onCopyRow(
                    `${item.path}: ${isRedactedValue(item.value) ? (item.value as RedactedValue).display : getFmt(item.value).text}`,
                    `search-${item.path}`,
                    $event
                  )"
                >&#x2398;</button>
              </td>
            </tr>
            <tr v-if="flatSearchEntries.length === 0">
              <td colspan="3" :style="{ textAlign: 'center', color: 'var(--ss-dim)' }">
                No matching entries
              </td>
            </tr>
          </tbody>
        </table>
        <div :style="{ padding: '4px 16px', fontSize: '10px', color: 'var(--ss-muted)' }">
          {{ flatSearchEntries.length }} of {{ flatSearchTotal }} entries
        </div>
      </div>
    </template>

    <!-- APP TAB default: config tree with collapsible sections -->
    <template v-else>
      <div :class="`${p}-config-table-wrap`">
        <div :class="`${p}-config-sections`">
          <div v-for="key in appKeys" :key="key" :class="`${p}-config-section`">
            <!-- Object section (collapsible) -->
            <template v-if="isObject((config!.app as Record<string, ConfigValue>)[key])">
              <div
                :class="`${p}-config-section-header`"
                :style="{ cursor: 'pointer' }"
                @click="togglePath(key)"
              >
                <span :class="`${p}-config-toggle`">
                  {{ expandedPaths.has(key) ? '\u25BC' : '\u25B6' }}
                </span>
                <span :class="`${p}-config-key`">{{ key }}</span>
                <span :class="`${p}-config-count`">
                  {{ countLeaves((config!.app as Record<string, ConfigValue>)[key]) }} entries
                </span>
              </div>
              <!-- Expanded inner table -->
              <div v-if="expandedPaths.has(key)" :class="`${p}-config-section-body`">
                <table :class="`${p}-table ${p}-config-inner-table`">
                  <thead>
                    <tr>
                      <th :style="{ width: '35%' }">Key</th>
                      <th>Value</th>
                      <th :style="{ width: '36px' }"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in getInnerEntries((config!.app as Record<string, ConfigValue>)[key], key)"
                      :key="item.path"
                    >
                      <td :title="getRelPath(item.path, key)">
                        <span :class="`${p}-config-key`">{{ getRelPath(item.path, key) }}</span>
                      </td>
                      <td :title="isRedactedValue(item.value) ? (item.value as RedactedValue).display : getFmt(item.value).text">
                        <!-- Redacted toggle -->
                        <span
                          v-if="isRedactedValue(item.value)"
                          :class="`${p}-config-redacted`"
                          :style="{ display: 'inline-flex', alignItems: 'center', gap: '4px' }"
                        >
                          <span>{{ revealedKeys.has(item.path) ? (item.value as RedactedValue).value : (item.value as RedactedValue).display }}</span>
                          <button
                            type="button"
                            :class="`${p}-btn`"
                            :title="revealedKeys.has(item.path) ? 'Hide' : 'Reveal'"
                            :style="{ padding: '0 4px', fontSize: '0.85em', lineHeight: 1, minWidth: 'auto' }"
                            @click.stop="toggleReveal(item.path)"
                          >
                            <svg
                              v-if="revealedKeys.has(item.path)"
                              width="14"
                              height="14"
                              :viewBox="TAB_ICONS['eye-off'].viewBox"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              v-html="eyeOffIconHtml"
                            />
                            <svg
                              v-else
                              width="14"
                              height="14"
                              :viewBox="TAB_ICONS.eye.viewBox"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              v-html="eyeIconHtml"
                            />
                          </button>
                        </span>
                        <!-- Normal value with color -->
                        <span
                          v-else
                          :class="`${p}-config-val`"
                          :style="{ color: getFmt(item.value).color }"
                        >{{ getFmt(item.value).text }}</span>
                      </td>
                      <td>
                        <button
                          v-if="!isRedactedValue(item.value)"
                          type="button"
                          :class="`${p}-copy-row-btn`"
                          title="Copy"
                          :ref="(el: any) => setCopyBtnRef(`inner-${item.path}`, el)"
                          @click="onCopyRow(
                            `${item.path}: ${getFmt(item.value).text}`,
                            `inner-${item.path}`,
                            $event
                          )"
                        >&#x2398;</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <!-- Leaf value (non-object, shown inline) -->
            <template v-else>
              <div :class="`${p}-config-section-header ${p}-config-leaf`" :style="{ cursor: 'default' }">
                <span :class="`${p}-config-toggle`" :style="{ visibility: 'hidden' }">&bull;</span>
                <span :class="`${p}-config-key`">{{ key }}</span>
                <span :class="`${p}-config-val`" :style="{ marginLeft: '8px' }">
                  <!-- Redacted value -->
                  <span
                    v-if="isRedactedValue((config!.app as Record<string, ConfigValue>)[key])"
                    :class="`${p}-config-redacted`"
                    :style="{ display: 'inline-flex', alignItems: 'center', gap: '4px' }"
                  >
                    <span>{{
                      revealedKeys.has(key)
                        ? ((config!.app as Record<string, ConfigValue>)[key] as RedactedValue).value
                        : ((config!.app as Record<string, ConfigValue>)[key] as RedactedValue).display
                    }}</span>
                    <button
                      type="button"
                      :class="`${p}-btn`"
                      :title="revealedKeys.has(key) ? 'Hide' : 'Reveal'"
                      :style="{ padding: '0 4px', fontSize: '0.85em', lineHeight: 1, minWidth: 'auto' }"
                      @click.stop="toggleReveal(key)"
                    >
                      <svg
                        v-if="revealedKeys.has(key)"
                        width="14"
                        height="14"
                        :viewBox="TAB_ICONS['eye-off'].viewBox"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        v-html="eyeOffIconHtml"
                      />
                      <svg
                        v-else
                        width="14"
                        height="14"
                        :viewBox="TAB_ICONS.eye.viewBox"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        v-html="eyeIconHtml"
                      />
                    </button>
                  </span>
                  <!-- null / undefined -->
                  <span
                    v-else-if="(config!.app as Record<string, ConfigValue>)[key] === null || (config!.app as Record<string, ConfigValue>)[key] === undefined"
                    :style="{ color: 'var(--ss-dim)' }"
                  >null</span>
                  <!-- boolean -->
                  <span
                    v-else-if="typeof (config!.app as Record<string, ConfigValue>)[key] === 'boolean'"
                    :style="{ color: (config!.app as Record<string, ConfigValue>)[key] ? 'var(--ss-green-fg)' : 'var(--ss-red-fg)' }"
                  >{{ String((config!.app as Record<string, ConfigValue>)[key]) }}</span>
                  <!-- number -->
                  <span
                    v-else-if="typeof (config!.app as Record<string, ConfigValue>)[key] === 'number'"
                    :style="{ color: 'var(--ss-amber-fg)' }"
                  >{{ String((config!.app as Record<string, ConfigValue>)[key]) }}</span>
                  <!-- array -->
                  <span
                    v-else-if="Array.isArray((config!.app as Record<string, ConfigValue>)[key])"
                    :style="{ color: 'var(--ss-purple-fg)' }"
                  >{{ getFmt((config!.app as Record<string, ConfigValue>)[key]).text }}</span>
                  <!-- string / other -->
                  <span v-else>{{ String((config!.app as Record<string, ConfigValue>)[key]) }}</span>
                </span>
                <!-- Copy button for non-redacted leaf -->
                <button
                  v-if="!isRedactedValue((config!.app as Record<string, ConfigValue>)[key])"
                  type="button"
                  :class="`${p}-copy-row-btn`"
                  :style="{ marginLeft: '4px' }"
                  title="Copy"
                  :ref="(el: any) => setCopyBtnRef(`leaf-${key}`, el)"
                  @click="onCopyRow(
                    `${key}: ${getFmt((config!.app as Record<string, ConfigValue>)[key]).text}`,
                    `leaf-${key}`,
                    $event
                  )"
                >&#x2398;</button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
