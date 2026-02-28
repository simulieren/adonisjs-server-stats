<script setup lang="ts">
/**
 * Request waterfall / timeline tab for the debug panel.
 */
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import {
  ApiClient,
  formatDuration,
  statusColor,
  timeAgo,
} from "../../../../core/index.js";
import { initResizableColumns } from "../../../../core/resizable-columns.js";
import type { TraceRecord, TraceSpan } from "../../../../core/index.js";

const props = defineProps<{
  data: { traces?: TraceRecord[] } | TraceRecord[] | null;
  dashboardPath?: string;
  baseUrl?: string;
  debugEndpoint?: string;
  authToken?: string;
}>();

const search = ref("");
const selectedTraceId = ref<number | null>(null);
const traceDetail = ref<TraceRecord | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);

let apiClient: ApiClient | null = null;
function getClient(): ApiClient {
  if (!apiClient) {
    apiClient = new ApiClient({
      baseUrl: props.baseUrl || "",
      authToken: props.authToken,
    });
  }
  return apiClient;
}

const traces = computed<TraceRecord[]>(() => {
  const d = props.data;
  if (!d) return [];
  const items = Array.isArray(d) ? d : d.traces || [];
  if (!search.value.trim()) return items;
  const term = search.value.toLowerCase();
  return items.filter(
    (t: TraceRecord) =>
      t.url.toLowerCase().includes(term) ||
      t.method.toLowerCase().includes(term) ||
      String(t.statusCode).includes(term),
  );
});

const CATEGORY_COLORS: Record<string, string> = {
  request: "#1e3a5f",
  middleware: "rgba(30, 58, 95, 0.7)",
  db: "#6d28d9",
  view: "#0e7490",
  mail: "#059669",
  event: "#b45309",
  custom: "#525252",
};

const CATEGORY_LABELS: Record<string, string> = {
  request: "Request",
  middleware: "Middleware",
  db: "Database",
  view: "View",
  mail: "Mail",
  event: "Event",
  custom: "Custom",
};

function selectTrace(trace: TraceRecord) {
  if (selectedTraceId.value === trace.id) {
    selectedTraceId.value = null;
    traceDetail.value = null;
    detailError.value = null;
  } else {
    selectedTraceId.value = trace.id;
    fetchTraceDetail(trace.id);
  }
}

function goBack() {
  selectedTraceId.value = null;
  traceDetail.value = null;
  detailError.value = null;
}

let fetchAbortController: AbortController | null = null;

async function fetchTraceDetail(id: number) {
  // Cancel any in-flight request
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchAbortController = new AbortController();

  detailLoading.value = true;
  detailError.value = null;
  traceDetail.value = null;

  const endpoint = props.debugEndpoint || "/admin/api/debug";
  try {
    const client = getClient();
    const detail = await client.get<TraceRecord>(`${endpoint}/traces/${id}`);
    traceDetail.value = detail;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    detailError.value =
      err instanceof Error ? err.message : "Failed to load trace";
  } finally {
    detailLoading.value = false;
  }
}

const detailSpans = computed<TraceSpan[]>(() => traceDetail.value?.spans || []);
const detailWarnings = computed<string[]>(
  () => traceDetail.value?.warnings || [],
);

function getBarStyle(
  span: TraceSpan,
  totalDuration: number,
): Record<string, string> {
  const total = totalDuration || 1;
  const left = total > 0 ? (span.startOffset / total) * 100 : 0;
  const width = total > 0 ? Math.max((span.duration / total) * 100, 0.5) : 0.5;
  return {
    left: `${left}%`,
    width: `${width}%`,
    background: CATEGORY_COLORS[span.category] || CATEGORY_COLORS.custom,
  };
}

const tableRef = ref<HTMLTableElement | null>(null);
let cleanupResize: (() => void) | null = null;

function attachResize() {
  if (cleanupResize) cleanupResize();
  cleanupResize = null;
  nextTick(() => {
    if (tableRef.value) {
      cleanupResize = initResizableColumns(tableRef.value);
    }
  });
}

watch(traces, attachResize);
onMounted(attachResize);
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize();
  if (fetchAbortController) fetchAbortController.abort();
});
</script>

