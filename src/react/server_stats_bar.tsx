import { useCallback, useState } from 'react'

import { Separator } from './separator.js'
import { StatBadge } from './stat_badge.js'
import { useServerStats } from './use_server_stats.js'
import {
  cpuColor,
  cpuHex,
  errorRateColor,
  formatBytes,
  formatCount,
  formatMb,
  formatUptime,
  hitRateColor,
  latencyColor,
  latencyHex,
  ratioColor,
  warnIfPositive,
} from './utils.js'

import type { ServerStats } from '../types.js'
import type { UseServerStatsOptions } from './types.js'

function deriveHistories(h: ServerStats[]) {
  return {
    cpuHistory: h.map((s) => s.cpuPercent),
    evtHistory: h.map((s) => s.eventLoopLag),
    heapHistory: h.map((s) => s.memHeapUsed),
    rssHistory: h.map((s) => s.memRss),
    sysMemHistory: h.map((s) => s.systemMemoryTotalMb - s.systemMemoryFreeMb),
    rpsHistory: h.map((s) => s.requestsPerSecond),
    avgRtHistory: h.map((s) => s.avgResponseTimeMs),
    errHistory: h.map((s) => s.errorRate),
    connHistory: h.map((s) => s.activeHttpConnections),
    dbUsedHistory: h.map((s) => s.dbPoolUsed),
    redisMemHistory: h.map((s) => s.redisMemoryUsedMb),
    redisKeysHistory: h.map((s) => s.redisKeysCount),
    redisHitHistory: h.map((s) => s.redisHitRate),
    qActiveHistory: h.map((s) => s.queueActive),
    usersHistory: h.map((s) => s.onlineUsers),
    webhooksHistory: h.map((s) => s.pendingWebhooks),
    emailsHistory: h.map((s) => s.pendingEmails),
    logErrorsHistory: h.map((s) => s.logErrorsLast5m),
    logRateHistory: h.map((s) => s.logEntriesPerMinute),
  }
}

