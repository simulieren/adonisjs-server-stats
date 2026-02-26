<script setup lang="ts">
/**
 * SVG sparkline chart component.
 *
 * Renders a small sparkline from a data array using the core
 * sparkline computation utilities.
 */
import { computed } from 'vue'
import { buildSparklineData } from '../../../core/index.js'

const props = withDefaults(
  defineProps<{
    /** Data values to render. */
    data: number[]
    /** Stroke color (CSS color string). */
    color?: string
    /** SVG width in pixels. */
    width?: number
    /** SVG height in pixels. */
    height?: number
  }>(),
  {
    color: '#34d399',
    width: 120,
    height: 32,
  }
)

const sparkline = computed(() =>
  buildSparklineData(props.data, {
    width: props.width,
    height: props.height,
    color: props.color,
  })
)

const hasData = computed(() => sparkline.value !== null)

const gradientId = computed(() => `sg-${props.color.replace('#', '')}`)
</script>

<template>
  <svg :width="width" :height="height" style="display: block">
    <template v-if="hasData && sparkline">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.25" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path :d="sparkline.areaPath" :fill="`url(#${gradientId})`" />
      <polyline
        :points="sparkline.points"
        fill="none"
        :stroke="color"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </template>
    <text
      v-else
      :x="width / 2"
      :y="height / 2 + 3"
      text-anchor="middle"
      fill="#737373"
      font-size="9"
    >
      collecting...
    </text>
  </svg>
</template>