<template>
  <div>
    <!-- Trace detail view -->
    <template v-if="selectedTraceId !== null">
      <!-- Loading state -->
      <div v-if="detailLoading" class="ss-dbg-empty">
        Loading trace detail...
      </div>

      <!-- Error state -->
      <template v-else-if="detailError">
        <div class="ss-dbg-tl-detail-header">
          <button class="ss-dbg-close" @click="goBack">&larr; Back</button>
        </div>
        <div class="ss-dbg-empty">Error: {{ detailError }}</div>
      </template>

      <!-- Detail content -->
      <template v-else-if="traceDetail">
        <div class="ss-dbg-tl-detail-header">
          <button class="ss-dbg-close" @click="goBack">&larr; Back</button>
          <span
            :class="`ss-dbg-method ss-dbg-method-${traceDetail.method.toLowerCase()}`"
          >
            {{ traceDetail.method }}
          </span>
          <span class="ss-dbg-tl-detail-url">{{ traceDetail.url }}</span>
          <span
            :class="`ss-dbg-status ss-dbg-status-${Math.floor(traceDetail.statusCode / 100)}xx`"
          >
            {{ traceDetail.statusCode }}
          </span>
          <span class="ss-dbg-tl-meta">
            {{ formatDuration(traceDetail.totalDuration) }} &middot;
            {{ traceDetail.spanCount }} spans
          </span>
        </div>

        <div class="ss-dbg-tl-legend">
          <span
            v-for="(color, cat) in CATEGORY_COLORS"
            :key="cat"
            class="ss-dbg-tl-legend-item"
          >
            <span
              class="ss-dbg-tl-legend-dot"
              :style="{ background: color }"
            ></span>
            {{ CATEGORY_LABELS[cat] || cat }}
          </span>
        </div>

        <div id="ss-dbg-tl-waterfall">
          <div v-if="detailSpans.length === 0" class="ss-dbg-empty">
            No spans captured for this request
          </div>
          <div v-for="span in detailSpans" :key="span.id" class="ss-dbg-tl-row">
            <span class="ss-dbg-tl-label" :title="span.label">
              {{ span.label }}
            </span>
            <span class="ss-dbg-tl-track">
              <span
                class="ss-dbg-tl-bar"
                :style="getBarStyle(span, traceDetail.totalDuration)"
                :title="`${formatDuration(span.duration)}`"
              ></span>
            </span>
            <span class="ss-dbg-tl-dur">{{
              formatDuration(span.duration)
            }}</span>
          </div>
        </div>

        <div v-if="detailWarnings.length > 0" class="ss-dbg-tl-warnings">
          <div class="ss-dbg-tl-warnings-title">Warnings</div>
          <div
            v-for="(w, i) in detailWarnings"
            :key="i"
            class="ss-dbg-tl-warning"
          >
            {{ w }}
          </div>
        </div>
      </template>

      <!-- Fallback loading -->
      <div v-else class="ss-dbg-empty">Loading trace detail...</div>
    </template>

    <!-- Trace list view -->
    <template v-else>
      <div class="ss-dbg-search-bar">
        <input v-model="search" class="ss-dbg-search" placeholder="Filter traces..." type="text" />
        <span class="ss-dbg-summary">{{ traces.length }} traces</span>
      </div>

      <div v-if="traces.length === 0" class="ss-dbg-empty">
        No traces captured
      </div>

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
          <tr
            v-for="t in traces"
            :key="t.id"
            style="cursor: pointer"
            @click="selectTrace(t)"
          >
            <td class="ss-dbg-c-dim">{{ t.id }}</td>
            <td>
              <span
                :class="`ss-dbg-method ss-dbg-method-${t.method.toLowerCase()}`"
              >
                {{ t.method }}
              </span>
            </td>
            <td class="ss-dbg-c-text">
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
              <span
                :class="`ss-dbg-status ss-dbg-status-${Math.floor(t.statusCode / 100)}xx`"
              >
                {{ t.statusCode }}
              </span>
            </td>
            <td class="ss-dbg-duration">
              {{ formatDuration(t.totalDuration) }}
            </td>
            <td class="ss-dbg-c-muted" style="text-align: center">
              {{ t.spanCount }}
            </td>
            <td class="ss-dbg-event-time">{{ timeAgo(t.timestamp) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
