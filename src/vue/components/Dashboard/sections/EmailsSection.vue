<script setup lang="ts">
/**
 * Emails section for the dashboard.
 */
import { ref, computed } from 'vue'
import { timeAgo } from '../../../../core/index.js'
import type { EmailRecord } from '../../../../core/index.js'
import FilterBar from '../shared/FilterBar.vue'
import PaginationControls from '../shared/PaginationControls.vue'

const props = defineProps<{
  data: any
  page: number
  perPage: number
  total: number
  onFetchPreview?: (emailId: number) => Promise<string | null>
}>()

const emit = defineEmits<{
  goToPage: [page: number]
  search: [term: string]
}>()

const search = ref('')
const previewEmail = ref<EmailRecord | null>(null)
const previewHtml = ref<string | null>(null)

const emails = computed<EmailRecord[]>(() => {
  const d = props.data
  if (!d) return []
  return d.data || d.emails || d || []
})

function statusClass(status: string): string {
  const map: Record<string, string> = {
    sent: 'ss-dash-badge-green',
    sending: 'ss-dash-badge-amber',
    queued: 'ss-dash-badge-blue',
    failed: 'ss-dash-badge-red',
  }
  return map[status] || 'ss-dash-badge-muted'
}

async function openPreview(email: EmailRecord) {
  previewEmail.value = email
  if (props.onFetchPreview) {
    previewHtml.value = await props.onFetchPreview(email.id)
  } else {
    previewHtml.value = email.html
  }
}

function closePreview() {
  previewEmail.value = null
  previewHtml.value = null
}

function handleSearch(term: string) {
  search.value = term
  emit('search', term)
}
</script>

<template>
  <div style="position: relative;">
    <!-- Email preview overlay -->
    <div v-if="previewEmail" class="ss-dash-email-preview">
      <div class="ss-dash-email-preview-header">
        <div class="ss-dash-email-preview-meta">
          <div><strong>From:</strong> {{ previewEmail.from }}</div>
          <div><strong>To:</strong> {{ previewEmail.to }}</div>
          <div v-if="previewEmail.cc"><strong>CC:</strong> {{ previewEmail.cc }}</div>
          <div><strong>Subject:</strong> {{ previewEmail.subject }}</div>
          <div>
            <strong>Status:</strong>
            <span :class="['ss-dash-badge', statusClass(previewEmail.status)]">
              {{ previewEmail.status }}
            </span>
          </div>
        </div>
        <button class="ss-dash-close-btn" @click="closePreview">&times;</button>
      </div>
      <iframe
        v-if="previewHtml"
        class="ss-dash-email-iframe"
        :srcdoc="previewHtml"
      ></iframe>
      <div v-else class="ss-dash-empty">No HTML content</div>
    </div>

    <!-- Email list -->
    <template v-if="!previewEmail">
      <FilterBar
        :model-value="search"
        placeholder="Filter emails..."
        :summary="`${props.total} emails`"
        @update:model-value="handleSearch"
      />

      <div v-if="emails.length === 0" class="ss-dash-empty">
        No emails found
      </div>

      <table v-else class="ss-dash-table">
        <thead>
          <tr>
            <th style="width: 30px;">#</th>
            <th>Subject</th>
            <th style="width: 150px;">From</th>
            <th style="width: 150px;">To</th>
            <th style="width: 70px;">Mailer</th>
            <th style="width: 70px;">Status</th>
            <th style="width: 30px;">Att.</th>
            <th style="width: 100px;">Time</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in emails"
            :key="e.id"
            style="cursor: pointer;"
            @click="openPreview(e)"
          >
            <td style="color: var(--ss-dim);">{{ e.id }}</td>
            <td style="color: var(--ss-text);">{{ e.subject }}</td>
            <td style="color: var(--ss-text-secondary);">{{ e.from }}</td>
            <td style="color: var(--ss-text-secondary);">{{ e.to }}</td>
            <td style="color: var(--ss-muted);">{{ e.mailer }}</td>
            <td>
              <span :class="['ss-dash-badge', statusClass(e.status)]">
                {{ e.status }}
              </span>
            </td>
            <td style="color: var(--ss-dim); text-align: center;">{{ e.attachmentCount || 0 }}</td>
            <td class="ss-dash-event-time">{{ timeAgo(e.timestamp) }}</td>
          </tr>
        </tbody>
      </table>

      <PaginationControls
        :page="props.page"
        :per-page="props.perPage"
        :total="props.total"
        @go-to-page="emit('goToPage', $event)"
      />
    </template>
  </div>
</template>
