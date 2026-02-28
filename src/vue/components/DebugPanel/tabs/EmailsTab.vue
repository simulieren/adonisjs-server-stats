<script setup lang="ts">
/**
 * Emails table with preview tab for the debug panel.
 */
import { computed, ref } from 'vue'
import { timeAgo, formatTime } from '../../../../core/index.js'
import { useResizableTable } from '../../../composables/useResizableTable.js'
import type { EmailRecord } from '../../../../core/index.js'

const props = defineProps<{
  data: { emails?: EmailRecord[] } | EmailRecord[] | null
  dashboardPath?: string
}>()

const search = ref('')
const previewEmail = ref<EmailRecord | null>(null)

const emails = computed<EmailRecord[]>(() => {
  const d = props.data
  const arr = d ? (Array.isArray(d) ? d : d.emails) || [] : []
  if (!search.value.trim()) return arr
  const term = search.value.toLowerCase()
  return arr.filter(
    (e: EmailRecord) =>
      e.subject.toLowerCase().includes(term) ||
      e.from.toLowerCase().includes(term) ||
      e.to.toLowerCase().includes(term) ||
      (e.mailer && e.mailer.toLowerCase().includes(term))
  )
})

const summary = computed(() => {
  const d = props.data
  const arr = d ? (Array.isArray(d) ? d : d.emails) || [] : []
  return `${arr.length} emails`
})

function statusClass(status: string): string {
  const map: Record<string, string> = {
    sent: 'ss-dbg-email-status-sent',
    sending: 'ss-dbg-email-status-sending',
    queued: 'ss-dbg-email-status-queued',
    failed: 'ss-dbg-email-status-failed',
  }
  return map[status] || ''
}

function openPreview(email: EmailRecord) {
  previewEmail.value = email
}

function closePreview() {
  previewEmail.value = null
}

const { tableRef } = useResizableTable(() => emails.value)
</script>

<template>
  <div style="position: relative; height: 100%">
    <!-- Email preview overlay -->
    <div v-if="previewEmail" class="ss-dbg-email-preview">
      <div class="ss-dbg-email-preview-header">
        <div class="ss-dbg-email-preview-meta">
          <div><strong>From:</strong> {{ previewEmail.from }}</div>
          <div><strong>To:</strong> {{ previewEmail.to }}</div>
          <div v-if="previewEmail.cc"><strong>CC:</strong> {{ previewEmail.cc }}</div>
          <div><strong>Subject:</strong> {{ previewEmail.subject }}</div>
          <div>
            <strong>Status:</strong>
            <span :class="['ss-dbg-email-status', statusClass(previewEmail.status)]">
              {{ previewEmail.status }}
            </span>
          </div>
        </div>
        <button type="button" class="ss-dbg-btn-clear" @click="closePreview">&times;</button>
      </div>
      <iframe
        v-if="previewEmail.html"
        class="ss-dbg-email-iframe"
        :srcdoc="previewEmail.html"
      ></iframe>
      <div v-else class="ss-dbg-empty">No HTML content</div>
    </div>

    <!-- Email list -->
    <template v-if="!previewEmail">
      <div class="ss-dbg-search-bar">
        <input v-model="search" class="ss-dbg-search" placeholder="Filter emails..." type="text" />
        <span class="ss-dbg-summary">{{ summary }}</span>
      </div>

      <div v-if="emails.length === 0" class="ss-dbg-empty">No emails captured</div>

      <table v-else ref="tableRef" class="ss-dbg-table">
        <thead>
          <tr>
            <th>#</th>
            <th>From</th>
            <th>To</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Mailer</th>
            <th title="Attachments">&#x1F4CE;</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in emails" :key="e.id" class="ss-dbg-email-row" @click="openPreview(e)">
            <td class="ss-dbg-c-dim" style="white-space: nowrap">{{ e.id }}</td>
            <td class="ss-dbg-c-secondary" :title="e.from">{{ e.from }}</td>
            <td class="ss-dbg-c-secondary" :title="e.to">{{ e.to }}</td>
            <td class="ss-dbg-c-sql">{{ e.subject }}</td>
            <td>
              <span :class="['ss-dbg-email-status', statusClass(e.status)]">
                {{ e.status }}
              </span>
            </td>
            <td class="ss-dbg-c-muted">{{ e.mailer }}</td>
            <td class="ss-dbg-c-dim" style="text-align: center">
              {{ e.attachmentCount > 0 ? e.attachmentCount : '-' }}
            </td>
            <td class="ss-dbg-event-time" :title="formatTime(e.timestamp)">{{ timeAgo(e.timestamp) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
