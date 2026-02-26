<script setup lang="ts">
/**
 * Individual metric display in the stats bar.
 *
 * Shows a label + value badge with optional color coding.
 * On hover, shows a tooltip with sparkline and stats.
 * On click, pins the tooltip.
 */
import { ref, computed } from 'vue'
import { formatStatNum, computeStats } from '../../../core/index.js'
import type { MetricDefinition, ServerStats } from '../../../core/index.js'
import Sparkline from './Sparkline.vue'

const props = defineProps<{
  /** Metric definition from core. */
  metric: MetricDefinition
  /** Current stats snapshot. */
  stats: ServerStats | null
  /** History array for sparkline. */
  history: number[]
}>()

const emit = defineEmits<{
  pin: [metricId: string]
}>()

const hovered = ref(false)
const pinned = ref(false)

const displayValue = computed(() => {
  if (!props.stats) return '...'
  const fn = props.metric.value || props.metric.format
  return fn(props.stats)
})

const colorClass = computed(() => {
  if (!props.stats || !props.metric.color) return 'green'
  return props.metric.color(props.stats)
})

const isVisible = computed(() => {
  if (!props.stats || !props.metric.show) return true
  return props.metric.show(props.stats)
})

const detail = computed(() => {
  if (!props.metric.detail) return ''
  if (typeof props.metric.detail === 'function') {
    return props.stats ? props.metric.detail(props.stats) : ''
  }
  return props.metric.detail
})

const sparklineColor = computed(() => {
  const colorMap: Record<string, string> = {
    green: '#34d399',
    amber: '#fbbf24',
    red: '#f87171',
    muted: '#737373',
  }
  return colorMap[colorClass.value] || '#34d399'
})

const statsInfo = computed(() => computeStats(props.history))

function onMouseEnter() {
  hovered.value = true
}

function onMouseLeave() {
  hovered.value = false
}

function onClick() {
  pinned.value = !pinned.value
  if (pinned.value) {
    emit('pin', props.metric.id)
  }
}

function closeTooltip() {
  pinned.value = false
}

const showTooltip = computed(() => hovered.value || pinned.value)
</script>

<template>
  <div
    v-if="isVisible"
    :id="`ss-b-${metric.id}`"
    :class="['ss-badge', { 'ss-pinned': pinned }]"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
    style="position: relative"
  >
    <span class="ss-label">{{ metric.label }}</span>
    <span :class="['ss-value', `ss-${colorClass}`]">{{ displayValue }}</span>

    <!-- Tooltip -->
    <div
      v-if="showTooltip"
      :class="['ss-tooltip', { 'ss-pinned': pinned }]"
      style="
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 10px;
        z-index: 180;
      "
    >
      <div class="ss-tooltip-inner" style="position: relative">
        <button v-if="pinned" class="ss-tooltip-close" @click.stop="closeTooltip">&times;</button>
        <div class="ss-tooltip-header">
          <span class="ss-tooltip-title">{{ metric.title }}</span>
          <span v-if="metric.unit" class="ss-tooltip-unit">{{ metric.unit }}</span>
        </div>
        <div class="ss-tooltip-current">
          <span class="ss-tooltip-current-label">Current: </span>
          <span class="ss-tooltip-current-value">{{ displayValue }}</span>
        </div>
        <div v-if="statsInfo" class="ss-tooltip-stats">
          <span>Min: {{ formatStatNum(statsInfo.min, metric.unit) }}</span>
          <span>Max: {{ formatStatNum(statsInfo.max, metric.unit) }}</span>
          <span>Avg: {{ formatStatNum(statsInfo.avg, metric.unit) }}</span>
        </div>
        <div v-if="detail" class="ss-tooltip-details">{{ detail }}</div>
        <div v-if="history.length > 0" class="ss-tooltip-sparkline">
          <Sparkline :data="history" :color="sparklineColor" />
        </div>
        <div v-if="history.length > 0" class="ss-tooltip-samples">
          Last {{ Math.min(history.length, 60) }} samples (~{{
            Math.round((Math.min(history.length, 60) * 3) / 60)
          }}
          min)
        </div>
      </div>
      <div class="ss-tooltip-arrow"></div>
    </div>
  </div>
</template>
