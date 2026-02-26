<script setup lang="ts">
/**
 * Sun/moon toggle button for switching between light and dark themes.
 */
import { computed } from 'vue'
import { useTheme } from '../../composables/useTheme.js'

const { theme, toggleTheme } = useTheme()

const icon = computed(() => (theme.value === 'dark' ? '\u2600' : '\u263D'))
const title = computed(() =>
  theme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
)
</script>

<template>
  <button type="button" class="ss-dbg-theme-toggle" :title="title" @click="toggleTheme">
    {{ icon }}
  </button>
</template>
