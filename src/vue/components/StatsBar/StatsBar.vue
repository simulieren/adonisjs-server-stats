<script setup lang="ts">
/**
 * Main stats bar component.
 *
 * Fixed bar at the bottom of the viewport showing live server metrics.
 * Uses SSE/polling for real-time updates, with sparkline tooltips.
 * Auto-hides on 403, persists visibility to localStorage.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useServerStats } from '../../composables/useServerStats.js'
import { useFeatures } from '../../composables/useFeatures.js'
import { useTheme } from '../../composables/useTheme.js'
import {
  getMetricsByGroup,
  getVisibleMetricGroups,
  formatBytes,
} from '../../../core/index.js'
import type { StatsBarConfig } from '../../../core/index.js'
import MetricCard from './MetricCard.vue'

const props = withDefaults(defineProps<StatsBarConfig>(), {
  baseUrl: '',
  endpoint: '/admin/api/server-stats',
  channelName: 'admin/server-stats',
  pollInterval: 3000,
  debugEndpoint: '/admin/api/debug',
})

const emit = defineEmits<{
  openDebugPanel: []
}>()

const { stats, history, isStale, isUnauthorized, connectionMode } = useServerStats({
  baseUrl: props.baseUrl,
  endpoint: props.endpoint,
  channelName: props.channelName,
  authToken: props.authToken,
  pollInterval: props.pollInterval,
})

const { features } = useFeatures({
  baseUrl: props.baseUrl,
  debugEndpoint: props.debugEndpoint,
  authToken: props.authToken,
})

const { theme } = useTheme()

const STORAGE_KEY = 'admin:stats-bar'
const visible = ref(true)

onMounted(() => {
  visible.value = localStorage.getItem(STORAGE_KEY) !== 'hidden'
})

function toggleVisibility() {
  visible.value = !visible.value
  localStorage.setItem(STORAGE_KEY, visible.value ? 'visible' : 'hidden')
}

// Auto-hide on unauthorized
watch(isUnauthorized, (unauthorized) => {
  if (unauthorized) visible.value = false
})

// Group metrics for rendering with separators, filtered by enabled features
const metricGroups = computed(() => {
  const visibleGroups = getVisibleMetricGroups(features.value)
  const groups = getMetricsByGroup()
  return Array.from(groups.entries())
    .filter(([name]) => visibleGroups.has(name))
    .map(([name, metrics]) => ({
      name,
      metrics,
    }))
})

function getMetricHistory(historyKey?: string): number[] {
  if (!historyKey) return []
  return (history as Record<string, number[]>)[historyKey] || []
}

// Toggle summary values for collapsed state
const cpuSummary = computed(() => {
  if (!stats.value) return '...'
  return `${stats.value.cpuPercent.toFixed(0)}%`
})

const memSummary = computed(() => {
  if (!stats.value) return '...'
  return formatBytes(stats.value.memHeapUsed)
})

const redisSummary = computed(() => {
  if (!stats.value) return '...'
  return stats.value.redisOk ? '\u2713' : '\u2717'
})

const themeAttr = computed(() => theme.value)
</script>

<template>
  <!-- Stats Bar -->
  <div
    v-if="!isUnauthorized"
    id="ss-bar"
    :class="['ss-bar', { 'ss-hidden': !visible }]"
    :data-ss-theme="themeAttr"
  >
    <div class="ss-bar-left">
      <button
        v-if="features.tracing || features.redis || features.queues"
        type="button"
        class="ss-dbg-btn"
        title="Open debug panel"
        @click="emit('openDebugPanel')"
      >
        &#x1F50D; Open debug panel
      </button>
      <div :class="['ss-dot', { 'ss-stale': isStale }]"></div>
    </div>

    <div id="ss-bar-scroll" class="ss-bar-scroll">
      <template v-for="(group, gi) in metricGroups" :key="group.name">
        <div class="ss-group">
          <MetricCard
            v-for="metric in group.metrics"
            :key="metric.id"
            :metric="metric"
            :stats="stats"
            :history="getMetricHistory(metric.historyKey)"
          />
        </div>
        <div v-if="gi < metricGroups.length - 1" class="ss-group-sep"></div>
      </template>
    </div>
  </div>

  <!-- Toggle Button -->
  <button
    v-if="!isUnauthorized"
    type="button"
    :class="['ss-toggle', visible ? 'ss-visible' : 'ss-collapsed']"
    :data-ss-theme="themeAttr"
    :title="visible ? 'Hide stats bar' : 'Show stats bar'"
    @click="toggleVisibility"
  >
    <span v-if="!visible" class="ss-toggle-summary">
      <span v-if="features.process" class="ss-value ss-green">{{ cpuSummary }}</span>
      <span v-if="features.process" class="ss-value ss-green">{{ memSummary }}</span>
      <span v-if="features.redis" :class="['ss-value', stats?.redisOk ? 'ss-green' : 'ss-red']">{{ redisSummary }}</span>
    </span>
    <span v-if="visible" class="ss-toggle-label" style="color: #737373">hide stats</span>
    <span class="ss-toggle-arrow">{{ visible ? '\u25BC' : '\u25B2' }}</span>
  </button>
</template>
