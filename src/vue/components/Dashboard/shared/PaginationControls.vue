<script setup lang="ts">
/**
 * Pagination controls for dashboard tables.
 *
 * CSS classes match the React Pagination component exactly:
 * - ss-dash-pagination (container)
 * - ss-dash-page-info (info text)
 * - ss-dash-pagination-controls (button row)
 * - ss-dash-page-btn / ss-dash-active (page buttons)
 * - ss-dash-page-ellipsis (ellipsis separator)
 */
import { computed } from 'vue'
import { getPageNumbers } from '../../../../core/pagination.js'

const props = defineProps<{
  page: number
  lastPage: number
  total: number
}>()

const emit = defineEmits<{
  pageChange: [page: number]
}>()

const pages = computed(() => getPageNumbers(props.page, props.lastPage))
</script>

<template>
  <div v-if="lastPage > 1" class="ss-dash-pagination">
    <span class="ss-dash-page-info">
      Page {{ page }} of {{ lastPage }} ({{ total }} total)
    </span>
    <div class="ss-dash-pagination-controls">
      <button
        type="button"
        class="ss-dash-page-btn"
        :disabled="page <= 1"
        @click="emit('pageChange', page - 1)"
      >
        &laquo; Prev
      </button>

      <template v-for="(p, i) in pages" :key="p === '...' ? `ellipsis-${i}` : p">
        <span v-if="p === '...'" class="ss-dash-page-ellipsis">...</span>
        <button
          v-else
          type="button"
          :class="`ss-dash-page-btn ${p === page ? 'ss-dash-active' : ''}`"
          @click="emit('pageChange', p as number)"
        >
          {{ p }}
        </button>
      </template>

      <button
        type="button"
        class="ss-dash-page-btn"
        :disabled="page >= lastPage"
        @click="emit('pageChange', page + 1)"
      >
        Next &raquo;
      </button>
    </div>
  </div>
</template>
