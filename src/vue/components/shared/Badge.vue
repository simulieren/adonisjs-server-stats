<script setup lang="ts">
/**
 * Colored pill badge component.
 *
 * Supports: green, amber, red, blue, purple, muted.
 */
defineProps<{
  /** Badge color variant. */
  color?: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'muted'
  /** CSS class prefix for context (dbg or dash). */
  prefix?: string
}>()
</script>

<template>
  <span :class="[`ss-${prefix || 'dbg'}-badge`, `ss-${prefix || 'dbg'}-badge-${color || 'muted'}`]">
    <slot />
  </span>
</template>
