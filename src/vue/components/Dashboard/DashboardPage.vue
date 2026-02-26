<script setup lang="ts">
/**
 * Full page dashboard with sidebar navigation.
 *
 * Uses hash-based routing for SPA-like navigation
 * with lazy-loaded sections.
 */
import { ref, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useDashboardData } from '../../composables/useDashboardData.js'
import { useFeatures } from '../../composables/useFeatures.js'
import { useTheme } from '../../composables/useTheme.js'
import type { DashboardConfig, DashboardSection } from '../../../core/index.js'
import ThemeToggle from '../shared/ThemeToggle.vue'

// Lazy-loaded sections
const OverviewSection = defineAsyncComponent(() => import('./sections/OverviewSection.vue'))
const RequestsSection = defineAsyncComponent(() => import('./sections/RequestsSection.vue'))
const QueriesSection = defineAsyncComponent(() => import('./sections/QueriesSection.vue'))
const EventsSection = defineAsyncComponent(() => import('./sections/EventsSection.vue'))
const RoutesSection = defineAsyncComponent(() => import('./sections/RoutesSection.vue'))
const LogsSection = defineAsyncComponent(() => import('./sections/LogsSection.vue'))
const EmailsSection = defineAsyncComponent(() => import('./sections/EmailsSection.vue'))
const TimelineSection = defineAsyncComponent(() => import('./sections/TimelineSection.vue'))
const CacheSection = defineAsyncComponent(() => import('./sections/CacheSection.vue'))
const JobsSection = defineAsyncComponent(() => import('./sections/JobsSection.vue'))
const ConfigSection = defineAsyncComponent(() => import('./sections/ConfigSection.vue'))

const props = withDefaults(defineProps<DashboardConfig>(), {
  baseUrl: '',
  dashboardEndpoint: '/__stats/api',
  tracingEnabled: false,
})

const { theme, toggleTheme } = useTheme()
const { features } = useFeatures({
  baseUrl: props.baseUrl,
  debugEndpoint: props.dashboardEndpoint?.replace('/api', '') || '/__stats',
  authToken: props.authToken,
})

const activeSection = ref<DashboardSection>('overview')
const sidebarCollapsed = ref(false)

// Initialize from hash
onMounted(() => {
  const stored = localStorage.getItem('ss-dash-sidebar')
  sidebarCollapsed.value = stored === 'collapsed'

  readHash()
  window.addEventListener('hashchange', readHash)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', readHash)
})

function readHash() {
  const hash = window.location.hash.replace('#', '').split('?')[0]
  if (hash && SECTIONS.some((s) => s.id === hash)) {
    activeSection.value = hash as DashboardSection
  }
}

const {
  data,
  loading,
  error,
  isUnauthorized,
  pagination,
  timeRange,
  goToPage,
  setSearch,
  setFilter,
  setSort,
  setTimeRange,
  refresh,
  fetchChart,
  fetchGroupedQueries,
  explainQuery,
  retryJob,
  deleteCacheKey,
  fetchEmailPreview,
} = useDashboardData(
  () => activeSection.value,
  {
    baseUrl: props.baseUrl,
    dashboardEndpoint: props.dashboardEndpoint,
    authToken: props.authToken,
  }
)

// Section definitions
interface SectionDef {
  id: DashboardSection
  label: string
  icon: string
  show?: () => boolean
}

const SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Overview', icon: '\u2302' },
  { id: 'requests', label: 'Requests', icon: '\u21C4' },
  { id: 'queries', label: 'Queries', icon: '\u2318' },
  { id: 'events', label: 'Events', icon: '\u26A1' },
  { id: 'routes', label: 'Routes', icon: '\u2630' },
  { id: 'logs', label: 'Logs', icon: '\u2261' },
  { id: 'emails', label: 'Emails', icon: '\u2709' },
  { id: 'timeline', label: 'Timeline', icon: '\u23F1' },
  { id: 'cache', label: 'Cache', icon: '\u26C1' },
  { id: 'jobs', label: 'Jobs', icon: '\u2699' },
  { id: 'config', label: 'Config', icon: '\u2699' },
]

const visibleSections = computed(() =>
  SECTIONS.filter((s) => {
    if (s.id === 'timeline' && !features.value.tracing && !props.tracingEnabled) return false
    if (s.id === 'cache' && !features.value.cache) return false
    if (s.id === 'jobs' && !features.value.queues) return false
    return true
  })
)

