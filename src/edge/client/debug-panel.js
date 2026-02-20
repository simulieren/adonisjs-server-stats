/**
 * Client-side script for the debug panel.
 *
 * Handles panel toggle, tab switching, lazy data fetching,
 * query/event/route table rendering, and log streaming.
 *
 * Config is read from data-* attributes on #ss-dbg-panel:
 *   data-logs-endpoint — logs API URL
 */
(function () {
  const BASE = '/admin/api/debug';
  const REFRESH_INTERVAL = 3000;
  const panel = document.getElementById('ss-dbg-panel');
  const wrench = document.getElementById('ss-dbg-wrench');
  const closeBtn = document.getElementById('ss-dbg-close');

  if (!panel || !wrench) return;

  const LOGS_ENDPOINT = panel.dataset.logsEndpoint || (BASE + '/logs');

  const tracingEnabled = panel.dataset.tracing === '1';

  let isOpen = false;
  let activeTab = tracingEnabled ? 'timeline' : 'queries';
  const fetched = {};
  let refreshTimer = null;
  let logFilter = 'all';
  let cachedLogs = [];
  const currentPath = window.location.pathname;

  // ── Helpers ──────────────────────────────────────────────────────
  const esc = (s) => {
    if (typeof s !== 'string') s = '' + s;
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  const timeAgo = (ts) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    return Math.floor(diff / 3600) + 'h ago';
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  };

  const eventPreview = (data) => {
    if (!data) return '-';
    try {
      const parsed = JSON.parse(data);
      return compactPreview(parsed, 100);
    } catch {
      return data.length > 100 ? data.slice(0, 100) + '...' : data;
    }
  };

  const compactPreview = (val, maxLen) => {
    if (val === null) return 'null';
    if (typeof val === 'string') return '"' + (val.length > 40 ? val.slice(0, 40) + '...' : val) + '"';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      const items = val.slice(0, 3).map((v) => compactPreview(v, 30));
      const s = '[' + items.join(', ') + (val.length > 3 ? ', ...' + val.length + ' items' : '') + ']';
      return s.length > maxLen ? '[' + val.length + ' items]' : s;
    }
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      if (keys.length === 0) return '{}';
      const pairs = [];
      for (let i = 0; i < Math.min(keys.length, 4); i++) {
        const k = keys[i];
        const v = compactPreview(val[k], 30);
        pairs.push(k + ': ' + v);
      }
      const s = '{ ' + pairs.join(', ') + (keys.length > 4 ? ', ...+' + (keys.length - 4) : '') + ' }';
      return s.length > maxLen ? '{ ' + keys.slice(0, 6).join(', ') + (keys.length > 6 ? ', ...' : '') + ' }' : s;
    }
    return String(val);
  };

  const methodClass = (m) => 'ss-dbg-method ss-dbg-method-' + (typeof m === 'string' ? m.toLowerCase() : '');

  const durationClass = (ms) => {
    if (ms > 500) return 'ss-dbg-very-slow';
    if (ms > 100) return 'ss-dbg-slow';
    return '';
  };

  // ── Custom pane cell formatter ────────────────────────────────────
  const formatCell = (value, col) => {
    if (value === null || value === undefined) return '<span style="color:#525252">-</span>';
    const fmt = col.format || 'text';
    switch (fmt) {
      case 'time':
        return typeof value === 'number' ? formatTime(value) : esc(value);
      case 'timeAgo':
        return '<span class="ss-dbg-event-time">' + (typeof value === 'number' ? timeAgo(value) : esc(value)) + '</span>';
      case 'duration': {
        const ms = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(ms)) return esc(value);
        return '<span class="ss-dbg-duration ' + durationClass(ms) + '">' + ms.toFixed(2) + 'ms</span>';
      }
      case 'method':
        return '<span class="' + methodClass(value) + '">' + esc(value) + '</span>';
      case 'json': {
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch { /* use as-is */ }
        }
        const preview = typeof value === 'object' ? compactPreview(value, 100) : String(value);
        return '<span class="ss-dbg-data-preview" style="cursor:default">' + esc(preview) + '</span>';
      }
      case 'badge': {
        const sv = String(value).toLowerCase();
        const colorMap = col.badgeColorMap || {};
        const color = colorMap[sv] || 'muted';
        return '<span class="ss-dbg-badge ss-dbg-badge-' + esc(color) + '">' + esc(value) + '</span>';
      }
      default:
        return esc(value);
    }
  };

  // ── Toggle panel ────────────────────────────────────────────────
  const togglePanel = () => {
    isOpen = !isOpen;
    panel.classList.toggle('ss-dbg-open', isOpen);
    wrench.classList.toggle('ss-dbg-active', isOpen);

    if (isOpen) {
      loadTab(activeTab);
      startRefresh();
    } else {
      stopRefresh();
    }
  };

  wrench.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (isOpen) togglePanel();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) togglePanel();
  });

  // ── Custom panes config ─────────────────────────────────────────
  let customPanes = [];
  const customPaneState = {};
  try {
    const cfgEl = document.getElementById('ss-dbg-custom-panes-config');
    if (cfgEl) customPanes = JSON.parse(cfgEl.textContent || '[]');
  } catch { /* ignore */ }

  for (let i = 0; i < customPanes.length; i++) {
    const cp = customPanes[i];
    customPaneState[cp.id] = { data: [], fetched: false, filter: '' };
  }

  // ── Tab switching ───────────────────────────────────────────────
  const tabs = panel.querySelectorAll('[data-ss-dbg-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.getAttribute('data-ss-dbg-tab');
      if (name === activeTab) return;

      tabs.forEach((t) => t.classList.remove('ss-dbg-active'));
      panel.querySelectorAll('.ss-dbg-pane').forEach((p) => p.classList.remove('ss-dbg-active'));

      tab.classList.add('ss-dbg-active');
      const pane = document.getElementById('ss-dbg-pane-' + name);
      if (pane) pane.classList.add('ss-dbg-active');

      activeTab = name;
      loadTab(name);
    });
  });

  // ── Data loading ────────────────────────────────────────────────
  const loadTab = (name) => {
    if (name === 'timeline') fetchTraces();
    else if (name === 'queries') fetchQueries();
    else if (name === 'events') fetchEvents();
    else if (name === 'routes' && !fetched.routes) fetchRoutes();
    else if (name === 'logs') fetchLogs();
    else if (name === 'emails') fetchEmails();
    else {
      const cp = customPanes.find((p) => p.id === name);
      if (cp) {
        if (cp.fetchOnce && customPaneState[cp.id].fetched) return;
        fetchCustomPane(cp);
      }
    }
  };

  const fetchJSON = (url) =>
    fetch(url, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });

  // ── Queries Tab ─────────────────────────────────────────────────
  const querySearchInput = document.getElementById('ss-dbg-search-queries');
  const querySummaryEl = document.getElementById('ss-dbg-queries-summary');
  const queryBodyEl = document.getElementById('ss-dbg-queries-body');
  const queryClearBtn = document.getElementById('ss-dbg-queries-clear');
  let cachedQueries = { queries: [], summary: {} };

  const fetchQueries = () => {
    fetchJSON(BASE + '/queries')
      .then((data) => {
        cachedQueries = data;
        renderQueries();
      })
      .catch(() => {
        queryBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load queries</div>';
      });
  };

  const renderQueries = () => {
    const filter = (querySearchInput ? querySearchInput.value : '').toLowerCase();
    const queries = cachedQueries.queries || [];
    const summary = cachedQueries.summary || {};

    if (querySummaryEl) {
      querySummaryEl.textContent = summary.total + ' queries'
        + (summary.slow > 0 ? ', ' + summary.slow + ' slow' : '')
        + (summary.duplicates > 0 ? ', ' + summary.duplicates + ' dup' : '')
        + ', avg ' + (summary.avgDuration || 0).toFixed(1) + 'ms';
    }

    const badge = document.getElementById('ss-dbg-query-badge');
    if (badge && activeTab === 'queries') {
      badge.textContent = summary.total + ' queries, avg ' + (summary.avgDuration || 0).toFixed(1) + 'ms';
    }

    let filtered = queries;
    if (filter) {
      filtered = queries.filter((q) =>
        q.sql.toLowerCase().indexOf(filter) !== -1
        || (q.model || '').toLowerCase().indexOf(filter) !== -1
        || q.method.toLowerCase().indexOf(filter) !== -1
      );
    }

    if (filtered.length === 0) {
      queryBodyEl.innerHTML = '<div class="ss-dbg-empty">' + (filter ? 'No matching queries' : 'No queries recorded yet') + '</div>';
      return;
    }

    const sqlCounts = {};
    for (let i = 0; i < queries.length; i++) {
      sqlCounts[queries[i].sql] = (sqlCounts[queries[i].sql] || 0) + 1;
    }

    let html = '<table class="ss-dbg-table"><thead><tr>'
      + '<th style="width:40px">#</th>'
      + '<th>SQL</th>'
      + '<th style="width:70px">Duration</th>'
      + '<th style="width:60px">Method</th>'
      + '<th style="width:100px">Model</th>'
      + '<th style="width:60px">Time</th>'
      + '</tr></thead><tbody>';

    for (let j = 0; j < filtered.length; j++) {
      const q = filtered[j];
      const durClass = durationClass(q.duration);
      const dupCount = sqlCounts[q.sql] || 1;
      html += '<tr>'
        + '<td style="color:#525252">' + q.id + '</td>'
        + '<td><span class="ss-dbg-sql" title="Click to expand" onclick="this.classList.toggle(\'ss-dbg-expanded\')">' + esc(q.sql) + '</span>'
        + (dupCount > 1 ? ' <span class="ss-dbg-dup">x' + dupCount + '</span>' : '')
        + '</td>'
        + '<td class="ss-dbg-duration ' + durClass + '">' + q.duration.toFixed(2) + 'ms</td>'
        + '<td><span class="' + methodClass(q.method) + '">' + esc(q.method) + '</span></td>'
        + '<td style="color:#737373">' + esc(q.model || '-') + '</td>'
        + '<td class="ss-dbg-event-time">' + timeAgo(q.timestamp) + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    queryBodyEl.innerHTML = html;
  };

  if (querySearchInput) querySearchInput.addEventListener('input', renderQueries);
  if (queryClearBtn) {
    queryClearBtn.addEventListener('click', () => {
      cachedQueries = { queries: [], summary: { total: 0, slow: 0, duplicates: 0, avgDuration: 0 } };
      renderQueries();
    });
  }

  // ── Events Tab ──────────────────────────────────────────────────
  const eventSearchInput = document.getElementById('ss-dbg-search-events');
  const eventSummaryEl = document.getElementById('ss-dbg-events-summary');
  const eventBodyEl = document.getElementById('ss-dbg-events-body');
  const eventClearBtn = document.getElementById('ss-dbg-events-clear');
  let cachedEvents = { events: [], total: 0 };

  const fetchEvents = () => {
    fetchJSON(BASE + '/events')
      .then((data) => {
        cachedEvents = data;
        renderEvents();
      })
      .catch(() => {
        eventBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load events</div>';
      });
  };

  const renderEvents = () => {
    const filter = (eventSearchInput ? eventSearchInput.value : '').toLowerCase();
    const events = cachedEvents.events || [];

    if (eventSummaryEl) {
      eventSummaryEl.textContent = cachedEvents.total + ' events';
    }

    let filtered = events;
    if (filter) {
      filtered = events.filter((e) =>
        e.event.toLowerCase().indexOf(filter) !== -1
        || (e.data || '').toLowerCase().indexOf(filter) !== -1
      );
    }

    if (filtered.length === 0) {
      eventBodyEl.innerHTML = '<div class="ss-dbg-empty">' + (filter ? 'No matching events' : 'No events recorded yet') + '</div>';
      return;
    }

    let html = '<table class="ss-dbg-table"><thead><tr>'
      + '<th style="width:40px">#</th>'
      + '<th>Event</th>'
      + '<th>Data</th>'
      + '<th style="width:100px">Time</th>'
      + '</tr></thead><tbody>';

    for (let i = 0; i < filtered.length; i++) {
      const ev = filtered[i];
      const hasData = ev.data && ev.data !== '-';
      const preview = hasData ? eventPreview(ev.data) : '-';
      html += '<tr>'
        + '<td style="color:#525252">' + ev.id + '</td>'
        + '<td class="ss-dbg-event-name">' + esc(ev.event) + '</td>'
        + '<td class="ss-dbg-event-data">'
        + (hasData
          ? '<span class="ss-dbg-data-preview" data-ev-idx="' + i + '">' + esc(preview) + '</span>'
            + '<pre class="ss-dbg-data-full" id="ss-dbg-evdata-' + i + '" style="display:none">' + esc(ev.data) + '</pre>'
            + '<button type="button" class="ss-dbg-copy-btn" data-copy-idx="' + i + '" title="Copy JSON">&#x2398;</button>'
          : '<span style="color:#525252">-</span>')
        + '</td>'
        + '<td class="ss-dbg-event-time">' + formatTime(ev.timestamp) + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    eventBodyEl.innerHTML = html;

    // Toggle expand on preview click
    eventBodyEl.querySelectorAll('.ss-dbg-data-preview').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = el.getAttribute('data-ev-idx');
        const pre = document.getElementById('ss-dbg-evdata-' + idx);
        if (pre) {
          const open = pre.style.display !== 'none';
          pre.style.display = open ? 'none' : 'block';
          el.style.display = open ? '' : 'none';
        }
      });
    });

    // Collapse on full-data click
    eventBodyEl.querySelectorAll('.ss-dbg-data-full').forEach((el) => {
      el.addEventListener('click', () => {
        el.style.display = 'none';
        const idx = el.id.replace('ss-dbg-evdata-', '');
        const preview = eventBodyEl.querySelector('[data-ev-idx="' + idx + '"]');
        if (preview) preview.style.display = '';
      });
    });

    // Copy button
    eventBodyEl.querySelectorAll('.ss-dbg-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = btn.getAttribute('data-copy-idx');
        const data = filtered[idx]?.data || '';
        navigator.clipboard.writeText(data).then(() => {
          btn.textContent = '\u2713';
          setTimeout(() => { btn.innerHTML = '&#x2398;'; }, 1200);
        });
      });
    });
  };

  if (eventSearchInput) eventSearchInput.addEventListener('input', renderEvents);
  if (eventClearBtn) {
    eventClearBtn.addEventListener('click', () => {
      cachedEvents = { events: [], total: 0 };
      renderEvents();
    });
  }

  // ── Routes Tab ──────────────────────────────────────────────────
  const routeSearchInput = document.getElementById('ss-dbg-search-routes');
  const routeSummaryEl = document.getElementById('ss-dbg-routes-summary');
  const routeBodyEl = document.getElementById('ss-dbg-routes-body');
  let cachedRoutes = { routes: [], total: 0 };

  const fetchRoutes = () => {
    fetchJSON(BASE + '/routes')
      .then((data) => {
        cachedRoutes = data;
        fetched.routes = true;
        renderRoutes();
      })
      .catch(() => {
        routeBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load routes</div>';
      });
  };

  const renderRoutes = () => {
    const filter = (routeSearchInput ? routeSearchInput.value : '').toLowerCase();
    const routes = cachedRoutes.routes || [];

    if (routeSummaryEl) {
      routeSummaryEl.textContent = cachedRoutes.total + ' routes';
    }

    let filtered = routes;
    if (filter) {
      filtered = routes.filter((r) =>
        r.pattern.toLowerCase().indexOf(filter) !== -1
        || r.method.toLowerCase().indexOf(filter) !== -1
        || (r.name || '').toLowerCase().indexOf(filter) !== -1
        || r.handler.toLowerCase().indexOf(filter) !== -1
        || r.middleware.join(' ').toLowerCase().indexOf(filter) !== -1
      );
    }

    if (filtered.length === 0) {
      routeBodyEl.innerHTML = '<div class="ss-dbg-empty">' + (filter ? 'No matching routes' : 'No routes available') + '</div>';
      return;
    }

    let html = '<table class="ss-dbg-table"><thead><tr>'
      + '<th style="width:60px">Method</th>'
      + '<th>Pattern</th>'
      + '<th style="width:140px">Name</th>'
      + '<th>Handler</th>'
      + '<th>Middleware</th>'
      + '</tr></thead><tbody>';

    for (let i = 0; i < filtered.length; i++) {
      const r = filtered[i];
      const isCurrent = currentPath === r.pattern || currentPath.match(new RegExp('^' + r.pattern.replace(/:[^/]+/g, '[^/]+') + '$'));
      html += '<tr' + (isCurrent ? ' class="ss-dbg-current-route"' : '') + '>'
        + '<td><span class="' + methodClass(r.method) + '">' + esc(r.method) + '</span></td>'
        + '<td>' + esc(r.pattern) + '</td>'
        + '<td style="color:#737373">' + esc(r.name || '-') + '</td>'
        + '<td style="color:#93c5fd">' + esc(r.handler) + '</td>'
        + '<td style="color:#525252;font-size:10px">' + (r.middleware.length ? esc(r.middleware.join(', ')) : '-') + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    routeBodyEl.innerHTML = html;
  };

  if (routeSearchInput) routeSearchInput.addEventListener('input', renderRoutes);

  // ── Logs Tab ────────────────────────────────────────────────────
  const logBodyEl = document.getElementById('ss-dbg-logs-body');
  const logFilters = panel.querySelectorAll('[data-ss-dbg-level]');
  const logReqIdInput = document.getElementById('ss-dbg-log-reqid');
  const logReqIdClear = document.getElementById('ss-dbg-log-reqid-clear');
  let logReqIdFilter = '';

  const setReqIdFilter = (id) => {
    logReqIdFilter = id || '';
    if (logReqIdInput) logReqIdInput.value = logReqIdFilter;
    if (logReqIdClear) logReqIdClear.style.display = logReqIdFilter ? '' : 'none';
    renderLogs();
  };

  if (logReqIdInput) {
    logReqIdInput.addEventListener('input', () => {
      logReqIdFilter = logReqIdInput.value.trim();
      if (logReqIdClear) logReqIdClear.style.display = logReqIdFilter ? '' : 'none';
      renderLogs();
    });
  }
  if (logReqIdClear) {
    logReqIdClear.addEventListener('click', () => setReqIdFilter(''));
  }

  const fetchLogs = () => {
    fetchJSON(LOGS_ENDPOINT)
      .then((data) => {
        cachedLogs = Array.isArray(data) ? data : (data.logs || data.entries || []);
        renderLogs();
      })
      .catch(() => {
        logBodyEl.innerHTML = '<div class="ss-dbg-empty">No log endpoint available</div>';
      });
  };

  const shortReqId = (id) => id ? id.slice(0, 8) : '';

  const renderLogs = () => {
    let entries = cachedLogs;

    if (logFilter !== 'all') {
      entries = entries.filter((e) => {
        const level = (e.levelName || e.level_name || '').toLowerCase();
        if (logFilter === 'error') return level === 'error' || level === 'fatal';
        return level === logFilter;
      });
    }

    if (logReqIdFilter) {
      const f = logReqIdFilter.toLowerCase();
      entries = entries.filter((e) => {
        const rid = (e.request_id || e['x-request-id'] || '').toLowerCase();
        return rid.indexOf(f) !== -1;
      });
    }

    if (entries.length === 0) {
      let hint = '';
      if (logReqIdFilter) hint = ' matching request ' + logReqIdFilter;
      else if (logFilter !== 'all') hint = ' for ' + logFilter;
      logBodyEl.innerHTML = '<div class="ss-dbg-empty">No log entries' + hint + '</div>';
      return;
    }

    const shown = entries.slice(-200).reverse();
    let html = '';

    for (let i = 0; i < shown.length; i++) {
      const e = shown[i];
      const level = (e.levelName || e.level_name || 'info').toLowerCase();
      const msg = e.msg || e.message || JSON.stringify(e);
      const ts = e.time || e.timestamp || 0;
      const reqId = e.request_id || e['x-request-id'] || '';

      html += '<div class="ss-dbg-log-entry">'
        + '<span class="ss-dbg-log-level ss-dbg-log-level-' + esc(level) + '">' + esc(level.toUpperCase()) + '</span>'
        + '<span class="ss-dbg-log-time">' + (ts ? formatTime(ts) : '-') + '</span>'
        + (reqId
          ? '<span class="ss-dbg-log-reqid" data-reqid="' + esc(reqId) + '" title="' + esc(reqId) + '">' + esc(shortReqId(reqId)) + '</span>'
          : '<span class="ss-dbg-log-reqid-empty">-</span>')
        + '<span class="ss-dbg-log-msg">' + esc(msg) + '</span>'
        + '</div>';
    }

    logBodyEl.innerHTML = html;

    // Click request ID to filter
    logBodyEl.querySelectorAll('.ss-dbg-log-reqid').forEach((el) => {
      el.addEventListener('click', () => {
        setReqIdFilter(el.getAttribute('data-reqid'));
      });
    });
  };

  logFilters.forEach((btn) => {
    btn.addEventListener('click', () => {
      logFilters.forEach((b) => b.classList.remove('ss-dbg-active'));
      btn.classList.add('ss-dbg-active');
      logFilter = btn.getAttribute('data-ss-dbg-level');
      renderLogs();
    });
  });

  // ── Emails Tab ─────────────────────────────────────────────────
  const emailSearchInput = document.getElementById('ss-dbg-search-emails');
  const emailSummaryEl = document.getElementById('ss-dbg-emails-summary');
  const emailBodyEl = document.getElementById('ss-dbg-emails-body');
  const emailClearBtn = document.getElementById('ss-dbg-emails-clear');
  const emailPreviewEl = document.getElementById('ss-dbg-email-preview');
  const emailPreviewMeta = document.getElementById('ss-dbg-email-preview-meta');
  const emailPreviewClose = document.getElementById('ss-dbg-email-preview-close');
  const emailIframe = document.getElementById('ss-dbg-email-iframe');
  let cachedEmails = { emails: [], total: 0 };

  const fetchEmails = () => {
    fetchJSON(BASE + '/emails')
      .then((data) => {
        cachedEmails = data;
        renderEmails();
      })
      .catch(() => {
        if (emailBodyEl) emailBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load emails</div>';
      });
  };

  const renderEmails = () => {
    if (!emailBodyEl) return;
    const filter = (emailSearchInput ? emailSearchInput.value : '').toLowerCase();
    const emails = cachedEmails.emails || [];

    if (emailSummaryEl) {
      emailSummaryEl.textContent = cachedEmails.total + ' emails';
    }

    let filtered = emails;
    if (filter) {
      filtered = emails.filter((e) =>
        (e.from || '').toLowerCase().indexOf(filter) !== -1
        || (e.to || '').toLowerCase().indexOf(filter) !== -1
        || (e.subject || '').toLowerCase().indexOf(filter) !== -1
        || (e.mailer || '').toLowerCase().indexOf(filter) !== -1
      );
    }

    if (filtered.length === 0) {
      emailBodyEl.innerHTML = '<div class="ss-dbg-empty">' + (filter ? 'No matching emails' : 'No emails captured yet') + '</div>';
      return;
    }

    let html = '<table class="ss-dbg-table"><thead><tr>'
      + '<th style="width:40px">#</th>'
      + '<th style="width:160px">From</th>'
      + '<th style="width:160px">To</th>'
      + '<th>Subject</th>'
      + '<th style="width:60px">Status</th>'
      + '<th style="width:60px">Mailer</th>'
      + '<th style="width:30px" title="Attachments">&#x1F4CE;</th>'
      + '<th style="width:70px">Time</th>'
      + '</tr></thead><tbody>';

    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i];
      html += '<tr class="ss-dbg-email-row" data-email-id="' + e.id + '">'
        + '<td style="color:#525252">' + e.id + '</td>'
        + '<td style="color:#a3a3a3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="' + esc(e.from) + '">' + esc(e.from) + '</td>'
        + '<td style="color:#a3a3a3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="' + esc(e.to) + '">' + esc(e.to) + '</td>'
        + '<td style="color:#93c5fd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.subject) + '</td>'
        + '<td><span class="ss-dbg-email-status ss-dbg-email-status-' + esc(e.status) + '">' + esc(e.status) + '</span></td>'
        + '<td style="color:#737373">' + esc(e.mailer) + '</td>'
        + '<td style="color:#525252;text-align:center">' + (e.attachmentCount > 0 ? e.attachmentCount : '-') + '</td>'
        + '<td class="ss-dbg-event-time">' + timeAgo(e.timestamp) + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    emailBodyEl.innerHTML = html;

    // Click row to open preview
    emailBodyEl.querySelectorAll('.ss-dbg-email-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-email-id');
        showEmailPreview(id, filtered);
      });
    });
  };

  const showEmailPreview = (id, emails) => {
    if (!emailPreviewEl || !emailIframe || !emailPreviewMeta) return;
    const email = emails.find((e) => String(e.id) === String(id));

    if (emailPreviewMeta && email) {
      emailPreviewMeta.innerHTML =
        '<strong>Subject:</strong> ' + esc(email.subject)
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>From:</strong> ' + esc(email.from)
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>To:</strong> ' + esc(email.to)
        + (email.cc ? '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>CC:</strong> ' + esc(email.cc) : '')
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Status:</strong> <span class="ss-dbg-email-status ss-dbg-email-status-' + esc(email.status) + '">' + esc(email.status) + '</span>'
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Mailer:</strong> ' + esc(email.mailer);
    }

    emailIframe.src = BASE + '/emails/' + id + '/preview';
    emailPreviewEl.style.display = 'flex';
  };

  if (emailPreviewClose) {
    emailPreviewClose.addEventListener('click', () => {
      if (emailPreviewEl) emailPreviewEl.style.display = 'none';
      if (emailIframe) emailIframe.src = 'about:blank';
    });
  }

  if (emailSearchInput) emailSearchInput.addEventListener('input', renderEmails);
  if (emailClearBtn) {
    emailClearBtn.addEventListener('click', () => {
      cachedEmails = { emails: [], total: 0 };
      renderEmails();
    });
  }

  // ── Timeline Tab ────────────────────────────────────────────────
  const tlSearchInput = document.getElementById('ss-dbg-search-timeline');
  const tlSummaryEl = document.getElementById('ss-dbg-timeline-summary');
  const tlBodyEl = document.getElementById('ss-dbg-timeline-body');
  const tlListEl = document.getElementById('ss-dbg-timeline-list');
  const tlDetailEl = document.getElementById('ss-dbg-timeline-detail');
  const tlBackBtn = document.getElementById('ss-dbg-tl-back');
  const tlDetailTitle = document.getElementById('ss-dbg-tl-detail-title');
  const tlWaterfall = document.getElementById('ss-dbg-tl-waterfall');
  let cachedTraces = { traces: [], total: 0 };

  const statusClass = (code) => {
    if (code >= 500) return 'ss-dbg-status-5xx';
    if (code >= 400) return 'ss-dbg-status-4xx';
    if (code >= 300) return 'ss-dbg-status-3xx';
    return 'ss-dbg-status-2xx';
  };

  const fetchTraces = () => {
    if (!tracingEnabled) return;
    fetchJSON(BASE + '/traces')
      .then((data) => {
        cachedTraces = data;
        renderTraces();
      })
      .catch(() => {
        if (tlBodyEl) tlBodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load traces</div>';
      });
  };

  const renderTraces = () => {
    if (!tlBodyEl) return;
    const filter = (tlSearchInput ? tlSearchInput.value : '').toLowerCase();
    const traces = cachedTraces.traces || [];

    if (tlSummaryEl) {
      tlSummaryEl.textContent = cachedTraces.total + ' requests';
    }

    let filtered = traces;
    if (filter) {
      filtered = traces.filter((t) =>
        t.url.toLowerCase().indexOf(filter) !== -1
        || t.method.toLowerCase().indexOf(filter) !== -1
      );
    }

    if (filtered.length === 0) {
      tlBodyEl.innerHTML = '<div class="ss-dbg-empty">' + (filter ? 'No matching requests' : 'No requests traced yet') + '</div>';
      return;
    }

    let html = '<table class="ss-dbg-table"><thead><tr>'
      + '<th style="width:40px">#</th>'
      + '<th style="width:60px">Method</th>'
      + '<th>URL</th>'
      + '<th style="width:55px">Status</th>'
      + '<th style="width:70px">Duration</th>'
      + '<th style="width:50px">Spans</th>'
      + '<th style="width:30px" title="Warnings">&#x26A0;</th>'
      + '<th style="width:70px">Time</th>'
      + '</tr></thead><tbody>';

    for (let i = 0; i < filtered.length; i++) {
      const t = filtered[i];
      html += '<tr class="ss-dbg-email-row" data-trace-id="' + t.id + '">'
        + '<td style="color:#525252">' + t.id + '</td>'
        + '<td><span class="' + methodClass(t.method) + '">' + esc(t.method) + '</span></td>'
        + '<td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px" title="' + esc(t.url) + '">' + esc(t.url) + '</td>'
        + '<td><span class="ss-dbg-status ' + statusClass(t.statusCode) + '">' + t.statusCode + '</span></td>'
        + '<td class="ss-dbg-duration ' + durationClass(t.totalDuration) + '">' + t.totalDuration.toFixed(1) + 'ms</td>'
        + '<td style="color:#737373;text-align:center">' + t.spanCount + '</td>'
        + '<td style="text-align:center">' + (t.warningCount > 0 ? '<span style="color:#fbbf24">' + t.warningCount + '</span>' : '<span style="color:#333">-</span>') + '</td>'
        + '<td class="ss-dbg-event-time">' + timeAgo(t.timestamp) + '</td>'
        + '</tr>';
    }

    html += '</tbody></table>';
    tlBodyEl.innerHTML = html;

    // Click row to open detail
    tlBodyEl.querySelectorAll('[data-trace-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-trace-id');
        fetchTraceDetail(id);
      });
    });
  };

  const fetchTraceDetail = (id) => {
    fetchJSON(BASE + '/traces/' + id)
      .then((trace) => {
        showTimeline(trace);
      })
      .catch(() => {
        if (tlWaterfall) tlWaterfall.innerHTML = '<div class="ss-dbg-empty">Failed to load trace</div>';
      });
  };

  const showTimeline = (trace) => {
    if (!tlListEl || !tlDetailEl || !tlDetailTitle || !tlWaterfall) return;

    tlListEl.style.display = 'none';
    tlDetailEl.style.display = '';

    tlDetailTitle.innerHTML =
      '<span class="' + methodClass(trace.method) + '">' + esc(trace.method) + '</span> '
      + esc(trace.url) + ' '
      + '<span class="ss-dbg-status ' + statusClass(trace.statusCode) + '">' + trace.statusCode + '</span>'
      + '<span class="ss-dbg-tl-meta">' + trace.totalDuration.toFixed(1) + 'ms &middot; '
      + trace.spanCount + ' spans &middot; '
      + formatTime(trace.timestamp) + '</span>';

    const spans = trace.spans || [];
    const total = trace.totalDuration || 1;

    // Legend
    let html = '<div class="ss-dbg-tl-legend">'
      + '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#6d28d9"></span>DB</div>'
      + '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#1e3a5f"></span>Request</div>'
      + '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#059669"></span>Mail</div>'
      + '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#b45309"></span>Event</div>'
      + '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#0e7490"></span>View</div>'
      + '<div class="ss-dbg-tl-legend-item"><span class="ss-dbg-tl-legend-dot" style="background:#525252"></span>Custom</div>'
      + '</div>';

    if (spans.length === 0) {
      html += '<div class="ss-dbg-empty">No spans captured for this request</div>';
    } else {
      // Build nesting depth from parentId
      const depthMap = {};
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        if (!s.parentId) {
          depthMap[s.id] = 0;
        } else {
          depthMap[s.id] = (depthMap[s.parentId] || 0) + 1;
        }
      }

      // Sort by startOffset
      const sorted = spans.slice().sort((a, b) => a.startOffset - b.startOffset);

      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const depth = depthMap[s.id] || 0;
        const leftPct = (s.startOffset / total * 100).toFixed(2);
        const widthPct = Math.max(s.duration / total * 100, 0.5).toFixed(2);
        const indent = depth * 16;
        const catLabel = s.category === 'db' ? 'DB' : s.category;
        const metaStr = s.metadata ? Object.entries(s.metadata).filter(([,v]) => v != null).map(([k,v]) => k + '=' + v).join(', ') : '';
        const tooltip = s.label + ' (' + s.duration.toFixed(2) + 'ms)' + (metaStr ? '\n' + metaStr : '');

        html += '<div class="ss-dbg-tl-row">'
          + '<div class="ss-dbg-tl-label" style="padding-left:' + (8 + indent) + 'px" title="' + esc(tooltip) + '">'
          + '<span class="ss-dbg-badge ss-dbg-badge-' + (s.category === 'db' ? 'purple' : s.category === 'mail' ? 'green' : s.category === 'event' ? 'amber' : s.category === 'view' ? 'blue' : 'muted') + '" style="font-size:9px;margin-right:4px">' + esc(catLabel) + '</span>'
          + esc(s.label.length > 40 ? s.label.slice(0, 40) + '...' : s.label)
          + '</div>'
          + '<div class="ss-dbg-tl-track">'
          + '<div class="ss-dbg-tl-bar ss-dbg-tl-bar-' + esc(s.category) + '" style="left:' + leftPct + '%;width:' + widthPct + '%" title="' + esc(tooltip) + '"></div>'
          + '</div>'
          + '<span class="ss-dbg-tl-dur">' + s.duration.toFixed(2) + 'ms</span>'
          + '</div>';
      }
    }

    // Warnings
    if (trace.warnings && trace.warnings.length > 0) {
      html += '<div class="ss-dbg-tl-warnings">'
        + '<div class="ss-dbg-tl-warnings-title">Warnings (' + trace.warnings.length + ')</div>';
      for (let w = 0; w < trace.warnings.length; w++) {
        html += '<div class="ss-dbg-tl-warning">' + esc(trace.warnings[w]) + '</div>';
      }
      html += '</div>';
    }

    tlWaterfall.innerHTML = html;
  };

  if (tlBackBtn) {
    tlBackBtn.addEventListener('click', () => {
      if (tlListEl) tlListEl.style.display = '';
      if (tlDetailEl) tlDetailEl.style.display = 'none';
    });
  }

  if (tlSearchInput) tlSearchInput.addEventListener('input', renderTraces);

  // ── Custom panes: fetch, render, bind ───────────────────────────
  const getNestedValue = (obj, path) => {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  };

  const fetchCustomPane = (pane) => {
    const bodyEl = document.getElementById('ss-dbg-' + pane.id + '-body');
    fetchJSON(pane.endpoint)
      .then((data) => {
        const key = pane.dataKey || pane.id;
        const rows = getNestedValue(data, key) || (Array.isArray(data) ? data : []);
        customPaneState[pane.id].data = rows;
        customPaneState[pane.id].fetched = true;
        renderCustomPane(pane);
      })
      .catch(() => {
        if (bodyEl) bodyEl.innerHTML = '<div class="ss-dbg-empty">Failed to load ' + esc(pane.label) + '</div>';
      });
  };

  const renderCustomPane = (pane) => {
    const state = customPaneState[pane.id];
    if (!state) return;
    const bodyEl = document.getElementById('ss-dbg-' + pane.id + '-body');
    const summaryEl = document.getElementById('ss-dbg-' + pane.id + '-summary');
    if (!bodyEl) return;

    const filter = state.filter.toLowerCase();
    let rows = state.data;

    if (summaryEl) {
      summaryEl.textContent = rows.length + ' ' + pane.label.toLowerCase();
    }

    if (filter) {
      const searchCols = pane.columns.filter((c) => c.searchable);
      if (searchCols.length > 0) {
        rows = rows.filter((row) =>
          searchCols.some((c) => {
            const v = row[c.key];
            return v != null && String(v).toLowerCase().indexOf(filter) !== -1;
          })
        );
      }
    }

    if (rows.length === 0) {
      bodyEl.innerHTML = '<div class="ss-dbg-empty">' + (filter ? 'No matching ' + esc(pane.label.toLowerCase()) : 'No ' + esc(pane.label.toLowerCase()) + ' recorded yet') + '</div>';
      return;
    }

    let html = '<table class="ss-dbg-table"><thead><tr>';
    for (let c = 0; c < pane.columns.length; c++) {
      const col = pane.columns[c];
      html += '<th' + (col.width ? ' style="width:' + col.width + '"' : '') + '>' + esc(col.label) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let r = 0; r < rows.length; r++) {
      html += '<tr>';
      for (let c = 0; c < pane.columns.length; c++) {
        const col = pane.columns[c];
        const val = rows[r][col.key];
        const cellHtml = formatCell(val, col);
        if (col.filterable && val != null) {
          html += '<td class="ss-dbg-filterable" data-ss-filter-key="' + esc(col.key) + '" data-ss-filter-val="' + esc(String(val)) + '">' + cellHtml + '</td>';
        } else {
          html += '<td>' + cellHtml + '</td>';
        }
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    bodyEl.innerHTML = html;

    // Bind click-to-filter on filterable cells
    bodyEl.querySelectorAll('.ss-dbg-filterable').forEach((td) => {
      td.style.cursor = 'pointer';
      td.addEventListener('click', () => {
        const val = td.getAttribute('data-ss-filter-val');
        const searchInput = document.getElementById('ss-dbg-search-' + pane.id);
        if (searchInput) {
          searchInput.value = val;
          state.filter = val;
          renderCustomPane(pane);
        }
      });
    });
  };

  // Bind search + clear for each custom pane
  for (let i = 0; i < customPanes.length; i++) {
    const cp = customPanes[i];
    const searchInput = document.getElementById('ss-dbg-search-' + cp.id);
    const clearBtn = document.getElementById('ss-dbg-' + cp.id + '-clear');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        customPaneState[cp.id].filter = searchInput.value;
        renderCustomPane(cp);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        customPaneState[cp.id].data = [];
        customPaneState[cp.id].fetched = false;
        if (searchInput) searchInput.value = '';
        customPaneState[cp.id].filter = '';
        renderCustomPane(cp);
      });
    }
  }

  // ── Auto-refresh ────────────────────────────────────────────────
  const startRefresh = () => {
    stopRefresh();
    refreshTimer = setInterval(() => {
      if (!isOpen) return;
      loadTab(activeTab);
    }, REFRESH_INTERVAL);
  };

  const stopRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };

  // ── Stats bar query badge (always visible) ──────────────────────
  const updateBarQueryBadge = () => {
    const el = document.getElementById('ss-b-dbg-queries');
    if (!el) return;

    fetchJSON(BASE + '/queries')
      .then((data) => {
        const s = data.summary || {};
        const valEl = el.querySelector('.ss-value');
        if (valEl) {
          valEl.textContent = (s.total || 0) + ' / ' + (s.avgDuration || 0).toFixed(1) + 'ms';
          valEl.className = 'ss-value ' + (s.slow > 0 ? 'ss-amber' : 'ss-green');
        }
      })
      .catch(() => {});
  };

  updateBarQueryBadge();
  setInterval(updateBarQueryBadge, 5000);
})();
