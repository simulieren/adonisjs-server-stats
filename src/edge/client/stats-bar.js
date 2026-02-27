/**
 * Client-side script for the server stats bar.
 *
 * Handles polling, DOM updates, sparkline SVG rendering, tooltips,
 * toggle persistence, stale detection, and formatting utils.
 *
 * Config is read from data-* attributes on #ss-bar:
 *   data-endpoint  — polling URL
 *   data-interval  — poll interval in ms
 */
;(function () {
  const bar = document.getElementById('ss-bar')
  const toggle = document.getElementById('ss-toggle')
  const dot = document.getElementById('ss-dot')
  const toggleSummary = document.getElementById('ss-toggle-summary')

  if (!bar || !toggle) return

  // ── Theme detection & application ───────────────────────────────
  let themeOverride = localStorage.getItem('ss-dash-theme')

  const applyBarTheme = () => {
    if (themeOverride) {
      bar.setAttribute('data-ss-theme', themeOverride)
      toggle.setAttribute('data-ss-theme', themeOverride)
    } else {
      bar.removeAttribute('data-ss-theme')
      toggle.removeAttribute('data-ss-theme')
    }
  }

  applyBarTheme()

  // Expose for debug-panel toggle to call directly
  window.__ssApplyBarTheme = applyBarTheme

  // Listen for cross-tab theme changes
  window.addEventListener('storage', function (e) {
    if (e.key === 'ss-dash-theme') {
      themeOverride = e.newValue
      applyBarTheme()
    }
  })

  const ENDPOINT = bar.dataset.endpoint || '/admin/api/server-stats'
  const INTERVAL = Number(bar.dataset.interval) || 3000
  const MAX_HISTORY = 60
  const STALE_MS = 10000

  // ── Formatting utils ──────────────────────────────────────────────

  const formatUptime = (s) => {
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (d > 0) return d + 'd ' + h + 'h'
    if (h > 0) return h + 'h ' + m + 'm'
    return m + 'm'
  }

  const formatBytes = (b) => {
    const mb = b / (1024 * 1024)
    if (mb >= 1024) return (mb / 1024).toFixed(1) + 'G'
    return mb.toFixed(0) + 'M'
  }

  const formatMb = (mb) => {
    if (mb >= 1024) return (mb / 1024).toFixed(1) + 'G'
    return mb.toFixed(1) + 'M'
  }

  const formatCount = (n) => {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
    return '' + n
  }

  const formatStatNum = (v, unit) => {
    if (unit === '%') return v.toFixed(1) + '%'
    if (unit === 'ms') return v.toFixed(0) + 'ms'
    if (unit === 'MB') return v.toFixed(1) + 'M'
    if (unit === 'bytes') return formatBytes(v)
    if (unit === '/s' || unit === '/m') return v.toFixed(1)
    return v.toFixed(1)
  }

  // ── Color thresholds ──────────────────────────────────────────────
  // Unified threshold helper: returns CSS class based on warn/crit thresholds
  const thresh = (v, warn, crit) => (v > crit ? 'ss-red' : v > warn ? 'ss-amber' : 'ss-green')
  const threshInverse = (v, warn, crit) =>
    v < crit ? 'ss-red' : v < warn ? 'ss-amber' : 'ss-green'

  // Map color class → CSS variable for sparklines (reads themed value at render time)
  const HEX_FALLBACK = {
    'ss-red': '#f87171',
    'ss-amber': '#fbbf24',
    'ss-green': '#34d399',
    'ss-muted': '#737373',
  }
  const HEX_VAR = {
    'ss-red': '--ss-red-fg',
    'ss-amber': '--ss-amber-fg',
    'ss-green': '--ss-accent',
    'ss-muted': '--ss-muted',
  }
  const hexFromClass = (cls) => {
    const varName = HEX_VAR[cls]
    if (varName) {
      const val = getComputedStyle(bar).getPropertyValue(varName).trim()
      if (val) return val
    }
    return HEX_FALLBACK[cls] || '#34d399'
  }

  const ratioColor = (used, max) => {
    if (max === 0) return 'ss-muted'
    const p = used / max
    return p > 0.8 ? 'ss-red' : p > 0.5 ? 'ss-amber' : 'ss-green'
  }

  // ── Sparkline rendering ───────────────────────────────────────────
  const SVG_NS = 'http://www.w3.org/2000/svg'

  const renderSparkline = (container, data, color) => {
    container.innerHTML = ''
    const w = 120,
      h = 32,
      pad = 2
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', '' + w)
    svg.setAttribute('height', '' + h)
    svg.style.display = 'block'

    if (data.length < 2) {
      const txt = document.createElementNS(SVG_NS, 'text')
      txt.setAttribute('x', '' + w / 2)
      txt.setAttribute('y', '' + (h / 2 + 3))
      txt.setAttribute('text-anchor', 'middle')
      txt.setAttribute('fill', '#737373')
      txt.setAttribute('font-size', '9')
      txt.textContent = 'collecting\u2026'
      svg.appendChild(txt)
      container.appendChild(svg)
      return
    }

    const iw = w - pad * 2,
      ih = h - pad * 2
    const mn = Math.min(...data),
      mx = Math.max(...data)
    const range = mx - mn || 1
    const pts = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * iw
      const y = pad + ih - ((v - mn) / range) * ih
      return x.toFixed(1) + ',' + y.toFixed(1)
    })

    const gradId = 'sg-' + color.replace('#', '')
    const defs = document.createElementNS(SVG_NS, 'defs')
    const grad = document.createElementNS(SVG_NS, 'linearGradient')
    grad.setAttribute('id', gradId)
    grad.setAttribute('x1', '0')
    grad.setAttribute('y1', '0')
    grad.setAttribute('x2', '0')
    grad.setAttribute('y2', '1')
    const s1 = document.createElementNS(SVG_NS, 'stop')
    s1.setAttribute('offset', '0%')
    s1.setAttribute('stop-color', color)
    s1.setAttribute('stop-opacity', '0.25')
    const s2 = document.createElementNS(SVG_NS, 'stop')
    s2.setAttribute('offset', '100%')
    s2.setAttribute('stop-color', color)
    s2.setAttribute('stop-opacity', '0.02')
    grad.appendChild(s1)
    grad.appendChild(s2)
    defs.appendChild(grad)
    svg.appendChild(defs)

    const lastX = (pad + iw).toFixed(1)
    const lastY = (pad + ih).toFixed(1)
    const firstX = pad.toFixed(1)
    const areaD =
      'M' +
      pts[0] +
      ' ' +
      pts
        .slice(1)
        .map((p) => 'L' + p)
        .join(' ') +
      ' L' +
      lastX +
      ',' +
      lastY +
      ' L' +
      firstX +
      ',' +
      lastY +
      ' Z'
    const area = document.createElementNS(SVG_NS, 'path')
    area.setAttribute('d', areaD)
    area.setAttribute('fill', 'url(#' + gradId + ')')
    svg.appendChild(area)

    const line = document.createElementNS(SVG_NS, 'polyline')
    line.setAttribute('points', pts.join(' '))
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', '1.5')
    line.setAttribute('stroke-linejoin', 'round')
    line.setAttribute('stroke-linecap', 'round')
    svg.appendChild(line)

    container.appendChild(svg)
  }

  // ── Stats computation ─────────────────────────────────────────────
  const computeStats = (data) => {
    if (!data || data.length === 0) return null
    const mn = Math.min(...data)
    const mx = Math.max(...data)
    const avg = data.reduce((a, b) => a + b, 0) / data.length
    return { min: mn, max: mx, avg }
  }

  // ── HTML escape ───────────────────────────────────────────────────
  const esc = (s) => {
    if (typeof s !== 'string') s = '' + s
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── Tooltip rendering ─────────────────────────────────────────────
  let pinnedBadge = null
  let activeTooltip = null

  const positionTooltip = (tip, badge) => {
    const badgeRect = badge.getBoundingClientRect()
    const barRect = bar.getBoundingClientRect()
    const leftPos = badgeRect.left - barRect.left + badgeRect.width / 2
    tip.style.bottom = '100%'
    tip.style.left = leftPos + 'px'
    tip.style.transform = 'translateX(-50%)'
    tip.style.marginBottom = '10px'
    requestAnimationFrame(() => {
      const tipRect = tip.getBoundingClientRect()
      let shift = 0
      if (tipRect.left < 8) shift = 8 - tipRect.left
      else if (tipRect.right > window.innerWidth - 8) shift = window.innerWidth - 8 - tipRect.right
      if (shift) tip.style.transform = 'translateX(calc(-50% + ' + shift + 'px))'
    })
  }

  const hideCurrentTooltip = () => {
    if (activeTooltip) {
      activeTooltip.remove()
      activeTooltip = null
    }
  }

  const unpinTooltip = () => {
    if (pinnedBadge) {
      pinnedBadge.classList.remove('ss-pinned')
      pinnedBadge = null
    }
    hideCurrentTooltip()
  }

  const showTooltip = (badge, { historyData, color, title, unit, currentValue, details, pinned }) => {
    hideCurrentTooltip()
    const tip = document.createElement('div')
    tip.className = pinned ? 'ss-tooltip ss-pinned' : 'ss-tooltip'

    let html = '<div class="ss-tooltip-inner" style="position:relative">'
    if (pinned) {
      html += '<button class="ss-tooltip-close" data-ss-close>\u00D7</button>'
    }
    html +=
      '<div class="ss-tooltip-header"><span class="ss-tooltip-title">' + esc(title) + '</span>'
    if (unit) html += '<span class="ss-tooltip-unit">' + esc(unit) + '</span>'
    html += '</div>'
    html +=
      '<div class="ss-tooltip-current"><span class="ss-tooltip-current-label">Current: </span>'
    html += '<span class="ss-tooltip-current-value">' + esc(currentValue) + '</span></div>'

    const st = computeStats(historyData)
    if (st) {
      html += '<div class="ss-tooltip-stats">'
      html += '<span>Min: ' + formatStatNum(st.min, unit) + '</span>'
      html += '<span>Max: ' + formatStatNum(st.max, unit) + '</span>'
      html += '<span>Avg: ' + formatStatNum(st.avg, unit) + '</span>'
      html += '</div>'
    }
    if (details) {
      html += '<div class="ss-tooltip-details">' + esc(details) + '</div>'
    }
    if (historyData && historyData.length > 0) {
      html += '<div class="ss-tooltip-sparkline" data-sparkline></div>'
      html +=
        '<div class="ss-tooltip-samples">Last ' +
        Math.min(historyData.length, MAX_HISTORY) +
        ' samples (~' +
        Math.round((Math.min(historyData.length, MAX_HISTORY) * 3) / 60) +
        ' min)</div>'
    }
    html += '</div><div class="ss-tooltip-arrow"></div>'
    tip.innerHTML = html

    bar.appendChild(tip)
    positionTooltip(tip, badge)
    activeTooltip = tip

    if (pinned) {
      const closeBtn = tip.querySelector('[data-ss-close]')
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          unpinTooltip()
        })
      }
    }

    const sparkContainer = tip.querySelector('[data-sparkline]')
    if (sparkContainer && historyData && historyData.length > 0) {
      renderSparkline(sparkContainer, historyData, color || '#34d399')
    }
  }

  const refreshPinnedTooltip = () => {
    if (!pinnedBadge || !window.__ssLatest) return
    const badgeId = pinnedBadge.id.replace('ss-b-', '')
    const b = BADGES.find((x) => x.id === badgeId)
    if (!b) return
    const valEl = pinnedBadge.querySelector('.ss-value')
    const currentVal = valEl ? valEl.textContent : ''
    const hist = b.hist ? history[b.hist] || [] : []
    const color = b.color ? hexFromClass(b.color(window.__ssLatest)) : '#34d399'
    const title = typeof b.title === 'string' ? b.title : b.label
    const details = typeof b.detail === 'function' ? b.detail(window.__ssLatest) : b.detail || ''
    showTooltip(pinnedBadge, { historyData: hist, color, title, unit: b.unit, currentValue: currentVal, details, pinned: true })
  }

  // Close pinned tooltip on click outside
  document.addEventListener('click', (e) => {
    if (!pinnedBadge) return
    if (!pinnedBadge.contains(e.target) && !(activeTooltip && activeTooltip.contains(e.target))) {
      unpinTooltip()
    }
  })

  // Close pinned tooltip on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinnedBadge) unpinTooltip()
  })

  // ── Badge definitions ─────────────────────────────────────────────
  // Compact badge defs: val (getValue), color (getColor→class), title, detail, hist (historyKey), unit, show (showIf), href, group
  const BADGES = [
    // Process
    {
      id: 'node',
      group: 'process',
      label: 'NODE',
      val: (s) => s.nodeVersion,
      title: 'Node.js Runtime',
      detail: 'Node.js version running the server process',
    },
    {
      id: 'up',
      group: 'process',
      label: 'UP',
      val: (s) => formatUptime(s.uptime),
      title: 'Process Uptime',
      detail: (s) =>
        'Process uptime: ' + formatUptime(s.uptime) + ' (' + Math.floor(s.uptime) + 's)',
    },
    {
      id: 'cpu',
      group: 'process',
      label: 'CPU',
      val: (s) => s.cpuPercent.toFixed(1) + '%',
      color: (s) => thresh(s.cpuPercent, 50, 80),
      unit: '%',
      title: 'CPU Usage',
      detail: 'Percentage of one CPU core. >50% amber, >80% red.',
      hist: 'cpuPercent',
    },
    {
      id: 'evt',
      group: 'process',
      label: 'EVT',
      val: (s) => s.eventLoopLag.toFixed(1) + 'ms',
      color: (s) => thresh(s.eventLoopLag, 20, 50),
      unit: 'ms',
      title: 'Event Loop Latency',
      detail: 'Delay between scheduled and actual timer execution. >20ms amber, >50ms red.',
      hist: 'eventLoopLag',
    },
    // Memory
    {
      id: 'mem',
      group: 'memory',
      label: 'MEM',
      val: (s) => formatBytes(s.memHeapUsed),
      unit: 'bytes',
      title: 'V8 Heap Usage',
      detail: (s) =>
        'Heap: ' +
        formatBytes(s.memHeapUsed) +
        ' used of ' +
        formatBytes(s.memHeapTotal) +
        ' allocated',
      hist: 'memHeapUsed',
    },
    {
      id: 'rss',
      group: 'memory',
      label: 'RSS',
      val: (s) => formatBytes(s.memRss),
      unit: 'bytes',
      title: 'Resident Set Size',
      detail: 'Total OS memory footprint including heap, stack, and native allocations',
      hist: 'memRss',
    },
    {
      id: 'sys',
      group: 'memory',
      label: 'SYS',
      val: (s) =>
        formatMb(s.systemMemoryTotalMb - s.systemMemoryFreeMb) +
        '/' +
        formatMb(s.systemMemoryTotalMb),
      unit: 'MB',
      title: 'System Memory',
      detail: (s) =>
        formatMb(s.systemMemoryFreeMb) + ' free of ' + formatMb(s.systemMemoryTotalMb) + ' total',
      hist: '_sysMemUsed',
    },
    // HTTP
    {
      id: 'rps',
      group: 'http',
      label: 'REQ/s',
      val: (s) => s.requestsPerSecond.toFixed(1),
      unit: '/s',
      title: 'Requests per Second',
      detail: 'HTTP requests per second over a 60-second rolling window',
      hist: 'requestsPerSecond',
    },
    {
      id: 'avg',
      group: 'http',
      label: 'AVG',
      val: (s) => s.avgResponseTimeMs.toFixed(0) + 'ms',
      color: (s) => thresh(s.avgResponseTimeMs, 200, 500),
      unit: 'ms',
      title: 'Avg Response Time',
      detail: 'Average HTTP response time (60s window). >200ms amber, >500ms red.',
      hist: 'avgResponseTimeMs',
    },
    {
      id: 'err',
      group: 'http',
      label: 'ERR',
      val: (s) => s.errorRate.toFixed(1) + '%',
      color: (s) => thresh(s.errorRate, 1, 5),
      unit: '%',
      title: 'Error Rate',
      detail: '5xx error rate (60s window). >1% amber, >5% red.',
      hist: 'errorRate',
    },
    {
      id: 'conn',
      group: 'http',
      label: 'CONN',
      val: (s) => '' + s.activeHttpConnections,
      title: 'Active Connections',
      detail: 'Currently open HTTP connections',
      hist: 'activeHttpConnections',
    },
    // DB
    {
      id: 'db',
      group: 'db',
      label: 'DB',
      val: (s) => s.dbPoolUsed + '/' + s.dbPoolFree + '/' + s.dbPoolMax,
      color: (s) => ratioColor(s.dbPoolUsed, s.dbPoolMax),
      title: 'Database Pool',
      detail: (s) =>
        'Used: ' +
        s.dbPoolUsed +
        ', Free: ' +
        s.dbPoolFree +
        ', Pending: ' +
        s.dbPoolPending +
        ', Max: ' +
        s.dbPoolMax,
      hist: 'dbPoolUsed',
    },
    // Redis
    {
      id: 'redis',
      group: 'redis',
      label: 'REDIS',
      val: (s) => (s.redisOk ? '\u2713' : '\u2717'),
      color: (s) => (s.redisOk ? 'ss-green' : 'ss-red'),
      title: 'Redis Status',
      detail: (s) => (s.redisOk ? 'Redis is connected and responding' : 'Redis is not responding!'),
    },
    {
      id: 'rmem',
      group: 'redis',
      label: 'MEM',
      val: (s) => s.redisMemoryUsedMb.toFixed(1) + 'M',
      unit: 'MB',
      title: 'Redis Memory',
      detail: (s) => 'Redis server memory usage: ' + s.redisMemoryUsedMb.toFixed(1) + ' MB',
      hist: 'redisMemoryUsedMb',
      show: (s) => s.redisOk,
    },
    {
      id: 'rkeys',
      group: 'redis',
      label: 'KEYS',
      val: (s) => formatCount(s.redisKeysCount),
      title: 'Redis Keys',
      detail: (s) => 'Total keys in Redis: ' + s.redisKeysCount,
      hist: 'redisKeysCount',
      show: (s) => s.redisOk,
    },
    {
      id: 'rhit',
      group: 'redis',
      label: 'HIT',
      val: (s) => s.redisHitRate.toFixed(0) + '%',
      color: (s) => threshInverse(s.redisHitRate, 90, 70),
      unit: '%',
      title: 'Redis Hit Rate',
      detail: 'Cache hit rate. <90% amber, <70% red.',
      hist: 'redisHitRate',
      show: (s) => s.redisOk,
    },
    // Queue
    {
      id: 'q',
      group: 'queue',
      label: 'Q',
      val: (s) => s.queueActive + '/' + s.queueWaiting + '/' + s.queueDelayed,
      color: (s) => (s.queueFailed > 0 ? 'ss-amber' : 'ss-green'),
      title: 'Job Queue',
      detail: (s) =>
        'Active: ' +
        s.queueActive +
        ', Waiting: ' +
        s.queueWaiting +
        ', Delayed: ' +
        s.queueDelayed +
        ', Failed: ' +
        s.queueFailed,
      hist: 'queueActive',
    },
    {
      id: 'workers',
      group: 'queue',
      label: 'WORKERS',
      val: (s) => '' + s.queueWorkerCount,
      title: 'Queue Workers',
      detail: (s) => 'Connected queue worker processes: ' + s.queueWorkerCount,
    },
    // App
    {
      id: 'users',
      group: 'app',
      label: 'USERS',
      val: (s) => '' + s.onlineUsers,
      title: 'Online Users',
      detail: 'Active user sessions (via Transmit)',
      hist: 'onlineUsers',
    },
    {
      id: 'hooks',
      group: 'app',
      label: 'HOOKS',
      val: (s) => '' + s.pendingWebhooks,
      color: (s) => (s.pendingWebhooks > 100 ? 'ss-amber' : 'ss-green'),
      title: 'Pending Webhooks',
      detail: 'Webhook events awaiting delivery. >100 amber.',
      hist: 'pendingWebhooks',
    },
    {
      id: 'mail',
      group: 'app',
      label: 'MAIL',
      val: (s) => '' + s.pendingEmails,
      color: (s) => (s.pendingEmails > 100 ? 'ss-amber' : 'ss-green'),
      title: 'Pending Emails',
      detail: 'Scheduled emails awaiting send. >100 amber.',
      hist: 'pendingEmails',
    },
    // Logs
    {
      id: 'logerr',
      group: 'log',
      label: 'LOG ERR',
      val: (s) => '' + s.logErrorsLast5m,
      color: (s) =>
        s.logErrorsLast5m > 0 ? 'ss-red' : s.logWarningsLast5m > 0 ? 'ss-amber' : 'ss-green',
      title: 'Log Errors (5m)',
      detail: (s) =>
        s.logErrorsLast5m +
        ' error/fatal entries and ' +
        s.logWarningsLast5m +
        ' warnings in the last 5 minutes',
      hist: 'logErrorsLast5m',
      href: '/admin/logs?hasError=true',
    },
    {
      id: 'lograte',
      group: 'log',
      label: 'LOG/m',
      val: (s) => '' + s.logEntriesPerMinute,
      unit: '/m',
      title: 'Log Rate',
      detail: (s) => s.logEntriesLast5m + ' total entries in the last 5 minutes',
      hist: 'logEntriesPerMinute',
      href: '/admin/logs',
    },
  ]

  // ── State ─────────────────────────────────────────────────────────
  const history = {}
  let lastSuccess = 0
  let visible = localStorage.getItem('admin:stats-bar') !== 'hidden'

  // Apply initial visibility
  applyVisibility()

  function applyVisibility() {
    bar.className = visible ? 'ss-bar' : 'ss-bar ss-hidden'
    toggle.className = visible ? 'ss-toggle ss-visible' : 'ss-toggle ss-collapsed'
    toggle.title = visible ? 'Hide stats bar' : 'Show stats bar'
    const arrow = toggle.querySelector('.ss-toggle-arrow')
    if (arrow) arrow.textContent = visible ? '\u25BC' : '\u25B2'
    const label = toggle.querySelector('.ss-toggle-label')
    if (label) label.textContent = visible ? 'hide stats' : ''
    if (toggleSummary) toggleSummary.style.display = visible ? 'none' : 'flex'
  }

  toggle.addEventListener('click', () => {
    visible = !visible
    localStorage.setItem('admin:stats-bar', visible ? 'visible' : 'hidden')
    applyVisibility()
  })

  // ── Fetch & Update ────────────────────────────────────────────────
  const updateDom = (stats) => {
    window.__ssLatest = stats
    lastSuccess = Date.now()
    if (dot) dot.className = 'ss-dot'

    BADGES.forEach((b) => {
      const el = document.getElementById('ss-b-' + b.id)
      if (!el) return

      // Conditional visibility
      if (b.show) {
        el.style.display = b.show(stats) ? 'flex' : 'none'
        if (!b.show(stats)) return
      }

      // Update value
      const valEl = el.querySelector('.ss-value')
      if (valEl) {
        valEl.textContent = b.val(stats)

        // Update color
        if (b.color) {
          valEl.classList.remove('ss-green', 'ss-amber', 'ss-red', 'ss-muted')
          valEl.classList.add(b.color(stats))
        }
      }

      // Push history
      if (b.hist) {
        let val
        if (b.hist === '_sysMemUsed') {
          val = stats.systemMemoryTotalMb - stats.systemMemoryFreeMb
        } else {
          val = stats[b.hist]
        }
        if (typeof val === 'number') {
          if (!history[b.hist]) history[b.hist] = []
          history[b.hist].push(val)
          if (history[b.hist].length > MAX_HISTORY) history[b.hist].shift()
        }
      }
    })

    // Update toggle summary for collapsed state
    if (toggleSummary) {
      const cpuEl = toggleSummary.querySelector('[data-ts=cpu]')
      const memEl = toggleSummary.querySelector('[data-ts=mem]')
      const redisEl = toggleSummary.querySelector('[data-ts=redis]')
      if (cpuEl) {
        cpuEl.textContent = stats.cpuPercent.toFixed(0) + '%'
        cpuEl.className = 'ss-value ' + thresh(stats.cpuPercent, 50, 80)
      }
      if (memEl) {
        memEl.textContent = formatBytes(stats.memHeapUsed)
        memEl.className = 'ss-value ss-green'
      }
      if (redisEl) {
        redisEl.textContent = stats.redisOk ? '\u2713' : '\u2717'
        redisEl.className = 'ss-value ' + (stats.redisOk ? 'ss-green' : 'ss-red')
      }
    }

    refreshPinnedTooltip()
  }

  const doFetch = () => {
    fetch(ENDPOINT, { credentials: 'same-origin' })
      .then((r) => {
        if (r.status === 403 || r.status === 401) {
          bar.className = 'ss-bar ss-hidden'
          toggle.style.display = 'none'
          return null
        }
        return r.json()
      })
      .then((data) => {
        if (data) updateDom(data)
      })
      .catch(() => {
        // network error — mark stale
      })
  }

  // Stale detection
  setInterval(() => {
    if (lastSuccess > 0 && Date.now() - lastSuccess > STALE_MS && dot) {
      dot.className = 'ss-dot ss-stale'
    }
  }, 2000)

  // ── Tooltip event binding ─────────────────────────────────────────
  const getBadgeTooltipData = (b, el) => {
    const valEl = el.querySelector('.ss-value')
    const currentVal = valEl ? valEl.textContent : ''
    const hist = b.hist ? history[b.hist] || [] : []
    let color = '#34d399'
    if (b.color && window.__ssLatest) {
      color = hexFromClass(b.color(window.__ssLatest))
    }
    const title = typeof b.title === 'string' ? b.title : b.label
    let details = ''
    if (b.detail) {
      details =
        typeof b.detail === 'function'
          ? window.__ssLatest
            ? b.detail(window.__ssLatest)
            : b.detail({})
          : b.detail
    }
    return { hist, color, title, details, currentVal, unit: b.unit }
  }

  BADGES.forEach((b) => {
    const el = document.getElementById('ss-b-' + b.id)
    if (!el) return

    // Hover: show tooltip preview (non-pinned)
    el.addEventListener('mouseenter', () => {
      if (pinnedBadge) return
      const d = getBadgeTooltipData(b, el)
      showTooltip(el, { historyData: d.hist, color: d.color, title: d.title, unit: d.unit, currentValue: d.currentVal, details: d.details, pinned: false })
    })
    el.addEventListener('mouseleave', () => {
      if (pinnedBadge) return
      hideCurrentTooltip()
    })

    // Click: pin/unpin tooltip
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      if (b.href && pinnedBadge === el) {
        window.location.href = b.href
        return
      }
      if (pinnedBadge === el) {
        unpinTooltip()
        return
      }
      unpinTooltip()
      pinnedBadge = el
      el.classList.add('ss-pinned')
      const d = getBadgeTooltipData(b, el)
      showTooltip(el, { historyData: d.hist, color: d.color, title: d.title, unit: d.unit, currentValue: d.currentVal, details: d.details, pinned: true })
    })
  })

  // ── Horizontal wheel scroll on the bar ──────────────────────────────
  const scrollEl = document.getElementById('ss-bar-scroll')
  if (scrollEl) {
    scrollEl.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
        e.preventDefault()
        scrollEl.scrollLeft += e.deltaY
      },
      { passive: false }
    )
    scrollEl.addEventListener('scroll', () => {
      if (pinnedBadge && activeTooltip) positionTooltip(activeTooltip, pinnedBadge)
    })
  }

  // ── Start polling ─────────────────────────────────────────────────
  doFetch()
  setInterval(doFetch, INTERVAL)
})()
