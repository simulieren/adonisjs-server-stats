<script setup lang="ts">
/**
 * Time range selector (5m / 15m / 30m / 1h / 6h / 24h / 7d).
 *
 * CSS classes match the React TimeRangeSelector component:
 * - ss-dash-btn-group (container)
 * - ss-dash-btn / ss-dash-active (buttons)
 */
import type { TimeRange } from '../../../../core/index.js'

const props = defineProps<{
  modelValue: TimeRange
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TimeRange]
}>()

const ranges: { value: TimeRange; label: string }[] = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
]
</script>

<template>
  <div class="ss-dash-btn-group">
    <button
      v-for="range in ranges"
      :key="range.value"
      type="button"
      :class="`ss-dash-btn ${modelValue === range.value ? 'ss-dash-active' : ''}`"
      @click="emit('update:modelValue', range.value)"
    >
      {{ range.label }}
    </button>
  </div>
</template>
