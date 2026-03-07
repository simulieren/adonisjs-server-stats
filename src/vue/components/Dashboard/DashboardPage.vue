<script setup lang="ts">
/**
 * Full page dashboard with sidebar navigation.
 *
 * Mirrors React DashboardPage.tsx structure exactly:
 * - SSE subscription via transmit-adapter for live updates
 * - Hash-based routing with deep linking
 * - Sidebar navigation with badges and custom panes
 * - Each section fetches its own data via provide/inject
 */
import { ref, computed, watch, provide, onMounted, onUnmounted, defineAsyncComponent } from 'vue'

import { subscribeToChannel } from '../../../core/transmit-adapter.js'
import { useFeatures } from '../../composables/useFeatures.js'
import { useTheme } from '../../composables/useTheme.js'
import { useDashboardData } from '../../composables/useDashboardData.js'
import type { DashboardSection, OverviewMetrics } from '../../../core/types.js'
import { TAB_ICONS } from '../../../core/icons.js'
import type { DebugPane } from '../../../debug/types.js'
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
const InternalsSection = defineAsyncComponent(() => import('./sections/InternalsSection.vue'))

/** All built-in section IDs used for hash-route validation. */
const VALID_SECTIONS: DashboardSection[] = [
  'overview',
  'requests',
  'queries',
  'events',
  'routes',
  'logs',
  'emails',
  'timeline',
  'cache',
  'jobs',
  'config',
  'internals',
]

const props = withDefaults(
  defineProps<{
    baseUrl?: string
    dashboardEndpoint?: string
    debugEndpoint?: string
    authToken?: string
    backUrl?: string
    channelName?: string
  }>(),
  {
    baseUrl: '',
    dashboardEndpoint: '/__stats/api',
    debugEndpoint: undefined,
    authToken: undefined,
    backUrl: '/',
    channelName: 'server-stats/dashboard',
  }
)

const { theme, toggleTheme } = useTheme()
const { features } = useFeatures({
  baseUrl: props.baseUrl,
  debugEndpoint: props.debugEndpoint,
  authToken: props.authToken,
})

const activeSection = ref<DashboardSection>('overview')
const sidebarCollapsed = ref(false)
const isConnected = ref(false)
const refreshKey = ref(0)

// Provide values for child sections to inject
provide('ss-refresh-key', refreshKey)
provide('ss-base-url', props.baseUrl)
provide('ss-dashboard-endpoint', props.dashboardEndpoint)
provide('ss-debug-endpoint', props.debugEndpoint)
provide('ss-auth-token', props.authToken)

// Initialize sidebar state from localStorage
if (typeof window !== 'undefined') {
  sidebarCollapsed.value = localStorage.getItem('ss-dash-sidebar') === 'collapsed'
}

// SSE subscription for live updates
let unsubscribeSSE: (() => void) | null = null

function setupSSE() {
  if (unsubscribeSSE) {
    unsubscribeSSE()
    unsubscribeSSE = null
  }

  if (!props.channelName) return

  const sub = subscribeToChannel({
    baseUrl: props.baseUrl,
    channelName: props.channelName,
    authToken: props.authToken,
    onMessage: () => {
      refreshKey.value += 1
    },
    onConnect: () => {
      isConnected.value = true
    },
    onDisconnect: () => {
      isConnected.value = false
    },
    onError: () => {
      isConnected.value = false
    },
  })

  unsubscribeSSE = sub.unsubscribe
}

onMounted(() => {
  setupSSE()
})

onUnmounted(() => {
  if (unsubscribeSSE) {
    unsubscribeSSE()
    unsubscribeSSE = null
  }
})

// Custom panes from features
const customPanes = computed<DebugPane[]>(() => features.value.customPanes || [])

/** Resolve a hash fragment to a validated section ID, falling back to 'overview'. */
function resolveHashSection(hash: string): DashboardSection {
  const section = hash.replace('#', '').split('?')[0]
  if (!section) return 'overview'
  const allValid: string[] = [...VALID_SECTIONS, ...customPanes.value.map((p: DebugPane) => p.id)]
  return allValid.includes(section) ? (section as DashboardSection) : 'overview'
}

