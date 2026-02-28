<script setup lang="ts">
/**
 * Internals diagnostics tab for the debug panel.
 *
 * Fetches from {debugEndpoint}/diagnostics using its own ApiClient,
 * with auto-refresh polling. Handles UnauthorizedError to stop polling.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { UnauthorizedError } from '../../../../core/index.js'
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

type DiagnosticsData = Partial<DiagnosticsResponse>

const REFRESH_INTERVAL = 3000

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps<{
  data?: DiagnosticsData | null
  baseUrl?: string
  debugEndpoint?: string
  authToken?: string
}>()

// ---------------------------------------------------------------------------
// Self-fetching (matches React pattern with ApiClient + UnauthorizedError)
// ---------------------------------------------------------------------------

const selfData = ref<DiagnosticsData | null>(null)
const isLoading = ref(true)
const fetchError = ref<Error | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

const getClient = useApiClient(props.baseUrl || '', props.authToken)

async function fetchDiagnostics() {
  const endpoint = props.debugEndpoint || '/admin/api/debug'
  try {
    const c = getClient()
    const result = await c.get<DiagnosticsData>(`${endpoint}/diagnostics`)
    selfData.value = result
    fetchError.value = null
    isLoading.value = false
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      fetchError.value = err
      isLoading.value = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      return
    }
    fetchError.value = err instanceof Error ? err : new Error(String(err))
    isLoading.value = false
  }
}

onMounted(() => {
  isLoading.value = true
  fetchError.value = null
  fetchDiagnostics()
  timer = setInterval(fetchDiagnostics, REFRESH_INTERVAL)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const revealedKeys = ref(new Set<string>())

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
  if (kind === 'ok') return 'ss-dbg-dot-ok'
  if (kind === 'err') return 'ss-dbg-dot-err'
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

// Use self-fetched data if available, otherwise fall back to prop data
const diagnosticsData = computed(() => selfData.value || props.data || null)
const d = computed(() => diagnosticsData.value || ({} as DiagnosticsData))

const bufferEntries = computed(() => {
  if (!d.value.buffers) return []
  return Object.entries(d.value.buffers).map(([name, buf]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    ...buf,
    percent: fillPercent(buf.current, buf.max),
  }))
})

const timerEntries = computed(() => {
  if (!d.value.timers) return []
  return Object.entries(d.value.timers).map(([key, t]) => ({
    key,
    label: getTimerLabel(key),
    ...t,
    interval: formatTimerInterval(t),
  }))
})

const integrationEntries = computed(() => {
  if (!d.value) return []
  const entries: Array<{ key: string; label: string; status: string; details: string }> = []

  if (d.value.transmit) {
    entries.push({
      key: 'transmit',
      label: 'Transmit (SSE)',
      status: d.value.transmit.available ? 'connected' : 'unavailable',
      details: d.value.transmit.available
        ? `Channels: ${d.value.transmit.channels.join(', ')}`
        : 'Not installed',
    })
  }

  if (d.value.integrations) {
    for (const [key, info] of Object.entries(d.value.integrations)) {
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
    <div v-if="isLoading && !diagnosticsData" class="ss-dbg-empty">Loading diagnostics...</div>

    <div v-else-if="fetchError" class="ss-dbg-empty">Error: {{ fetchError.message }}</div>

    <div v-else-if="!diagnosticsData" class="ss-dbg-empty">Diagnostics not available</div>

    <template v-else>
      <!-- 1. Package Info — compact card row -->
      <div class="ss-dbg-internals-title">Package Info</div>
      <div class="ss-dbg-info-cards">
        <div
          v-for="card in [
            { label: 'Version', value: d.package?.version || '-' },
            { label: 'Node.js', value: d.package?.nodeVersion || '-' },
            { label: 'AdonisJS', value: d.package?.adonisVersion || '-' },
            { label: 'Uptime', value: formatUptime(d.package?.uptime) },
          ]"
          :key="card.label"
          class="ss-dbg-info-card"
        >
          <span class="ss-dbg-info-card-label">{{ card.label }}</span>
          <span class="ss-dbg-info-card-value">{{ card.value }}</span>
        </div>
      </div>

      <!-- 2. Collectors -->
      <div class="ss-dbg-internals-title">Collectors</div>
      <div v-if="!d.collectors?.length" class="ss-dbg-empty">No collectors</div>
      <table v-else class="ss-dbg-table">
        <thead>
          <tr>
            <th>Collector</th>
            <th>Status</th>
            <th>Last Error</th>
            <th>Config</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in d.collectors" :key="c.name">
            <td>
              <span style="font-family: monospace; font-size: 11px">{{ c.name }}</span>
              <span
                v-if="c.label && c.label !== c.name"
                class="ss-dbg-c-dim"
                style="margin-left: 6px; font-size: 11px"
                >{{ c.label }}</span
              >
            </td>
            <td>
              <span :class="['ss-dbg-dot', dotClass(c.status)]"></span>
              {{ c.status }}
            </td>
            <td class="ss-dbg-c-red">
              <template v-if="c.lastError">
                {{ c.lastError }}
                <span class="ss-dbg-c-dim" style="margin-left: 4px">{{
                  timeAgo(c.lastErrorAt)
                }}</span>
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
                  {{ item.key }}=<template
                    v-if="item.secret && !revealedKeys.has(`collector-${c.name}-${item.key}`)"
                    ><span
                      class="ss-dbg-c-muted"
                      style="cursor: pointer"
                      @click="toggleReveal(`collector-${c.name}-${item.key}`)"
                      >&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span
                    ></template
                  ><template v-else
                    ><span>{{ item.value }}</span
                    ><button
                      v-if="item.secret"
                      style="
                        background: none;
                        border: none;
                        color: var(--ss-link-color, #3b82f6);
                        cursor: pointer;
                        font-size: 10px;
                        margin-left: 4px;
                        padding: 0;
                      "
                      @click="toggleReveal(`collector-${c.name}-${item.key}`)"
                    >
                      Hide
                    </button></template
                  >
                </span>
              </template>
              <template v-else>-</template>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 3. Buffers -->
      <div class="ss-dbg-internals-title">Buffers</div>
      <div v-if="!bufferEntries.length" class="ss-dbg-empty">No buffer data</div>
      <table v-else class="ss-dbg-table">
        <thead>
          <tr>
            <th>Buffer</th>
            <th>Usage</th>
            <th>Fill %</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bufferEntries" :key="b.name">
            <td>{{ b.name }}</td>
            <td>{{ b.current.toLocaleString() }} / {{ b.max.toLocaleString() }}</td>
            <td>
              <div class="ss-dbg-bar">
                <div class="ss-dbg-bar-track">
                  <div
                    :class="['ss-dbg-bar-fill', b.percent >= 100 ? 'ss-dbg-bar-fill-warn' : '']"
                    :style="{ width: b.percent + '%' }"
                  ></div>
                </div>
                <span :class="['ss-dbg-bar-pct', b.percent >= 100 ? 'ss-dbg-bar-pct-warn' : '']"
                  >{{ b.percent }}%</span
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 4. Timers -->
      <div class="ss-dbg-internals-title">Timers</div>
      <div v-if="!timerEntries.length" class="ss-dbg-empty">No timer data</div>
      <table v-else class="ss-dbg-table">
        <thead>
          <tr>
            <th>Timer</th>
            <th>Status</th>
            <th>Interval</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in timerEntries" :key="t.key">
            <td>{{ t.label }}</td>
            <td>
              <span :class="['ss-dbg-dot', dotClass(t.active ? 'active' : 'inactive')]"></span>
              {{ t.active ? 'active' : 'inactive' }}
            </td>
            <td class="ss-dbg-c-dim">{{ t.interval }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 5. Integrations -->
      <div class="ss-dbg-internals-title">Integrations</div>
      <div v-if="!integrationEntries.length" class="ss-dbg-empty">No integration data</div>
      <table v-else class="ss-dbg-table">
        <thead>
          <tr>
            <th>Integration</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in integrationEntries" :key="i.key">
            <td>{{ i.label }}</td>
            <td>
              <span :class="['ss-dbg-dot', dotClass(i.status)]"></span>
              {{ i.status }}
            </td>
            <td class="ss-dbg-c-dim">{{ i.details }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 6. Storage -->
      <template v-if="d.storage">
        <div class="ss-dbg-internals-title">Storage</div>
        <table class="ss-dbg-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Status</td>
              <td>
                <span
                  :class="['ss-dbg-dot', dotClass(d.storage!.ready ? 'ready' : 'unavailable')]"
                ></span>
                {{ d.storage!.ready ? 'ready' : 'not ready' }}
              </td>
            </tr>
            <tr>
              <td>DB Path</td>
              <td style="font-family: monospace; font-size: 11px">{{ d.storage!.dbPath }}</td>
            </tr>
            <tr>
              <td>File Size</td>
              <td>{{ d.storage!.fileSizeMb.toFixed(1) }} MB</td>
            </tr>
            <tr>
              <td>WAL Size</td>
              <td>{{ d.storage!.walSizeMb.toFixed(1) }} MB</td>
            </tr>
            <tr>
              <td>Retention</td>
              <td>{{ d.storage!.retentionDays }} days</td>
            </tr>
            <tr>
              <td>Last Cleanup</td>
              <td>{{ timeAgo(d.storage!.lastCleanupAt) }}</td>
            </tr>
          </tbody>
        </table>

        <table v-if="d.storage!.tables?.length" class="ss-dbg-table" style="margin-top: 8px">
          <thead>
            <tr>
              <th>Table</th>
              <th>Rows</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in d.storage!.tables" :key="t.name">
              <td style="font-family: monospace; font-size: 11px">{{ t.name }}</td>
              <td>{{ t.rowCount.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- 7. Resolved Config -->
      <div class="ss-dbg-internals-title">Resolved Config</div>
      <table class="ss-dbg-table">
        <thead>
          <tr>
            <th>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>intervalMs</td>
            <td>{{ d.config?.intervalMs }}</td>
          </tr>
          <tr>
            <td>transport</td>
            <td>{{ d.config?.transport }}</td>
          </tr>
          <tr>
            <td>channelName</td>
            <td>{{ d.config?.channelName }}</td>
          </tr>
          <tr>
            <td>endpoint</td>
            <td>{{ d.config?.endpoint === false ? 'false' : d.config?.endpoint }}</td>
          </tr>
          <tr>
            <td>skipInTest</td>
            <td>{{ d.config?.skipInTest }}</td>
          </tr>
          <tr>
            <td>onStats callback</td>
            <td>{{ d.config?.hasOnStatsCallback ? 'defined' : 'not defined' }}</td>
          </tr>
          <tr>
            <td>shouldShow callback</td>
            <td>{{ d.config?.hasShouldShowCallback ? 'defined' : 'not defined' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- DevToolbar sub-table -->
      <div class="ss-dbg-internals-title">DevToolbar</div>
      <table class="ss-dbg-table">
        <thead>
          <tr>
            <th>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>enabled</td>
            <td>{{ d.devToolbar?.enabled }}</td>
          </tr>
          <tr>
            <td>tracing</td>
            <td>{{ d.devToolbar?.tracing }}</td>
          </tr>
          <tr>
            <td>dashboard</td>
            <td>{{ d.devToolbar?.dashboard }}</td>
          </tr>
          <tr>
            <td>dashboardPath</td>
            <td style="font-family: monospace; font-size: 11px">
              {{ d.devToolbar?.dashboardPath }}
            </td>
          </tr>
          <tr>
            <td>debugEndpoint</td>
            <td style="font-family: monospace; font-size: 11px">
              <template v-if="!revealedKeys.has('cfg-debugEndpoint')">
                <span
                  class="ss-dbg-c-muted"
                  style="cursor: pointer"
                  @click="toggleReveal('cfg-debugEndpoint')"
                  >&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span
                >
              </template>
              <template v-else>
                {{ d.devToolbar?.debugEndpoint }}
                <button
                  style="
                    background: none;
                    border: none;
                    color: var(--ss-link-color, #3b82f6);
                    cursor: pointer;
                    font-size: 10px;
                    margin-left: 4px;
                    padding: 0;
                  "
                  @click="toggleReveal('cfg-debugEndpoint')"
                >
                  Hide
                </button>
              </template>
            </td>
          </tr>
          <tr>
            <td>maxQueries</td>
            <td>{{ d.devToolbar?.maxQueries }}</td>
          </tr>
          <tr>
            <td>maxEvents</td>
            <td>{{ d.devToolbar?.maxEvents }}</td>
          </tr>
          <tr>
            <td>maxEmails</td>
            <td>{{ d.devToolbar?.maxEmails }}</td>
          </tr>
          <tr>
            <td>maxTraces</td>
            <td>{{ d.devToolbar?.maxTraces }}</td>
          </tr>
          <tr>
            <td>slowQueryThresholdMs</td>
            <td>{{ d.devToolbar?.slowQueryThresholdMs }}</td>
          </tr>
          <tr>
            <td>retentionDays</td>
            <td>{{ d.devToolbar?.retentionDays }}</td>
          </tr>
          <tr>
            <td>dbPath</td>
            <td style="font-family: monospace; font-size: 11px">
              <template v-if="!revealedKeys.has('cfg-dbPath')">
                <span
                  class="ss-dbg-c-muted"
                  style="cursor: pointer"
                  @click="toggleReveal('cfg-dbPath')"
                  >&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span
                >
              </template>
              <template v-else>
                {{ d.devToolbar?.dbPath }}
                <button
                  style="
                    background: none;
                    border: none;
                    color: var(--ss-link-color, #3b82f6);
                    cursor: pointer;
                    font-size: 10px;
                    margin-left: 4px;
                    padding: 0;
                  "
                  @click="toggleReveal('cfg-dbPath')"
                >
                  Hide
                </button>
              </template>
            </td>
          </tr>
          <tr>
            <td>persistDebugData</td>
            <td>{{ d.devToolbar?.persistDebugData }}</td>
          </tr>
          <tr>
            <td>excludeFromTracing</td>
            <td style="font-size: 11px">
              {{ d.devToolbar?.excludeFromTracing?.join(', ') || '-' }}
            </td>
          </tr>
          <tr>
            <td>customPanes</td>
            <td>{{ d.devToolbar?.customPaneCount ?? 0 }} registered</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
