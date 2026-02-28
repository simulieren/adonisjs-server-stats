<script setup lang="ts">
/**
 * Search/filter bar for dashboard sections.
 */
import { TAB_ICONS } from '../../../../core/icons.js'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  summary?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  clear: []
}>()

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function handleClear() {
  emit('update:modelValue', '')
  emit('clear')
}
</script>

<template>
  <div class="ss-dash-filter-bar">
    <span v-if="summary" class="ss-dash-summary">{{ summary }}</span>
    <div class="ss-dash-search-wrapper">
      <svg
        class="ss-dash-search-icon"
        :viewBox="TAB_ICONS.search.viewBox"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        v-html="TAB_ICONS.search.elements.join('')"
      ></svg>
      <input
        class="ss-dash-search"
        type="text"
        :value="modelValue"
        :placeholder="placeholder || 'Search...'"
        @input="onInput"
      />
      <button v-if="modelValue" type="button" class="ss-dash-search-clear" @click="handleClear">&times;</button>
    </div>
    <div v-if="$slots.default" class="ss-dash-filter-controls">
      <slot />
    </div>
  </div>
</template>
