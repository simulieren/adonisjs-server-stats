<script setup lang="ts">
/**
 * Search/filter bar for dashboard sections.
 */
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
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
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
