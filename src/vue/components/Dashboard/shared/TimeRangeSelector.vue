<script setup lang="ts">
/**
 * Time range selector (1h / 6h / 24h / 7d).
 */
import type { TimeRange } from '../../../../core/index.js'

const props = defineProps<{
  modelValue: TimeRange
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TimeRange]
}>()

const ranges: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
]
</script>

<template>
  <div class="ss-dash-time-range">
    <button
      v-for="range in ranges"
      :key="range.value"
      :class="[
        'ss-dash-time-range-btn',
        { 'ss-dash-time-range-active': modelValue === range.value },
      ]"
      @click="emit('update:modelValue', range.value)"
    >
      {{ range.label }}
    </button>
  </div>
</template>
