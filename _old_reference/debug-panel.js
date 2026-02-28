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
    const href =
      dashboardPath + '#' + section + (id !== null && id !== undefined ? '?id=' + id : '')
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
    if (!ts) return '-'
    var d = typeof ts === 'string' ? new Date(ts).getTime() : ts
    var diff = Math.floor((Date.now() - d) / 1000)
    if (diff < 0) return 'just now'
    if (diff < 60) return diff + 's ago'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
    return Math.floor(diff / 86400) + 'd ago'
  }

  const formatDuration = (ms) => {
    if (ms === null || ms === undefined) return '-'
    if (ms >= 1000) return (ms / 1000).toFixed(2) + 's'
    if (ms >= 1) return ms.toFixed(0) + 'ms'
    return ms.toFixed(2) + 'ms'
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

  const initResizableColumns = (table) => {
    if (!table) return () => {}
    const headers = Array.from(table.querySelectorAll('thead th'))
    if (!headers.length) return () => {}
    const cleanups = []
    let frozen = false
    function freezeWidths() {
      if (frozen) return
      frozen = true
      headers.forEach((th) => {
        th.style.width = th.offsetWidth + 'px'
      })
      table.style.tableLayout = 'fixed'
    }
    headers.forEach((th) => {
      if (!th.textContent || !th.textContent.trim()) return
      const handle = document.createElement('div')
      handle.className = 'ss-col-resize'
      th.appendChild(handle)
      function onDown(e) {
        e.preventDefault()
        e.stopPropagation()
        freezeWidths()
        const startX = e.clientX,
          startW = th.offsetWidth
        handle.classList.add('ss-resizing')
        handle.setPointerCapture(e.pointerId)
        function onMove(ev) {
          th.style.width = Math.max(30, startW + ev.clientX - startX) + 'px'
        }
        function onUp() {
          handle.classList.remove('ss-resizing')
          handle.removeEventListener('pointermove', onMove)
          handle.removeEventListener('pointerup', onUp)
        }
        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp)
      }
      handle.addEventListener('pointerdown', onDown)
      cleanups.push(() => {
        handle.removeEventListener('pointerdown', onDown)
        handle.remove()
      })
    })
    return () => {
      cleanups.forEach((fn) => fn())
    }
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
      tab.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
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
    else if (name === 'internals') fetchInternals()
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
      '<th>#</th>' +
      '<th>SQL</th>' +
      '<th>Duration</th>' +
      '<th>Method</th>' +
      '<th>Model</th>' +
      '<th>Time</th>' +
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
    const qTable = queryBodyEl.querySelector('.ss-dbg-table')
    if (qTable) initResizableColumns(qTable)
  }

  if (querySearchInput) querySearchInput.addEventListener('input', renderQueries)
  if (queryClearBtn) {
    queryClearBtn.addEventListener('click', () => {
      cachedQueries = {
        queries: [],
        summary: { total: 0, slow: 0, duplicates: 0, avgDuration: 0 },
      }
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
      '<th>#</th>' +
      '<th>Event</th>' +
      '<th>Data</th>' +
      '<th>Time</th>' +
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
    const evTable = eventBodyEl.querySelector('.ss-dbg-table')
    if (evTable) initResizableColumns(evTable)

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
      '<th>Method</th>' +
      '<th>Pattern</th>' +
      '<th>Name</th>' +
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
    const rtTable = routeBodyEl.querySelector('.ss-dbg-table')
    if (rtTable) initResizableColumns(rtTable)
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
      '<th>#</th>' +
      '<th>From</th>' +
      '<th>To</th>' +
      '<th>Subject</th>' +
      '<th>Status</th>' +
      '<th>Mailer</th>' +
      '<th title="Attachments">&#x1F4CE;</th>' +
      '<th>Time</th>' +
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
    const emTable = emailBodyEl.querySelector('.ss-dbg-table')
    if (emTable) initResizableColumns(emTable)

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
      '<th>#</th>' +
      '<th>Method</th>' +
      '<th>URL</th>' +
      '<th>Status</th>' +
      '<th>Duration</th>' +
      '<th>Spans</th>' +
      '<th title="Warnings">&#x26A0;</th>' +
      '<th>Time</th>' +
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
    const tlTable = tlBodyEl.querySelector('.ss-dbg-table')
    if (tlTable) initResizableColumns(tlTable)

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
              .filter(([, v]) => v !== null && v !== undefined)
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
  let _miniStatsTimer = null

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
      '<th>Type</th>' +
      '<th>TTL</th>' +
      '<th>Size</th>' +
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
        (k.ttl !== null && k.ttl !== undefined ? k.ttl + 's' : '-') +
        '</td>' +
        '<td class="ss-dbg-c-dim">' +
        (k.size !== null && k.size !== undefined ? k.size + 'B' : '-') +
        '</td>' +
        '</tr>'
    }

    html += '</tbody></table>'
    cacheBodyEl.innerHTML = html
    const caTable = cacheBodyEl.querySelector('.ss-dbg-table')
    if (caTable) initResizableColumns(caTable)

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
    const stats = cachedJobsData.stats || cachedJobsData.overview || {}

    const statNum = (v) => (v !== null && v !== undefined ? v : 0)

    // Stats area
    if (jobsStatsArea) {
      jobsStatsArea.innerHTML =
        '<div class="ss-dbg-job-stats">' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Active:</span><span class="ss-dbg-job-stat-value">' +
        statNum(stats.active) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Waiting:</span><span class="ss-dbg-job-stat-value">' +
        statNum(stats.waiting) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Delayed:</span><span class="ss-dbg-job-stat-value">' +
        statNum(stats.delayed) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Completed:</span><span class="ss-dbg-job-stat-value">' +
        statNum(stats.completed) +
        '</span></div>' +
        '<div class="ss-dbg-job-stat"><span class="ss-dbg-job-stat-label">Failed:</span><span class="ss-dbg-job-stat-value ss-dbg-c-red">' +
        statNum(stats.failed) +
        '</span></div>' +
        '</div>'
    }

    if (jobsSummaryEl) {
      const total =
        (cachedJobsData.meta ? cachedJobsData.meta.total : null) ||
        cachedJobsData.total ||
        items.length
      jobsSummaryEl.textContent = total + ' jobs'
    }

    if (items.length === 0) {
      jobsBodyEl.innerHTML = '<div class="ss-dbg-empty">No jobs found</div>'
      return
    }

    let html =
      '<table class="ss-dbg-table"><thead><tr>' +
      '<th>ID</th>' +
      '<th>Name</th>' +
      '<th>Status</th>' +
      '<th>Payload</th>' +
      '<th>Tries</th>' +
      '<th>Duration</th>' +
      '<th>Time</th>' +
      '<th></th>' +
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
      const payload = j.payload || j.data
      html +=
        '<tr>' +
        '<td class="ss-dbg-c-dim">' +
        j.id +
        '</td>' +
        '<td class="ss-dbg-c-sql" title="' +
        esc(j.name || '') +
        '">' +
        esc(j.name || '') +
        '</td>' +
        '<td><span class="ss-dbg-badge ss-dbg-badge-' +
        statusBadge +
        '">' +
        esc(j.status || '') +
        '</span></td>' +
        '<td style="color:var(--ss-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="' +
        esc(payload ? compactPreview(payload, 120) : '') +
        '">' +
        esc(payload ? compactPreview(payload, 60) : '-') +
        '</td>' +
        '<td class="ss-dbg-c-muted" style="text-align:center">' +
        (j.attempts || j.attemptsMade || 0) +
        '</td>' +
        '<td class="ss-dbg-duration">' +
        formatDuration(j.duration) +
        '</td>' +
        '<td class="ss-dbg-event-time">' +
        timeAgo(j.timestamp || j.createdAt || j.processedAt || j.created_at) +
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

    const jobsTable = jobsBodyEl.querySelector('.ss-dbg-table')
    if (jobsTable) initResizableColumns(jobsTable)

    // Retry buttons
    jobsBodyEl.querySelectorAll('.ss-dbg-retry-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-retry-id')
        btn.textContent = '...'
        btn.disabled = true
        fetch(DASH_API + '/jobs/' + id + '/retry', {
          method: 'POST',
          credentials: 'same-origin',
        })
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

  // ── Internals Tab ─────────────────────────────────────────────
  const internalsBodyEl = document.getElementById('ss-dbg-internals-body')

  const formatMs = (ms) => {
    if (ms < 1000) return ms + 'ms'
    if (ms < 60000) return ms / 1000 + 's'
    if (ms < 3600000) return ms / 60000 + 'm'
    return ms / 3600000 + 'h'
  }

  const formatUptime = (seconds) => {
    if (!seconds && seconds !== 0) return '-'
    const s = Math.floor(seconds)
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (d > 0) return d + 'd ' + h + 'h'
    if (h > 0) return h + 'h ' + m + 'm'
    if (m > 0) return m + 'm ' + (s % 60) + 's'
    return s + 's'
  }

  const statusDot = (status) => {
    let cls = 'ss-dbg-dot'
    if (
      status === 'healthy' ||
      status === 'active' ||
      status === 'connected' ||
      status === 'available' ||
      status === 'ready'
    ) {
      cls += ' ss-dbg-dot-ok'
    } else if (status === 'errored' || status === 'unavailable') {
      cls += ' ss-dbg-dot-err'
    }
    return '<span class="' + cls + '"></span>'
  }

  const renderInternalsRedacted = (val) => {
    const display = esc(String(val))
    const id = 'ss-int-r-' + Math.random().toString(36).slice(2, 8)
    return (
      '<span class="ss-dbg-redacted-wrap" id="' +
      id +
      '">' +
      '<span class="ss-dbg-redacted-display">\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022</span>' +
      '<span class="ss-dbg-redacted-real" style="display:none">' +
      display +
      '</span>' +
      '<button type="button" class="ss-dbg-redacted-reveal ss-dbg-internals-reveal" data-target="' +
      id +
      '" title="Reveal value" style="background:none;border:none;cursor:pointer;padding:2px;vertical-align:middle">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
      '</button></span>'
    )
  }

  const renderCollectorConfig = (config) => {
    if (!config || typeof config !== 'object') return '-'
    const keys = Object.keys(config)
    if (keys.length === 0) return '-'
    const parts = []
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const v = config[k]
      if (typeof v === 'object' && v && v.__redacted) {
        parts.push(esc(k) + ': ' + renderInternalsRedacted(v.value || v.display || ''))
      } else if (
        typeof v === 'string' &&
        (k.toLowerCase().indexOf('password') !== -1 ||
          k.toLowerCase().indexOf('secret') !== -1 ||
          k.toLowerCase().indexOf('token') !== -1)
      ) {
        parts.push(esc(k) + ': ' + renderInternalsRedacted(v))
      } else {
        parts.push(esc(k) + ': ' + esc(String(v)))
      }
    }
    return parts.join(', ')
  }

  const fetchInternals = () => {
    fetchJSON(BASE + '/diagnostics')
      .then((data) => {
        renderInternals(data)
      })
      .catch(() => {
        if (internalsBodyEl)
          internalsBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load internals</div>'
      })
  }

  const renderInternals = (data) => {
    if (!internalsBodyEl) return

    let html = '<div>'

    // 1. Package Info — compact card row
    const pkg = data.package || {}
    html += '<div>'
    html += '<div class="ss-dbg-internals-title">Package Info</div>'
    html += '<div class="ss-dbg-info-cards">'
    const cards = [
      ['Version', pkg.version || '-'],
      ['Node.js', pkg.nodeVersion || '-'],
      ['AdonisJS', pkg.adonisVersion || '-'],
      ['Uptime', formatUptime(pkg.uptime)],
    ]
    for (let ci = 0; ci < cards.length; ci++) {
      html += '<div class="ss-dbg-info-card">'
      html += '<span class="ss-dbg-info-card-label">' + esc(cards[ci][0]) + '</span>'
      html += '<span class="ss-dbg-info-card-value">' + esc(cards[ci][1]) + '</span>'
      html += '</div>'
    }
    html += '</div></div>'

    // 2. Collectors
    const collectors = data.collectors || []
    if (collectors.length > 0) {
      html += '<div>'
      html += '<div class="ss-dbg-internals-title">Collectors</div>'
      html += '<table class="ss-dbg-table"><thead><tr>'
      html += '<th>Collector</th><th>Status</th><th>Last Error</th><th>Config</th>'
      html += '</tr></thead><tbody>'
      for (let c = 0; c < collectors.length; c++) {
        const col = collectors[c]
        const errMsg = col.lastError
          ? esc(col.lastError) +
            ' <span class="ss-dbg-c-dim">' +
            timeAgo(col.lastErrorAt) +
            '</span>'
          : '<span class="ss-dbg-c-dim">\u2014</span>'
        html += '<tr>'
        html += '<td><code>' + esc(col.name) + '</code>'
        if (col.label && col.label !== col.name) {
          html += ' <span class="ss-dbg-c-dim">' + esc(col.label) + '</span>'
        }
        html += '</td>'
        html += '<td>' + statusDot(col.status) + esc(col.status) + '</td>'
        html += '<td>' + errMsg + '</td>'
        html += '<td>' + renderCollectorConfig(col.config) + '</td>'
        html += '</tr>'
      }
      html += '</tbody></table></div>'
    }

    // 3. Buffers
    const buffers = data.buffers
    if (buffers) {
      const bufferKeys = ['queries', 'events', 'emails', 'traces']
      html += '<div>'
      html += '<div class="ss-dbg-internals-title">Buffers</div>'
      html += '<table class="ss-dbg-table"><thead><tr>'
      html += '<th>Buffer</th><th>Usage</th><th style="width:180px">Fill %</th>'
      html += '</tr></thead><tbody>'
      for (let b = 0; b < bufferKeys.length; b++) {
        const bk = bufferKeys[b]
        const buf = buffers[bk]
        if (!buf) continue
        const pct = buf.max > 0 ? Math.round((buf.current / buf.max) * 100) : 0
        html += '<tr>'
        html += '<td style="text-transform:capitalize">' + esc(bk) + '</td>'
        html += '<td>' + buf.current + ' / ' + buf.max + '</td>'
        html += '<td><div class="ss-dbg-bar">'
        html += '<div class="ss-dbg-bar-track">'
        html +=
          '<div class="ss-dbg-bar-fill' +
          (pct >= 100 ? ' ss-dbg-bar-fill-warn' : '') +
          '" style="width:' +
          Math.min(pct, 100) +
          '%"></div></div>'
        html +=
          '<span class="ss-dbg-bar-pct' +
          (pct >= 100 ? ' ss-dbg-bar-pct-warn' : '') +
          '">' +
          pct +
          '%</span>'
        html += '</div></td>'
        html += '</tr>'
      }
      html += '</tbody></table></div>'
    }

    // 4. Timers
    const timers = data.timers
    if (timers) {
      const timerLabels = {
        collectionInterval: 'Stats Collection',
        dashboardBroadcast: 'Dashboard Broadcast',
        debugBroadcast: 'Debug Broadcast',
        persistFlush: 'Persist Flush',
        retentionCleanup: 'Retention Cleanup',
      }
      html += '<div>'
      html += '<div class="ss-dbg-internals-title">Timers</div>'
      html += '<table class="ss-dbg-table"><thead><tr>'
      html += '<th>Timer</th><th>Status</th><th>Interval</th>'
      html += '</tr></thead><tbody>'
      const timerKeys = Object.keys(timers)
      for (let t = 0; t < timerKeys.length; t++) {
        const tk = timerKeys[t]
        const timer = timers[tk]
        const label = timerLabels[tk] || tk
        let intervalStr = '-'
        if (timer.intervalMs) intervalStr = formatMs(timer.intervalMs)
        else if (timer.debounceMs) intervalStr = formatMs(timer.debounceMs) + ' (debounce)'
        html += '<tr>'
        html += '<td>' + esc(label) + '</td>'
        html +=
          '<td>' +
          statusDot(timer.active ? 'active' : 'inactive') +
          (timer.active ? 'active' : 'inactive') +
          '</td>'
        html +=
          '<td>' +
          (timer.active ? esc(intervalStr) : '<span class="ss-dbg-c-dim">\u2014</span>') +
          '</td>'
        html += '</tr>'
      }
      html += '</tbody></table></div>'
    }

    // 5. Integrations
    const integrations = data.integrations
    const transmit = data.transmit
    if (integrations || transmit) {
      html += '<div>'
      html += '<div class="ss-dbg-internals-title">Integrations</div>'
      html += '<table class="ss-dbg-table"><thead><tr>'
      html += '<th>Integration</th><th>Status</th><th>Details</th>'
      html += '</tr></thead><tbody>'
      if (transmit) {
        const txStatus = transmit.available ? 'connected' : 'unavailable'
        const txDetails =
          transmit.channels && transmit.channels.length
            ? 'Channels: ' + transmit.channels.map((ch) => esc(ch)).join(', ')
            : '-'
        html +=
          '<tr><td>Transmit (SSE)</td><td>' +
          statusDot(txStatus) +
          esc(txStatus) +
          '</td><td>' +
          txDetails +
          '</td></tr>'
      }
      if (integrations) {
        if (integrations.prometheus) {
          html +=
            '<tr><td>Prometheus</td><td>' +
            statusDot(integrations.prometheus.active ? 'active' : 'inactive') +
            (integrations.prometheus.active ? 'active' : 'inactive') +
            '</td><td>-</td></tr>'
        }
        if (integrations.pinoHook) {
          const pinoMode = integrations.pinoHook.mode || 'none'
          html +=
            '<tr><td>Pino Log Hook</td><td>' +
            statusDot(integrations.pinoHook.active ? 'active' : 'inactive') +
            (integrations.pinoHook.active ? 'active' : 'inactive') +
            '</td><td>Mode: ' +
            esc(pinoMode) +
            '</td></tr>'
        }
        if (integrations.edgePlugin) {
          html +=
            '<tr><td>Edge Plugin</td><td>' +
            statusDot(integrations.edgePlugin.active ? 'active' : 'inactive') +
            (integrations.edgePlugin.active ? 'active' : 'inactive') +
            '</td><td>' +
            (integrations.edgePlugin.active ? '@serverStats() tag registered' : '-') +
            '</td></tr>'
        }
        if (integrations.cacheInspector) {
          html +=
            '<tr><td>Cache Inspector</td><td>' +
            statusDot(integrations.cacheInspector.available ? 'available' : 'unavailable') +
            (integrations.cacheInspector.available ? 'available' : 'unavailable') +
            '</td><td>' +
            (integrations.cacheInspector.available ? 'Redis dependency detected' : '-') +
            '</td></tr>'
        }
        if (integrations.queueInspector) {
          html +=
            '<tr><td>Queue Inspector</td><td>' +
            statusDot(integrations.queueInspector.available ? 'available' : 'unavailable') +
            (integrations.queueInspector.available ? 'available' : 'unavailable') +
            '</td><td>' +
            (integrations.queueInspector.available ? 'Queue dependency detected' : '-') +
            '</td></tr>'
        }
      }
      html += '</tbody></table></div>'
    }

    // 6. Storage (SQLite) — conditional
    const storage = data.storage
    if (storage) {
      html += '<div>'
      html += '<div class="ss-dbg-internals-title">Storage (SQLite)</div>'
      html +=
        '<table class="ss-dbg-table"><thead><tr><th style="width:160px">Metric</th><th>Value</th></tr></thead><tbody>'
      html +=
        '<tr><td>Status</td><td>' +
        statusDot(storage.ready ? 'ready' : 'not ready') +
        (storage.ready ? 'ready' : 'not ready') +
        '</td></tr>'
      html += '<tr><td>DB Path</td><td><code>' + esc(storage.dbPath || '-') + '</code></td></tr>'
      html +=
        '<tr><td>File Size</td><td>' +
        (typeof storage.fileSizeMb === 'number' ? storage.fileSizeMb.toFixed(1) + ' MB' : '-') +
        '</td></tr>'
      html +=
        '<tr><td>WAL Size</td><td>' +
        (typeof storage.walSizeMb === 'number' ? storage.walSizeMb.toFixed(1) + ' MB' : '-') +
        '</td></tr>'
      html += '<tr><td>Retention</td><td>' + (storage.retentionDays || '-') + ' days</td></tr>'
      html += '<tr><td>Last Cleanup</td><td>' + timeAgo(storage.lastCleanupAt) + '</td></tr>'
      html += '</tbody></table>'

      const tables = storage.tables
      if (tables && tables.length > 0) {
        html +=
          '<table class="ss-dbg-table" style="margin-top:6px"><thead><tr><th>Table</th><th>Rows</th></tr></thead><tbody>'
        for (let st = 0; st < tables.length; st++) {
          html += '<tr><td><code>' + esc(tables[st].name) + '</code></td>'
          html +=
            '<td>' +
            (typeof tables[st].rowCount === 'number' ? tables[st].rowCount.toLocaleString() : '-') +
            '</td></tr>'
        }
        html += '</tbody></table>'
      }
      html += '</div>'
    }

    // 7. Resolved Config
    const cfg = data.config
    const devToolbar = data.devToolbar
    if (cfg || devToolbar) {
      html += '<div>'
      html += '<div class="ss-dbg-internals-title">Resolved Config</div>'

      if (cfg) {
        html +=
          '<table class="ss-dbg-table"><thead><tr><th style="width:160px">Setting</th><th>Value</th></tr></thead><tbody>'
        html += '<tr><td>intervalMs</td><td>' + esc(cfg.intervalMs) + '</td></tr>'
        html += '<tr><td>transport</td><td>' + esc(cfg.transport) + '</td></tr>'
        html += '<tr><td>channelName</td><td>' + esc(cfg.channelName) + '</td></tr>'
        html += '<tr><td>endpoint</td><td>' + esc(String(cfg.endpoint)) + '</td></tr>'
        html += '<tr><td>skipInTest</td><td>' + esc(String(cfg.skipInTest)) + '</td></tr>'
        html +=
          '<tr><td>onStats callback</td><td>' +
          (cfg.hasOnStatsCallback ? 'defined' : 'not defined') +
          '</td></tr>'
        html +=
          '<tr><td>shouldShow callback</td><td>' +
          (cfg.hasShouldShowCallback ? 'defined' : 'not defined') +
          '</td></tr>'
        html += '</tbody></table>'
      }

      if (devToolbar) {
        html += '<div class="ss-dbg-internals-title">DevToolbar</div>'
        html +=
          '<table class="ss-dbg-table"><thead><tr><th style="width:160px">Setting</th><th>Value</th></tr></thead><tbody>'
        const dtKeys = [
          'enabled',
          'tracing',
          'dashboard',
          'dashboardPath',
          'debugEndpoint',
          'maxQueries',
          'maxEvents',
          'maxEmails',
          'maxTraces',
          'slowQueryThresholdMs',
          'retentionDays',
          'dbPath',
          'persistDebugData',
        ]
        for (let dk = 0; dk < dtKeys.length; dk++) {
          const dtk = dtKeys[dk]
          if (devToolbar[dtk] !== undefined) {
            html +=
              '<tr><td>' + esc(dtk) + '</td><td>' + esc(String(devToolbar[dtk])) + '</td></tr>'
          }
        }
        if (devToolbar.excludeFromTracing && devToolbar.excludeFromTracing.length) {
          html +=
            '<tr><td>excludeFromTracing</td><td>' +
            devToolbar.excludeFromTracing.map((p) => esc(p)).join(', ') +
            '</td></tr>'
        }
        if (typeof devToolbar.customPaneCount === 'number') {
          html +=
            '<tr><td>customPanes</td><td>' + devToolbar.customPaneCount + ' registered</td></tr>'
        }
        html += '</tbody></table>'
      }
      html += '</div>'
    }

    html += '</div>'

    internalsBodyEl.innerHTML = html

    // Bind click-to-reveal for redacted values
    internalsBodyEl.querySelectorAll('.ss-dbg-internals-reveal').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const targetId = btn.getAttribute('data-target')
        if (!targetId) return
        const wrap = document.getElementById(targetId)
        if (!wrap) return
        const display = wrap.querySelector('.ss-dbg-redacted-display')
        const real = wrap.querySelector('.ss-dbg-redacted-real')
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
  }

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
      if (cur === null || cur === undefined) return undefined
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
            return v !== null && v !== undefined && String(v).toLowerCase().indexOf(filter) !== -1
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
      html += '<th>' + esc(col.label) + '</th>'
    }
    html += '</tr></thead><tbody>'

    for (let r = 0; r < rows.length; r++) {
      html += '<tr>'
      for (let c = 0; c < pane.columns.length; c++) {
        const col = pane.columns[c]
        const val = rows[r][col.key]
        const cellHtml = formatCell(val, col)
        if (col.filterable && val !== null && val !== undefined) {
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
    const cpTable = bodyEl.querySelector('.ss-dbg-table')
    if (cpTable) initResizableColumns(cpTable)

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
