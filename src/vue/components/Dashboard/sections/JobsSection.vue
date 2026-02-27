<script setup lang="ts">
/**
 * Queue manager section for the dashboard.
 */
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import { timeAgo, formatDuration } from "../../../../core/index.js";
import { initResizableColumns } from "../../../../core/resizable-columns.js";
import FilterBar from "../shared/FilterBar.vue";
import PaginationControls from "../shared/PaginationControls.vue";
import JsonViewer from "../../shared/JsonViewer.vue";

interface JobEntry {
  id: string;
  name: string;
  status: string;
  data?: any;
  payload?: any;
  attempts: number;
  duration: number | null;
  error?: string;
  failedReason?: string | null;
  timestamp: number;
  createdAt?: number;
}

const props = defineProps<{
  data: any;
  page: number;
  perPage: number;
  total: number;
  onRetryJob?: (jobId: string) => Promise<boolean>;
}>();

const emit = defineEmits<{
  goToPage: [page: number];
  search: [term: string];
  filter: [key: string, value: string | number | boolean];
}>();

const search = ref("");
const activeFilter = ref("all");
const expandedJobId = ref<string | null>(null);

const FILTERS = [
  "all",
  "active",
  "waiting",
  "delayed",
  "completed",
  "failed",
] as const;

const jobData = computed(() => props.data || {});
const stats = computed(
  () => jobData.value.stats || jobData.value.overview || {},
);

const jobs = computed<JobEntry[]>(() => {
  const d = props.data;
  if (!d) return [];
  return d.data || d.jobs || d || [];
});

function statusClass(status: string): string {
  const map: Record<string, string> = {
    completed: "ss-dash-badge-green",
    failed: "ss-dash-badge-red",
    active: "ss-dash-badge-blue",
    waiting: "ss-dash-badge-amber",
    delayed: "ss-dash-badge-purple",
  };
  return map[status] || "ss-dash-badge-muted";
}

function handleFilterChange(filter: string) {
  activeFilter.value = filter;
  if (filter === "all") {
    emit("filter", "status", "");
  } else {
    emit("filter", "status", filter);
  }
}

async function handleRetry(jobId: string) {
  if (props.onRetryJob) {
    await props.onRetryJob(jobId);
  }
}

function toggleExpand(jobId: string) {
  expandedJobId.value = expandedJobId.value === jobId ? null : jobId;
}

function handleSearch(term: string) {
  search.value = term;
  emit("search", term);
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

watch(jobs, attachResize);
onMounted(attachResize);
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize();
});
</script>

<template>
  <div>
    <!-- Stats -->
    <div class="ss-dash-job-stats">
      <span class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Active:</span>
        <span class="ss-dash-job-stat-value">{{ stats.active ?? 0 }}</span>
      </span>
      <span class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Waiting:</span>
        <span class="ss-dash-job-stat-value">{{ stats.waiting ?? 0 }}</span>
      </span>
      <span class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Delayed:</span>
        <span class="ss-dash-job-stat-value">{{ stats.delayed ?? 0 }}</span>
      </span>
      <span class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Completed:</span>
        <span class="ss-dash-job-stat-value">{{ stats.completed ?? 0 }}</span>
      </span>
      <span class="ss-dash-job-stat">
        <span class="ss-dash-job-stat-label">Failed:</span>
        <span class="ss-dash-job-stat-value">{{ stats.failed ?? 0 }}</span>
      </span>
    </div>

    <div class="ss-dash-job-filters">
      <button
        v-for="f in FILTERS"
        :key="f"
        :class="[
          'ss-dash-job-filter',
          { 'ss-dash-active': activeFilter === f },
        ]"
        @click="handleFilterChange(f)"
      >
        {{ f }}
      </button>
    </div>

    <FilterBar
      :model-value="search"
      placeholder="Filter jobs..."
      :summary="`${props.total} jobs`"
      @update:model-value="handleSearch"
    />

    <div v-if="jobs.length === 0" class="ss-dash-empty">No jobs found</div>

    <table v-else ref="tableRef" class="ss-dash-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Status</th>
          <th>Payload</th>
          <th>Tries</th>
          <th>Duration</th>
          <th>Time</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="j in jobs" :key="j.id">
          <tr style="cursor: pointer" @click="toggleExpand(j.id)">
            <td style="color: var(--ss-dim)">{{ j.id }}</td>
            <td style="color: var(--ss-text)">{{ j.name }}</td>
            <td>
              <span :class="['ss-dash-badge', statusClass(j.status)]">{{
                j.status
              }}</span>
            </td>
            <td>
              <JsonViewer :value="j.payload || j.data" :max-len="60" />
            </td>
            <td style="color: var(--ss-muted); text-align: center">
              {{ j.attempts }}
            </td>
            <td class="ss-dash-duration">
              {{ j.duration !== null ? formatDuration(j.duration) : "-" }}
            </td>
            <td class="ss-dash-event-time">
              {{ timeAgo(j.timestamp || j.createdAt) }}
            </td>
            <td>
              <button
                v-if="j.status === 'failed'"
                class="ss-dash-action-btn"
                @click.stop="handleRetry(j.id)"
              >
                Retry
              </button>
            </td>
          </tr>
          <!-- Expanded detail -->
          <tr v-if="expandedJobId === j.id">
            <td colspan="8" style="padding: 8px 12px">
              <div
                v-if="j.failedReason || j.error"
                style="color: var(--ss-red-fg)"
              >
                <strong>Error:</strong>
                <pre
                  style="
                    white-space: pre-wrap;
                    word-break: break-all;
                    margin-top: 4px;
                  "
                  >{{ j.failedReason || j.error }}</pre
                >
              </div>
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
