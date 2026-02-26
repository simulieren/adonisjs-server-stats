<script setup lang="ts">
/**
 * Overview section with performance cards and charts.
 */
import { ref, computed, onMounted } from 'vue'
import { formatDuration, formatStatNum, timeAgo } from '../../../../core/index.js'
import type { OverviewData, ChartDataPoint, TimeRange } from '../../../../core/index.js'
import Sparkline from '../../StatsBar/Sparkline.vue'
import TimeRangeSelector from '../shared/TimeRangeSelector.vue'

const props = defineProps<{
  data: any
  timeRange: TimeRange
  onFetchChart?: (range: TimeRange) => Promise<any>
}>()

const emit = defineEmits<{
  changeTimeRange: [range: TimeRange]
  navigateTo: [section: string]
}>()

const chartData = ref<ChartDataPoint[]>([])

const overview = computed<OverviewData | null>(() => props.data)

const metricCards = computed(() => {
  if (!overview.value) return []
  return [
    {
      label: 'Avg Response Time',
      value: formatStatNum(overview.value.avgResponseTime, 'ms'),
      series: overview.value.avgResponseTimeSeries || [],
      color: overview.value.avgResponseTime > 500 ? '#f87171' : overview.value.avgResponseTime > 200 ? '#fbbf24' : '#34d399',
    },
    {
      label: 'P95 Response Time',
      value: formatStatNum(overview.value.p95ResponseTime, 'ms'),
      series: overview.value.p95ResponseTimeSeries || [],
      color: overview.value.p95ResponseTime > 1000 ? '#f87171' : overview.value.p95ResponseTime > 500 ? '#fbbf24' : '#34d399',
    },
    {
      label: 'Requests/min',
      value: overview.value.requestsPerMinute.toFixed(1),
      series: overview.value.requestsPerMinuteSeries || [],
      color: '#34d399',
    },
    {
      label: 'Error Rate',
      value: `${overview.value.errorRate.toFixed(1)}%`,
      series: overview.value.errorRateSeries || [],
      color: overview.value.errorRate > 5 ? '#f87171' : overview.value.errorRate > 1 ? '#fbbf24' : '#34d399',
    },
  ]
})

async function handleRangeChange(range: TimeRange) {
  emit('changeTimeRange', range)
  if (props.onFetchChart) {
    const result = await props.onFetchChart(range)
    if (result?.data) chartData.value = result.data
  }
}

// SVG chart rendering
const chartMaxCount = computed(() => {
  if (chartData.value.length === 0) return 1
  return Math.max(...chartData.value.map((d) => d.total), 1)
})

function barHeight(count: number): number {
  return (count / chartMaxCount.value) * 100
}

onMounted(async () => {
  if (props.onFetchChart) {
    const result = await props.onFetchChart(props.timeRange)
    if (result?.data) chartData.value = result.data
  }
})
</script>

