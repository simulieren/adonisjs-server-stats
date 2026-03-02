<script setup lang="ts">
/**
 * Sun/moon toggle button for switching between light and dark themes.
 */
import { computed } from 'vue'
import { useTheme } from '../../composables/useTheme.js'
import { TAB_ICONS } from '../../../core/icons.js'

const props = withDefaults(
  defineProps<{
    classPrefix?: 'ss-dash' | 'ss-dbg'
  }>(),
  { classPrefix: 'ss-dbg' }
)

const { theme, toggleTheme } = useTheme()

const isDark = computed(() => theme.value === 'dark')
const title = computed(() => (isDark.value ? 'Switch to light theme' : 'Switch to dark theme'))
const baseClass = computed(() =>
  props.classPrefix === 'ss-dbg' ? 'ss-dbg-theme-toggle' : 'ss-dash-theme-btn'
)
</script>

<template>
  <button type="button" :class="baseClass" :title="title" :aria-label="title" @click="toggleTheme">
    <!-- Sun icon -->
    <svg
      v-if="isDark"
      width="16"
      height="16"
      :viewBox="TAB_ICONS.sun.viewBox"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      v-html="TAB_ICONS.sun.elements.join('')"
    ></svg>
    <!-- Moon icon -->
    <svg
      v-else
      width="16"
      height="16"
      :viewBox="TAB_ICONS.moon.viewBox"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      v-html="TAB_ICONS.moon.elements.join('')"
    ></svg>
  </button>
</template>
