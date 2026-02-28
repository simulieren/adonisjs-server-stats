<script setup lang="ts">
/**
 * Main debug panel with tabs.
 *
 * Expandable overlay panel with lazy-loaded tabs for queries,
 * events, emails, routes, logs, timeline, cache, jobs, config,
 * internals, and custom panes.
 */
import { ref, computed, defineAsyncComponent, watch } from "vue";
import { useDebugData } from "../../composables/useDebugData.js";
import { useFeatures } from "../../composables/useFeatures.js";
import { useTheme } from "../../composables/useTheme.js";
import type {
  DebugPanelConfig,
  DebugPane,
  DebugTab,
} from "../../../core/index.js";
import { TAB_ICONS } from "../../../core/index.js";
import ThemeToggle from "../shared/ThemeToggle.vue";

// Lazy-loaded tab components
const QueriesTab = defineAsyncComponent(() => import("./tabs/QueriesTab.vue"));
const EventsTab = defineAsyncComponent(() => import("./tabs/EventsTab.vue"));
const EmailsTab = defineAsyncComponent(() => import("./tabs/EmailsTab.vue"));
const RoutesTab = defineAsyncComponent(() => import("./tabs/RoutesTab.vue"));
const LogsTab = defineAsyncComponent(() => import("./tabs/LogsTab.vue"));
const TimelineTab = defineAsyncComponent(
  () => import("./tabs/TimelineTab.vue"),
);
const CacheTab = defineAsyncComponent(() => import("./tabs/CacheTab.vue"));
const JobsTab = defineAsyncComponent(() => import("./tabs/JobsTab.vue"));
const ConfigTab = defineAsyncComponent(
  () => import("./tabs/ConfigTab.vue"),
);
const InternalsTab = defineAsyncComponent(
  () => import("./tabs/InternalsTab.vue"),
);
const CustomPaneTab = defineAsyncComponent(
  () => import("./tabs/CustomPaneTab.vue"),
);

const props = withDefaults(defineProps<DebugPanelConfig>(), {
  baseUrl: "",
  debugEndpoint: "/admin/api/debug",
  dashboardPath: "/__stats",
  tracingEnabled: false,
  isLive: false,
});

const isOpen = ref(false);
const activeTab = ref<string>("queries");

const { theme } = useTheme();
const { features } = useFeatures({
  baseUrl: props.baseUrl,
  debugEndpoint: props.debugEndpoint,
  authToken: props.authToken,
});

const dashboardEndpoint = props.dashboardPath
  ? props.dashboardPath.replace(/\/+$/, "") + "/api"
  : undefined;

const isCustomTab = computed(() => activeTab.value.startsWith("custom-"));
const isSelfManagedTab = computed(() => isCustomTab.value || activeTab.value === 'internals');

const {
  data,
  loading,
  error,
  isUnauthorized,
  refresh,
  startRefresh,
  stopRefresh,
} = useDebugData(() => activeTab.value as DebugTab, {
  baseUrl: props.baseUrl,
  debugEndpoint: props.debugEndpoint,
  dashboardEndpoint,
  authToken: props.authToken,
});

// Tab definitions
interface TabDef {
  id: string;
  label: string;
  icon: string;
  show?: () => boolean;
}

const TABS = computed<TabDef[]>(() => {
  const tabs: TabDef[] = [
    { id: "queries", label: "Queries", icon: "Q" },
    { id: "events", label: "Events", icon: "E" },
    { id: "emails", label: "Emails", icon: "M" },
    { id: "routes", label: "Routes", icon: "R" },
    { id: "logs", label: "Logs", icon: "L" },
  ];

  if (features.value.tracing || props.tracingEnabled) {
    tabs.push({ id: "timeline", label: "Timeline", icon: "T" });
  }

  if (features.value.cache) {
    tabs.push({ id: "cache", label: "Cache", icon: "C" });
  }

  if (features.value.queues) {
    tabs.push({ id: "jobs", label: "Jobs", icon: "J" });
  }

  tabs.push({ id: "config", label: "Config", icon: "G" });
  tabs.push({ id: "internals", label: "Internals", icon: "I" });

  // Add custom panes
  for (const pane of features.value.customPanes) {
    tabs.push({
      id: `custom-${pane.id}`,
      label: pane.label,
      icon: pane.label.charAt(0).toUpperCase(),
    });
  }

  return tabs;
});

function getCustomPane(tabId: string): DebugPane | undefined {
  const paneId = tabId.replace("custom-", "");
  return features.value.customPanes.find((p) => p.id === paneId);
}

