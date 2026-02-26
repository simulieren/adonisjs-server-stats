<script setup lang="ts">
/**
 * Pagination controls for dashboard tables.
 */
import { computed } from 'vue'
import { computePagination } from '../../../../core/index.js'

const props = defineProps<{
  page: number
  perPage: number
  total: number
}>()

const emit = defineEmits<{
  goToPage: [page: number]
}>()

const pagination = computed(() =>
  computePagination({
    page: props.page,
    perPage: props.perPage,
    total: props.total,
  })
)

const pageNumbers = computed(() => {
  const p = pagination.value
  const pages: (number | '...')[] = []
  const maxVisible = 7

  if (p.lastPage <= maxVisible) {
    for (let i = 1; i <= p.lastPage; i++) pages.push(i)
  } else {
    pages.push(1)
    if (p.page > 3) pages.push('...')
    for (let i = Math.max(2, p.page - 1); i <= Math.min(p.lastPage - 1, p.page + 1); i++) {
      pages.push(i)
    }
    if (p.page < p.lastPage - 2) pages.push('...')
    pages.push(p.lastPage)
  }

  return pages
})
</script>

<template>
  <div v-if="total > perPage" class="ss-dash-pagination">
    <span class="ss-dash-pagination-info">
      {{ pagination.from }}-{{ pagination.to }} of {{ pagination.total }}
    </span>

    <div class="ss-dash-pagination-controls">
      <button
        class="ss-dash-pagination-btn"
        :disabled="!pagination.hasPrev"
        @click="emit('goToPage', pagination.page - 1)"
      >
        &laquo;
      </button>

      <template v-for="p in pageNumbers" :key="p">
        <span v-if="p === '...'" class="ss-dash-pagination-dots">&hellip;</span>
        <button
          v-else
          :class="[
            'ss-dash-pagination-btn',
            { 'ss-dash-pagination-active': p === pagination.page },
          ]"
          @click="emit('goToPage', p as number)"
        >
          {{ p }}
        </button>
      </template>

      <button
        class="ss-dash-pagination-btn"
        :disabled="!pagination.hasNext"
        @click="emit('goToPage', pagination.page + 1)"
      >
        &raquo;
      </button>
    </div>
  </div>
</template>
