<script setup lang="ts">
/**
 * Individual metric display in the stats bar.
 *
 * Shows a label + value badge with optional color coding.
 * On hover, shows a tooltip with sparkline and stats.
 * On click, pins the tooltip.
 *
 * The tooltip is teleported to the nearest .ss-bar ancestor so it is
 * not clipped by the scroll container (overflow-x: auto on .ss-bar-scroll).
 * Position is calculated relative to the badge, matching the old vanilla JS
 * positionTooltip behaviour.
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
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
const badgeRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)

/** Teleport target: the closest .ss-bar ancestor element. */
const teleportTarget = ref<HTMLElement | null>(null)

const tooltipStyle = ref<Record<string, string>>({
  position: 'absolute',
  bottom: '100%',
  left: '0',
  marginBottom: '10px',
  zIndex: '180',
})

onMounted(() => {
  if (badgeRef.value) {
    teleportTarget.value = badgeRef.value.closest('.ss-bar') as HTMLElement | null
  }
})

/**
 * Compute tooltip position relative to .ss-bar, matching the old
 * vanilla JS positionTooltip behaviour:
 *   left = badge centre relative to bar left
 *   bottom = 100% (above the bar)
 *   edge-clamp so the tooltip never overflows the viewport.
 */
function updateTooltipPosition() {
  const badge = badgeRef.value
  const tip = tooltipRef.value
  const bar = teleportTarget.value
  if (!badge || !tip || !bar) return

  const badgeRect = badge.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()

  const leftPos = badgeRect.left - barRect.left + badgeRect.width / 2

  tooltipStyle.value = {
    position: 'absolute',
    bottom: '100%',
    left: `${leftPos}px`,
    transform: 'translateX(-50%)',
    marginBottom: '10px',
    zIndex: '180',
  }

  // Edge-clamp after the browser paints
  requestAnimationFrame(() => {
    if (!tooltipRef.value) return
    const tipRect = tooltipRef.value.getBoundingClientRect()
    let shift = 0
    if (tipRect.left < 8) {
      shift = 8 - tipRect.left
    } else if (tipRect.right > window.innerWidth - 8) {
      shift = window.innerWidth - 8 - tipRect.right
    }
    if (shift) {
      tooltipStyle.value = {
        ...tooltipStyle.value,
        transform: `translateX(calc(-50% + ${shift}px))`,
      }
    }
  })
}

// Re-position tooltip whenever it becomes visible
const showTooltip = computed(() => hovered.value || pinned.value)

watch(showTooltip, (visible) => {
  if (visible) {
    nextTick(updateTooltipPosition)
  }
})

// Re-position when the scroll container scrolls
let scrollEl: Element | null = null
function onScroll() {
  if (showTooltip.value) updateTooltipPosition()
}
function onResize() {
  if (showTooltip.value) updateTooltipPosition()
}

onMounted(() => {
  scrollEl = badgeRef.value?.closest('.ss-bar-scroll') ?? null
  scrollEl?.addEventListener('scroll', onScroll)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  scrollEl?.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
})

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

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') onClick()
}

// Close pinned tooltip when clicking outside or pressing Escape
function handleOutsideClick(e: MouseEvent) {
  const target = e.target as Node
  if (
    badgeRef.value &&
    !badgeRef.value.contains(target) &&
    tooltipRef.value &&
    !tooltipRef.value.contains(target)
  ) {
    pinned.value = false
  }
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') pinned.value = false
}

watch(pinned, (isPinned) => {
  if (isPinned) {
    document.addEventListener('click', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
  } else {
    document.removeEventListener('click', handleOutsideClick)
    document.removeEventListener('keydown', handleEscape)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <div
    v-if="isVisible"
    ref="badgeRef"
    :id="`ss-b-${metric.id}`"
    :class="['ss-badge', { 'ss-pinned': pinned }]"
    role="button"
    :tabindex="0"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
    @keydown="onKeyDown"
  >
    <span class="ss-label">{{ metric.label }}</span>
    <span :class="['ss-value', `ss-${colorClass}`]">{{ displayValue }}</span>
  </div>

  <!-- Tooltip teleported to .ss-bar so it is not clipped by .ss-bar-scroll overflow -->
  <Teleport v-if="showTooltip && teleportTarget" :to="teleportTarget">
    <div
      ref="tooltipRef"
      :class="['ss-tooltip', { 'ss-pinned': pinned }]"
      :style="tooltipStyle"
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
  </Teleport>
</template>