// Hash-based routing
function readHash() {
  const section = resolveHashSection(window.location.hash)
  if (section !== activeSection.value) {
    activeSection.value = section
  }
}

// Parse hash for deep linking on mount
onMounted(() => {
  if (typeof window === 'undefined') return
  const section = resolveHashSection(window.location.hash)
  if (section !== 'overview' || window.location.hash) {
    activeSection.value = section
  }
  window.addEventListener('hashchange', readHash)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', readHash)
})

// Update hash when section changes
watch(activeSection, (section) => {
  if (typeof window !== 'undefined') {
    window.location.hash = section
  }
})

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('ss-dash-sidebar', sidebarCollapsed.value ? 'collapsed' : 'expanded')
}

function navigateTo(section: DashboardSection) {
  if (section !== activeSection.value) {
    activeSection.value = section
  }
}

// Built-in section definitions
const builtInSections = computed(() => [
  { id: 'overview' as DashboardSection, label: 'Overview', visible: true },
  { id: 'requests' as DashboardSection, label: 'Requests', visible: true },
  { id: 'queries' as DashboardSection, label: 'Queries', visible: true },
  { id: 'events' as DashboardSection, label: 'Events', visible: true },
  { id: 'routes' as DashboardSection, label: 'Routes', visible: true },
  { id: 'logs' as DashboardSection, label: 'Logs', visible: true },
  { id: 'emails' as DashboardSection, label: 'Emails', visible: true },
  { id: 'timeline' as DashboardSection, label: 'Timeline', visible: features.value.tracing },
  { id: 'cache' as DashboardSection, label: 'Cache', visible: features.value.cache },
  { id: 'jobs' as DashboardSection, label: 'Jobs', visible: features.value.queues },
  { id: 'config' as DashboardSection, label: 'Config', visible: true },
  { id: 'internals' as DashboardSection, label: 'Internals', visible: true },
])

const visibleSections = computed(() => builtInSections.value.filter((s) => s.visible))

// Fetch overview metrics for sidebar nav badges
const { data: overviewRawData } = useDashboardData(() => 'overview', {
  baseUrl: props.baseUrl,
  dashboardEndpoint: props.dashboardEndpoint,
  authToken: props.authToken,
  refreshKey,
})
const overviewData = computed(() => overviewRawData.value as OverviewMetrics | null)

/** Badge counts for sidebar nav items. */
const navBadges = computed(() => {
  const badges: Partial<Record<DashboardSection, { count: number; variant?: string }>> = {}
  if (!overviewData.value) return badges

  if (overviewData.value.totalRequests > 0) {
    badges.requests = { count: overviewData.value.totalRequests }
  }

  if (overviewData.value.queryStats?.total > 0) {
    badges.queries = { count: overviewData.value.queryStats.total }
  }

  if (overviewData.value.logLevelBreakdown) {
    const b = overviewData.value.logLevelBreakdown
    const totalLogs = b.error + b.warn + b.info + b.debug
    if (totalLogs > 0) {
      badges.logs = { count: totalLogs }
    }
  }

  return badges
})

/** Section component map for rendering active pane. */
const sectionComponents: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  overview: OverviewSection,
  requests: RequestsSection,
  queries: QueriesSection,
  events: EventsSection,
  routes: RoutesSection,
  logs: LogsSection,
  emails: EmailsSection,
  timeline: TimelineSection,
  cache: CacheSection,
  jobs: JobsSection,
  config: ConfigSection,
  internals: InternalsSection,
}

const activeSectionComponent = computed(() => sectionComponents[activeSection.value] || null)

/** Resolve icon key for a dashboard section, using the clock variant for timeline. */
function sectionIconKey(sectionId: string): string {
  return sectionId === 'timeline' ? 'dashboard-timeline' : sectionId
}
</script>

