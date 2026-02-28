<script setup lang="ts">
/**
 * Internals diagnostics tab for the debug panel.
 *
 * Fetches from {debugEndpoint}/diagnostics using its own ApiClient,
 * with auto-refresh polling. Handles UnauthorizedError to stop polling.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ApiClient, UnauthorizedError } from '../../../../core/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CollectorInfo {
  name: string
  label: string
  status: 'healthy' | 'errored' | 'stopped'
  lastError: string | null
  lastErrorAt: number | null
  config: Record<string, unknown>
}

interface BufferInfo {
  current: number
  max: number
}

interface TimerInfo {
  active: boolean
  intervalMs?: number
  debounceMs?: number
}

interface DiagnosticsData {
  package?: {
    version: string
    nodeVersion: string
    adonisVersion: string
    uptime?: number
  }
  config?: {
    intervalMs: number
    transport: string
    channelName: string
    endpoint: string | false
    skipInTest: boolean
    hasOnStatsCallback: boolean
    hasShouldShowCallback: boolean
  }
  devToolbar?: {
    enabled: boolean
    maxQueries: number
    maxEvents: number
    maxEmails: number
    maxTraces: number
    slowQueryThresholdMs: number
    tracing: boolean
    dashboard: boolean
    dashboardPath: string
    debugEndpoint: string
    retentionDays: number
    dbPath: string
    persistDebugData: boolean | string
    excludeFromTracing: string[]
    customPaneCount: number
  }
  collectors?: CollectorInfo[]
  buffers?: Record<string, BufferInfo>
  timers?: Record<string, TimerInfo>
  transmit?: {
    available: boolean
    channels: string[]
  }
  integrations?: Record<string, { active?: boolean; available?: boolean; mode?: string }>
  storage?: {
    ready: boolean
    dbPath: string
    fileSizeMb: number
    walSizeMb: number
    retentionDays: number
    tables: Array<{ name: string; rowCount: number }>
    lastCleanupAt: number | null
  } | null
  uptime?: number
}

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

let client: ApiClient | null = null
let timer: ReturnType<typeof setInterval> | null = null

function getClient(): ApiClient {
  if (!client) {
    client = new ApiClient({
      baseUrl: props.baseUrl || '',
      authToken: props.authToken,
    })
  }
  return client
}

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

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${ms / 1000}s`
  if (ms < 3_600_000) return `${ms / 60_000}m`
  return `${ms / 3_600_000}h`
}

function formatUptime(seconds?: number): string {
  if (!seconds && seconds !== 0) return '-'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function timeAgo(ts: number | null): string {
  if (!ts) return '-'
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function fillPercent(buf: BufferInfo): number {
  if (!buf.max) return 0
  return Math.round((buf.current / buf.max) * 100)
}

function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ') || '-'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isSecret(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    lower.includes('password') ||
    lower.includes('secret') ||
    lower.includes('token') ||
    lower.includes('key')
  )
}

function formatCollectorConfig(
  config: Record<string, unknown>
): Array<{ key: string; value: string; secret: boolean }> {
  return Object.entries(config).map(([k, v]) => ({
    key: k,
    value: formatConfigValue(v),
    secret: isSecret(k),
  }))
}

function dotClass(status: string): string {
  if (['healthy', 'active', 'connected', 'available', 'ready'].includes(status))
    return 'ss-dbg-dot-ok'
  if (['errored', 'unavailable'].includes(status)) return 'ss-dbg-dot-err'
  return ''
}

const TIMER_LABELS: Record<string, string> = {
  collectionInterval: 'Stats Collection',
  dashboardBroadcast: 'Dashboard Broadcast',
  debugBroadcast: 'Debug Broadcast',
  persistFlush: 'Persist Flush',
  retentionCleanup: 'Retention Cleanup',
}

function formatTimerInterval(t: TimerInfo): string {
  if (t.debounceMs !== undefined) return `${formatMs(t.debounceMs)} (debounce)`
  if (t.intervalMs !== undefined) return formatMs(t.intervalMs)
  return '-'
}

const INTEGRATION_LABELS: Record<string, string> = {
  prometheus: 'Prometheus',
  pinoHook: 'Pino Log Hook',
  edgePlugin: 'Edge Plugin',
  cacheInspector: 'Cache Inspector',
  queueInspector: 'Queue Inspector',
}

function integrationStatus(info: { active?: boolean; available?: boolean }): string {
  if ('active' in info) return info.active ? 'active' : 'inactive'
  if ('available' in info) return info.available ? 'available' : 'unavailable'
  return 'unknown'
}

function integrationDetails(key: string, info: Record<string, unknown>): string {
  if (key === 'pinoHook' && info.mode) return `Mode: ${info.mode}`
  if (key === 'edgePlugin' && info.active) return '@serverStats() tag registered'
  if (key === 'cacheInspector')
    return info.available ? 'Redis dependency detected' : 'Redis not installed'
  if (key === 'queueInspector')
    return info.available ? 'Queue dependency detected' : '@rlanz/bull-queue not installed'
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
    percent: fillPercent(buf),
  }))
})

const timerEntries = computed(() => {
  if (!d.value.timers) return []
  return Object.entries(d.value.timers).map(([key, t]) => ({
    key,
    label: TIMER_LABELS[key] || key,
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
        label: INTEGRATION_LABELS[key] || key,
        status: integrationStatus(info),
        details: integrationDetails(key, info as Record<string, unknown>),
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
