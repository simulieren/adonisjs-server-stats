/**
 * Client-side script for the debug panel.
 *
 * Handles panel toggle, tab switching, lazy data fetching,
 * query/event/route table rendering, and log streaming.
 *
 * Config is read from data-* attributes on #ss-dbg-panel:
 *   data-logs-endpoint — logs API URL
 */
;(function () {
  const REFRESH_INTERVAL = 3000
  const panel = document.getElementById('ss-dbg-panel')
  const wrench = document.getElementById('ss-dbg-wrench')
  const BASE = (panel && panel.dataset.debugEndpoint) || '/admin/api/debug'
  const closeBtn = document.getElementById('ss-dbg-close')

  if (!panel || !wrench) return

  // ── Theme detection & toggle ────────────────────────────────────
  let themeOverride = localStorage.getItem('ss-dash-theme')
  const themeBtn = document.getElementById('ss-dbg-theme-btn')

  const applyPanelTheme = () => {
    if (themeOverride) {
      panel.setAttribute('data-ss-theme', themeOverride)
    } else {
      panel.removeAttribute('data-ss-theme')
    }
    if (themeBtn) {
      const isDark =
        themeOverride === 'dark' ||
        (!themeOverride && window.matchMedia('(prefers-color-scheme: dark)').matches)
      themeBtn.textContent = isDark ? '\u2600' : '\u263D'
      themeBtn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme'
    }
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const isDark =
        themeOverride === 'dark' ||
        (!themeOverride && window.matchMedia('(prefers-color-scheme: dark)').matches)
      themeOverride = isDark ? 'light' : 'dark'
      localStorage.setItem('ss-dash-theme', themeOverride)
      applyPanelTheme()
      // Sync stats bar if applyBarTheme exists globally
      if (typeof window.__ssApplyBarTheme === 'function') window.__ssApplyBarTheme()
    })
  }

  applyPanelTheme()

  // Listen for cross-tab theme changes
  window.addEventListener('storage', function (e) {
    if (e.key === 'ss-dash-theme') {
      themeOverride = e.newValue
      applyPanelTheme()
    }
  })

  const LOGS_ENDPOINT = panel.dataset.logsEndpoint || BASE + '/logs'

  const tracingEnabled = panel.dataset.tracing === '1'
  const dashboardPath = panel.dataset.dashboardPath || null
  const DASH_API = dashboardPath ? dashboardPath.replace(/\/+$/, '') + '/api' : null

  /** Build an SVG external-link icon for deep links. */
  const deepLinkSvg =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'

  /** Build a deep link anchor element HTML string. */
  const deepLink = (section, id) => {
    if (!dashboardPath) return ''
    const href = dashboardPath + '#' + section + (id != null ? '?id=' + id : '')
    return (
      ' <a href="' +
      esc(href) +
      '" target="_blank" class="ss-dbg-deeplink" title="Open in dashboard" onclick="event.stopPropagation()">' +
      deepLinkSvg +
      '</a>'
    )
  }

  let isOpen = false
  let activeTab = tracingEnabled ? 'timeline' : 'queries'
  const fetched = {}
  let refreshTimer = null
  let logFilter = 'all'
  let cachedLogs = []
  const currentPath = window.location.pathname
  let isLive = false
  let transmitSub = null

  // ── Helpers ──────────────────────────────────────────────────────
  const esc = (s) => {
    if (typeof s !== 'string') s = '' + s
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  const timeAgo = (ts) => {
    const diff = Math.floor((Date.now() - ts) / 1000)
    if (diff < 60) return diff + 's ago'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    return Math.floor(diff / 3600) + 'h ago'
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    return (
      d.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) +
      '.' +
      String(d.getMilliseconds()).padStart(3, '0')
    )
  }

  const eventPreview = (data) => {
    if (!data) return '-'
    try {
      const parsed = JSON.parse(data)
      return compactPreview(parsed, 100)
    } catch {
      return data.length > 100 ? data.slice(0, 100) + '...' : data
    }
  }

  const compactPreview = (val, maxLen) => {
    if (val === null) return 'null'
    if (typeof val === 'string')
      return '"' + (val.length > 40 ? val.slice(0, 40) + '...' : val) + '"'
    if (typeof val === 'number' || typeof val === 'boolean') return String(val)
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]'
      const items = val.slice(0, 3).map((v) => compactPreview(v, 30))
      const s =
        '[' + items.join(', ') + (val.length > 3 ? ', ...' + val.length + ' items' : '') + ']'
      return s.length > maxLen ? '[' + val.length + ' items]' : s
    }
    if (typeof val === 'object') {
      const keys = Object.keys(val)
      if (keys.length === 0) return '{}'
      const pairs = []
      for (let i = 0; i < Math.min(keys.length, 4); i++) {
        const k = keys[i]
        const v = compactPreview(val[k], 30)
        pairs.push(k + ': ' + v)
      }
      const s =
        '{ ' + pairs.join(', ') + (keys.length > 4 ? ', ...+' + (keys.length - 4) : '') + ' }'
      return s.length > maxLen
        ? '{ ' + keys.slice(0, 6).join(', ') + (keys.length > 6 ? ', ...' : '') + ' }'
        : s
    }
    return String(val)
  }

  const methodClass = (m) =>
    'ss-dbg-method ss-dbg-method-' + (typeof m === 'string' ? m.toLowerCase() : '')

  const durationClass = (ms) => {
    if (ms > 500) return 'ss-dbg-very-slow'
    if (ms > 100) return 'ss-dbg-slow'
    return ''
  }

  // ── Custom pane cell formatter ────────────────────────────────────
  const formatCell = (value, col) => {
    if (value === null || value === undefined) return '<span class="ss-dbg-c-dim">-</span>'
    const fmt = col.format || 'text'
    switch (fmt) {
      case 'time':
        return typeof value === 'number' ? formatTime(value) : esc(value)
      case 'timeAgo':
        return (
          '<span class="ss-dbg-event-time">' +
          (typeof value === 'number' ? timeAgo(value) : esc(value)) +
          '</span>'
        )
      case 'duration': {
        const ms = typeof value === 'number' ? value : parseFloat(value)
        if (isNaN(ms)) return esc(value)
        return (
          '<span class="ss-dbg-duration ' + durationClass(ms) + '">' + ms.toFixed(2) + 'ms</span>'
        )
      }
      case 'method':
        return '<span class="' + methodClass(value) + '">' + esc(value) + '</span>'
      case 'json': {
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value)
          } catch {
            /* use as-is */
          }
        }
        const preview = typeof value === 'object' ? compactPreview(value, 100) : String(value)
        return (
          '<span class="ss-dbg-data-preview" style="cursor:default">' + esc(preview) + '</span>'
        )
      }
      case 'badge': {
        const sv = String(value).toLowerCase()
        const colorMap = col.badgeColorMap || {}
        const color = colorMap[sv] || 'muted'
        return (
          '<span class="ss-dbg-badge ss-dbg-badge-' + esc(color) + '">' + esc(value) + '</span>'
        )
      }
      default:
        return esc(value)
    }
  }

  // ── Toggle panel ────────────────────────────────────────────────
  const togglePanel = () => {
    isOpen = !isOpen
    panel.classList.toggle('ss-dbg-open', isOpen)
    wrench.classList.toggle('ss-dbg-active', isOpen)

    if (isOpen) {
      loadTab(activeTab)
      startRefresh()
    } else {
      stopRefresh()
    }
  }

  wrench.addEventListener('click', (e) => {
    e.stopPropagation()
    togglePanel()
  })

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (isOpen) togglePanel()
    })
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) togglePanel()
  })

  // ── Custom panes config ─────────────────────────────────────────
  let customPanes = []
  const customPaneState = {}
  try {
    const cfgEl = document.getElementById('ss-dbg-custom-panes-config')
    if (cfgEl) customPanes = JSON.parse(cfgEl.textContent || '[]')
  } catch {
    /* ignore */
  }

  for (let i = 0; i < customPanes.length; i++) {
    const cp = customPanes[i]
    customPaneState[cp.id] = { data: [], fetched: false, filter: '' }
  }

  // ── Tab switching ───────────────────────────────────────────────
  const tabs = panel.querySelectorAll('[data-ss-dbg-tab]')
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-ss-dbg-tab')
      if (name === activeTab) return

      tabs.forEach((t) => t.classList.remove('ss-dbg-active'))
      panel.querySelectorAll('.ss-dbg-pane').forEach((p) => p.classList.remove('ss-dbg-active'))

      tab.classList.add('ss-dbg-active')
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
      const pane = document.getElementById('ss-dbg-pane-' + name)
      if (pane) pane.classList.add('ss-dbg-active')

      activeTab = name
      loadTab(name)
    })
  })

  // ── Data loading ────────────────────────────────────────────────
  const loadTab = (name) => {
    if (name === 'timeline') fetchTraces()
    else if (name === 'queries') fetchQueries()
    else if (name === 'events') fetchEvents()
    else if (name === 'routes' && !fetched.routes) fetchRoutes()
    else if (name === 'logs') fetchLogs()
    else if (name === 'emails') fetchEmails()
    else if (name === 'cache') fetchCache()
    else if (name === 'jobs') fetchJobs()
    else if (name === 'config' && !fetched.config) fetchConfig()
    else {
      const cp = customPanes.find((p) => p.id === name)
      if (cp) {
        if (cp.fetchOnce && customPaneState[cp.id].fetched) return
        fetchCustomPane(cp)
      }
    }
  }

  const fetchJSON = (url) =>
    fetch(url, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error(r.status)
      return r.json()
    })

  // ── Queries Tab ─────────────────────────────────────────────────
  const querySearchInput = document.getElementById('ss-dbg-search-queries')
  const querySummaryEl = document.getElementById('ss-dbg-queries-summary')
  const queryBodyEl = document.getElementById('ss-dbg-queries-body')
  const queryClearBtn = document.getElementById('ss-dbg-queries-clear')
  let cachedQueries = { queries: [], summary: {} }

  const fetchQueries = () => {
    fetchJSON(BASE + '/queries')
      .then((data) => {
        cachedQueries = data
        renderQueries()
      })
      .catch(() => {
        queryBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load queries</div>'
      })
  }

  const renderQueries = () => {
    const filter = (querySearchInput ? querySearchInput.value : '').toLowerCase()
    const queries = cachedQueries.queries || []
    const summary = cachedQueries.summary || {}

    if (querySummaryEl) {
      querySummaryEl.textContent =
        summary.total +
        ' queries' +
        (summary.slow > 0 ? ', ' + summary.slow + ' slow' : '') +
        (summary.duplicates > 0 ? ', ' + summary.duplicates + ' dup' : '') +
        ', avg ' +
        (summary.avgDuration || 0).toFixed(1) +
        'ms'
    }

    const badge = document.getElementById('ss-dbg-query-badge')
    if (badge && activeTab === 'queries') {
      badge.textContent =
        summary.total + ' queries, avg ' + (summary.avgDuration || 0).toFixed(1) + 'ms'
    }

    let filtered = queries
    if (filter) {
      filtered = queries.filter(
        (q) =>
          q.sql.toLowerCase().indexOf(filter) !== -1 ||
          (q.model || '').toLowerCase().indexOf(filter) !== -1 ||
          q.method.toLowerCase().indexOf(filter) !== -1
      )
    }

    if (filtered.length === 0) {
      queryBodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter ? 'No matching queries' : 'No queries recorded yet') +
        '</div>'
      return
    }

    const sqlCounts = {}
    for (let i = 0; i < queries.length; i++) {
      sqlCounts[queries[i].sql] = (sqlCounts[queries[i].sql] || 0) + 1
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:64px">#</th>' +
      '<th>SQL</th>' +
      '<th style="width:70px">Duration</th>' +
      '<th style="width:60px">Method</th>' +
      '<th style="width:100px">Model</th>' +
      '<th style="width:60px">Time</th>' +
      '</tr></thead><tbody>'

    for (let j = 0; j < filtered.length; j++) {
      const q = filtered[j]
      const durClass = durationClass(q.duration)
      const dupCount = sqlCounts[q.sql] || 1
      html +=
        '<tr>' +
        '<td class="ss-dbg-c-dim" style="white-space:nowrap">' +
        q.id +
        deepLink('queries', q.id) +
        '</td>' +
        '<td><span class="ss-dbg-sql" title="Click to expand" onclick="this.classList.toggle(\'ss-dbg-expanded\')">' +
        esc(q.sql) +
        '</span>' +
        (dupCount > 1 ? ' <span class="ss-dbg-dup">x' + dupCount + '</span>' : '') +
        '</td>' +
        '<td class="ss-dbg-duration ' +
        durClass +
        '">' +
        q.duration.toFixed(2) +
        'ms</td>' +
        '<td><span class="' +
        methodClass(q.method) +
        '">' +
        esc(q.method) +
        '</span></td>' +
        '<td class="ss-dbg-c-muted">' +
        esc(q.model || '-') +
        '</td>' +
        '<td class="ss-dbg-event-time">' +
        timeAgo(q.timestamp) +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    queryBodyEl.innerHTML = html
  }

  if (querySearchInput) querySearchInput.addEventListener('input', renderQueries)
  if (queryClearBtn) {
    queryClearBtn.addEventListener('click', () => {
      cachedQueries = { queries: [], summary: { total: 0, slow: 0, duplicates: 0, avgDuration: 0 } }
      renderQueries()
    })
  }

  // ── Events Tab ──────────────────────────────────────────────────
  const eventSearchInput = document.getElementById('ss-dbg-search-events')
  const eventSummaryEl = document.getElementById('ss-dbg-events-summary')
  const eventBodyEl = document.getElementById('ss-dbg-events-body')
  const eventClearBtn = document.getElementById('ss-dbg-events-clear')
  let cachedEvents = { events: [], total: 0 }

  const fetchEvents = () => {
    fetchJSON(BASE + '/events')
      .then((data) => {
        cachedEvents = data
        renderEvents()
      })
      .catch(() => {
        eventBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load events</div>'
      })
  }

  const renderEvents = () => {
    const filter = (eventSearchInput ? eventSearchInput.value : '').toLowerCase()
    const events = cachedEvents.events || []

    if (eventSummaryEl) {
      eventSummaryEl.textContent = cachedEvents.total + ' events'
    }

    let filtered = events
    if (filter) {
      filtered = events.filter(
        (e) =>
          e.event.toLowerCase().indexOf(filter) !== -1 ||
          (e.data || '').toLowerCase().indexOf(filter) !== -1
      )
    }

    if (filtered.length === 0) {
      eventBodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter ? 'No matching events' : 'No events recorded yet') +
        '</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:64px">#</th>' +
      '<th>Event</th>' +
      '<th>Data</th>' +
      '<th style="width:100px">Time</th>' +
      '</tr></thead><tbody>'

    for (let i = 0; i < filtered.length; i++) {
      const ev = filtered[i]
      const hasData = ev.data && ev.data !== '-'
      const preview = hasData ? eventPreview(ev.data) : '-'
      html +=
        '<tr>' +
        '<td class="ss-dbg-c-dim" style="white-space:nowrap">' +
        ev.id +
        deepLink('events', ev.id) +
        '</td>' +
        '<td class="ss-dbg-event-name">' +
        esc(ev.event) +
        '</td>' +
        '<td class="ss-dbg-event-data">' +
        (hasData
          ? '<span class="ss-dbg-data-preview" data-ev-idx="' +
            i +
            '">' +
            esc(preview) +
            '</span>' +
            '<pre class="ss-dbg-data-full" id="ss-dbg-evdata-' +
            i +
            '" style="display:none">' +
            esc(ev.data) +
            '</pre>' +
            '<button type="button" class="ss-dbg-copy-btn" data-copy-idx="' +
            i +
            '" title="Copy JSON">&#x2398;</button>'
          : '<span class="ss-dbg-c-dim">-</span>') +
        '</td>' +
        '<td class="ss-dbg-event-time">' +
        formatTime(ev.timestamp) +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    eventBodyEl.innerHTML = html

    // Toggle expand on preview click
    eventBodyEl.querySelectorAll('.ss-dbg-data-preview').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = el.getAttribute('data-ev-idx')
        const pre = document.getElementById('ss-dbg-evdata-' + idx)
        if (pre) {
          const open = pre.style.display !== 'none'
          pre.style.display = open ? 'none' : 'block'
          el.style.display = open ? '' : 'none'
        }
      })
    })

    // Collapse on full-data click
    eventBodyEl.querySelectorAll('.ss-dbg-data-full').forEach((el) => {
      el.addEventListener('click', () => {
        el.style.display = 'none'
        const idx = el.id.replace('ss-dbg-evdata-', '')
        const preview = eventBodyEl.querySelector('[data-ev-idx="' + idx + '"]')
        if (preview) preview.style.display = ''
      })
    })

    // Copy button
    eventBodyEl.querySelectorAll('.ss-dbg-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const idx = btn.getAttribute('data-copy-idx')
        const data = filtered[idx]?.data || ''
        navigator.clipboard.writeText(data).then(() => {
          btn.textContent = '\u2713'
          setTimeout(() => {
            btn.innerHTML = '&#x2398;'
          }, 1200)
        })
      })
    })
  }

  if (eventSearchInput) eventSearchInput.addEventListener('input', renderEvents)
  if (eventClearBtn) {
    eventClearBtn.addEventListener('click', () => {
      cachedEvents = { events: [], total: 0 }
      renderEvents()
    })
  }

  // ── Routes Tab ──────────────────────────────────────────────────
  const routeSearchInput = document.getElementById('ss-dbg-search-routes')
  const routeSummaryEl = document.getElementById('ss-dbg-routes-summary')
  const routeBodyEl = document.getElementById('ss-dbg-routes-body')
  let cachedRoutes = { routes: [], total: 0 }

  const fetchRoutes = () => {
    fetchJSON(BASE + '/routes')
      .then((data) => {
        cachedRoutes = data
        fetched.routes = true
        renderRoutes()
      })
      .catch(() => {
        routeBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load routes</div>'
      })
  }

  const renderRoutes = () => {
    const filter = (routeSearchInput ? routeSearchInput.value : '').toLowerCase()
    const routes = cachedRoutes.routes || []

    if (routeSummaryEl) {
      routeSummaryEl.textContent = cachedRoutes.total + ' routes'
    }

    let filtered = routes
    if (filter) {
      filtered = routes.filter(
        (r) =>
          r.pattern.toLowerCase().indexOf(filter) !== -1 ||
          r.method.toLowerCase().indexOf(filter) !== -1 ||
          (r.name || '').toLowerCase().indexOf(filter) !== -1 ||
          r.handler.toLowerCase().indexOf(filter) !== -1 ||
          r.middleware.join(' ').toLowerCase().indexOf(filter) !== -1
      )
    }

    if (filtered.length === 0) {
      routeBodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter ? 'No matching routes' : 'No routes available') +
        '</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:60px">Method</th>' +
      '<th>Pattern</th>' +
      '<th style="width:140px">Name</th>' +
      '<th>Handler</th>' +
      '<th>Middleware</th>' +
      '</tr></thead><tbody>'

    for (let i = 0; i < filtered.length; i++) {
      const r = filtered[i]
      const isCurrent =
        currentPath === r.pattern ||
        currentPath.match(new RegExp('^' + r.pattern.replace(/:[^/]+/g, '[^/]+') + '$'))
      html +=
        '<tr' +
        (isCurrent ? ' class="ss-dbg-current-route"' : '') +
        '>' +
        '<td><span class="' +
        methodClass(r.method) +
        '">' +
        esc(r.method) +
        '</span></td>' +
        '<td>' +
        esc(r.pattern) +
        '</td>' +
        '<td class="ss-dbg-c-muted">' +
        esc(r.name || '-') +
        '</td>' +
        '<td class="ss-dbg-c-sql">' +
        esc(r.handler) +
        '</td>' +
        '<td class="ss-dbg-c-dim" style="font-size:10px">' +
        (r.middleware.length ? esc(r.middleware.join(', ')) : '-') +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    routeBodyEl.innerHTML = html
  }

  if (routeSearchInput) routeSearchInput.addEventListener('input', renderRoutes)

  // ── Logs Tab ────────────────────────────────────────────────────
  const logBodyEl = document.getElementById('ss-dbg-logs-body')
  const logFilters = panel.querySelectorAll('[data-ss-dbg-level]')
  const logReqIdInput = document.getElementById('ss-dbg-log-reqid')
  const logReqIdClear = document.getElementById('ss-dbg-log-reqid-clear')
  let logReqIdFilter = ''

  const setReqIdFilter = (id) => {
    logReqIdFilter = id || ''
    if (logReqIdInput) logReqIdInput.value = logReqIdFilter
    if (logReqIdClear) logReqIdClear.style.display = logReqIdFilter ? '' : 'none'
    renderLogs()
  }

  if (logReqIdInput) {
    logReqIdInput.addEventListener('input', () => {
      logReqIdFilter = logReqIdInput.value.trim()
      if (logReqIdClear) logReqIdClear.style.display = logReqIdFilter ? '' : 'none'
      renderLogs()
    })
  }
  if (logReqIdClear) {
    logReqIdClear.addEventListener('click', () => setReqIdFilter(''))
  }

  const fetchLogs = () => {
    fetchJSON(LOGS_ENDPOINT)
      .then((data) => {
        cachedLogs = Array.isArray(data) ? data : data.logs || data.entries || []
        renderLogs()
      })
      .catch(() => {
        logBodyEl.innerHTML = '<div class="ss-dbg-empty">No log endpoint available</div>'
      })
  }

  const shortReqId = (id) => (id ? id.slice(0, 8) : '')

  const renderLogs = () => {
    let entries = cachedLogs

    if (logFilter !== 'all') {
      entries = entries.filter((e) => {
        const level = (e.levelName || e.level_name || '').toLowerCase()
        if (logFilter === 'error') return level === 'error' || level === 'fatal'
        return level === logFilter
      })
    }

    if (logReqIdFilter) {
      const f = logReqIdFilter.toLowerCase()
      entries = entries.filter((e) => {
        const rid = (e.request_id || e['x-request-id'] || '').toLowerCase()
        return rid.indexOf(f) !== -1
      })
    }

    if (entries.length === 0) {
      let hint = ''
      if (logReqIdFilter) hint = ' matching request ' + logReqIdFilter
      else if (logFilter !== 'all') hint = ' for ' + logFilter
      logBodyEl.innerHTML = '<div class="ss-dbg-empty">No log entries' + hint + '</div>'
      return
    }

    const shown = entries.slice(-200).reverse()
    let html = ''

    for (let i = 0; i < shown.length; i++) {
      const e = shown[i]
      const level = (e.levelName || e.level_name || 'info').toLowerCase()
      const msg = e.msg || e.message || JSON.stringify(e)
      const ts = e.time || e.timestamp || 0
      const reqId = e.request_id || e['x-request-id'] || ''

      html +=
        '<div class="ss-dbg-log-entry">' +
        '<span class="ss-dbg-log-level ss-dbg-log-level-' +
        esc(level) +
        '">' +
        esc(level.toUpperCase()) +
        '</span>' +
        '<span class="ss-dbg-log-time">' +
        (ts ? formatTime(ts) : '-') +
        '</span>' +
        (reqId
          ? '<span class="ss-dbg-log-reqid" data-reqid="' +
            esc(reqId) +
            '" title="' +
            esc(reqId) +
            '">' +
            esc(shortReqId(reqId)) +
            '</span>'
          : '<span class="ss-dbg-log-reqid-empty">-</span>') +
        '<span class="ss-dbg-log-msg">' +
        esc(msg) +
        '</span>' +
        '</div>'
    }

    logBodyEl.innerHTML = html

    // Click request ID to filter
    logBodyEl.querySelectorAll('.ss-dbg-log-reqid').forEach((el) => {
      el.addEventListener('click', () => {
        setReqIdFilter(el.getAttribute('data-reqid'))
      })
    })
  }

  logFilters.forEach((btn) => {
    btn.addEventListener('click', () => {
      logFilters.forEach((b) => b.classList.remove('ss-dbg-active'))
      btn.classList.add('ss-dbg-active')
      logFilter = btn.getAttribute('data-ss-dbg-level')
      renderLogs()
    })
  })

  // ── Emails Tab ─────────────────────────────────────────────────
  const emailSearchInput = document.getElementById('ss-dbg-search-emails')
  const emailSummaryEl = document.getElementById('ss-dbg-emails-summary')
  const emailBodyEl = document.getElementById('ss-dbg-emails-body')
  const emailClearBtn = document.getElementById('ss-dbg-emails-clear')
  const emailPreviewEl = document.getElementById('ss-dbg-email-preview')
  const emailPreviewMeta = document.getElementById('ss-dbg-email-preview-meta')
  const emailPreviewClose = document.getElementById('ss-dbg-email-preview-close')
  const emailIframe = document.getElementById('ss-dbg-email-iframe')
  let cachedEmails = { emails: [], total: 0 }

  const fetchEmails = () => {
    fetchJSON(BASE + '/emails')
      .then((data) => {
        cachedEmails = data
        renderEmails()
      })
      .catch(() => {
        if (emailBodyEl)
          emailBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load emails</div>'
      })
  }

  const renderEmails = () => {
    if (!emailBodyEl) return
    const filter = (emailSearchInput ? emailSearchInput.value : '').toLowerCase()
    const emails = cachedEmails.emails || []

    if (emailSummaryEl) {
      emailSummaryEl.textContent = cachedEmails.total + ' emails'
    }

    let filtered = emails
    if (filter) {
      filtered = emails.filter(
        (e) =>
          (e.from || '').toLowerCase().indexOf(filter) !== -1 ||
          (e.to || '').toLowerCase().indexOf(filter) !== -1 ||
          (e.subject || '').toLowerCase().indexOf(filter) !== -1 ||
          (e.mailer || '').toLowerCase().indexOf(filter) !== -1
      )
    }

    if (filtered.length === 0) {
      emailBodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter ? 'No matching emails' : 'No emails captured yet') +
        '</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:64px">#</th>' +
      '<th style="width:160px">From</th>' +
      '<th style="width:160px">To</th>' +
      '<th>Subject</th>' +
      '<th style="width:60px">Status</th>' +
      '<th style="width:60px">Mailer</th>' +
      '<th style="width:30px" title="Attachments">&#x1F4CE;</th>' +
      '<th style="width:70px">Time</th>' +
      '</tr></thead><tbody>'

    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i]
      html +=
        '<tr class="ss-dbg-email-row" data-email-id="' +
        e.id +
        '">' +
        '<td class="ss-dbg-c-dim" style="white-space:nowrap">' +
        e.id +
        deepLink('emails', e.id) +
        '</td>' +
        '<td class="ss-dbg-c-secondary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="' +
        esc(e.from) +
        '">' +
        esc(e.from) +
        '</td>' +
        '<td class="ss-dbg-c-secondary" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="' +
        esc(e.to) +
        '">' +
        esc(e.to) +
        '</td>' +
        '<td class="ss-dbg-c-sql" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(e.subject) +
        '</td>' +
        '<td><span class="ss-dbg-email-status ss-dbg-email-status-' +
        esc(e.status) +
        '">' +
        esc(e.status) +
        '</span></td>' +
        '<td class="ss-dbg-c-muted">' +
        esc(e.mailer) +
        '</td>' +
        '<td class="ss-dbg-c-dim" style="text-align:center">' +
        (e.attachmentCount > 0 ? e.attachmentCount : '-') +
        '</td>' +
        '<td class="ss-dbg-event-time">' +
        timeAgo(e.timestamp) +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    emailBodyEl.innerHTML = html

    // Click row to open preview
    emailBodyEl.querySelectorAll('.ss-dbg-email-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-email-id')
        showEmailPreview(id, filtered)
      })
    })
  }

  const showEmailPreview = (id, emails) => {
    if (!emailPreviewEl || !emailIframe || !emailPreviewMeta) return
    const email = emails.find((e) => String(e.id) === String(id))

    if (emailPreviewMeta && email) {
      emailPreviewMeta.innerHTML =
        '<strong>Subject:</strong> ' +
        esc(email.subject) +
        '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>From:</strong> ' +
        esc(email.from) +
        '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>To:</strong> ' +
        esc(email.to) +
        (email.cc ? '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>CC:</strong> ' + esc(email.cc) : '') +
        '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Status:</strong> <span class="ss-dbg-email-status ss-dbg-email-status-' +
        esc(email.status) +
        '">' +
        esc(email.status) +
        '</span>' +
        '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Mailer:</strong> ' +
        esc(email.mailer)
    }

    emailIframe.src = BASE + '/emails/' + id + '/preview'
    emailPreviewEl.style.display = 'flex'
  }

  if (emailPreviewClose) {
    emailPreviewClose.addEventListener('click', () => {
      if (emailPreviewEl) emailPreviewEl.style.display = 'none'
      if (emailIframe) emailIframe.src = 'about:blank'
    })
  }

  if (emailSearchInput) emailSearchInput.addEventListener('input', renderEmails)
  if (emailClearBtn) {
    emailClearBtn.addEventListener('click', () => {
      cachedEmails = { emails: [], total: 0 }
      renderEmails()
    })
  }

  // ── Timeline Tab ────────────────────────────────────────────────
  const tlSearchInput = document.getElementById('ss-dbg-search-timeline')
  const tlSummaryEl = document.getElementById('ss-dbg-timeline-summary')
  const tlBodyEl = document.getElementById('ss-dbg-timeline-body')
  const tlListEl = document.getElementById('ss-dbg-timeline-list')
  const tlDetailEl = document.getElementById('ss-dbg-timeline-detail')
  const tlBackBtn = document.getElementById('ss-dbg-tl-back')
  const tlDetailTitle = document.getElementById('ss-dbg-tl-detail-title')
  const tlWaterfall = document.getElementById('ss-dbg-tl-waterfall')
  let cachedTraces = { traces: [], total: 0 }

  const statusClass = (code) => {
    if (code >= 500) return 'ss-dbg-status-5xx'
    if (code >= 400) return 'ss-dbg-status-4xx'
    if (code >= 300) return 'ss-dbg-status-3xx'
    return 'ss-dbg-status-2xx'
  }

  const fetchTraces = () => {
    if (!tracingEnabled) return
    fetchJSON(BASE + '/traces')
      .then((data) => {
        cachedTraces = data
        renderTraces()
      })
      .catch(() => {
        if (tlBodyEl) tlBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load traces</div>'
      })
  }

  const renderTraces = () => {
    if (!tlBodyEl) return
    const filter = (tlSearchInput ? tlSearchInput.value : '').toLowerCase()
    const traces = cachedTraces.traces || []

    if (tlSummaryEl) {
      tlSummaryEl.textContent = cachedTraces.total + ' requests'
    }

    let filtered = traces
    if (filter) {
      filtered = traces.filter(
        (t) =>
          t.url.toLowerCase().indexOf(filter) !== -1 ||
          t.method.toLowerCase().indexOf(filter) !== -1
      )
    }

    if (filtered.length === 0) {
      tlBodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter ? 'No matching requests' : 'No requests traced yet') +
        '</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:64px">#</th>' +
      '<th style="width:60px">Method</th>' +
      '<th>URL</th>' +
      '<th style="width:55px">Status</th>' +
      '<th style="width:70px">Duration</th>' +
      '<th style="width:50px">Spans</th>' +
      '<th style="width:30px" title="Warnings">&#x26A0;</th>' +
      '<th style="width:70px">Time</th>' +
      '</tr></thead><tbody>'

    for (let i = 0; i < filtered.length; i++) {
      const t = filtered[i]
      html +=
        '<tr class="ss-dbg-email-row" data-trace-id="' +
        t.id +
        '">' +
        '<td class="ss-dbg-c-dim" style="white-space:nowrap">' +
        t.id +
        deepLink('traces', t.id) +
        '</td>' +
        '<td><span class="' +
        methodClass(t.method) +
        '">' +
        esc(t.method) +
        '</span></td>' +
        '<td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px" title="' +
        esc(t.url) +
        '">' +
        esc(t.url) +
        '</td>' +
        '<td><span class="ss-dbg-status ' +
        statusClass(t.statusCode) +
        '">' +
        t.statusCode +
        '</span></td>' +
        '<td class="ss-dbg-duration ' +
        durationClass(t.totalDuration) +
        '">' +
        t.totalDuration.toFixed(1) +
        'ms</td>' +
        '<td class="ss-dbg-c-muted" style="text-align:center">' +
        t.spanCount +
        '</td>' +
        '<td style="text-align:center">' +
        (t.warningCount > 0
          ? '<span class="ss-dbg-c-amber">' + t.warningCount + '</span>'
          : '<span class="ss-dbg-c-border">-</span>') +
        '</td>' +
        '<td class="ss-dbg-event-time">' +
        timeAgo(t.timestamp) +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    tlBodyEl.innerHTML = html

    // Click row to open detail
    tlBodyEl.querySelectorAll('[data-trace-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-trace-id')
        fetchTraceDetail(id)
      })
    })
  }

  const fetchTraceDetail = (id) => {
    fetchJSON(BASE + '/traces/' + id)
      .then((trace) => {
        showTimeline(trace)
      })
      .catch(() => {
        if (tlWaterfall)
          tlWaterfall.innerHTML = '<div class="ss-dbg-empty">Failed to load trace</div>'
      })
  }

  const showTimeline = (trace) => {
    if (!tlListEl || !tlDetailEl || !tlDetailTitle || !tlWaterfall) return

    tlListEl.style.display = 'none'
    tlDetailEl.style.display = ''

    tlDetailTitle.innerHTML =
      '<span class="' +
      methodClass(trace.method) +
      '">' +
      esc(trace.method) +
      '</span> ' +
      esc(trace.url) +
      ' ' +
      '<span class="ss-dbg-status ' +
      statusClass(trace.statusCode) +
      '">' +
      trace.statusCode +
      '</span>' +
      '<span class="ss-dbg-tl-meta">' +
      trace.totalDuration.toFixed(1) +
      'ms &middot; ' +
      trace.spanCount +
      ' spans &middot; ' +
      formatTime(trace.timestamp) +
      '</span>'

    const spans = trace.spans || []
    const total = trace.totalDuration || 1

    // Legend
    let html =
      '<div class="ss-dbg-tl-legend">' +
      '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#6d28d9"></span>DB</div>' +
      '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#1e3a5f"></span>Request</div>' +
      '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#059669"></span>Mail</div>' +
      '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#b45309"></span>Event</div>' +
      '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#0e7490"></span>View</div>' +
      '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#525252"></span>Custom</div>' +
      '</div>'

    if (spans.length === 0) {
      html += '<div class="ss-dbg-empty">No spans captured for this request</div>'
    } else {
      // Build nesting depth from parentId
      const depthMap = {}
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i]
        if (!s.parentId) {
          depthMap[s.id] = 0
        } else {
          depthMap[s.id] = (depthMap[s.parentId] || 0) + 1
        }
      }

      // Sort by startOffset
      const sorted = spans.slice().sort((a, b) => a.startOffset - b.startOffset)

      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i]
        const depth = depthMap[s.id] || 0
        const leftPct = ((s.startOffset / total) * 100).toFixed(2)
        const widthPct = Math.max((s.duration / total) * 100, 0.5).toFixed(2)
        const indent = depth * 16
        const catLabel = s.category === 'db' ? 'DB' : s.category
        const metaStr = s.metadata
          ? Object.entries(s.metadata)
              .filter(([, v]) => v != null)
              .map(([k, v]) => k + '=' + v)
              .join(', ')
          : ''
        const tooltip =
          s.label + ' (' + s.duration.toFixed(2) + 'ms)' + (metaStr ? '\n' + metaStr : '')

        html +=
          '<div class="ss-dbg-tl-row">' +
          '<div class="ss-dbg-tl-label" style="padding-left:' +
          (8 + indent) +
          'px" title="' +
          esc(tooltip) +
          '">' +
          '<span class="ss-dbg-badge ss-dbg-badge-' +
          (s.category === 'db'
            ? 'purple'
            : s.category === 'mail'
              ? 'green'
              : s.category === 'event'
                ? 'amber'
                : s.category === 'view'
                  ? 'blue'
                  : 'muted') +
          '" style="font-size:9px;margin-right:4px">' +
          esc(catLabel) +
          '</span>' +
          esc(s.label.length > 40 ? s.label.slice(0, 40) + '...' : s.label) +
          '</div>' +
          '<div class="ss-dbg-tl-track">' +
          '<div class="ss-dbg-tl-bar ss-dbg-tl-bar-' +
          esc(s.category) +
          '" style="left:' +
          leftPct +
          '%;width:' +
          widthPct +
          '%" title="' +
          esc(tooltip) +
          '"></div>' +
          '</div>' +
          '<span class="ss-dbg-tl-dur">' +
          s.duration.toFixed(2) +
          'ms</span>' +
          '</div>'
      }
    }

    // Warnings
    if (trace.warnings && trace.warnings.length > 0) {
      html +=
        '<div class="ss-dbg-tl-warnings">' +
        '<div class="ss-dbg-tl-warnings-title">Warnings (' +
        trace.warnings.length +
        ')</div>'
      for (let w = 0; w < trace.warnings.length; w++) {
        html += '<div class="ss-dbg-tl-warning">' + esc(trace.warnings[w]) + '</div>'
      }
      html += '</div>'
    }

    tlWaterfall.innerHTML = html
  }

  if (tlBackBtn) {
    tlBackBtn.addEventListener('click', () => {
      if (tlListEl) tlListEl.style.display = ''
      if (tlDetailEl) tlDetailEl.style.display = 'none'
    })
  }

  if (tlSearchInput) tlSearchInput.addEventListener('input', renderTraces)

  // ── Mini Stats Bar ─────────────────────────────────────────────
  const miniStatsEl = document.getElementById('ss-dbg-mini-stats')
  let miniStatsTimer = null

  const fetchMiniStats = () => {
    if (!DASH_API || !miniStatsEl) return
    fetchJSON(DASH_API + '/overview?range=1h')
      .then((data) => {
        const avg = data.avgResponseTime || 0
        const err = data.errorRate || 0
        const rpm = data.requestsPerMinute || 0
        const hasData = (data.totalRequests || 0) > 0

        if (!hasData) {
          miniStatsEl.innerHTML = ''
          return
        }

        const avgClass =
          avg > 500 ? 'ss-dbg-stat-red' : avg > 200 ? 'ss-dbg-stat-amber' : 'ss-dbg-stat-green'
        const errClass =
          err > 5 ? 'ss-dbg-stat-red' : err > 1 ? 'ss-dbg-stat-amber' : 'ss-dbg-stat-green'

        miniStatsEl.innerHTML =
          '<span class="ss-dbg-mini-stat"><span class="ss-dbg-mini-stat-value ' +
          avgClass +
          '">' +
          avg.toFixed(1) +
          'ms</span> avg</span>' +
          '<span class="ss-dbg-mini-stat"><span class="ss-dbg-mini-stat-value ' +
          errClass +
          '">' +
          err.toFixed(1) +
          '%</span> err</span>' +
          '<span class="ss-dbg-mini-stat"><span class="ss-dbg-mini-stat-value">' +
          Math.round(rpm) +
          '</span> req/m</span>'
      })
      .catch(() => {
        miniStatsEl.innerHTML = ''
      })
  }

  // ── Cache Tab ─────────────────────────────────────────────────
  const cacheSearchInput = document.getElementById('ss-dbg-search-cache')
  const cacheSummaryEl = document.getElementById('ss-dbg-cache-summary')
  const cacheBodyEl = document.getElementById('ss-dbg-cache-body')
  const cacheStatsArea = document.getElementById('ss-dbg-cache-stats-area')
  let cachedCacheData = { stats: {}, keys: [] }

  const fetchCache = () => {
    if (!DASH_API) return
    fetchJSON(DASH_API + '/cache')
      .then((data) => {
        cachedCacheData = data
        renderCache()
      })
      .catch(() => {
        if (cacheBodyEl)
          cacheBodyEl.innerHTML = '<div class="ss-dbg-empty">Cache not available</div>'
        if (cacheStatsArea) cacheStatsArea.innerHTML = ''
      })
  }

  const renderCache = () => {
    if (!cacheBodyEl) return
    const stats = cachedCacheData.stats || {}
    const keys = cachedCacheData.keys || cachedCacheData.data || []
    const filter = (cacheSearchInput ? cacheSearchInput.value : '').toLowerCase()

    // Stats area
    if (cacheStatsArea) {
      cacheStatsArea.innerHTML =
        '<div class="ss-dbg-cache-stat"><span class="ss-dbg-cache-stat-label">Hit Rate:</span><span class="ss-dbg-cache-stat-value">' +
        (stats.hitRate || 0).toFixed(1) +
        '%</span></div>' +
        '<div class="ss-dbg-cache-stat"><span class="ss-dbg-cache-stat-label">Hits:</span><span class="ss-dbg-cache-stat-value">' +
        (stats.hits || 0) +
        '</span></div>' +
        '<div class="ss-dbg-cache-stat"><span class="ss-dbg-cache-stat-label">Misses:</span><span class="ss-dbg-cache-stat-value">' +
        (stats.misses || 0) +
        '</span></div>' +
        '<div class="ss-dbg-cache-stat"><span class="ss-dbg-cache-stat-label">Keys:</span><span class="ss-dbg-cache-stat-value">' +
        (stats.keyCount || keys.length || 0) +
        '</span></div>'
    }

    if (cacheSummaryEl) {
      cacheSummaryEl.textContent = (stats.keyCount || keys.length || 0) + ' keys'
    }

    let filtered = keys
    if (filter) {
      filtered = keys.filter((k) => (k.key || '').toLowerCase().indexOf(filter) !== -1)
    }

    if (filtered.length === 0) {
      cacheBodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter ? 'No matching cache keys' : 'No cache keys found') +
        '</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th>Key</th>' +
      '<th style="width:80px">Type</th>' +
      '<th style="width:80px">TTL</th>' +
      '<th style="width:80px">Size</th>' +
      '</tr></thead><tbody>'

    for (let i = 0; i < filtered.length; i++) {
      const k = filtered[i]
      html +=
        '<tr class="ss-dbg-email-row" data-cache-key="' +
        esc(k.key || '') +
        '">' +
        '<td class="ss-dbg-c-sql">' +
        esc(k.key || '') +
        '</td>' +
        '<td class="ss-dbg-c-muted">' +
        esc(k.type || '-') +
        '</td>' +
        '<td class="ss-dbg-c-muted">' +
        (k.ttl != null ? k.ttl + 's' : '-') +
        '</td>' +
        '<td class="ss-dbg-c-dim">' +
        (k.size != null ? k.size + 'B' : '-') +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    cacheBodyEl.innerHTML = html

    // Click row to show cache detail
    cacheBodyEl.querySelectorAll('[data-cache-key]').forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.getAttribute('data-cache-key')
        fetchJSON(DASH_API + '/cache/' + encodeURIComponent(key))
          .then((data) => {
            cacheBodyEl.innerHTML =
              '<div class="ss-dbg-cache-detail">' +
              '<button type="button" class="ss-dbg-btn-clear" id="ss-dbg-cache-back">&larr; Back</button>' +
              '&nbsp;&nbsp;<strong>' +
              esc(key) +
              '</strong>' +
              '<pre>' +
              esc(JSON.stringify(data.value || data, null, 2)) +
              '</pre>' +
              '</div>'
            const backBtn = document.getElementById('ss-dbg-cache-back')
            if (backBtn) backBtn.addEventListener('click', () => renderCache())
          })
          .catch(() => {
            /* ignore */
          })
      })
    })
  }

  if (cacheSearchInput) cacheSearchInput.addEventListener('input', renderCache)

  // ── Jobs Tab ──────────────────────────────────────────────────
  const jobsBodyEl = document.getElementById('ss-dbg-jobs-body')
  const jobsSummaryEl = document.getElementById('ss-dbg-jobs-summary')
  const jobsStatsArea = document.getElementById('ss-dbg-jobs-stats-area')
  const jobFilters = panel.querySelectorAll('[data-ss-dbg-job-status]')
  let jobStatusFilter = 'all'
  let cachedJobsData = { data: [], stats: {} }

  const fetchJobs = () => {
    if (!DASH_API) return
    let url = DASH_API + '/jobs?limit=100'
    if (jobStatusFilter && jobStatusFilter !== 'all') url += '&status=' + jobStatusFilter

    fetchJSON(url)
      .then((data) => {
        cachedJobsData = data
        renderJobs()
      })
      .catch(() => {
        if (jobsBodyEl)
          jobsBodyEl.innerHTML = '<div class="ss-dbg-empty">Jobs/Queue not available</div>'
        if (jobsStatsArea) jobsStatsArea.innerHTML = ''
      })
  }

  const renderJobs = () => {
    if (!jobsBodyEl) return
    const items = cachedJobsData.data || cachedJobsData.jobs || []
    const stats = cachedJobsData.stats || {}

    // Stats area
    if (jobsStatsArea) {
      jobsStatsArea.innerHTML =
        '<div class="ss-dbg-job-stats">' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Active:</span><span class="ss-dbg-job-stat-value">' +
        (stats.active || 0) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Waiting:</span><span class="ss-dbg-job-stat-value">' +
        (stats.waiting || 0) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Delayed:</span><span class="ss-dbg-job-stat-value">' +
        (stats.delayed || 0) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Completed:</span><span class="ss-dbg-job-stat-value">' +
        (stats.completed || 0) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Failed:</span><span class="ss-dbg-job-stat-value ss-dbg-c-red">' +
        (stats.failed || 0) +
        '</span></div>' +
        '</div>'
    }

    if (jobsSummaryEl) {
      const total = (cachedJobsData.meta ? cachedJobsData.meta.total : null) || items.length
      jobsSummaryEl.textContent = total + ' jobs'
    }

    if (items.length === 0) {
      jobsBodyEl.innerHTML = '<div class="ss-dbg-empty">No jobs found</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:50px">ID</th>' +
      '<th>Name</th>' +
      '<th style="width:80px">Status</th>' +
      '<th style="width:60px">Attempts</th>' +
      '<th style="width:80px">Duration</th>' +
      '<th style="width:70px">Time</th>' +
      '<th style="width:50px"></th>' +
      '</tr></thead><tbody>'

    for (let i = 0; i < items.length; i++) {
      const j = items[i]
      const statusBadge =
        j.status === 'failed'
          ? 'red'
          : j.status === 'completed'
            ? 'green'
            : j.status === 'active'
              ? 'blue'
              : 'amber'
      html +=
        '<tr>' +
        '<td class="ss-dbg-c-dim">' +
        j.id +
        '</td>' +
        '<td class="ss-dbg-c-sql">' +
        esc(j.name || '') +
        '</td>' +
        '<td><span class="ss-dbg-badge ss-dbg-badge-' +
        statusBadge +
        '">' +
        esc(j.status || '') +
        '</span></td>' +
        '<td class="ss-dbg-c-muted" style="text-align:center">' +
        (j.attempts || j.attemptsMade || 0) +
        '</td>' +
        '<td class="ss-dbg-duration">' +
        (j.duration != null ? j.duration.toFixed(0) + 'ms' : '-') +
        '</td>' +
        '<td class="ss-dbg-event-time">' +
        timeAgo(j.timestamp || j.processedOn || j.created_at) +
        '</td>' +
        '<td>' +
        (j.status === 'failed'
          ? '<button class="ss-dbg-retry-btn" data-retry-id="' + j.id + '">Retry</button>'
          : '') +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    jobsBodyEl.innerHTML = html

    // Retry buttons
    jobsBodyEl.querySelectorAll('.ss-dbg-retry-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-retry-id')
        btn.textContent = '...'
        btn.disabled = true
        fetch(DASH_API + '/jobs/' + id + '/retry', { method: 'POST', credentials: 'same-origin' })
          .then(() => {
            btn.textContent = 'OK'
            setTimeout(fetchJobs, 1000)
          })
          .catch(() => {
            btn.textContent = 'Retry'
            btn.disabled = false
          })
      })
    })
  }

  jobFilters.forEach((btn) => {
    btn.addEventListener('click', () => {
      jobFilters.forEach((b) => b.classList.remove('ss-dbg-active'))
      btn.classList.add('ss-dbg-active')
      jobStatusFilter = btn.getAttribute('data-ss-dbg-job-status')
      fetchJobs()
    })
  })

  // ── Config Tab ────────────────────────────────────────────────
  const configBodyEl = document.getElementById('ss-dbg-config-body')
  const configSummaryEl = document.getElementById('ss-dbg-config-summary')
  const configSearchInput = document.getElementById('ss-dbg-search-config')
  const configTabs = panel.querySelectorAll('[data-ss-dbg-config-tab]')
  let configRawData = null
  let configActiveTab = 'config'
  let configSearchTerm = ''

  const flattenConfig = (obj, prefix) => {
    const results = []
    if (typeof obj !== 'object' || obj === null) {
      results.push({ path: prefix, value: obj })
      return results
    }
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      const fullPath = prefix ? prefix + '.' + keys[i] : keys[i]
      const val = obj[keys[i]]
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && !val.__redacted) {
        const nested = flattenConfig(val, fullPath)
        for (let n = 0; n < nested.length; n++) results.push(nested[n])
      } else {
        results.push({ path: fullPath, value: val })
      }
    }
    return results
  }

  const countLeaves = (obj) => {
    if (typeof obj !== 'object' || obj === null || obj.__redacted) return 1
    let count = 0
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) count += countLeaves(obj[keys[i]])
    return count
  }

  const formatConfigValue = (val) => {
    if (val === null || val === undefined) return '<span class="ss-dbg-config-val-null">null</span>'
    if (val === true) return '<span class="ss-dbg-config-val-true">true</span>'
    if (val === false) return '<span class="ss-dbg-config-val-false">false</span>'
    if (typeof val === 'number') return '<span class="ss-dbg-config-val-number">' + val + '</span>'
    if (Array.isArray(val)) {
      const items = val.map((item) => {
        if (item === null || item === undefined) return 'null'
        if (typeof item === 'object') {
          try {
            return JSON.stringify(item)
          } catch {
            return String(item)
          }
        }
        return String(item)
      })
      return '<span class="ss-dbg-config-val-array">[' + esc(items.join(', ')) + ']</span>'
    }
    if (typeof val === 'object') {
      try {
        return (
          '<span class="ss-dbg-config-val-null">' + esc(JSON.stringify(val, null, 2)) + '</span>'
        )
      } catch {
        /* fall through */
      }
    }
    return esc(String(val))
  }

  const highlightMatch = (text, term) => {
    if (!term) return text
    const idx = text.toLowerCase().indexOf(term.toLowerCase())
    if (idx === -1) return text
    return (
      text.slice(0, idx) +
      '<mark class="ss-dbg-config-match">' +
      text.slice(idx, idx + term.length) +
      '</mark>' +
      text.slice(idx + term.length)
    )
  }

  const isRedactedObj = (val) => val && typeof val === 'object' && val.__redacted === true

  const renderRedacted = (val, prefix) => {
    const cls = prefix + '-config-redacted'
    const realVal = esc(val.value || '')
    return (
      '<span class="' +
      cls +
      ' ' +
      prefix +
      '-redacted-wrap" data-redacted-value="' +
      realVal +
      '">' +
      '<span class="' +
      prefix +
      '-redacted-display">' +
      esc(val.display) +
      '</span>' +
      '<span class="' +
      prefix +
      '-redacted-real" style="display:none">' +
      realVal +
      '</span>' +
      '<button type="button" class="' +
      prefix +
      '-redacted-reveal" title="Reveal value">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
      '</button>' +
      '<button type="button" class="' +
      prefix +
      '-redacted-copy" title="Copy value">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '</button>' +
      '</span>'
    )
  }

  const bindRedactedButtons = (container, prefix) => {
    container.querySelectorAll('.' + prefix + '-redacted-reveal').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const wrap = btn.closest('.' + prefix + '-redacted-wrap')
        if (!wrap) return
        const display = wrap.querySelector('.' + prefix + '-redacted-display')
        const real = wrap.querySelector('.' + prefix + '-redacted-real')
        if (!display || !real) return
        const isHidden = real.style.display === 'none'
        display.style.display = isHidden ? 'none' : ''
        real.style.display = isHidden ? '' : 'none'
        btn.innerHTML = isHidden
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        btn.title = isHidden ? 'Hide value' : 'Reveal value'
      })
    })

    container.querySelectorAll('.' + prefix + '-redacted-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const wrap = btn.closest('.' + prefix + '-redacted-wrap')
        if (!wrap) return
        const val = wrap.getAttribute('data-redacted-value')
        if (!val) return
        navigator.clipboard.writeText(val).then(() => {
          btn.innerHTML = '\u2713'
          setTimeout(() => {
            btn.innerHTML =
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
          }, 1200)
        })
      })
    })
  }

  const fetchConfig = () => {
    if (!DASH_API) return
    fetchJSON(DASH_API + '/config')
      .then((data) => {
        configRawData = data
        fetched.config = true
        renderConfig()
      })
      .catch(() => {
        if (configBodyEl)
          configBodyEl.innerHTML = '<div class="ss-dbg-empty">Config not available</div>'
      })
  }

  const renderConfigTable = (obj, prefix) => {
    const flat = flattenConfig(obj, prefix)
    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th style="width:320px">Key</th><th>Value</th>' +
      '</tr></thead><tbody>'
    for (let i = 0; i < flat.length; i++) {
      const item = flat[i]
      const relPath =
        item.path.indexOf(prefix + '.') === 0 ? item.path.slice(prefix.length + 1) : item.path
      const redacted = isRedactedObj(item.value)
      html +=
        '<tr>' +
        '<td><span class="ss-dbg-config-key">' +
        esc(relPath) +
        '</span></td>' +
        '<td>' +
        (redacted
          ? renderRedacted(item.value, 'ss-dbg')
          : '<span class="ss-dbg-config-val">' + formatConfigValue(item.value) + '</span>') +
        '</td>' +
        '</tr>'
    }
    html += '</tbody></table>'
    return html
  }

  const renderConfig = () => {
    if (!configBodyEl || !configRawData) return

    const source =
      configActiveTab === 'env' ? configRawData.env || {} : configRawData.config || configRawData
    const flat = flattenConfig(source, '')
    const term = configSearchTerm.toLowerCase()
    let filtered = flat
    if (term) {
      filtered = flat.filter((item) => {
        var valStr = isRedactedObj(item.value) ? item.value.display : String(item.value)
        return (
          item.path.toLowerCase().indexOf(term) !== -1 || valStr.toLowerCase().indexOf(term) !== -1
        )
      })
    }

    if (configSummaryEl) {
      configSummaryEl.textContent =
        filtered.length + (term ? ' of ' + flat.length : '') + ' entries'
    }

    let html = ''

    if (configActiveTab === 'env') {
      // Env vars: simple table
      html +=
        '<div class="ss-dbg-config-table-wrap"><table class="ss-dbg-table"><thead><tr>' +
        '<th>Variable</th><th>Value</th>' +
        '</tr></thead><tbody>'
      for (let i = 0; i < filtered.length; i++) {
        const item = filtered[i]
        const redacted = isRedactedObj(item.value)
        const displayVal = redacted ? item.value.display : String(item.value)
        html +=
          '<tr>' +
          '<td><span class="ss-dbg-config-key">' +
          highlightMatch(esc(item.path), term) +
          '</span></td>' +
          '<td>' +
          (redacted
            ? renderRedacted(item.value, 'ss-dbg')
            : '<span class="ss-dbg-config-val">' +
              highlightMatch(esc(displayVal), term) +
              '</span>') +
          '</td>' +
          '</tr>'
      }
      html += '</tbody></table></div>'
    } else {
      if (term) {
        // Search mode: flat list
        html +=
          '<div class="ss-dbg-config-table-wrap"><table class="ss-dbg-table"><thead><tr>' +
          '<th>Path</th><th>Value</th>' +
          '</tr></thead><tbody>'
        for (let i = 0; i < filtered.length; i++) {
          const item = filtered[i]
          const redacted = isRedactedObj(item.value)
          const displayVal = redacted ? item.value.display : String(item.value)
          html +=
            '<tr>' +
            '<td><span class="ss-dbg-config-key" style="white-space:nowrap">' +
            highlightMatch(esc(item.path), term) +
            '</span></td>' +
            '<td>' +
            (redacted
              ? renderRedacted(item.value, 'ss-dbg')
              : '<span class="ss-dbg-config-val" style="word-break:break-all">' +
                highlightMatch(esc(displayVal), term) +
                '</span>') +
            '</td>' +
            '</tr>'
        }
        html += '</tbody></table></div>'
      } else {
        // Browse mode: collapsible sections
        const topKeys = Object.keys(source)
        html += '<div class="ss-dbg-config-sections">'
        for (let t = 0; t < topKeys.length; t++) {
          const sectionKey = topKeys[t]
          const sectionVal = source[sectionKey]
          const childCount = countLeaves(sectionVal)
          const isObj =
            typeof sectionVal === 'object' && sectionVal !== null && !sectionVal.__redacted

          html += '<div class="ss-dbg-config-section">'
          if (isObj) {
            html +=
              '<div class="ss-dbg-config-section-header" data-config-section="' +
              esc(sectionKey) +
              '">' +
              '<span class="ss-dbg-config-toggle">\u25B6</span>' +
              '<span class="ss-dbg-config-key">' +
              esc(sectionKey) +
              '</span>' +
              '<span class="ss-dbg-config-count">' +
              childCount +
              ' entries</span>' +
              '</div>'
            html += '<div class="ss-dbg-config-section-body" style="display:none">'
            html += renderConfigTable(sectionVal, sectionKey)
            html += '</div>'
          } else {
            html +=
              '<div class="ss-dbg-config-section-header ss-dbg-config-leaf">' +
              '<span class="ss-dbg-config-key">' +
              esc(sectionKey) +
              '</span>' +
              '<span class="ss-dbg-config-val" style="margin-left:8px">' +
              formatConfigValue(sectionVal) +
              '</span>' +
              '</div>'
          }
          html += '</div>'
        }
        html += '</div>'
      }
    }

    configBodyEl.innerHTML = html

    // Bind section toggles
    configBodyEl.querySelectorAll('[data-config-section]').forEach((header) => {
      header.addEventListener('click', () => {
        const sectionBody = header.nextElementSibling
        if (!sectionBody) return
        const isHidden = sectionBody.style.display === 'none'
        sectionBody.style.display = isHidden ? '' : 'none'
        const toggle = header.querySelector('.ss-dbg-config-toggle')
        if (toggle) toggle.textContent = isHidden ? '\u25BC' : '\u25B6'
      })
    })

    // Bind redacted reveal/copy buttons
    bindRedactedButtons(configBodyEl, 'ss-dbg')
  }

  configTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      configTabs.forEach((b) => b.classList.remove('ss-dbg-active'))
      btn.classList.add('ss-dbg-active')
      configActiveTab = btn.getAttribute('data-ss-dbg-config-tab')
      renderConfig()
    })
  })

  if (configSearchInput) {
    configSearchInput.addEventListener('input', () => {
      configSearchTerm = configSearchInput.value.trim()
      renderConfig()
    })
  }

  // ── Custom panes: fetch, render, bind ───────────────────────────
  const getNestedValue = (obj, path) => {
    const parts = path.split('.')
    let cur = obj
    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return undefined
      cur = cur[parts[i]]
    }
    return cur
  }

  const fetchCustomPane = (pane) => {
    const bodyEl = document.getElementById('ss-dbg-' + pane.id + '-body')
    fetchJSON(pane.endpoint)
      .then((data) => {
        const key = pane.dataKey || pane.id
        const rows = getNestedValue(data, key) || (Array.isArray(data) ? data : [])
        customPaneState[pane.id].data = rows
        customPaneState[pane.id].fetched = true
        renderCustomPane(pane)
      })
      .catch(() => {
        if (bodyEl)
          bodyEl.innerHTML =
            '<div class="ss-dbg-empty">Failed to load ' + esc(pane.label) + '</div>'
      })
  }

  const renderCustomPane = (pane) => {
    const state = customPaneState[pane.id]
    if (!state) return
    const bodyEl = document.getElementById('ss-dbg-' + pane.id + '-body')
    const summaryEl = document.getElementById('ss-dbg-' + pane.id + '-summary')
    if (!bodyEl) return

    const filter = state.filter.toLowerCase()
    let rows = state.data

    if (summaryEl) {
      summaryEl.textContent = rows.length + ' ' + pane.label.toLowerCase()
    }

    if (filter) {
      const searchCols = pane.columns.filter((c) => c.searchable)
      if (searchCols.length > 0) {
        rows = rows.filter((row) =>
          searchCols.some((c) => {
            const v = row[c.key]
            return v != null && String(v).toLowerCase().indexOf(filter) !== -1
          })
        )
      }
    }

    if (rows.length === 0) {
      bodyEl.innerHTML =
        '<div class="ss-dbg-empty">' +
        (filter
          ? 'No matching ' + esc(pane.label.toLowerCase())
          : 'No ' + esc(pane.label.toLowerCase()) + ' recorded yet') +
        '</div>'
      return
    }

    let html = '<table class="ss-dbg-table"><thead><tr>'
    for (let c = 0; c < pane.columns.length; c++) {
      const col = pane.columns[c]
      html +=
        '<th' +
        (col.width ? ' style="width:' + col.width + '"' : '') +
        '>' +
        esc(col.label) +
        '</th>'
    }
    html += '</tr></thead><tbody>'

    for (let r = 0; r < rows.length; r++) {
      html += '<tr>'
      for (let c = 0; c < pane.columns.length; c++) {
        const col = pane.columns[c]
        const val = rows[r][col.key]
        const cellHtml = formatCell(val, col)
        if (col.filterable && val != null) {
          html +=
            '<td class="ss-dbg-filterable" data-ss-filter-key="' +
            esc(col.key) +
            '" data-ss-filter-val="' +
            esc(String(val)) +
            '">' +
            cellHtml +
            '</td>'
        } else {
          html += '<td>' + cellHtml + '</td>'
        }
      }
      html += '</tr>'
    }

    html += '</tbody></table>'
    bodyEl.innerHTML = html

    // Bind click-to-filter on filterable cells
    bodyEl.querySelectorAll('.ss-dbg-filterable').forEach((td) => {
      td.style.cursor = 'pointer'
      td.addEventListener('click', () => {
        const val = td.getAttribute('data-ss-filter-val')
        const searchInput = document.getElementById('ss-dbg-search-' + pane.id)
        if (searchInput) {
          searchInput.value = val
          state.filter = val
          renderCustomPane(pane)
        }
      })
    })
  }

  // Bind search + clear for each custom pane
  for (let i = 0; i < customPanes.length; i++) {
    const cp = customPanes[i]
    const searchInput = document.getElementById('ss-dbg-search-' + cp.id)
    const clearBtn = document.getElementById('ss-dbg-' + cp.id + '-clear')

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        customPaneState[cp.id].filter = searchInput.value
        renderCustomPane(cp)
      })
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        customPaneState[cp.id].data = []
        customPaneState[cp.id].fetched = false
        if (searchInput) searchInput.value = ''
        customPaneState[cp.id].filter = ''
        renderCustomPane(cp)
      })
    }
  }

  // ── Connection mode indicator ──────────────────────────────────
  const POLL_INTERVAL_NORMAL = REFRESH_INTERVAL
  const POLL_INTERVAL_LIVE = 15000 // slow polling as fallback when live

  const updateConnectionIndicator = () => {
    const el = document.getElementById('ss-dbg-conn-mode')
    if (!el) return
    if (isLive) {
      el.textContent = 'live'
      el.className = 'ss-dbg-conn-mode ss-dbg-conn-live'
      el.title = 'Connected via Transmit (SSE) — real-time updates'
    } else {
      el.textContent = 'polling'
      el.className = 'ss-dbg-conn-mode ss-dbg-conn-polling'
      el.title = 'Polling every ' + POLL_INTERVAL_NORMAL / 1000 + 's'
    }
  }

  // ── Auto-refresh ────────────────────────────────────────────────
  const startRefresh = () => {
    stopRefresh()
    fetchMiniStats()
    const interval = isLive ? POLL_INTERVAL_LIVE : POLL_INTERVAL_NORMAL
    refreshTimer = setInterval(() => {
      if (!isOpen) return
      loadTab(activeTab)
      fetchMiniStats()
    }, interval)
  }

  const stopRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  // ── Transmit (SSE) support ─────────────────────────────────────
  const initTransmit = () => {
    // window.Transmit is set by the inline IIFE injected before this module
    const TransmitClass = typeof window !== 'undefined' && window.Transmit ? window.Transmit : null

    if (!TransmitClass) return // Transmit client not available

    try {
      const transmit = new TransmitClass({
        baseUrl: window.location.origin,
        onSubscription: () => {
          isLive = true
          updateConnectionIndicator()
          // Restart refresh with slower interval now that we have live updates
          if (isOpen) startRefresh()
        },
        onReconnectFailed: () => {
          isLive = false
          updateConnectionIndicator()
          if (isOpen) startRefresh()
        },
        onSubscribeFailed: () => {
          isLive = false
          updateConnectionIndicator()
        },
      })

      transmitSub = transmit.subscription('server-stats/debug')

      transmitSub.onMessage((message) => {
        try {
          const event = typeof message === 'string' ? JSON.parse(message) : message
          handleLiveEvent(event)
        } catch {
          /* ignore */
        }
      })

      transmitSub.create().catch(() => {
        isLive = false
        updateConnectionIndicator()
      })
    } catch {
      // Transmit init failed — stay on polling
    }
  }

  const handleLiveEvent = (event) => {
    if (!isOpen) return

    // Backend sends { types: ['query', 'event', ...] }
    const types = event.types || (event.type ? [event.type] : [])
    const tabMap = {
      query: 'queries',
      event: 'events',
      email: 'emails',
      trace: 'timeline',
    }

    let shouldRefresh = false
    for (let i = 0; i < types.length; i++) {
      const targetTab = tabMap[types[i]]
      if (targetTab && targetTab === activeTab) {
        shouldRefresh = true
      }
      if (types[i] === 'query') {
        updateBarQueryBadge()
      }
    }

    if (shouldRefresh) {
      loadTab(activeTab)
    }
  }

  // Initialize Transmit after a short delay to let the page fully load
  setTimeout(initTransmit, 500)
  updateConnectionIndicator()

  // ── Stats bar query badge (always visible) ──────────────────────
  const updateBarQueryBadge = () => {
    const el = document.getElementById('ss-b-dbg-queries')
    if (!el) return

    fetchJSON(BASE + '/queries')
      .then((data) => {
        const s = data.summary || {}
        const valEl = el.querySelector('.ss-value')
        if (valEl) {
          valEl.textContent = (s.total || 0) + ' / ' + (s.avgDuration || 0).toFixed(1) + 'ms'
          valEl.className = 'ss-value ' + (s.slow > 0 ? 'ss-amber' : 'ss-green')
        }
      })
      .catch(() => {})
  }

  updateBarQueryBadge()
  setInterval(updateBarQueryBadge, 5000)
})()