<template>
  <div class="ss-dash" :data-theme="theme" id="ss-dash">
    <!-- Header -->
    <div class="ss-dash-header">
      <div class="ss-dash-header-left">
        <span class="ss-dash-logo">Server Stats</span>
        <span class="ss-dash-logo-sub">Dashboard</span>
      </div>
      <div class="ss-dash-header-center">
        <span
          :class="['ss-dash-live-dot', { 'ss-dash-connected': isConnected }]"
          id="ss-dash-live-dot"
        />
        <span
          :class="['ss-dash-live-label', { 'ss-dash-connected': isConnected }]"
          id="ss-dash-live-label"
        >
          {{ isConnected ? 'Live' : 'Polling' }}
        </span>
      </div>
      <div class="ss-dash-header-right">
        <ThemeToggle class-prefix="ss-dash" />
        <a v-if="backUrl" :href="backUrl" class="ss-dash-back-link" title="Back to app">
          &larr; App
        </a>
      </div>
    </div>

    <!-- Body: sidebar + main -->
    <div class="ss-dash-body">
      <!-- Sidebar -->
      <div
        :class="['ss-dash-sidebar', { 'ss-dash-collapsed': sidebarCollapsed }]"
        id="ss-dash-sidebar"
      >
        <nav class="ss-dash-nav">
          <button
            v-for="section in visibleSections"
            :key="section.id"
            type="button"
            :class="['ss-dash-nav-item', { 'ss-dash-active': activeSection === section.id }]"
            :data-ss-section="section.id"
            @click="navigateTo(section.id)"
            :title="sidebarCollapsed ? section.label : undefined"
          >
            <span class="ss-dash-nav-icon">
              <svg
                width="20"
                height="20"
                :viewBox="(TAB_ICONS[sectionIconKey(section.id)] || TAB_ICONS.config).viewBox"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                v-html="
                  (TAB_ICONS[sectionIconKey(section.id)] || TAB_ICONS.config).elements.join('')
                "
              ></svg>
            </span>
            <span class="ss-dash-nav-label">{{ section.label }}</span>
            <span
              v-if="navBadges[section.id] && navBadges[section.id]!.count > 0"
              :class="['ss-dash-nav-badge', navBadges[section.id]!.variant || '']"
            >
              {{ navBadges[section.id]!.count }}
            </span>
          </button>

          <!-- Separator before custom panes -->
          <div v-if="customPanes.length > 0" class="ss-dash-nav-sep" />

          <!-- Custom pane nav items -->
          <button
            v-for="pane in customPanes"
            :key="pane.id"
            type="button"
            :class="['ss-dash-nav-item', { 'ss-dash-active': activeSection === pane.id }]"
            @click="navigateTo(pane.id)"
            :title="sidebarCollapsed ? pane.label : undefined"
          >
            <span class="ss-dash-nav-icon">
              <svg
                width="20"
                height="20"
                :viewBox="TAB_ICONS['custom-pane'].viewBox"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                v-html="TAB_ICONS['custom-pane'].elements.join('')"
              ></svg>
            </span>
            <span class="ss-dash-nav-label">{{ pane.label }}</span>
          </button>
        </nav>

        <!-- Collapse toggle -->
        <button
          type="button"
          class="ss-dash-sidebar-toggle"
          id="ss-dash-sidebar-toggle"
          @click="toggleSidebar"
          :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        >
          <svg
            v-if="sidebarCollapsed"
            width="16"
            height="16"
            :viewBox="TAB_ICONS['chevron-right'].viewBox"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            v-html="TAB_ICONS['chevron-right'].elements.join('')"
          ></svg>
          <svg
            v-else
            width="16"
            height="16"
            :viewBox="TAB_ICONS['chevron-left'].viewBox"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            v-html="TAB_ICONS['chevron-left'].elements.join('')"
          ></svg>
        </button>
      </div>

      <!-- Main content -->
      <div class="ss-dash-main">
        <div class="ss-dash-pane ss-dash-active" :id="`ss-dash-pane-${activeSection}`">
          <div class="ss-dash-pane-inner">
            <Suspense>
              <component :is="activeSectionComponent" v-if="activeSectionComponent" />
              <div v-else class="ss-dash-empty">Unknown section</div>
              <template #fallback>
                <div class="ss-dash-empty">Loading...</div>
              </template>
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
