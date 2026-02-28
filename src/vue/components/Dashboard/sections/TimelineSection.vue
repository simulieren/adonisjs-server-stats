<script setup lang="ts">
/**
 * Timeline/traces section for the dashboard.
 */
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import { ApiClient, formatDuration, timeAgo } from "../../../../core/index.js";
import { initResizableColumns } from "../../../../core/resizable-columns.js";
import type { TraceRecord, TraceSpan } from "../../../../core/index.js";
import FilterBar from "../shared/FilterBar.vue";
import PaginationControls from "../shared/PaginationControls.vue";
import WaterfallChart from "../shared/WaterfallChart.vue";

interface TracesData {
  data?: TraceRecord[];
  traces?: TraceRecord[];
}

const props = defineProps<{
  data: TracesData | TraceRecord[] | null;
  page: number;
  perPage: number;
  total: number;
  baseUrl?: string;
  dashboardEndpoint?: string;
  authToken?: string;
}>();

const emit = defineEmits<{
  goToPage: [page: number];
  search: [term: string];
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
  return (
    (d as TracesData).data ||
    (d as TracesData).traces ||
    (d as TraceRecord[]) ||
    []
  );
});

let fetchAbortController: AbortController | null = null;

async function fetchTraceDetail(id: number) {
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
  fetchAbortController = new AbortController();

  detailLoading.value = true;
  detailError.value = null;
  traceDetail.value = null;

  const endpoint = props.dashboardEndpoint || "/__stats/api";
  try {
    const client = getClient();
    const detail = await client.get<TraceRecord>(`${endpoint}/traces/${id}`);

    // Parse spans/warnings from JSON string if necessary (SQLite storage)
    let spans = detail.spans as TraceSpan[] | string | undefined;
    if (typeof spans === "string") {
      try {
        spans = JSON.parse(spans);
      } catch {
        spans = [];
      }
    }

    let warnings = detail.warnings as string[] | string | undefined;
    if (typeof warnings === "string") {
      try {
        warnings = JSON.parse(warnings);
      } catch {
        warnings = [];
      }
    }

    traceDetail.value = {
      ...detail,
      spans: (Array.isArray(spans) ? spans : []) as TraceSpan[],
      warnings: (Array.isArray(warnings) ? warnings : []) as string[],
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    detailError.value =
      err instanceof Error ? err.message : "Failed to load trace";
  } finally {
    detailLoading.value = false;
  }
}

function toggleTrace(id: number) {
  if (selectedTraceId.value === id) {
    selectedTraceId.value = null;
    traceDetail.value = null;
    detailError.value = null;
  } else {
    selectedTraceId.value = id;
    fetchTraceDetail(id);
  }
}

function handleSearch(term: string) {
  search.value = term;
  emit("search", term);
}

const detailSpans = computed<TraceSpan[]>(() => traceDetail.value?.spans || []);
const detailWarnings = computed<string[]>(
  () => traceDetail.value?.warnings || [],
);

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
    <FilterBar
      :model-value="search"
      placeholder="Filter traces..."
      :summary="`${props.total} traces`"
      @update:model-value="handleSearch"
    />

    <div v-if="traces.length === 0" class="ss-dash-empty">No traces found</div>

    <table v-else ref="tableRef" class="ss-dash-table">
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
        <template v-for="t in traces" :key="t.id">
          <tr style="cursor: pointer" @click="toggleTrace(t.id)">
            <td style="color: var(--ss-dim)">{{ t.id }}</td>
            <td>
              <span
                :class="`ss-dash-method ss-dash-method-${t.method.toLowerCase()}`"
              >
                {{ t.method }}
              </span>
            </td>
            <td style="color: var(--ss-text)">{{ t.url }}</td>
            <td>
              <span
                :class="`ss-dash-status ss-dash-status-${Math.floor(t.statusCode / 100)}xx`"
              >
                {{ t.statusCode }}
              </span>
            </td>
            <td class="ss-dash-duration">
              {{ formatDuration(t.totalDuration) }}
            </td>
            <td style="color: var(--ss-muted); text-align: center">
              {{ t.spanCount }}
            </td>
            <td class="ss-dash-event-time">{{ timeAgo(t.timestamp) }}</td>
          </tr>
          <!-- Expanded waterfall -->
          <tr v-if="selectedTraceId === t.id">
            <td colspan="7" style="padding: 0">
              <div v-if="detailLoading" class="ss-dash-empty">
                Loading trace detail...
              </div>
              <div v-else-if="detailError" class="ss-dash-empty">
                Error: {{ detailError }}
              </div>
              <template v-else-if="traceDetail">
                <WaterfallChart
                  :spans="detailSpans"
                  :total-duration="traceDetail.totalDuration"
                />
                <div v-if="detailWarnings.length > 0" class="ss-dash-warnings">
                  <div class="ss-dash-warnings-title">Warnings</div>
                  <div
                    v-for="(w, wi) in detailWarnings"
                    :key="wi"
                    class="ss-dash-warning"
                  >
                    {{ w }}
                  </div>
                </div>
              </template>
              <div v-else class="ss-dash-empty">Loading trace detail...</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <PaginationControls
      :page="props.page"
      :per-page="props.perPage"
      :total="props.total"
      @go-to-page="emit('goToPage', $event)"
    />
  </div>
</template>
