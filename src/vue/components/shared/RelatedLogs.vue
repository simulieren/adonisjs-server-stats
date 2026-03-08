<script setup lang="ts">
import { ref } from 'vue'
import { formatTime, timeAgo } from '../../../core/formatters.js'
import {
  resolveLogLevel,
  resolveLogMessage,
  resolveLogTimestamp,
  resolveLogRequestId,
  getLogLevelCssClass,
  getStructuredData,
} from '../../../core/log-utils.js'
import JsonViewer from './JsonViewer.vue'

import type { LogEntry } from '../../../core/log-utils.js'

const props = withDefaults(
  defineProps<{
    logs: LogEntry[]
    classPrefix?: 'ss-dash' | 'ss-dbg'
  }>(),
  {
    classPrefix: 'ss-dash',
  }
)

const expandedIndex = ref<number | null>(null)

function toggleExpand(index: number, hasData: boolean) {
  if (!hasData) return
  expandedIndex.value = expandedIndex.value === index ? null : index
}
</script>

<template>
  <div v-if="logs.length > 0">
    <div :class="`${classPrefix}-related-logs-title`">
      Related Logs
      <span :class="`${classPrefix}-related-logs-count`">({{ logs.length }})</span>
    </div>
    <div style="overflow: auto">
      <template v-for="(log, i) in logs" :key="(log.id as string) || i">
        <div
          :class="[
            `${classPrefix}-log-entry`,
            getStructuredData(log) ? `${classPrefix}-log-entry-expandable` : '',
          ]"
          @click="toggleExpand(i, !!getStructuredData(log))"
        >
          <span
            :class="[
              `${classPrefix}-log-level`,
              getLogLevelCssClass(resolveLogLevel(log), `${classPrefix}-log-level`),
            ]"
          >
            {{ resolveLogLevel(log).toUpperCase() }}
          </span>
          <span
            :class="`${classPrefix}-log-time`"
            :title="resolveLogTimestamp(log) ? formatTime(resolveLogTimestamp(log)) : ''"
          >
            {{ resolveLogTimestamp(log) ? timeAgo(resolveLogTimestamp(log)) : '-' }}
          </span>
          <span
            v-if="resolveLogRequestId(log)"
            :class="`${classPrefix}-log-reqid`"
            :title="resolveLogRequestId(log)"
          >
            {{ resolveLogRequestId(log).slice(0, 8) }}
          </span>
          <span v-else :class="`${classPrefix}-log-reqid-empty`">--</span>
          <span
            v-if="getStructuredData(log)"
            :class="[
              `${classPrefix}-log-expand-icon`,
              expandedIndex === i ? `${classPrefix}-log-expand-icon-open` : '',
            ]"
            >&#x25B6;</span
          >
          <span v-else style="width: 14px" />
          <span :class="`${classPrefix}-log-msg`">{{ resolveLogMessage(log) }}</span>
        </div>
        <div
          v-if="expandedIndex === i && getStructuredData(log)"
          :class="`${classPrefix}-log-detail`"
        >
          <JsonViewer
            :value="getStructuredData(log)"
            :class-prefix="classPrefix"
            :default-expanded="true"
          />
        </div>
      </template>
    </div>
  </div>
</template>