// Control open/close
function open() {
  isOpen.value = true;
  startRefresh();
}

function close() {
  isOpen.value = false;
  stopRefresh();
}

function toggle() {
  if (isOpen.value) close();
  else open();
}

function selectTab(tabId: string) {
  activeTab.value = tabId;
}

// Pause refresh when panel is closed
watch(isOpen, (open) => {
  if (open) startRefresh();
  else stopRefresh();
});

// Expose toggle for parent components
defineExpose({ toggle, open, close });
</script>

<template>
  <div
    v-if="!isUnauthorized"
    :class="['ss-dbg-panel', { 'ss-dbg-open': isOpen }]"
    :data-ss-theme="theme"
  >
    <!-- Tab bar -->
    <div class="ss-dbg-tabs">
      <div class="ss-dbg-tabs-scroll">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          :class="['ss-dbg-tab', { 'ss-dbg-active': activeTab === tab.id }]"
          @click="selectTab(tab.id)"
        >
          <svg
            v-if="TAB_ICONS[tab.id]"
            class="ss-dbg-tab-icon"
            :viewBox="TAB_ICONS[tab.id].viewBox"
            v-html="TAB_ICONS[tab.id].elements.join('')"
          ></svg>
          {{ tab.label }}
        </button>
      </div>

      <div class="ss-dbg-tabs-right">
        <!-- Connection mode indicator -->
        <span
          :class="[
            'ss-dbg-conn-mode',
            isLive ? 'ss-dbg-conn-live' : 'ss-dbg-conn-polling',
          ]"
          :title="
            isLive
              ? 'Connected via Transmit (SSE) \u2014 real-time updates'
              : 'Polling every 3s'
          "
        >
          {{ isLive ? "live" : "polling" }}
        </span>

        <!-- Dashboard link -->
        <a
          v-if="dashboardPath && features.dashboard"
          :href="dashboardPath"
          target="_blank"
          rel="noopener noreferrer"
          class="ss-dbg-dashboard-link"
          title="Open dashboard"
        >
          <svg
            width="14"
            height="14"
            :viewBox="TAB_ICONS['external-link'].viewBox"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            v-html="TAB_ICONS['external-link'].elements.join('')"
          ></svg>
        </a>

        <ThemeToggle />

        <button type="button" class="ss-dbg-close" @click="close" title="Close panel">&times;</button>
      </div>
    </div>

    <!-- Tab content -->
    <div class="ss-dbg-content">
      <!-- Loading state (skip for custom tabs - they handle their own state) -->
      <div v-if="loading && !data && !isSelfManagedTab" class="ss-dbg-empty">Loading...</div>

      <!-- Error state (skip for custom tabs - they handle their own state) -->
      <div
        v-else-if="error && !isSelfManagedTab"
        class="ss-dbg-empty"
        style="color: var(--ss-red-fg)"
      >
        Error: {{ error.message }}
      </div>

      <!-- Tab content -->
      <template v-else>
        <QueriesTab
          v-if="activeTab === 'queries'"
          :data="data"
          :dashboard-path="dashboardPath"
        />
        <EventsTab
          v-else-if="activeTab === 'events'"
          :data="data"
          :dashboard-path="dashboardPath"
        />
        <EmailsTab
          v-else-if="activeTab === 'emails'"
          :data="data"
          :dashboard-path="dashboardPath"
        />
        <RoutesTab v-else-if="activeTab === 'routes'" :data="data" />
        <LogsTab
          v-else-if="activeTab === 'logs'"
          :data="data"
          :dashboard-path="dashboardPath"
        />
        <TimelineTab
          v-else-if="activeTab === 'timeline'"
          :data="data"
          :dashboard-path="dashboardPath"
          :base-url="baseUrl"
          :debug-endpoint="debugEndpoint"
          :auth-token="authToken"
        />
        <CacheTab v-else-if="activeTab === 'cache'" :data="data" />
        <JobsTab v-else-if="activeTab === 'jobs'" :data="data" />
        <ConfigTab v-else-if="activeTab === 'config'" :data="data" />
        <InternalsTab
          v-else-if="activeTab === 'internals'"
          :data="data"
          :base-url="baseUrl"
          :debug-endpoint="debugEndpoint"
          :auth-token="authToken"
        />
        <CustomPaneTab
          v-else-if="activeTab.startsWith('custom-')"
          :pane="getCustomPane(activeTab)!"
          :base-url="baseUrl"
          :auth-token="authToken"
        />
      </template>
    </div>
  </div>
</template>