function StatsBarMetrics({
  stats,
  histories,
}: {
  stats: ServerStats
  histories: ReturnType<typeof deriveHistories>
}) {
  const {
    cpuHistory,
    evtHistory,
    heapHistory,
    rssHistory,
    sysMemHistory,
    rpsHistory,
    avgRtHistory,
    errHistory,
    connHistory,
    dbUsedHistory,
    redisMemHistory,
    redisKeysHistory,
    redisHitHistory,
    qActiveHistory,
    usersHistory,
    webhooksHistory,
    emailsHistory,
    logErrorsHistory,
    logRateHistory,
  } = histories

  return (
    <div className="flex items-center">
      {/* Process */}
      <StatBadge
        label="NODE"
        value={stats.nodeVersion}
        tooltipTitle="Node.js Runtime"
        tooltipDetails="Node.js version running the server process"
      />
      <StatBadge
        label="UP"
        value={formatUptime(stats.uptime)}
        tooltipTitle="Process Uptime"
        tooltipDetails={`Process uptime: ${formatUptime(stats.uptime)} (${Math.floor(stats.uptime)}s)`}
      />
      <StatBadge
        label="CPU"
        value={`${stats.cpuPercent.toFixed(1)}%`}
        tooltipTitle="CPU Usage"
        tooltipUnit="%"
        tooltipDetails="Percentage of one CPU core. >50% amber, >80% red."
        color={cpuColor(stats.cpuPercent)}
        history={cpuHistory}
        historyColor={cpuHex(stats.cpuPercent)}
      />
      <StatBadge
        label="EVT"
        value={`${stats.eventLoopLag.toFixed(1)}ms`}
        tooltipTitle="Event Loop Latency"
        tooltipUnit="ms"
        tooltipDetails="Delay between scheduled and actual timer execution. >20ms amber, >50ms red."
        color={latencyColor(stats.eventLoopLag, 20, 50)}
        history={evtHistory}
        historyColor={latencyHex(stats.eventLoopLag, 20, 50)}
      />

      <Separator />

      {/* Memory */}
      <StatBadge
        label="MEM"
        value={formatBytes(stats.memHeapUsed)}
        tooltipTitle="V8 Heap Usage"
        tooltipUnit="bytes"
        tooltipDetails={`Heap: ${formatBytes(stats.memHeapUsed)} used of ${formatBytes(stats.memHeapTotal)} allocated`}
        history={heapHistory}
        historyColor="#34d399"
      />
      <StatBadge
        label="RSS"
        value={formatBytes(stats.memRss)}
        tooltipTitle="Resident Set Size"
        tooltipUnit="bytes"
        tooltipDetails="Total OS memory footprint including heap, stack, and native allocations"
        history={rssHistory}
        historyColor="#34d399"
      />
      <StatBadge
        label="SYS"
        value={`${formatMb(stats.systemMemoryTotalMb - stats.systemMemoryFreeMb)}/${formatMb(stats.systemMemoryTotalMb)}`}
        tooltipTitle="System Memory"
        tooltipUnit="MB"
        tooltipDetails={`${formatMb(stats.systemMemoryFreeMb)} free of ${formatMb(stats.systemMemoryTotalMb)} total`}
        history={sysMemHistory}
        historyColor="#34d399"
      />

      <Separator />

      {/* HTTP */}
      <StatBadge
        label="REQ/s"
        value={stats.requestsPerSecond.toFixed(1)}
        tooltipTitle="Requests per Second"
        tooltipUnit="/s"
        tooltipDetails="HTTP requests per second over a 60-second rolling window"
        history={rpsHistory}
        historyColor="#34d399"
      />
      <StatBadge
        label="AVG"
        value={`${stats.avgResponseTimeMs.toFixed(0)}ms`}
        tooltipTitle="Avg Response Time"
        tooltipUnit="ms"
        tooltipDetails="Average HTTP response time (60s window). >200ms amber, >500ms red."
        color={latencyColor(stats.avgResponseTimeMs, 200, 500)}
        history={avgRtHistory}
        historyColor={latencyHex(stats.avgResponseTimeMs, 200, 500)}
      />
      <StatBadge
        label="ERR"
        value={`${stats.errorRate.toFixed(1)}%`}
        tooltipTitle="Error Rate"
        tooltipUnit="%"
        tooltipDetails="5xx error rate (60s window). >1% amber, >5% red."
        color={errorRateColor(stats.errorRate)}
        history={errHistory}
        historyColor={stats.errorRate > 5 ? '#f87171' : stats.errorRate > 1 ? '#fbbf24' : '#34d399'}
      />
      <StatBadge
        label="CONN"
        value={`${stats.activeHttpConnections}`}
        tooltipTitle="Active Connections"
        tooltipDetails="Currently open HTTP connections"
        history={connHistory}
        historyColor="#34d399"
      />

      <Separator />

      {/* DB Pool */}
      <StatBadge
        label="DB"
        value={`${stats.dbPoolUsed}/${stats.dbPoolFree}/${stats.dbPoolMax}`}
        tooltipTitle="Database Pool"
        tooltipDetails={`Used: ${stats.dbPoolUsed}, Free: ${stats.dbPoolFree}, Pending: ${stats.dbPoolPending}, Max: ${stats.dbPoolMax}`}
        color={ratioColor(stats.dbPoolUsed, stats.dbPoolMax)}
        history={dbUsedHistory}
        historyColor={
          ratioColor(stats.dbPoolUsed, stats.dbPoolMax) === 'text-red-400' ? '#f87171' : '#34d399'
        }
      />

      <Separator />

      {/* Redis */}
      <StatBadge
        label="REDIS"
        value={stats.redisOk ? '\u2713' : '\u2717'}
        tooltipTitle="Redis Status"
        tooltipDetails={
          stats.redisOk ? 'Redis is connected and responding' : 'Redis is not responding!'
        }
        color={stats.redisOk ? 'text-emerald-400' : 'text-red-400'}
      />
      {stats.redisOk && (
        <>
          <StatBadge
            label="MEM"
            value={`${stats.redisMemoryUsedMb.toFixed(1)}M`}
            tooltipTitle="Redis Memory"
            tooltipUnit="MB"
            tooltipDetails={`Redis server memory usage: ${stats.redisMemoryUsedMb.toFixed(1)} MB`}
            history={redisMemHistory}
            historyColor="#34d399"
          />
          <StatBadge
            label="KEYS"
            value={formatCount(stats.redisKeysCount)}
            tooltipTitle="Redis Keys"
            tooltipDetails={`Total keys in Redis: ${stats.redisKeysCount}`}
            history={redisKeysHistory}
            historyColor="#34d399"
          />
          <StatBadge
            label="HIT"
            value={`${stats.redisHitRate.toFixed(0)}%`}
            tooltipTitle="Redis Hit Rate"
            tooltipUnit="%"
            tooltipDetails="Cache hit rate. <90% amber, <70% red."
            color={hitRateColor(stats.redisHitRate)}
            history={redisHitHistory}
            historyColor={
              stats.redisHitRate < 70 ? '#f87171' : stats.redisHitRate < 90 ? '#fbbf24' : '#34d399'
            }
          />
        </>
      )}

      <Separator />

      {/* Queue */}
      <StatBadge
        label="Q"
        value={`${stats.queueActive}/${stats.queueWaiting}/${stats.queueDelayed}`}
        tooltipTitle="Job Queue"
        tooltipDetails={`Active: ${stats.queueActive}, Waiting: ${stats.queueWaiting}, Delayed: ${stats.queueDelayed}, Failed: ${stats.queueFailed}`}
        color={stats.queueFailed > 0 ? 'text-amber-400' : 'text-emerald-400'}
        history={qActiveHistory}
        historyColor={stats.queueFailed > 0 ? '#fbbf24' : '#34d399'}
      />
      <StatBadge
        label="WORKERS"
        value={`${stats.queueWorkerCount}`}
        tooltipTitle="Queue Workers"
        tooltipDetails={`Connected queue worker processes: ${stats.queueWorkerCount}`}
      />

      <Separator />

      {/* App */}
      <StatBadge
        label="USERS"
        value={`${stats.onlineUsers}`}
        tooltipTitle="Online Users"
        tooltipDetails="Active user sessions (via Transmit)"
        history={usersHistory}
        historyColor="#34d399"
      />
      <StatBadge
        label="HOOKS"
        value={`${stats.pendingWebhooks}`}
        tooltipTitle="Pending Webhooks"
        tooltipDetails="Webhook events awaiting delivery. >100 amber."
        color={warnIfPositive(stats.pendingWebhooks, 100)}
        history={webhooksHistory}
        historyColor={stats.pendingWebhooks > 100 ? '#fbbf24' : '#34d399'}
      />
      <StatBadge
        label="MAIL"
        value={`${stats.pendingEmails}`}
        tooltipTitle="Pending Emails"
        tooltipDetails="Scheduled emails awaiting send. >100 amber."
        color={warnIfPositive(stats.pendingEmails, 100)}
        history={emailsHistory}
        historyColor={stats.pendingEmails > 100 ? '#fbbf24' : '#34d399'}
      />

      <Separator />

      {/* Logs */}
      <StatBadge
        label="LOG ERR"
        value={`${stats.logErrorsLast5m}`}
        tooltipTitle="Log Errors (5m)"
        tooltipDetails={`${stats.logErrorsLast5m} error/fatal entries and ${stats.logWarningsLast5m} warnings in the last 5 minutes`}
        color={
          stats.logErrorsLast5m > 0
            ? 'text-red-400'
            : stats.logWarningsLast5m > 0
              ? 'text-amber-400'
              : 'text-emerald-400'
        }
        history={logErrorsHistory}
        historyColor={stats.logErrorsLast5m > 0 ? '#f87171' : '#34d399'}
        href="/admin/logs?hasError=true"
      />
      <StatBadge
        label="LOG/m"
        value={`${stats.logEntriesPerMinute}`}
        tooltipTitle="Log Rate"
        tooltipUnit="/m"
        tooltipDetails={`${stats.logEntriesLast5m} total entries in the last 5 minutes`}
        history={logRateHistory}
        historyColor="#34d399"
        href="/admin/logs"
      />
    </div>
  )
}