<template>
  <div class="ss-dash-overview">
    <!-- Metric cards -->
    <div v-if="overview" class="ss-dash-metric-cards">
      <div
        v-for="card in metricCards"
        :key="card.label"
        class="ss-dash-metric-card"
      >
        <div class="ss-dash-metric-card-header">
          <span class="ss-dash-metric-card-label">{{ card.label }}</span>
          <span class="ss-dash-metric-card-value" :style="{ color: card.color }">
            {{ card.value }}
          </span>
        </div>
        <div class="ss-dash-metric-card-chart">
          <Sparkline
            :data="card.series"
            :color="card.color"
            :width="200"
            :height="40"
          />
        </div>
      </div>
    </div>

    <!-- Request volume chart -->
    <div class="ss-dash-chart-section">
      <div class="ss-dash-chart-header">
        <h3 class="ss-dash-section-title">Request Volume</h3>
        <TimeRangeSelector
          :model-value="timeRange"
          @update:model-value="handleRangeChange"
        />
      </div>

      <div v-if="chartData.length > 0" class="ss-dash-bar-chart">
        <svg
          :width="Math.max(chartData.length * 12, 400)"
          height="120"
          style="display: block; width: 100%;"
          preserveAspectRatio="none"
          :viewBox="`0 0 ${Math.max(chartData.length * 12, 400)} 120`"
        >
          <g v-for="(point, i) in chartData" :key="i">
            <!-- Stacked bar: 2xx, 3xx, 4xx, 5xx -->
            <rect
              :x="i * 12 + 1"
              :y="120 - barHeight(point.total)"
              :width="10"
              :height="barHeight(point.count2xx)"
              fill="var(--ss-green-fg, #34d399)"
              opacity="0.8"
            >
              <title>{{ point.bucket }}: {{ point.count2xx }} 2xx</title>
            </rect>
            <rect
              :x="i * 12 + 1"
              :y="120 - barHeight(point.total) + barHeight(point.count2xx)"
              :width="10"
              :height="barHeight(point.count3xx)"
              fill="var(--ss-blue-fg, #60a5fa)"
              opacity="0.8"
            >
              <title>{{ point.count3xx }} 3xx</title>
            </rect>
            <rect
              :x="i * 12 + 1"
              :y="120 - barHeight(point.total) + barHeight(point.count2xx) + barHeight(point.count3xx)"
              :width="10"
              :height="barHeight(point.count4xx)"
              fill="var(--ss-amber-fg, #fbbf24)"
              opacity="0.8"
            >
              <title>{{ point.count4xx }} 4xx</title>
            </rect>
            <rect
              :x="i * 12 + 1"
              :y="120 - barHeight(point.count5xx)"
              :width="10"
              :height="barHeight(point.count5xx)"
              fill="var(--ss-red-fg, #f87171)"
              opacity="0.8"
            >
              <title>{{ point.count5xx }} 5xx</title>
            </rect>
          </g>
        </svg>
      </div>
      <div v-else class="ss-dash-empty">No chart data available</div>
    </div>

    <!-- Bottom row: secondary cards -->
    <div v-if="overview" class="ss-dash-secondary-cards">
      <!-- Slowest Endpoints -->
      <div class="ss-dash-secondary-card">
        <h4 class="ss-dash-secondary-title">Slowest Endpoints</h4>
        <div v-if="overview.slowestEndpoints && overview.slowestEndpoints.length > 0">
          <div
            v-for="ep in overview.slowestEndpoints.slice(0, 5)"
            :key="ep.url"
            class="ss-dash-endpoint-row"
          >
            <span class="ss-dash-endpoint-url">{{ ep.url }}</span>
            <span class="ss-dash-endpoint-stats">
              {{ formatDuration(ep.avgDuration) }} avg &middot; {{ ep.count }}x
            </span>
          </div>
        </div>
        <div v-else class="ss-dash-empty-small">No data yet</div>
      </div>

      <!-- Query Stats -->
      <div class="ss-dash-secondary-card">
        <h4 class="ss-dash-secondary-title">Query Stats</h4>
        <div class="ss-dash-stat-row">
          <span>Total queries:</span>
          <strong>{{ overview.queryStats?.total || 0 }}</strong>
        </div>
        <div class="ss-dash-stat-row">
          <span>Avg duration:</span>
          <strong>{{ formatDuration(overview.queryStats?.avgDuration || 0) }}</strong>
        </div>
        <div class="ss-dash-stat-row">
          <span>Queries/request:</span>
          <strong>{{ (overview.queryStats?.perRequest || 0).toFixed(1) }}</strong>
        </div>
      </div>

      <!-- Recent Errors -->
      <div class="ss-dash-secondary-card">
        <h4 class="ss-dash-secondary-title">
          Recent Errors
          <button
            class="ss-dash-link-btn"
            @click="emit('navigateTo', 'logs')"
          >
            View all
          </button>
        </h4>
        <div v-if="overview.recentErrors && overview.recentErrors.length > 0">
          <div
            v-for="err in overview.recentErrors.slice(0, 5)"
            :key="err.id"
            class="ss-dash-error-row"
          >
            <span class="ss-dash-error-level">{{ err.level }}</span>
            <span class="ss-dash-error-msg">{{ err.message }}</span>
            <span class="ss-dash-error-time">{{ timeAgo(err.timestamp) }}</span>
          </div>
        </div>
        <div v-else class="ss-dash-empty-small">No errors</div>
      </div>
    </div>

    <div v-if="!overview" class="ss-dash-empty">Loading overview...</div>
  </div>
</template>
