<script setup lang="ts">
/**
 * Emails section for the dashboard.
 *
 * Self-contained: injects dependencies and fetches its own data.
 * CSS classes match the React EmailsSection.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { timeAgo, formatTime } from '../../../../core/index.js'
import { useDashboardData } from '../../../composables/useDashboardData.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const refreshKey = inject<Ref<number>>('ss-refresh-key', ref(0))
const dashboardEndpoint = inject<string>('ss-dashboard-endpoint', '/__stats/api')
const authToken = inject<string | undefined>('ss-auth-token', undefined)
const baseUrl = inject<string>('ss-base-url', '')

const {
  data,
  loading,
  pagination,
  goToPage,
  setSearch,
  fetchEmailPreview,
} = useDashboardData(() => 'emails', {
  baseUrl,
  dashboardEndpoint,
  authToken,
  refreshKey,
})

const search = ref('')
const previewId = ref<number | null>(null)
const previewHtml = ref<string | null>(null)

const emails = computed<Record<string, unknown>[]>(() => {
  if (!data.value) return []
  const d = data.value as Record<string, unknown>
  return (d.data || d.emails || data.value || []) as Record<string, unknown>[]
})

function handleSearch(term: string) {
  search.value = term
  setSearch(term)
}

async function handlePreview(email: Record<string, unknown>) {
  if (email.html) {
    previewId.value = email.id as number
    previewHtml.value = email.html as string
    return
  }
  const html = await fetchEmailPreview(email.id as number)
  previewId.value = email.id as number
  previewHtml.value = html
}

function closePreview() {
  previewId.value = null
  previewHtml.value = null
}

const { tableRef } = useResizableTable(() => emails.value)
</script>

<template>
  <div>
    <!-- Email preview -->
    <template v-if="previewId && previewHtml">
      <div class="ss-dash-email-preview" id="ss-dash-email-preview">
        <div class="ss-dash-email-preview-header">
          <div class="ss-dash-email-preview-meta" id="ss-dash-email-preview-meta">
            <template v-if="emails.find(e => e.id === previewId)">
              <strong>Subject:</strong> {{ emails.find(e => e.id === previewId)?.subject }}
              &nbsp;&nbsp;|&nbsp;&nbsp;<strong>From:</strong>
              {{ emails.find(e => e.id === previewId)?.from_addr || emails.find(e => e.id === previewId)?.from }}
              &nbsp;&nbsp;|&nbsp;&nbsp;<strong>To:</strong>
              {{ emails.find(e => e.id === previewId)?.to_addr || emails.find(e => e.id === previewId)?.to }}
              <template v-if="emails.find(e => e.id === previewId)?.cc || emails.find(e => e.id === previewId)?.cc_addr">
                &nbsp;&nbsp;|&nbsp;&nbsp;<strong>CC:</strong>
                {{ emails.find(e => e.id === previewId)?.cc || emails.find(e => e.id === previewId)?.cc_addr }}
              </template>
              &nbsp;&nbsp;|&nbsp;&nbsp;<strong>Status:</strong>
              <span :class="`ss-dash-badge ss-dash-email-status-${emails.find(e => e.id === previewId)?.status}`">
                {{ emails.find(e => e.id === previewId)?.status }}
              </span>
              <template v-if="emails.find(e => e.id === previewId)?.mailer">
                &nbsp;&nbsp;|&nbsp;&nbsp;<strong>Mailer:</strong>
                {{ emails.find(e => e.id === previewId)?.mailer }}
              </template>
            </template>
          </div>
          <button
            type="button"
            class="ss-dash-btn"
            id="ss-dash-email-preview-close"
            @click="closePreview"
          >
            Close
          </button>
        </div>
        <iframe
          class="ss-dash-email-iframe"
          id="ss-dash-email-iframe"
          :srcdoc="previewHtml"
          title="Email preview"
          sandbox=""
        />
      </div>
    </template>

    <!-- Email list -->
    <template v-else>
      <FilterBar
        :model-value="search"
        placeholder="Filter emails..."
        :summary="`${pagination.total ?? 0} emails`"
        @update:model-value="handleSearch"
      />

      <div v-if="loading && !data" class="ss-dash-empty">Loading emails...</div>

      <template v-else>
        <div class="ss-dash-table-wrap">
          <table v-if="emails.length > 0" ref="tableRef" class="ss-dash-table">
            <colgroup>
              <col style="width: 40px" />
              <col style="width: 150px" />
              <col style="width: 150px" />
              <col />
              <col style="width: 80px" />
              <col style="width: 40px" />
              <col style="width: 70px" />
              <col style="width: 80px" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>From</th>
                <th>To</th>
                <th>Subject</th>
                <th>Status</th>
                <th>ATT</th>
                <th>Mailer</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="e in emails"
                :key="(e.id as number)"
                class="ss-dash-clickable ss-dash-email-row"
                @click="handlePreview(e)"
              >
                <td><span style="color: var(--ss-dim)">{{ e.id }}</span></td>
                <td>
                  <span
                    :title="((e.from_addr as string) || (e.from as string) || '')"
                    style="color: var(--ss-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block"
                  >
                    {{ (e.from_addr as string) || (e.from as string) || '' }}
                  </span>
                </td>
                <td>
                  <span
                    :title="((e.to_addr as string) || (e.to as string) || '')"
                    style="color: var(--ss-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block"
                  >
                    {{ (e.to_addr as string) || (e.to as string) || '' }}
                  </span>
                </td>
                <td>
                  <span
                    :title="((e.subject as string) || '')"
                    style="color: var(--ss-sql-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block"
                  >
                    {{ (e.subject as string) || '' }}
                  </span>
                </td>
                <td>
                  <span :class="`ss-dash-badge ss-dash-email-status-${(e.status as string) || ''}`">
                    {{ e.status }}
                  </span>
                </td>
                <td>
                  <span
                    v-if="((e.attachment_count as number) || (e.attachmentCount as number) || 0) > 0"
                    style="color: var(--ss-dim); text-align: center; display: block"
                  >
                    {{ (e.attachment_count as number) || (e.attachmentCount as number) || 0 }}
                  </span>
                  <span v-else style="color: var(--ss-dim); text-align: center; display: block">-</span>
                </td>
                <td>
                  <span
                    :title="((e.mailer as string) || '')"
                    style="color: var(--ss-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block"
                  >
                    {{ (e.mailer as string) || '' }}
                  </span>
                </td>
                <td>
                  <span
                    class="ss-dash-event-time"
                    style="white-space: nowrap"
                    :title="formatTime(((e.createdAt as string) || (e.created_at as string) || (e.timestamp as string)) as string)"
                  >
                    {{ timeAgo(((e.createdAt as string) || (e.created_at as string) || (e.timestamp as string)) as string) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="ss-dash-empty">No emails captured yet</div>
        </div>
        <PaginationControls
          v-if="pagination.totalPages > 1"
          :page="pagination.page"
          :last-page="pagination.totalPages"
          :total="pagination.total"
          @page-change="goToPage"
        />
      </template>
    </template>
  </div>
</template>
