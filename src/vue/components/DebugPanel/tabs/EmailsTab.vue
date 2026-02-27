<script setup lang="ts">
/**
 * Emails table with preview tab for the debug panel.
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { timeAgo } from '../../../../core/index.js'
import { initResizableColumns } from '../../../../core/resizable-columns.js'
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
      e.to.toLowerCase().includes(term)
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

watch(emails, attachResize)
onMounted(attachResize)
onBeforeUnmount(() => {
  if (cleanupResize) cleanupResize()
})
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
        <button class="ss-dbg-close" @click="closePreview">&times;</button>
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
            <th>Subject</th>
            <th>To</th>
            <th>Mailer</th>
            <th>Status</th>
            <th>Att.</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in emails" :key="e.id" class="ss-dbg-email-row" @click="openPreview(e)">
            <td style="color: var(--ss-dim)">{{ e.id }}</td>
            <td style="color: var(--ss-text)">
              {{ e.subject }}
              <a
                v-if="dashboardPath"
                :href="`${dashboardPath}#emails?id=${e.id}`"
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
            <td style="color: var(--ss-text-secondary)">{{ e.to }}</td>
            <td style="color: var(--ss-muted)">{{ e.mailer }}</td>
            <td>
              <span :class="['ss-dbg-email-status', statusClass(e.status)]">
                {{ e.status }}
              </span>
            </td>
            <td style="color: var(--ss-dim); text-align: center">
              {{ e.attachmentCount || 0 }}
            </td>
            <td class="ss-dbg-event-time">{{ timeAgo(e.timestamp) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
