<script setup lang="ts">
/**
 * Trace waterfall visualization for the dashboard.
 *
 * Renders a horizontal bar chart showing span timing
 * within a request trace.
 */
import { computed } from 'vue'
import { formatDuration } from '../../../../core/index.js'
import type { TraceSpan } from '../../../../core/index.js'

const props = defineProps<{
  spans: TraceSpan[]
  totalDuration: number
}>()

const CATEGORY_COLORS: Record<string, string> = {
  request: '#1e3a5f',
  middleware: 'rgba(30, 58, 95, 0.7)',
  db: '#6d28d9',
  view: '#0e7490',
  mail: '#059669',
  event: '#b45309',
  custom: '#525252',
}

const CATEGORY_LABELS: Record<string, string> = {
  request: 'Request',
  middleware: 'Middleware',
  db: 'Database',
  view: 'View',
  mail: 'Mail',
  event: 'Event',
  custom: 'Custom',
}

const legendItems = computed(() =>
  Object.entries(CATEGORY_COLORS).map(([key, color]) => ({
    key,
    color,
    label: CATEGORY_LABELS[key] || key,
  }))
)

function getBarStyle(span: TraceSpan): Record<string, string> {
  const total = props.totalDuration || 1
  const left = (span.startOffset / total) * 100
  const width = Math.max((span.duration / total) * 100, 0.5)
  return {
    left: `${left}%`,
    width: `${width}%`,
    background: CATEGORY_COLORS[span.category] || CATEGORY_COLORS.custom,
  }
}
</script>

<template>
  <div class="ss-dash-waterfall">
    <div class="ss-dash-waterfall-legend">
      <span
        v-for="item in legendItems"
        :key="item.key"
        class="ss-dash-waterfall-legend-item"
      >
        <span
          class="ss-dash-waterfall-legend-dot"
          :style="{ background: item.color }"
        ></span>
        {{ item.label }}
      </span>
    </div>

    <div class="ss-dash-waterfall-rows">
      <div
        v-for="span in spans"
        :key="span.id"
        class="ss-dash-waterfall-row"
      >
        <span class="ss-dash-waterfall-label" :title="span.label">
          {{ span.label }}
        </span>
        <span class="ss-dash-waterfall-track">
          <span
            class="ss-dash-waterfall-bar"
            :style="getBarStyle(span)"
            :title="`${span.label}: ${formatDuration(span.duration)}`"
          ></span>
        </span>
        <span class="ss-dash-waterfall-dur">
          {{ formatDuration(span.duration) }}
        </span>
      </div>
    </div>
  </div>
</template>
