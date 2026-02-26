<script setup lang="ts">
/**
 * Hover tooltip component.
 *
 * Shows content on hover, positioned above the trigger element.
 */
import { ref } from 'vue'

defineProps<{
  /** Tooltip text content. */
  text?: string
}>()

const visible = ref(false)

function show() {
  visible.value = true
}

function hide() {
  visible.value = false
}
</script>

<template>
  <span
    class="ss-tooltip-trigger"
    @mouseenter="show"
    @mouseleave="hide"
    style="position: relative; display: inline-flex"
  >
    <slot />
    <span
      v-if="visible && (text || $slots.content)"
      class="ss-tooltip"
      style="
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 8px;
        pointer-events: none;
        z-index: 180;
      "
    >
      <span class="ss-tooltip-inner" style="white-space: nowrap">
        <slot name="content">{{ text }}</slot>
      </span>
      <span class="ss-tooltip-arrow"></span>
    </span>
  </span>
</template>