export interface ServerStatsBarProps extends UseServerStatsOptions {}

export function ServerStatsBar(props?: ServerStatsBarProps) {
  const { stats, stale, history } = useServerStats(props)

  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('admin:stats-bar') !== 'hidden'
  })

  const toggleVisible = useCallback(() => {
    setVisible((prev) => {
      const next = !prev
      localStorage.setItem('admin:stats-bar', next ? 'visible' : 'hidden')
      return next
    })
  }, [])

  if (!stats) return null

  const histories = deriveHistories(history)

  return (
    <>
      <button
        type="button"
        onClick={toggleVisible}
        className={`fixed uppercase right-3 z-50 flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200 ${visible ? 'bottom-9' : 'bottom-3'}`}
        title={visible ? 'Hide stats bar' : 'Show stats bar'}
      >
        {!visible && (
          <span className="flex items-center gap-1.5 text-neutral-500">
            <span className={`font-semibold tabular-nums ${cpuColor(stats.cpuPercent)}`}>
              {stats.cpuPercent.toFixed(0)}%
            </span>
            <span className="font-semibold tabular-nums text-emerald-400">
              {formatBytes(stats.memHeapUsed)}
            </span>
            <span
              className={`font-semibold tabular-nums ${stats.redisOk ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {stats.redisOk ? '\u2713' : '\u2717'}
            </span>
          </span>
        )}
        {visible && <span className="text-neutral-500">hide stats</span>}
        <span>{visible ? '\u25BC' : '\u25B2'}</span>
      </button>

      {!visible ? null : (
        <div className="fixed inset-x-0 bottom-0 z-50 flex h-7 items-center justify-center gap-0.5 border-t border-neutral-800 bg-neutral-950 font-mono text-neutral-400 shadow-2xl">
          {/* Connection indicator */}
          <div className="flex items-center gap-1 px-2">
            <div
              className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500'}`}
              title={stale ? 'Connection stale \u2014 no update in 10s' : 'Live connection'}
            />
          </div>

          <StatsBarMetrics stats={stats} histories={histories} />
        </div>
      )}
    </>
  )
}
