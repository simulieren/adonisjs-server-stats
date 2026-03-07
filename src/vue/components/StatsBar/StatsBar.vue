<script setup lang="ts">
/**
 * Main stats bar component.
 *
 * Fixed bar at the bottom of the viewport showing live server metrics.
 * Uses SSE/polling for real-time updates, with sparkline tooltips.
 * Auto-hides on 403, persists visibility to localStorage.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useServerStats } from '../../composables/useServerStats.js'
import { useFeatures } from '../../composables/useFeatures.js'
import { useTheme } from '../../composables/useTheme.js'
import {
  getMetricsByGroup,
  getVisibleMetricGroups,
  detectMetricGroupsFromStats,
  formatBytes,
} from '../../../core/index.js'
import type { StatsBarConfig } from '../../../core/index.js'
import { TAB_ICONS } from '../../../core/index.js'
import MetricCard from './MetricCard.vue'

const props = withDefaults(defineProps<StatsBarConfig & { debugPanelOpen?: boolean }>(), {
  baseUrl: '',
  endpoint: '/admin/api/server-stats',
  channelName: 'admin/server-stats',
  pollInterval: 3000,
  debugEndpoint: '/admin/api/debug',
  debugPanelOpen: false,
})

const emit = defineEmits<{
  openDebugPanel: []
  connectionChange: [isConnected: boolean]
}>()

const { stats, history, isStale, isUnauthorized, isConnected, connectionMode } = useServerStats({
  baseUrl: props.baseUrl,
  endpoint: props.endpoint,
  channelName: props.channelName,
  authToken: props.authToken,
  pollInterval: props.pollInterval,
})

watch(isConnected, (value) => {
  emit('connectionChange', value)
})

const { features } = useFeatures({
  baseUrl: props.baseUrl,
  debugEndpoint: props.debugEndpoint,
  authToken: props.authToken,
})

const { theme } = useTheme()

const STORAGE_KEY = 'admin:stats-bar'
const visible = ref(true)
const scrollRef = ref<HTMLDivElement | null>(null)

onMounted(() => {
  visible.value = localStorage.getItem(STORAGE_KEY) !== 'hidden'

  // Horizontal wheel scroll
  const el = scrollRef.value
  if (el) {
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', handler, { passive: false })
    onUnmounted(() => el.removeEventListener('wheel', handler))
  }
})

function toggleVisibility() {
  visible.value = !visible.value
  localStorage.setItem(STORAGE_KEY, visible.value ? 'visible' : 'hidden')
}

// Auto-hide on unauthorized
watch(isUnauthorized, (unauthorized) => {
  if (unauthorized) visible.value = false
})

// Group metrics for rendering with separators, filtered by available data.
// Primary: detect groups from actual stats data (mirrors old vanilla JS behavior).
// Fallback: use feature flags from the debug endpoint before stats arrive.
const visibleGroups = computed(() => {
  if (stats.value) {
    return detectMetricGroupsFromStats(stats.value as unknown as Record<string, unknown>)
  }
  return getVisibleMetricGroups(features.value)
})

const metricGroups = computed(() => {
  const groups = getMetricsByGroup()
  return Array.from(groups.entries())
    .filter(([name]) => visibleGroups.value.has(name))
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
  return stats.value.memHeapUsed !== undefined
    ? Math.round(stats.value.memHeapUsed / (1024 * 1024)) + 'M'
    : '-'
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
        v-if="features.tracing || visibleGroups.has('redis') || visibleGroups.has('queue')"
        type="button"
        :class="['ss-dbg-btn', { 'ss-dbg-active': debugPanelOpen }]"
        title="Toggle debug panel"
        id="ss-dbg-wrench"
        @click="emit('openDebugPanel')"
      >
        <svg
          width="14"
          height="14"
          :viewBox="TAB_ICONS.wrench.viewBox"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="TAB_ICONS.wrench.elements.join('')"
        ></svg>
      </button>
      <div :class="['ss-dot', { 'ss-stale': isStale }]"></div>
    </div>

    <div ref="scrollRef" id="ss-bar-scroll" class="ss-bar-scroll">
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
    <span v-if="!visible && stats" class="ss-toggle-summary" style="display: flex">
      <span
        v-if="visibleGroups.has('process')"
        :class="[
          'ss-value',
          stats.cpuPercent > 80 ? 'ss-red' : stats.cpuPercent > 50 ? 'ss-amber' : 'ss-green',
        ]"
        >{{ cpuSummary }}</span
      >
      <span v-if="visibleGroups.has('process')" class="ss-value ss-green">{{ memSummary }}</span>
      <span
        v-if="visibleGroups.has('redis') && stats?.redisOk !== undefined"
        :class="['ss-value', stats?.redisOk ? 'ss-green' : 'ss-red']"
        >{{ redisSummary }}</span
      >
    </span>
    <span v-if="visible" class="ss-toggle-label" style="color: #737373">hide stats</span>
    <span class="ss-toggle-arrow">{{ visible ? '\u25BC' : '\u25B2' }}</span>
  </button>
</template>
