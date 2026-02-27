<script setup lang="ts">
/**
 * Request waterfall / timeline tab for the debug panel.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { formatDuration, statusColor, timeAgo } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
import type { TraceRecord, TraceSpan } from '../../../../core/index.js'

const props = defineProps<{
  data: any
  dashboardPath?: string
}>()

const selectedTrace = ref<TraceRecord | null>(null)

const traces = computed<TraceRecord[]>(() => {
  return props.data?.traces || props.data || []
})

const CATEGORY_COLORS: Record<string, string> = {
  request: '#1e3a5f',
  middleware: 'rgba(30, 58, 95, 0.7)',
  db: '#6d28d9',
  view: '#0e7490',
  mail: '#059669',
  event: '#b45309',
  custom: '#525252',
}

const CATEGORY_LABELS: Record<string, string> = {
  request: 'Request',
  middleware: 'Middleware',
  db: 'Database',
  view: 'View',
  mail: 'Mail',
  event: 'Event',
  custom: 'Custom',
}

function selectTrace(trace: TraceRecord) {
  selectedTrace.value = selectedTrace.value?.id === trace.id ? null : trace
}

function getBarStyle(span: TraceSpan, totalDuration: number): Record<string, string> {
  const left = totalDuration > 0 ? (span.startOffset / totalDuration) * 100 : 0
  const width = totalDuration > 0 ? Math.max((span.duration / totalDuration) * 100, 0.5) : 0.5
  return {
    left: `${left}%`,
    width: `${width}%`,
    background: CATEGORY_COLORS[span.category] || CATEGORY_COLORS.custom,
  }
}

const tableRef = ref<HTMLTableElement | null>(null)
let cleanupResize: (() => void) | null = null

function attachResize() {
  if (cleanupResize) cleanupResize()
  cleanupResize = null
  nextTick(() => {
    if (tableRef.value) {
      cleanupResize = initResizableColumns(tableRef.value)
    }
  })
}

watch(traces, attachResize)
onMounted(attachResize)
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
</script>

<template>
  <div>
    <!-- Trace detail view -->
    <template v-if="selectedTrace">
      <div class="ss-dbg-tl-detail-header">
        <button class="ss-dbg-close" @click="selectedTrace = null">&larr; Back</button>
        <span :class="`ss-dbg-method ss-dbg-method-${selectedTrace.method.toLowerCase()}`">
          {{ selectedTrace.method }}
        </span>
        <span style="color: var(--ss-text)">{{ selectedTrace.url }}</span>
        <span
          :class="`ss-dbg-status ss-dbg-status-${Math.floor(selectedTrace.statusCode / 100)}xx`"
        >
          {{ selectedTrace.statusCode }}
        </span>
        <span class="ss-dbg-tl-meta">
          {{ formatDuration(selectedTrace.totalDuration) }} &middot;
          {{ selectedTrace.spanCount }} spans
        </span>
      </div>

      <div class="ss-dbg-tl-legend">
        <span v-for="(color, cat) in CATEGORY_COLORS" :key="cat" class="ss-dbg-tl-legend-item">
          <span class="ss-dbg-tl-legend-dot" :style="{ background: color }"></span>
          {{ CATEGORY_LABELS[cat] || cat }}
        </span>
      </div>

      <div id="ss-dbg-tl-waterfall">
        <div v-for="span in selectedTrace.spans" :key="span.id" class="ss-dbg-tl-row">
          <span class="ss-dbg-tl-label" :title="span.label">
            {{ span.label }}
          </span>
          <span class="ss-dbg-tl-track">
            <span
              class="ss-dbg-tl-bar"
              :style="getBarStyle(span, selectedTrace.totalDuration)"
              :title="`${formatDuration(span.duration)}`"
            ></span>
          </span>
          <span class="ss-dbg-tl-dur">{{ formatDuration(span.duration) }}</span>
        </div>
      </div>

      <div v-if="selectedTrace.warnings.length > 0" class="ss-dbg-tl-warnings">
        <div class="ss-dbg-tl-warnings-title">Warnings</div>
        <div v-for="(w, i) in selectedTrace.warnings" :key="i" class="ss-dbg-tl-warning">
          {{ w }}
        </div>
      </div>
    </template>

    <!-- Trace list view -->
    <template v-else>
      <div v-if="traces.length === 0" class="ss-dbg-empty">No traces captured</div>

      <table v-else ref="tableRef" class="ss-dbg-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Method</th>
            <th>URL</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Spans</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in traces" :key="t.id" style="cursor: pointer" @click="selectTrace(t)">
            <td style="color: var(--ss-dim)">{{ t.id }}</td>
            <td>
              <span :class="`ss-dbg-method ss-dbg-method-${t.method.toLowerCase()}`">
                {{ t.method }}
              </span>
            </td>
            <td style="color: var(--ss-text)">
              {{ t.url }}
              <a
                v-if="dashboardPath"
                :href="`${dashboardPath}#timeline?id=${t.id}`"
                target="_blank"
                class="ss-dbg-deeplink"
                @click.stop
              >
                <svg
                  viewBox="0 0 16 16"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M6 3H3v10h10v-3M9 1h6v6M7 9L15 1" />
                </svg>
              </a>
            </td>
            <td>
              <span :class="`ss-dbg-status ss-dbg-status-${Math.floor(t.statusCode / 100)}xx`">
                {{ t.statusCode }}
              </span>
            </td>
            <td class="ss-dbg-duration">{{ formatDuration(t.totalDuration) }}</td>
            <td style="color: var(--ss-muted); text-align: center">{{ t.spanCount }}</td>
            <td class="ss-dbg-event-time">{{ timeAgo(t.timestamp) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
