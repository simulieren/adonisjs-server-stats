<script setup lang="ts">
/**
 * Compact JSON preview with click-to-expand.
 */
import { ref, computed } from 'vue'
import { compactPreview } from '../../../core/index.js'

const props = defineProps<{
  /** The value to display (object, array, or primitive). */
  value: unknown
  /** Maximum preview length. */
  maxLen?: number
}>()

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
  <div class="ss-dbg-event-data">
    <span class="ss-dbg-data-preview" @click="toggle">
      {{ preview }}
    </span>
    <button
      v-if="value !== null && value !== undefined"
      class="ss-dbg-copy-btn"
      title="Copy JSON"
      @click.stop="copyToClipboard"
    >
      &#x2398;
    </button>
    <pre v-if="expanded" class="ss-dbg-data-full" @click="toggle">{{ fullJson }}</pre>
  </div>
</template>
