<script setup lang="ts">
/**
 * Compact JSON preview with click-to-expand.
 */
import { ref, computed } from 'vue'
import { compactPreview } from '../../../core/index.js'

const props = withDefaults(
  defineProps<{
    /** The value to display (object, array, or primitive). */
    value: unknown
    /** Maximum preview length. */
    maxLen?: number
    /** CSS class prefix: 'ss-dash' for dashboard, 'ss-dbg' for debug panel. */
    classPrefix?: 'ss-dash' | 'ss-dbg'
  }>(),
  {
    classPrefix: 'ss-dash',
  }
)

const expanded = ref(false)

const preview = computed(() => {
  if (props.value === null || props.value === undefined) return '-'
  if (typeof props.value === 'string') {
    try {
      return compactPreview(JSON.parse(props.value), props.maxLen || 100)
    } catch {
      return props.value.length > 100 ? props.value.slice(0, 100) + '...' : props.value
    }
  }
  return compactPreview(props.value, props.maxLen || 100)
})

const fullJson = computed(() => {
  if (props.value === null || props.value === undefined) return ''
  if (typeof props.value === 'string') {
    try {
      return JSON.stringify(JSON.parse(props.value), null, 2)
    } catch {
      return props.value
    }
  }
  return JSON.stringify(props.value, null, 2)
})

function toggle() {
  expanded.value = !expanded.value
}

function copyToClipboard() {
  navigator.clipboard?.writeText(fullJson.value)
}
</script>

<template>
  <span v-if="value === null || value === undefined" :class="`ss-dim ${props.classPrefix}-c-dim`"
    >-</span
  >
  <div v-else :class="`${props.classPrefix}-data-cell`">
    <span
      :class="`${props.classPrefix}-data-preview`"
      role="button"
      :tabindex="0"
      @click="toggle"
      @keydown="(e: KeyboardEvent) => e.key === 'Enter' && toggle()"
    >
      {{ preview }}
    </span>
    <div v-if="expanded" :class="`${props.classPrefix}-data-full`" @click="toggle">
      <button
        :class="`${props.classPrefix}-copy-btn`"
        title="Copy to clipboard"
        @click.stop="copyToClipboard"
      >
        Copy
      </button>
      <pre>{{ fullJson }}</pre>
    </div>
  </div>
</template>