function navigateTo(section: DashboardSection) {
  activeSection.value = section
  window.location.hash = section
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('ss-dash-sidebar', sidebarCollapsed.value ? 'collapsed' : 'expanded')
}

const themeAttr = computed(() => theme.value)
</script>

<template>
  <div
    class="ss-dash"
    :data-theme="themeAttr"
  >
    <!-- Header -->
    <header class="ss-dash-header">
      <div class="ss-dash-header-left">
        <span class="ss-dash-logo">Server Stats</span>
      </div>
      <div class="ss-dash-header-right">
        <span class="ss-dash-live-indicator">
          <span class="ss-dash-live-dot"></span>
          Live
        </span>
        <ThemeToggle />
      </div>
    </header>

    <div class="ss-dash-layout">
      <!-- Sidebar -->
      <nav :class="['ss-dash-sidebar', { 'ss-dash-sidebar-collapsed': sidebarCollapsed }]">
        <div class="ss-dash-sidebar-items">
          <button
            v-for="section in visibleSections"
            :key="section.id"
            :class="['ss-dash-sidebar-item', { 'ss-dash-sidebar-active': activeSection === section.id }]"
            @click="navigateTo(section.id)"
            :title="section.label"
          >
            <span class="ss-dash-sidebar-icon">{{ section.icon }}</span>
            <span v-if="!sidebarCollapsed" class="ss-dash-sidebar-label">{{ section.label }}</span>
          </button>
        </div>
        <button class="ss-dash-sidebar-toggle" @click="toggleSidebar">
          {{ sidebarCollapsed ? '\u00BB' : '\u00AB' }}
        </button>
      </nav>

      <!-- Main content -->
      <main class="ss-dash-main">
        <!-- Unauthorized -->
        <div v-if="isUnauthorized" class="ss-dash-empty">
          Access denied. You do not have permission to view this dashboard.
        </div>

        <!-- Loading -->
        <div v-else-if="loading && !data" class="ss-dash-empty">
          Loading...
        </div>

        <!-- Error -->
        <div v-else-if="error" class="ss-dash-empty" style="color: var(--ss-red-fg);">
          Error: {{ error.message }}
        </div>

        <!-- Section content -->
        <template v-else>
          <OverviewSection
            v-if="activeSection === 'overview'"
            :data="data"
            :time-range="timeRange"
            :on-fetch-chart="fetchChart"
            @change-time-range="setTimeRange"
            @navigate-to="navigateTo($event as DashboardSection)"
          />

          <RequestsSection
            v-else-if="activeSection === 'requests'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            @go-to-page="goToPage"
            @search="setSearch"
          />

          <QueriesSection
            v-else-if="activeSection === 'queries'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            :on-explain-query="explainQuery"
            :on-fetch-grouped="fetchGroupedQueries"
            @go-to-page="goToPage"
            @search="setSearch"
          />

          <EventsSection
            v-else-if="activeSection === 'events'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            @go-to-page="goToPage"
            @search="setSearch"
          />

          <RoutesSection
            v-else-if="activeSection === 'routes'"
            :data="data"
          />

          <LogsSection
            v-else-if="activeSection === 'logs'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            @go-to-page="goToPage"
            @search="setSearch"
            @filter="setFilter"
          />

          <EmailsSection
            v-else-if="activeSection === 'emails'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            :on-fetch-preview="fetchEmailPreview"
            @go-to-page="goToPage"
            @search="setSearch"
          />

          <TimelineSection
            v-else-if="activeSection === 'timeline'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            @go-to-page="goToPage"
            @search="setSearch"
          />

          <CacheSection
            v-else-if="activeSection === 'cache'"
            :data="data"
            :on-delete-key="deleteCacheKey"
          />

          <JobsSection
            v-else-if="activeSection === 'jobs'"
            :data="data"
            :page="pagination.page"
            :per-page="pagination.perPage"
            :total="pagination.total"
            :on-retry-job="retryJob"
            @go-to-page="goToPage"
            @search="setSearch"
            @filter="setFilter"
          />

          <ConfigSection
            v-else-if="activeSection === 'config'"
            :data="data"
          />
        </template>
      </main>
    </div>
  </div>
</template>
