<script setup lang="ts">
/**
 * Trace waterfall visualization for the dashboard.
 *
 * Renders horizontal bars positioned by time offset relative to
 * the request start, showing the timeline of operations.
 *
 * CSS classes match the React WaterfallChart component exactly:
 * - ss-dash-tl-waterfall (container)
 * - ss-dash-tl-legend / ss-dash-tl-legend-item / ss-dash-tl-legend-dot
 * - ss-dash-tl-row / ss-dash-tl-label / ss-dash-tl-track / ss-dash-tl-bar / ss-dash-tl-dur
 * - ss-dash-tl-warnings / ss-dash-tl-warnings-title / ss-dash-tl-warning
 * - ss-dash-badge / ss-dash-badge-{color}
 */
import { computed } from 'vue'
import type { TraceSpan } from '../../../../core/index.js'

const props = defineProps<{
  spans: TraceSpan[]
  totalDuration: number
  className?: string
  warnings?: string[]
}>()

const CATEGORY_COLORS: Record<string, string> = {
  request: '#1e3a5f',
  middleware: 'rgba(30, 58, 95, 0.7)',
  db: '#6d28d9',
  view: '#0e7490',
  mail: '#059669',
  event: '#b45309',
  custom: 'var(--ss-dim)',
}

const CATEGORY_LABELS: Record<string, string> = {
  request: 'Request',
  middleware: 'Middleware',
  db: 'DB',
  mail: 'Mail',
  event: 'Event',
  view: 'View',
  custom: 'Custom',
}

const safeSpans = computed(() => props.spans || [])

const sortedSpans = computed(() =>
  [...safeSpans.value].sort((a, b) => a.startOffset - b.startOffset)
)

const depthMap = computed(() => {
  const map: Record<string, number> = {}
  for (const s of sortedSpans.value) {
    map[s.id] = s.parentId ? (map[s.parentId] || 0) + 1 : 0
  }
  return map
})

function getBarLeft(span: TraceSpan): string {
  const total = props.totalDuration || 1
  return `${(span.startOffset / total) * 100}%`
}

function getBarWidth(span: TraceSpan): string {
  const total = props.totalDuration || 1
  return `${Math.max((span.duration / total) * 100, 0.5)}%`
}

function truncateLabel(label: string): string {
  return label.length > 50 ? label.slice(0, 50) + '...' : label
}

function getCatLabel(category: string): string {
  return category === 'db' ? 'DB' : category
}

function getBadgeCat(category: string): string {
  if (category === 'db') return 'purple'
  if (category === 'mail') return 'green'
  if (category === 'event') return 'amber'
  if (category === 'view') return 'blue'
  return 'muted'
}

function getTooltip(span: TraceSpan): string {
  const metaStr = span.metadata
    ? Object.entries(span.metadata)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
    : ''
  return metaStr
    ? `${span.label} (${span.duration.toFixed(2)}ms)\n${metaStr}`
    : `${span.label} (${span.duration.toFixed(2)}ms)`
}
</script>

<template>
  <div v-if="safeSpans.length === 0" class="ss-dash-empty">No spans recorded</div>

  <div v-else :class="`ss-dash-tl-waterfall ${className || ''}`">
    <!-- Legend -->
    <div class="ss-dash-tl-legend">
      <div
        v-for="(label, cat) in CATEGORY_LABELS"
        :key="cat"
        class="ss-dash-tl-legend-item"
      >
        <span
          class="ss-dash-tl-legend-dot"
          :style="{ background: CATEGORY_COLORS[cat] || CATEGORY_COLORS.custom }"
        />
        <span>{{ label }}</span>
      </div>
    </div>

    <!-- Rows -->
    <div
      v-for="span in sortedSpans"
      :key="span.id"
      class="ss-dash-tl-row"
    >
      <div
        class="ss-dash-tl-label"
        :title="getTooltip(span)"
        :style="{ paddingLeft: 8 + (depthMap[span.id] || 0) * 16 + 'px' }"
      >
        <span
          :class="`ss-dash-badge ss-dash-badge-${getBadgeCat(span.category)}`"
          style="font-size: 9px; margin-right: 4px"
        >
          {{ getCatLabel(span.category) }}
        </span>
        {{ truncateLabel(span.label) }}
      </div>
      <div class="ss-dash-tl-track">
        <div
          :class="`ss-dash-tl-bar ss-dash-tl-bar-${span.category || 'custom'}`"
          :style="{
            left: getBarLeft(span),
            width: getBarWidth(span),
          }"
          :title="getTooltip(span)"
        />
      </div>
      <span class="ss-dash-tl-dur">{{ span.duration.toFixed(2) }}ms</span>
    </div>

    <!-- Warnings -->
    <div v-if="warnings && warnings.length > 0" class="ss-dash-tl-warnings">
      <div class="ss-dash-tl-warnings-title">Warnings ({{ warnings.length }})</div>
      <div v-for="(w, i) in warnings" :key="i" class="ss-dash-tl-warning">
        {{ w }}
      </div>
    </div>
  </div>
</template>
