<script setup lang="ts">
/**
 * Internals diagnostics section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches from the debug endpoint.
 * CSS classes match the React InternalsSection / InternalsContent.
 */
import { ref, computed, inject, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { UnauthorizedError, SECTION_REFRESH_MS } from '../../../../core/index.js'
import { useApiClient } from '../../../composables/useApiClient.js'
import { formatUptime, timeAgo, formatDuration } from '../../../../core/formatters.js'
import {
  getTimerLabel,
  getIntegrationLabel,
  getIntegrationStatus,
  getIntegrationDetails,
  formatCollectorConfig,
  fillPercent,
  classifyStatus,
} from '../../../../core/internals-utils.js'

import type { DiagnosticsResponse, DiagnosticsTimerInfo } from '../../../../core/types.js'

// ---------------------------------------------------------------------------
// Inject dependencies
// ---------------------------------------------------------------------------

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const baseUrl = inject<string>('ss-base-url', '')
const debugEndpoint = inject<string>('ss-debug-endpoint', '/admin/api/debug')
const authToken = inject<string | undefined>('ss-auth-token', undefined)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const diagnostics = ref<DiagnosticsResponse | null>(null)
const isLoading = ref(true)
const error = ref<Error | null>(null)
const revealedKeys = ref(new Set<string>())

// ---------------------------------------------------------------------------
// Data fetching - from debug endpoint (not dashboard API)
// ---------------------------------------------------------------------------

const getClient = useApiClient(baseUrl, authToken)
let timer: ReturnType<typeof setInterval> | null = null

async function fetchDiagnostics() {
  try {
    const result = await getClient().fetch<DiagnosticsResponse>(
      `${debugEndpoint}/diagnostics`
    )
    diagnostics.value = result
    error.value = null
    isLoading.value = false
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      error.value = err
      isLoading.value = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      return
    }
    error.value = err instanceof Error ? err : new Error(String(err))
    isLoading.value = false
  }
}

