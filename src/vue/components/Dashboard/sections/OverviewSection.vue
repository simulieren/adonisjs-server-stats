<script setup lang="ts">
/**
 * Overview section with performance cards, area chart, and secondary info cards.
 * Self-contained: fetches its own data via useDashboardData composable.
 * Matches React OverviewSection.tsx exactly.
 */
import {
  ref,
  computed,
  watch,
  inject,
  onUnmounted,
  type Ref,
} from 'vue'
import {
  durationSeverity,
  formatDuration,
  formatTime,
  timeAgo,
} from '../../../../core/formatters.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import Sparkline from '../../StatsBar/Sparkline.vue'
import TimeRangeSelector from '../shared/TimeRangeSelector.vue'

import type {
  OverviewMetrics,
  ChartDataPoint,
  TimeRange,
} from '../../../../core/types.js'

/* ── Injected values from parent DashboardPage ──────────────────────── */
const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const baseUrl = inject<string>('ss-base-url', '')
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)

/* ── Local state ─────────────────────────────────────────────────────── */
const uid = Math.random().toString(36).slice(2, 8)
const timeRange = ref<TimeRange>('1h')

/* ── Data fetching ───────────────────────────────────────────────────── */
const {
  data: overviewRaw,
  loading: isLoading,
} = useDashboardData(() => 'overview' as const, {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const {
  data: chartResponseRaw,
  setTimeRange: setChartTimeRange,
} = useDashboardData(() => 'overview/chart' as const, {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

// When timeRange changes from the UI, propagate to the chart composable
watch(timeRange, (range) => {
  setChartTimeRange(range)
})

/* ── Computed data ───────────────────────────────────────────────────── */
const overview = computed<OverviewMetrics | null>(() => {
  return overviewRaw.value as OverviewMetrics | null
})

const metrics = computed<OverviewMetrics>(() => {
  return overview.value || {
    avgResponseTime: 0,
    p95ResponseTime: 0,
    requestsPerMinute: 0,
    errorRate: 0,
    totalRequests: 0,
    slowestEndpoints: [],
    queryStats: { total: 0, avgDuration: 0, perRequest: 0 },
    recentErrors: [],
    topEvents: [],
    emailActivity: { sent: 0, queued: 0, failed: 0 },
    logLevelBreakdown: { error: 0, warn: 0, info: 0, debug: 0 },
    cacheStats: null,
    jobQueueStatus: null,
    statusDistribution: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    slowestQueries: [],
  }
})

// Support both camelCase and snake_case API field names
const raw = computed(() => metrics.value as unknown as Record<string, unknown>)
const avgResponseTime = computed(() => metrics.value.avgResponseTime || Number(raw.value.avg_response_time) || 0)
const p95ResponseTime = computed(() => metrics.value.p95ResponseTime || Number(raw.value.p95_response_time) || 0)
const requestsPerMinute = computed(() => metrics.value.requestsPerMinute || Number(raw.value.requests_per_minute) || 0)
const errorRate = computed(() => metrics.value.errorRate || Number(raw.value.error_rate) || 0)
const totalRequests = computed(() => metrics.value.totalRequests || Number(raw.value.total_requests) || 0)
const hasData = computed(() => totalRequests.value > 0)

// Chart data
const chartPoints = computed<ChartDataPoint[]>(() => {
  const resp = chartResponseRaw.value as { buckets?: ChartDataPoint[] } | null
  return resp?.buckets || []
})

// Sparkline data: prefer pre-computed from API, fall back to chart points
const avgResponseTimes = computed(() =>
  metrics.value.sparklines?.avgResponseTime ?? chartPoints.value.map((p) => p.avgDuration ?? 0)
)
const p95ResponseTimes = computed(() =>
  metrics.value.sparklines?.p95ResponseTime ?? chartPoints.value.map((p) => p.p95Duration ?? 0)
)
const requestCounts = computed(() =>
  metrics.value.sparklines?.requestsPerMinute ?? chartPoints.value.map((p) => p.requestCount ?? 0)
)
const errorCounts = computed(() =>
  metrics.value.sparklines?.errorRate ?? chartPoints.value.map((p) => p.errorCount ?? 0)
)

/* ── Unique gradient IDs (avoid SVG collisions) ──────────────────────── */
const gradientTotalId = computed(() => `ss-cg-total-${uid}`)
const gradientErrorId = computed(() => `ss-cg-error-${uid}`)

/* ── Chart helpers ───────────────────────────────────────────────────── */

/** Compute nice Y-axis tick values */
function niceYTicks(max: number, count: number): number[] {
  if (max <= 0) return [0]
  const rawVal = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(rawVal)))
  const nice = rawVal / mag
  let step: number
  if (nice <= 1) step = mag
  else if (nice <= 2) step = 2 * mag
  else if (nice <= 5) step = 5 * mag
  else step = 10 * mag
  const ticks: number[] = []
  for (let v = step; v <= max + step * 0.5; v += step) ticks.push(Math.round(v))
  if (ticks.length === 0) ticks.push(Math.ceil(max))
  return ticks
}

/** Format a bucket timestamp to HH:MM */
function bucketLabel(bucket: string): string {
  try {
    const d = new Date(bucket)
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/** Build a smooth SVG path through a set of points (monotone cubic) */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`

  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const cpx = (p0.x + p1.x) / 2
    d += ` C${cpx.toFixed(1)},${p0.y.toFixed(1)} ${cpx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`
  }
  return d
}

/** Compute a CSS class for a duration value */
function durationClass(ms: number): string {
  const sev = durationSeverity(ms)
  if (sev === 'very-slow') return 'ss-dash-very-slow'
  if (sev === 'slow') return 'ss-dash-slow'
  return ''
}

/* ── Chart reactive state (ResizeObserver + tooltip) ─────────────────── */
const chartContainerRef = ref<HTMLDivElement | null>(null)
const measuredWidth = ref(0)
let resizeObserver: ResizeObserver | null = null

watch(chartContainerRef, (el) => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (!el) return
  measuredWidth.value = el.clientWidth
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      measuredWidth.value = entry.contentRect.width
    }
  })
  resizeObserver.observe(el)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

const pad = { top: 12, right: 12, bottom: 28, left: 38 }
const chartHeight = 220

const w = computed(() => measuredWidth.value || 600)
const cw = computed(() => w.value - pad.left - pad.right)
const ch = computed(() => chartHeight - pad.top - pad.bottom)
const baseline = computed(() => pad.top + ch.value)

const totals = computed(() =>
  chartPoints.value.map((p) => {
    const r = p as unknown as Record<string, unknown>
    const rc = (p.requestCount ?? 0) + (Number(r.request_count) || 0)
    return rc || p.total || 0
  })
)
const errors = computed(() =>
  chartPoints.value.map((p) => {
    const r = p as unknown as Record<string, unknown>
    return (p.errorCount ?? 0) + (Number(r.error_count) || 0)
  })
)
const maxCount = computed(() => Math.max(...totals.value, 1))
const maxVal = computed(() => Math.ceil(maxCount.value * 1.1))
const hasErrors = computed(() => errors.value.some((e) => e > 0))

const yTicks = computed(() => niceYTicks(maxVal.value, 4))
const yMax = computed(() => yTicks.value.length > 0 ? yTicks.value[yTicks.value.length - 1] : maxVal.value)

function toX(i: number): number {
  return pad.left + (i / Math.max(chartPoints.value.length - 1, 1)) * cw.value
}
function toY(v: number): number {
  return pad.top + ch.value - (v / (yMax.value || 1)) * ch.value
}

const totalPoints = computed(() =>
  chartPoints.value.map((_, i) => ({ x: toX(i), y: toY(totals.value[i]) }))
)
const errorPoints = computed(() =>
  chartPoints.value.map((_, i) => ({ x: toX(i), y: toY(errors.value[i]) }))
)

const totalLine = computed(() => smoothPath(totalPoints.value))
const errorLine = computed(() => hasErrors.value ? smoothPath(errorPoints.value) : '')

const totalArea = computed(() =>
  totalPoints.value.length > 1
    ? `${totalLine.value} L${totalPoints.value[totalPoints.value.length - 1].x.toFixed(1)},${baseline.value} L${totalPoints.value[0].x.toFixed(1)},${baseline.value} Z`
    : ''
)
const errorArea = computed(() =>
  hasErrors.value && errorPoints.value.length > 1
    ? `${errorLine.value} L${errorPoints.value[errorPoints.value.length - 1].x.toFixed(1)},${baseline.value} L${errorPoints.value[0].x.toFixed(1)},${baseline.value} Z`
    : ''
)

// X-axis label interval
const maxLabels = computed(() => Math.min(10, chartPoints.value.length))
const labelInterval = computed(() => Math.max(1, Math.ceil(chartPoints.value.length / maxLabels.value)))

// Tooltip state
const tooltip = ref<{ visible: boolean; x: number; idx: number }>({ visible: false, x: 0, idx: -1 })

function handleMouseEnter(i: number) {
  const cx = totalPoints.value[i].x
  tooltip.value = { visible: true, x: cx, idx: i }
}

function handleMouseLeave() {
  tooltip.value = { visible: false, x: 0, idx: -1 }
}

const tooltipWidth = 120
const clampedLeft = computed(() =>
  tooltip.value.visible
    ? Math.max(tooltipWidth / 2, Math.min(tooltip.value.x, w.value - tooltipWidth / 2))
    : 0
)

const sliceWidth = computed(() => cw.value / (chartPoints.value.length || 1))

function showXLabel(i: number): boolean {
  return i % labelInterval.value === 0 || i === chartPoints.value.length - 1
}

/* ── Value color helpers (matching React) ────────────────────────────── */
function avgClass(): string {
  if (!hasData.value) return 'ss-dash-dim'
  if (avgResponseTime.value > 500) return 'ss-dash-red'
  if (avgResponseTime.value > 200) return 'ss-dash-amber'
  return 'ss-dash-accent'
}
function p95Class(): string {
  if (!hasData.value) return 'ss-dash-dim'
  if (p95ResponseTime.value > 500) return 'ss-dash-red'
  if (p95ResponseTime.value > 200) return 'ss-dash-amber'
  return 'ss-dash-accent'
}
function rpmClass(): string {
  return !hasData.value ? 'ss-dash-dim' : 'ss-dash-accent'
}
function errorRateClass(): string {
  if (!hasData.value) return 'ss-dash-dim'
  if (errorRate.value > 5) return 'ss-dash-red'
  if (errorRate.value > 1) return 'ss-dash-amber'
  return 'ss-dash-accent'
}

/* ── Secondary card helpers ──────────────────────────────────────────── */
function epUrl(ep: { url?: string; pattern?: string }): string {
  return ep.url || ep.pattern || '-'
}

function eventName(ev: { name?: string; eventName?: string; event_name?: string; event?: string }): string {
  return ev.name || ev.eventName || ev.event_name || ev.event || ''
}

function querySql(q: { sqlNormalized?: string; normalizedSql?: string; sql_normalized?: string; sql?: string }): string {
  return q.sqlNormalized || q.normalizedSql || q.sql_normalized || q.sql || '-'
}
</script>

<template>
  <div class="ss-dash-overview">
    <!-- Loading state -->
    <div v-if="isLoading && !overview" class="ss-dash-empty">Loading overview...</div>

    <template v-else>
      <!-- Top metric cards -->
      <div class="ss-dash-cards">
        <div class="ss-dash-card">
          <div class="ss-dash-card-title">Avg Response Time</div>
          <div :class="['ss-dash-card-value', avgClass()]">
            {{ hasData ? formatDuration(avgResponseTime) : '-' }}
          </div>
          <div class="ss-dash-sparkline">
            <Sparkline :data="avgResponseTimes" color="#34d399" :width="160" :height="40" />
          </div>
        </div>
        <div class="ss-dash-card">
          <div class="ss-dash-card-title">P95 Response Time</div>
          <div :class="['ss-dash-card-value', p95Class()]">
            {{ hasData ? formatDuration(p95ResponseTime) : '-' }}
          </div>
          <div class="ss-dash-sparkline">
            <Sparkline :data="p95ResponseTimes" color="#60a5fa" :width="160" :height="40" />
          </div>
        </div>
        <div class="ss-dash-card">
          <div class="ss-dash-card-title">Requests / min</div>
          <div :class="['ss-dash-card-value', rpmClass()]">
            {{ hasData ? requestsPerMinute.toFixed(1) : '-' }}
          </div>
          <div class="ss-dash-sparkline">
            <Sparkline :data="requestCounts" color="#34d399" :width="160" :height="40" />
          </div>
        </div>
        <div class="ss-dash-card">
          <div class="ss-dash-card-title">Error Rate</div>
          <div :class="['ss-dash-card-value', errorRateClass()]">
            {{ hasData ? `${errorRate.toFixed(1)}%` : '-' }}
          </div>
          <div class="ss-dash-sparkline">
            <Sparkline :data="errorCounts" color="#f87171" :width="160" :height="40" />
          </div>
        </div>
      </div>

      <!-- Request volume chart -->
      <div class="ss-dash-chart-container">
        <div class="ss-dash-chart-header">
          <span class="ss-dash-chart-title">Request Volume</span>
          <TimeRangeSelector :model-value="timeRange" @update:model-value="timeRange = $event" />
        </div>
        <div class="ss-dash-chart" id="ss-dash-chart-area">
          <div v-if="chartPoints.length === 0" class="ss-dash-empty" style="min-height: 120px">
            No data for this range
          </div>
          <!-- Area chart -->
          <div v-else ref="chartContainerRef" style="position: relative">
            <svg :viewBox="`0 0 ${w} ${chartHeight}`" class="ss-dash-chart-svg">
              <!-- Gradient definitions -->
              <defs>
                <linearGradient :id="gradientTotalId" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--ss-accent)" stop-opacity="0.3" />
                  <stop offset="100%" stop-color="var(--ss-accent)" stop-opacity="0.02" />
                </linearGradient>
                <linearGradient :id="gradientErrorId" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--ss-red-fg)" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="var(--ss-red-fg)" stop-opacity="0.02" />
                </linearGradient>
              </defs>

              <!-- Horizontal grid lines + Y-axis labels -->
              <g v-for="val in yTicks" :key="`ytick-${val}`">
                <line
                  :x1="pad.left"
                  :y1="toY(val)"
                  :x2="w - pad.right"
                  :y2="toY(val)"
                  stroke="var(--ss-border-faint)"
                  stroke-width="0.5"
                  stroke-dasharray="3,3"
                />
                <text
                  :x="pad.left - 6"
                  :y="toY(val)"
                  text-anchor="end"
                  fill="var(--ss-dim)"
                  font-size="9"
                  dominant-baseline="middle"
                >
                  {{ val }}
                </text>
              </g>

              <!-- Total requests: gradient fill + line -->
              <path v-if="totalArea" :d="totalArea" :fill="`url(#${gradientTotalId})`" />
              <path
                v-if="totalLine"
                :d="totalLine"
                fill="none"
                stroke="var(--ss-accent)"
                stroke-width="1.5"
                stroke-linejoin="round"
                stroke-linecap="round"
              />

              <!-- Error requests: gradient fill + dashed line -->
              <path v-if="errorArea" :d="errorArea" :fill="`url(#${gradientErrorId})`" />
              <path
                v-if="errorLine"
                :d="errorLine"
                fill="none"
                stroke="var(--ss-red-fg)"
                stroke-width="1.5"
                stroke-linejoin="round"
                stroke-linecap="round"
                stroke-dasharray="4,2"
              />

              <!-- Hover zones + data point dots -->
              <g v-for="(point, i) in chartPoints" :key="i">
                <!-- Invisible hover target -->
                <rect
                  :x="totalPoints[i].x - sliceWidth / 2"
                  :y="pad.top"
                  :width="sliceWidth"
                  :height="ch"
                  fill="transparent"
                  class="ss-dash-chart-hover-zone"
                  :data-idx="i"
                  @mouseenter="handleMouseEnter(i)"
                  @mouseleave="handleMouseLeave"
                />
                <!-- Request dot -->
                <circle
                  v-if="totals[i] > 0"
                  :cx="totalPoints[i].x"
                  :cy="totalPoints[i].y"
                  :r="tooltip.visible && tooltip.idx === i ? 4 : 2.5"
                  fill="var(--ss-accent)"
                  stroke="var(--ss-surface)"
                  stroke-width="1"
                  class="ss-dash-chart-dot"
                  :data-idx="i"
                  :opacity="tooltip.visible && tooltip.idx !== i ? 0.3 : 1"
                />
                <!-- Error dot -->
                <circle
                  v-if="errors[i] > 0"
                  :cx="totalPoints[i].x"
                  :cy="errorPoints[i].y"
                  :r="tooltip.visible && tooltip.idx === i ? 3.5 : 2"
                  fill="var(--ss-red-fg)"
                  stroke="var(--ss-surface)"
                  stroke-width="1"
                  class="ss-dash-chart-dot ss-dash-chart-dot-err"
                  :data-idx="i"
                  :opacity="tooltip.visible && tooltip.idx !== i ? 0.3 : 1"
                />
              </g>

              <!-- X-axis labels -->
              <template v-for="(point, i) in chartPoints" :key="`xlabel-${i}`">
                <text
                  v-if="showXLabel(i) && bucketLabel(point.bucket)"
                  :x="toX(i)"
                  :y="chartHeight - 6"
                  text-anchor="middle"
                  fill="var(--ss-dim)"
                  font-size="9"
                >
                  {{ bucketLabel(point.bucket) }}
                </text>
              </template>
            </svg>

            <!-- Floating tooltip -->
            <div
              v-if="tooltip.visible && tooltip.idx >= 0"
              class="ss-dash-chart-tooltip"
              :style="{
                left: clampedLeft + 'px',
                top: (pad.top - 4) + 'px',
                transform: 'translate(-50%, -100%)',
              }"
            >
              <div>{{ bucketLabel(chartPoints[tooltip.idx].bucket) }}</div>
              <div>Requests: {{ totals[tooltip.idx] }}</div>
              <div v-if="errors[tooltip.idx] > 0" style="color: var(--ss-red-fg)">
                Errors: {{ errors[tooltip.idx] }}
              </div>
            </div>
          </div>
        </div>
        <div class="ss-dash-chart-legend" id="ss-dash-chart-legend">
          <span class="ss-dash-chart-legend-item">
            <span class="ss-dash-legend-dot" style="background: var(--ss-accent)" />
            Requests
          </span>
          <span v-if="chartPoints.some((p) => (p.errorCount ?? 0) > 0)" class="ss-dash-chart-legend-item">
            <span class="ss-dash-legend-dot" style="background: var(--ss-red-fg)" />
            Errors
          </span>
        </div>
      </div>

      <!-- Secondary cards -->
      <div class="ss-dash-secondary-cards">
        <!-- Slowest Endpoints -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#requests" class="ss-dash-widget-link">Slowest Endpoints</a>
          </div>
          <div v-if="metrics.slowestEndpoints.length === 0" class="ss-dash-empty" style="min-height: 60px">
            No data yet
          </div>
          <ul v-else class="ss-dash-secondary-list">
            <li v-for="(ep, i) in metrics.slowestEndpoints.slice(0, 5)" :key="i">
              <a :href="`#requests?url=${encodeURIComponent(epUrl(ep))}`" class="ss-dash-widget-row-link">
                <span :title="epUrl(ep)">{{ epUrl(ep) }}</span>
                <span :class="['ss-dash-secondary-list-value', 'ss-dash-duration', durationClass(ep.avgDuration)]">
                  {{ formatDuration(ep.avgDuration) }}
                </span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Query Stats -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#queries" class="ss-dash-widget-link">Query Stats</a>
          </div>
          <ul class="ss-dash-secondary-list">
            <li>
              <span>Total Queries</span>
              <span class="ss-dash-secondary-list-value">{{ metrics.queryStats.total }}</span>
            </li>
            <li>
              <span>Avg Duration</span>
              <span class="ss-dash-secondary-list-value">
                {{ formatDuration(metrics.queryStats.avgDuration) }}
              </span>
            </li>
            <li>
              <span>Queries / Request</span>
              <span class="ss-dash-secondary-list-value">
                {{ metrics.queryStats.perRequest.toFixed(1) }}
              </span>
            </li>
          </ul>
        </div>

        <!-- Recent Errors -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#logs?level=error" class="ss-dash-widget-link">Recent Errors</a>
          </div>
          <div v-if="metrics.recentErrors.length === 0" class="ss-dash-empty" style="min-height: 60px">
            No recent errors
          </div>
          <ul v-else class="ss-dash-secondary-list">
            <li v-for="(err, i) in metrics.recentErrors" :key="i">
              <a :href="`#logs?id=${err.id ?? ''}`" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-red-fg)" :title="err.message">
                  {{ err.message }}
                </span>
                <span
                  v-if="err.timestamp"
                  class="ss-dash-secondary-list-value"
                  style="color: var(--ss-dim)"
                  :title="formatTime(err.timestamp)"
                >
                  {{ timeAgo(err.timestamp) }}
                </span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Top Events -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#events" class="ss-dash-widget-link">Top Events</a>
          </div>
          <div v-if="metrics.topEvents.length === 0" class="ss-dash-empty" style="min-height: 60px">
            No events yet
          </div>
          <ul v-else class="ss-dash-secondary-list">
            <li v-for="(ev, i) in metrics.topEvents.slice(0, 5)" :key="i">
              <a :href="`#events?event_name=${encodeURIComponent(eventName(ev))}`" class="ss-dash-widget-row-link">
                <span>{{ eventName(ev) }}</span>
                <span class="ss-dash-secondary-list-value">{{ ev.count }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Email Activity -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#emails" class="ss-dash-widget-link">Email Activity</a>
          </div>
          <ul class="ss-dash-secondary-list">
            <li>
              <a href="#emails?status=sent" class="ss-dash-widget-row-link">
                <span>Sent</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.emailActivity.sent }}</span>
              </a>
            </li>
            <li>
              <a href="#emails?status=queued" class="ss-dash-widget-row-link">
                <span>Queued</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.emailActivity.queued }}</span>
              </a>
            </li>
            <li>
              <a href="#emails?status=failed" class="ss-dash-widget-row-link">
                <span>Failed</span>
                <span
                  class="ss-dash-secondary-list-value"
                  :style="metrics.emailActivity.failed > 0 ? { color: 'var(--ss-red-fg)' } : undefined"
                >
                  {{ metrics.emailActivity.failed }}
                </span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Log Levels -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#logs" class="ss-dash-widget-link">Log Levels</a>
          </div>
          <ul class="ss-dash-secondary-list">
            <li>
              <a href="#logs?level=error" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-red-fg)">Error</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.logLevelBreakdown.error }}</span>
              </a>
            </li>
            <li>
              <a href="#logs?level=warn" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-amber-fg)">Warn</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.logLevelBreakdown.warn }}</span>
              </a>
            </li>
            <li>
              <a href="#logs?level=info" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-green-fg)">Info</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.logLevelBreakdown.info }}</span>
              </a>
            </li>
            <li>
              <a href="#logs?level=debug" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-dim)">Debug</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.logLevelBreakdown.debug }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Cache -->
        <div v-if="metrics.cacheStats && metrics.cacheStats.available" class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#cache" class="ss-dash-widget-link">Cache</a>
          </div>
          <ul class="ss-dash-secondary-list">
            <li>
              <a href="#cache" class="ss-dash-widget-row-link">
                <span>Keys</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.cacheStats.totalKeys }}</span>
              </a>
            </li>
            <li>
              <a href="#cache" class="ss-dash-widget-row-link">
                <span>Hit Rate</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.cacheStats.hitRate.toFixed(1) }}%</span>
              </a>
            </li>
            <li>
              <a href="#cache" class="ss-dash-widget-row-link">
                <span>Memory</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.cacheStats.memoryUsedHuman }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Job Queue -->
        <div v-if="metrics.jobQueueStatus && metrics.jobQueueStatus.available" class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#jobs" class="ss-dash-widget-link">Job Queue</a>
          </div>
          <ul class="ss-dash-secondary-list">
            <li>
              <a href="#jobs?status=active" class="ss-dash-widget-row-link">
                <span>Active</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.jobQueueStatus.active }}</span>
              </a>
            </li>
            <li>
              <a href="#jobs?status=waiting" class="ss-dash-widget-row-link">
                <span>Waiting</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.jobQueueStatus.waiting }}</span>
              </a>
            </li>
            <li>
              <a href="#jobs?status=failed" class="ss-dash-widget-row-link">
                <span>Failed</span>
                <span
                  class="ss-dash-secondary-list-value"
                  :style="metrics.jobQueueStatus.failed > 0 ? { color: 'var(--ss-red-fg)' } : undefined"
                >
                  {{ metrics.jobQueueStatus.failed }}
                </span>
              </a>
            </li>
            <li>
              <a href="#jobs?status=completed" class="ss-dash-widget-row-link">
                <span>Completed</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.jobQueueStatus.completed }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Response Status -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#requests" class="ss-dash-widget-link">Response Status</a>
          </div>
          <ul class="ss-dash-secondary-list">
            <li>
              <a href="#requests?status=2xx" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-green-fg)">2xx</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.statusDistribution['2xx'] }}</span>
              </a>
            </li>
            <li>
              <a href="#requests?status=3xx" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-blue-fg)">3xx</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.statusDistribution['3xx'] }}</span>
              </a>
            </li>
            <li>
              <a href="#requests?status=4xx" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-amber-fg)">4xx</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.statusDistribution['4xx'] }}</span>
              </a>
            </li>
            <li>
              <a href="#requests?status=5xx" class="ss-dash-widget-row-link">
                <span style="color: var(--ss-red-fg)">5xx</span>
                <span class="ss-dash-secondary-list-value">{{ metrics.statusDistribution['5xx'] }}</span>
              </a>
            </li>
          </ul>
        </div>

        <!-- Slowest Queries -->
        <div class="ss-dash-secondary-card">
          <div class="ss-dash-secondary-card-title">
            <a href="#queries" class="ss-dash-widget-link">Slowest Queries</a>
          </div>
          <div v-if="metrics.slowestQueries.length === 0" class="ss-dash-empty" style="min-height: 60px">
            No query data yet
          </div>
          <ul v-else class="ss-dash-secondary-list">
            <li v-for="(q, i) in metrics.slowestQueries.slice(0, 5)" :key="i">
              <a :href="`#queries?pattern=${encodeURIComponent(querySql(q))}`" class="ss-dash-widget-row-link">
                <span :title="querySql(q)">{{ querySql(q) }}</span>
                <span :class="['ss-dash-secondary-list-value', 'ss-dash-duration', durationClass(q.avgDuration)]">
                  {{ formatDuration(q.avgDuration) }}
                </span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Contain card and sparkline overflow to prevent content from bleeding
   into the row below. The React Sparkline wraps itself in an extra
   .ss-dash-sparkline div (double-nesting) which implicitly clips;
   Vue's Sparkline renders a bare <svg>, so the single wrapper here
   needs explicit overflow control. */
.ss-dash-card {
  overflow: hidden;
}
.ss-dash-sparkline {
  overflow: hidden;
}
.ss-dash-secondary-card {
  overflow: hidden;
}
/* Chart containment – the SVG uses only a viewBox (no explicit width/height
   attributes), so the parent needs a fixed height matching `chartHeight` (220px)
   and overflow:hidden to prevent the chart from bleeding into secondary cards. */
.ss-dash-chart-container {
  overflow: hidden;
}
.ss-dash-chart {
  overflow: hidden;
  height: 220px;
}
.ss-dash-chart-svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
