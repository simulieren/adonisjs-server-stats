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
    <svg
      class="ss-dash-filter-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" />
    </svg>
    <input
      class="ss-dash-filter-input"
      type="text"
      :value="modelValue"
      :placeholder="placeholder || 'Search...'"
      @input="onInput"
    />
    <span v-if="summary" class="ss-dash-filter-summary">{{ summary }}</span>
    <button v-if="modelValue" class="ss-dash-filter-clear" @click="handleClear">Clear</button>
  </div>
</template>