onMounted(() => {
  isLoading.value = true
  error.value = null
  fetchDiagnostics()
  timer = setInterval(fetchDiagnostics, SECTION_REFRESH_MS)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// Re-fetch when SSE pushes an update
watch(refreshKey, () => {
  fetchDiagnostics()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toggleReveal(key: string) {
  if (revealedKeys.value.has(key)) {
    revealedKeys.value.delete(key)
  } else {
    revealedKeys.value.add(key)
  }
}

function dotClass(status: string): string {
  const kind = classifyStatus(status)
  if (kind === 'ok') return 'ss-dash-dot-ok'
  if (kind === 'err') return 'ss-dash-dot-err'
  return ''
}

function formatTimerInterval(t: DiagnosticsTimerInfo): string {
  if (t.debounceMs !== undefined) return `${formatDuration(t.debounceMs)} (debounce)`
  if (t.intervalMs !== undefined) return formatDuration(t.intervalMs)
  return '-'
}

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const bufferEntries = computed(() => {
  if (!diagnostics.value?.buffers) return []
  return Object.entries(diagnostics.value.buffers).map(([name, buf]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    ...buf,
    percent: fillPercent(buf.current, buf.max),
  }))
})

const timerEntries = computed(() => {
  if (!diagnostics.value?.timers) return []
  return Object.entries(diagnostics.value.timers).map(([key, t]) => ({
    key,
    label: getTimerLabel(key),
    ...t,
    interval: formatTimerInterval(t),
  }))
})

const integrationEntries = computed(() => {
  if (!diagnostics.value) return []
  const entries: Array<{ key: string; label: string; status: string; details: string }> = []

  if (diagnostics.value.transmit) {
    entries.push({
      key: 'transmit',
      label: 'Transmit (SSE)',
      status: diagnostics.value.transmit.available ? 'connected' : 'unavailable',
      details: diagnostics.value.transmit.available
        ? `Channels: ${diagnostics.value.transmit.channels.join(', ')}`
        : 'Not installed',
    })
  }

  if (diagnostics.value.integrations) {
    for (const [key, info] of Object.entries(diagnostics.value.integrations)) {
      entries.push({
        key,
        label: getIntegrationLabel(key),
        status: getIntegrationStatus(info),
        details: getIntegrationDetails(key, info),
      })
    }
  }

  return entries
})
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="isLoading && !diagnostics" class="ss-dash-empty">Loading diagnostics...</div>

    <!-- Error -->
    <div v-else-if="error && !diagnostics" class="ss-dash-empty">
      Error: {{ error.message }}
    </div>

    <!-- No data -->
    <div v-else-if="!diagnostics" class="ss-dash-empty">Diagnostics not available</div>

    <template v-else>
      <!-- 1. Package Info -->
      <h3 class="ss-dash-section-title">Package Info</h3>
      <div class="ss-dash-info-cards">
        <div
          v-for="card in [
            { label: 'Version', value: diagnostics.package?.version || '-' },
            { label: 'Node.js', value: diagnostics.package?.nodeVersion || '-' },
            { label: 'AdonisJS', value: diagnostics.package?.adonisVersion || '-' },
            { label: 'Uptime', value: formatUptime(diagnostics.uptime || diagnostics.package?.uptime) },
          ]"
          :key="card.label"
          class="ss-dash-info-card"
        >
          <span class="ss-dash-info-card-label">{{ card.label }}</span>
          <span class="ss-dash-info-card-value">{{ card.value }}</span>
        </div>
      </div>

      <!-- 2. Collectors -->
      <h3 class="ss-dash-section-title">Collectors</h3>
      <div v-if="!diagnostics.collectors?.length" class="ss-dash-empty">No collectors</div>
      <table v-else class="ss-dash-table">
        <thead>
          <tr>
            <th>Collector</th>
            <th>Status</th>
            <th>Last Error</th>
            <th>Config</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in diagnostics.collectors" :key="c.name">
            <td>
              <span style="font-family: monospace; font-size: 11px">{{ c.name }}</span>
              <span
                v-if="c.label && c.label !== c.name"
                style="margin-left: 6px; font-size: 11px; color: var(--ss-dim)"
              >{{ c.label }}</span>
            </td>
            <td>
              <span :class="['ss-dash-dot', dotClass(c.status)]"></span>
              {{ c.status }}
            </td>
            <td :style="c.lastError ? { color: 'var(--ss-red-fg)' } : {}">
              <template v-if="c.lastError">
                {{ c.lastError }}
                <span style="color: var(--ss-dim); margin-left: 4px">{{ timeAgo(c.lastErrorAt ?? 0) }}</span>
              </template>
              <template v-else>-</template>
            </td>
            <td style="font-size: 11px">
              <template v-if="Object.keys(c.config || {}).length">
                <span
                  v-for="item in formatCollectorConfig(c.config)"
                  :key="item.key"
                  style="margin-right: 8px"
                >
                  {{ item.key }}=<template v-if="item.secret && !revealedKeys.has(`collector-${c.name}-${item.key}`)">
                    <span
                      style="color: var(--ss-muted); cursor: pointer"
                      @click="toggleReveal(`collector-${c.name}-${item.key}`)"
                    >&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span>
                  </template><template v-else>
                    <span>{{ item.value }}</span>
                    <button
                      v-if="item.secret"
                      style="background: none; border: none; color: var(--ss-link-color, #3b82f6); cursor: pointer; font-size: 10px; margin-left: 4px; padding: 0"
                      @click="toggleReveal(`collector-${c.name}-${item.key}`)"
                    >Hide</button>
                  </template>
                </span>
              </template>
              <template v-else>-</template>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 3. Buffers -->
      <h3 class="ss-dash-section-title">Buffers</h3>
      <div v-if="!bufferEntries.length" class="ss-dash-empty">No buffer data</div>
      <table v-else class="ss-dash-table">
        <thead>
          <tr><th>Buffer</th><th>Usage</th><th>Fill %</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in bufferEntries" :key="b.name">
            <td>{{ b.name }}</td>
            <td>{{ b.current.toLocaleString() }} / {{ b.max.toLocaleString() }}</td>
            <td>
              <div class="ss-dash-bar">
                <div class="ss-dash-bar-track" style="max-width: 120px">
                  <div
                    :class="['ss-dash-bar-fill', b.percent >= 100 ? 'ss-dash-bar-fill-warn' : '']"
                    :style="{ width: b.percent + '%' }"
                  ></div>
                </div>
                <span :class="['ss-dash-bar-pct', b.percent >= 100 ? 'ss-dash-bar-pct-warn' : '']">{{ b.percent }}%</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 4. Timers -->
      <h3 class="ss-dash-section-title">Timers</h3>
      <div v-if="!timerEntries.length" class="ss-dash-empty">No timer data</div>
      <table v-else class="ss-dash-table">
        <thead>
          <tr><th>Timer</th><th>Status</th><th>Interval</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in timerEntries" :key="t.key">
            <td>{{ t.label }}</td>
            <td>
              <span :class="['ss-dash-dot', dotClass(t.active ? 'active' : 'inactive')]"></span>
              {{ t.active ? 'active' : 'inactive' }}
            </td>
            <td style="color: var(--ss-dim)">{{ t.interval }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 5. Integrations -->
      <h3 class="ss-dash-section-title">Integrations</h3>
      <div v-if="!integrationEntries.length" class="ss-dash-empty">No integration data</div>
      <table v-else class="ss-dash-table">
        <thead>
          <tr><th>Integration</th><th>Status</th><th>Details</th></tr>
        </thead>
        <tbody>
          <tr v-for="i in integrationEntries" :key="i.key">
            <td>{{ i.label }}</td>
            <td>
              <span :class="['ss-dash-dot', dotClass(i.status)]"></span>
              {{ i.status }}
            </td>
            <td style="color: var(--ss-dim); font-size: 11px">{{ i.details }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 6. Storage -->
      <template v-if="diagnostics.storage">
        <h3 class="ss-dash-section-title">Storage</h3>
        <table class="ss-dash-table">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr>
              <td>Status</td>
              <td>
                <span :class="['ss-dash-dot', dotClass(diagnostics.storage!.ready ? 'ready' : 'unavailable')]"></span>
                {{ diagnostics.storage!.ready ? 'ready' : 'not ready' }}
              </td>
            </tr>
            <tr>
              <td>DB Path</td>
              <td style="font-family: monospace; font-size: 11px">{{ diagnostics.storage!.dbPath }}</td>
            </tr>
            <tr><td>File Size</td><td>{{ diagnostics.storage!.fileSizeMb.toFixed(1) }} MB</td></tr>
            <tr><td>WAL Size</td><td>{{ diagnostics.storage!.walSizeMb.toFixed(1) }} MB</td></tr>
            <tr><td>Retention</td><td>{{ diagnostics.storage!.retentionDays }} days</td></tr>
            <tr><td>Last Cleanup</td><td>{{ timeAgo(diagnostics.storage!.lastCleanupAt ?? 0) }}</td></tr>
          </tbody>
        </table>

        <table v-if="diagnostics.storage!.tables?.length" class="ss-dash-table" style="margin-top: 8px">
          <thead><tr><th>Table</th><th>Rows</th></tr></thead>
          <tbody>
            <tr v-for="t in diagnostics.storage!.tables" :key="t.name">
              <td style="font-family: monospace; font-size: 11px">{{ t.name }}</td>
              <td>{{ t.rowCount.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- 7. Resolved Config -->
      <h3 class="ss-dash-section-title">Resolved Config</h3>
      <table class="ss-dash-table">
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>intervalMs</td><td>{{ diagnostics.config?.intervalMs }}</td></tr>
          <tr><td>transport</td><td>{{ diagnostics.config?.transport }}</td></tr>
          <tr><td>channelName</td><td>{{ diagnostics.config?.channelName }}</td></tr>
          <tr><td>endpoint</td><td>{{ diagnostics.config?.endpoint === false ? 'false' : diagnostics.config?.endpoint }}</td></tr>
          <tr><td>skipInTest</td><td>{{ diagnostics.config?.skipInTest }}</td></tr>
          <tr><td>onStats callback</td><td>{{ diagnostics.config?.hasOnStatsCallback ? 'defined' : 'not defined' }}</td></tr>
          <tr><td>shouldShow callback</td><td>{{ diagnostics.config?.hasShouldShowCallback ? 'defined' : 'not defined' }}</td></tr>
        </tbody>
      </table>

      <h4 class="ss-dash-section-title">DevToolbar</h4>
      <table class="ss-dash-table">
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>enabled</td><td>{{ diagnostics.devToolbar?.enabled }}</td></tr>
          <tr><td>tracing</td><td>{{ diagnostics.devToolbar?.tracing }}</td></tr>
          <tr><td>dashboard</td><td>{{ diagnostics.devToolbar?.dashboard }}</td></tr>
          <tr>
            <td>dashboardPath</td>
            <td style="font-family: monospace; font-size: 11px">{{ diagnostics.devToolbar?.dashboardPath }}</td>
          </tr>
          <tr>
            <td>debugEndpoint</td>
            <td style="font-family: monospace; font-size: 11px">
              <template v-if="!revealedKeys.has('cfg-debugEndpoint')">
                <span style="color: var(--ss-muted); cursor: pointer" @click="toggleReveal('cfg-debugEndpoint')">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span>
              </template>
              <template v-else>
                {{ diagnostics.devToolbar?.debugEndpoint }}
                <button
                  style="background: none; border: none; color: var(--ss-link-color, #3b82f6); cursor: pointer; font-size: 10px; margin-left: 4px; padding: 0"
                  @click="toggleReveal('cfg-debugEndpoint')"
                >Hide</button>
              </template>
            </td>
          </tr>
          <tr><td>maxQueries</td><td>{{ diagnostics.devToolbar?.maxQueries }}</td></tr>
          <tr><td>maxEvents</td><td>{{ diagnostics.devToolbar?.maxEvents }}</td></tr>
          <tr><td>maxEmails</td><td>{{ diagnostics.devToolbar?.maxEmails }}</td></tr>
          <tr><td>maxTraces</td><td>{{ diagnostics.devToolbar?.maxTraces }}</td></tr>
          <tr><td>slowQueryThresholdMs</td><td>{{ diagnostics.devToolbar?.slowQueryThresholdMs }}</td></tr>
          <tr><td>retentionDays</td><td>{{ diagnostics.devToolbar?.retentionDays }}</td></tr>
          <tr>
            <td>dbPath</td>
            <td style="font-family: monospace; font-size: 11px">
              <template v-if="!revealedKeys.has('cfg-dbPath')">
                <span style="color: var(--ss-muted); cursor: pointer" @click="toggleReveal('cfg-dbPath')">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span>
              </template>
              <template v-else>
                {{ diagnostics.devToolbar?.dbPath }}
                <button
                  style="background: none; border: none; color: var(--ss-link-color, #3b82f6); cursor: pointer; font-size: 10px; margin-left: 4px; padding: 0"
                  @click="toggleReveal('cfg-dbPath')"
                >Hide</button>
              </template>
            </td>
          </tr>
          <tr><td>persistDebugData</td><td>{{ diagnostics.devToolbar?.persistDebugData }}</td></tr>
          <tr>
            <td>excludeFromTracing</td>
            <td style="font-size: 11px">{{ diagnostics.devToolbar?.excludeFromTracing?.join(', ') || '-' }}</td>
          </tr>
          <tr><td>customPanes</td><td>{{ diagnostics.devToolbar?.customPaneCount ?? 0 }} registered</td></tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
