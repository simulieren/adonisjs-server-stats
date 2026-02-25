/**
 * Client-side SPA for the server-stats full-page dashboard.
 *
 * Config is read from:
 *   - data-path on #ss-dash — dashboard base path (e.g. "/__stats")
 *   - data-tracing on #ss-dash — "1" if tracing enabled
 *   - <script id="ss-dash-config"> — JSON config object
 *
 * Hash-based routing: #overview, #requests, #queries, etc.
 * Deep link support: #queries?id=42, #logs?requestId=abc123
 */
(function () {
  var root = document.getElementById('ss-dash');
  if (!root) return;

  var BASE = (root.dataset.path || '/__stats').replace(/\/+$/, '');
  var API = BASE + '/api';
  var tracingEnabled = root.dataset.tracing === '1';

  // Config from JSON script tag
  var dashConfig = {};
  try {
    var cfgEl = document.getElementById('ss-dash-config');
    if (cfgEl) dashConfig = JSON.parse(cfgEl.textContent || '{}');
  } catch (e) { /* ignore */ }

  var customPanes = dashConfig.customPanes || [];

  // ── Helpers ───────────────────────────────────────────────────
  var esc = function (s) {
    if (typeof s !== 'string') s = '' + s;
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  var timeAgo = function (ts) {
    if (!ts) return '-';
    var d = typeof ts === 'string' ? new Date(ts).getTime() : ts;
    var diff = Math.floor((Date.now() - d) / 1000);
    if (diff < 0) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  };

  var formatTime = function (ts) {
    var d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  };

  var methodClass = function (m) {
    return 'ss-dash-method ss-dash-method-' + (typeof m === 'string' ? m.toLowerCase() : '');
  };

  var durationClass = function (ms) {
    if (ms > 500) return 'ss-dash-very-slow';
    if (ms > 100) return 'ss-dash-slow';
    return '';
  };

  var statusClass = function (code) {
    if (code >= 500) return 'ss-dash-status-5xx';
    if (code >= 400) return 'ss-dash-status-4xx';
    if (code >= 300) return 'ss-dash-status-3xx';
    return 'ss-dash-status-2xx';
  };

  var compactPreview = function (val, maxLen) {
    if (val === null) return 'null';
    if (typeof val === 'string') return '"' + (val.length > 40 ? val.slice(0, 40) + '...' : val) + '"';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      var items = val.slice(0, 3).map(function (v) { return compactPreview(v, 30); });
      var s = '[' + items.join(', ') + (val.length > 3 ? ', ...' + val.length + ' items' : '') + ']';
      return s.length > maxLen ? '[' + val.length + ' items]' : s;
    }
    if (typeof val === 'object') {
      var keys = Object.keys(val);
      if (keys.length === 0) return '{}';
      var pairs = [];
      for (var i = 0; i < Math.min(keys.length, 4); i++) {
        pairs.push(keys[i] + ': ' + compactPreview(val[keys[i]], 30));
      }
      var s2 = '{ ' + pairs.join(', ') + (keys.length > 4 ? ', ...+' + (keys.length - 4) : '') + ' }';
      return s2.length > maxLen ? '{ ' + keys.slice(0, 6).join(', ') + (keys.length > 6 ? ', ...' : '') + ' }' : s2;
    }
    return String(val);
  };

  var eventPreview = function (data) {
    if (!data) return '-';
    try {
      var parsed = typeof data === 'string' ? JSON.parse(data) : data;
      return compactPreview(parsed, 100);
    } catch (e) {
      return data.length > 100 ? data.slice(0, 100) + '...' : data;
    }
  };

  var shortReqId = function (id) { return id ? id.slice(0, 8) : ''; };

  var formatCell = function (value, col) {
    if (value === null || value === undefined) return '<span style="color:var(--ss-dim)">-</span>';
    var fmt = col.format || 'text';
    switch (fmt) {
      case 'time': return typeof value === 'number' ? formatTime(value) : esc(value);
      case 'timeAgo': return '<span class="ss-dash-event-time">' + (typeof value === 'number' ? timeAgo(value) : esc(value)) + '</span>';
      case 'duration': {
        var ms = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(ms)) return esc(value);
        return '<span class="ss-dash-duration ' + durationClass(ms) + '">' + ms.toFixed(2) + 'ms</span>';
      }
      case 'method': return '<span class="' + methodClass(value) + '">' + esc(value) + '</span>';
      case 'json': {
        if (typeof value === 'string') { try { value = JSON.parse(value); } catch (e) { /* use as-is */ } }
        var preview = typeof value === 'object' ? compactPreview(value, 100) : String(value);
        return '<span class="ss-dash-data-preview" style="cursor:default">' + esc(preview) + '</span>';
      }
      case 'badge': {
        var sv = String(value).toLowerCase();
        var colorMap = col.badgeColorMap || {};
        var color = colorMap[sv] || 'muted';
        return '<span class="ss-dash-badge ss-dash-badge-' + esc(color) + '">' + esc(value) + '</span>';
      }
      default: return esc(value);
    }
  };

  // ── State ─────────────────────────────────────────────────────
  var activeSection = 'overview';
  var sidebarCollapsed = localStorage.getItem('ss-dash-sidebar') === 'collapsed';
  var refreshTimer = null;
  var transmitSub = null;
  var isLive = false;

  // Per-section pagination state
  var pageState = {};
  var PER_PAGE = 50;

  var getPage = function (section) {
    if (!pageState[section]) pageState[section] = { page: 1, total: 0 };
    return pageState[section];
  };

  // ── Fetch helper ──────────────────────────────────────────────
  var fetchJSON = function (url) {
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
  };

  // ── Theme ─────────────────────────────────────────────────────
  var themeOverride = localStorage.getItem('ss-dash-theme');
  var themeBtn = document.getElementById('ss-dash-theme-btn');

  var applyTheme = function () {
    if (themeOverride) {
      root.setAttribute('data-theme', themeOverride);
    } else {
      root.removeAttribute('data-theme');
    }
    if (themeBtn) {
      var isDark = themeOverride === 'dark' || (!themeOverride && window.matchMedia('(prefers-color-scheme: dark)').matches);
      themeBtn.textContent = isDark ? '\u2600' : '\u263D';
      themeBtn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    }
  };

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var isDark = themeOverride === 'dark' || (!themeOverride && window.matchMedia('(prefers-color-scheme: dark)').matches);
      themeOverride = isDark ? 'light' : 'dark';
      localStorage.setItem('ss-dash-theme', themeOverride);
      applyTheme();
    });
  }
  applyTheme();

  // ── Sidebar ───────────────────────────────────────────────────
  var sidebar = document.getElementById('ss-dash-sidebar');
  var sidebarToggle = document.getElementById('ss-dash-sidebar-toggle');
  var navItems = root.querySelectorAll('[data-ss-section]');

  var applySidebar = function () {
    if (sidebar) sidebar.classList.toggle('ss-dash-collapsed', sidebarCollapsed);
    if (sidebarToggle) sidebarToggle.innerHTML = sidebarCollapsed
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18l6-6-6-6"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 18l-6-6 6-6"/></svg>';
  };

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function () {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem('ss-dash-sidebar', sidebarCollapsed ? 'collapsed' : 'expanded');
      applySidebar();
    });
  }
  applySidebar();

  // ── Section switching ─────────────────────────────────────────
  var switchSection = function (name) {
    if (name === activeSection) return;

    navItems.forEach(function (item) {
      item.classList.toggle('ss-dash-active', item.getAttribute('data-ss-section') === name);
    });
    root.querySelectorAll('.ss-dash-pane').forEach(function (p) {
      p.classList.toggle('ss-dash-active', p.id === 'ss-dash-pane-' + name);
    });

    activeSection = name;
    location.hash = name;
    loadSection(name);
    startRefresh();
  };

  navItems.forEach(function (item) {
    item.addEventListener('click', function () {
      switchSection(item.getAttribute('data-ss-section'));
    });
  });

  // ── Data loading ──────────────────────────────────────────────
  var sectionLoaded = {};

  var loadSection = function (name) {
    switch (name) {
      case 'overview': fetchOverview(); break;
      case 'requests': fetchRequests(); break;
      case 'queries': fetchQueries(); break;
      case 'events': fetchEvents(); break;
      case 'routes':
        if (!sectionLoaded.routes) fetchRoutes();
        break;
      case 'logs': fetchLogs(); break;
      case 'emails': fetchEmails(); break;
      case 'timeline': fetchTraces(); break;
      case 'cache': fetchCache(); break;
      case 'jobs': fetchJobs(); break;
      case 'config':
        if (!sectionLoaded.config) fetchConfig();
        break;
      default: {
        var cp = customPanes.find(function (p) { return p.id === name; });
        if (cp) fetchCustomPane(cp);
      }
    }
  };

  // ── Overview ──────────────────────────────────────────────────
  var overviewRange = '1h';

  var fetchOverview = function () {
    Promise.all([
      fetchJSON(API + '/overview?range=' + overviewRange),
      fetchJSON(API + '/overview/chart?range=' + overviewRange)
    ])
      .then(function (results) { renderOverview(results[0], results[1]); })
      .catch(function () {
        var el = document.getElementById('ss-dash-overview-content');
        if (el) el.innerHTML = '<div class="ss-dash-empty">Failed to load overview</div>';
      });
  };

  // Cache chart data so live updates don't wipe the chart
  var lastChartData = [];
  var lastSparklines = {};

  var renderOverview = function (data, chartData) {
    var el = document.getElementById('ss-dash-overview-content');
    if (!el) return;

    // Preserve sparklines and chart from previous full fetch when live data arrives
    if (data.sparklines) lastSparklines = data.sparklines;
    var sparklines = data.sparklines || lastSparklines;
    if (chartData && chartData.buckets && chartData.buckets.length > 0) lastChartData = chartData.buckets;
    var chart = (chartData && chartData.buckets) || lastChartData;
    var slowest = data.slowestEndpoints || [];
    var queryStats = data.queryStats || {};
    var recentErrors = data.recentErrors || [];
    var topEvents = data.topEvents || [];
    var emailActivity = data.emailActivity || {};
    var logLevelBreakdown = data.logLevelBreakdown || {};
    var cacheStats = data.cacheStats || null;
    var jobQueueStatus = data.jobQueueStatus || null;
    var statusDistribution = data.statusDistribution || {};
    var slowQueries = data.slowestQueries || [];

    var avgVal = data.avgResponseTime || 0;
    var p95Val = data.p95ResponseTime || 0;
    var rpmVal = data.requestsPerMinute || 0;
    var errVal = data.errorRate || 0;
    var hasData = (data.totalRequests || 0) > 0;

    var avgClass = avgVal > 500 ? 'ss-dash-red' : avgVal > 200 ? 'ss-dash-amber' : 'ss-dash-accent';
    var p95Class = p95Val > 500 ? 'ss-dash-red' : p95Val > 200 ? 'ss-dash-amber' : 'ss-dash-accent';
    var errClass = errVal > 5 ? 'ss-dash-red' : errVal > 1 ? 'ss-dash-amber' : 'ss-dash-accent';

    var fmtMs = function (v) { return hasData ? v.toFixed(1) + 'ms' : '-'; };
    var fmtNum = function (v) { return hasData ? String(Math.round(v * 10) / 10) : '-'; };
    var fmtPct = function (v) { return hasData ? v.toFixed(1) + '%' : '-'; };

    var html = '<div class="ss-dash-overview">';

    // Top cards
    html += '<div class="ss-dash-cards">';
    html += renderCard('Avg Response Time', fmtMs(avgVal), hasData ? avgClass : 'ss-dash-dim', sparklines.avgResponseTime);
    html += renderCard('P95 Response Time', fmtMs(p95Val), hasData ? p95Class : 'ss-dash-dim', sparklines.p95ResponseTime);
    html += renderCard('Requests / min', fmtNum(rpmVal), hasData ? 'ss-dash-accent' : 'ss-dash-dim', sparklines.requestsPerMinute);
    html += renderCard('Error Rate', fmtPct(errVal), hasData ? errClass : 'ss-dash-dim', sparklines.errorRate);
    html += '</div>';

    // Chart
    html += '<div class="ss-dash-chart-container">';
    html += '<div class="ss-dash-chart-header">';
    html += '<span class="ss-dash-chart-title">Request Volume</span>';
    html += '<div class="ss-dash-btn-group">';
    ['5m', '15m', '30m', '1h', '6h', '24h', '7d'].forEach(function (r) {
      html += '<button class="ss-dash-btn' + (r === overviewRange ? ' ss-dash-active' : '') + '" data-range="' + r + '">' + r + '</button>';
    });
    html += '</div></div>';
    html += '<div class="ss-dash-chart" id="ss-dash-chart-area"></div>';
    html += '</div>';

    // Secondary cards
    html += '<div class="ss-dash-secondary-cards">';

    // Slowest endpoints
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#requests" class="ss-dash-widget-link">Slowest Endpoints</a></div>';
    if (slowest.length > 0) {
      html += '<ul class="ss-dash-secondary-list">';
      slowest.forEach(function (ep) {
        var epUrl = ep.url || ep.pattern || '-';
        html += '<li><a href="#requests?url=' + encodeURIComponent(epUrl) + '" class="ss-dash-widget-row-link"><span title="' + esc(epUrl) + '">' + esc(epUrl) + '</span><span class="ss-dash-secondary-list-value ss-dash-duration ' + durationClass(ep.avgDuration || 0) + '">' + (ep.avgDuration || 0).toFixed(1) + 'ms</span></a></li>';
      });
      html += '</ul>';
    } else {
      html += '<div class="ss-dash-empty" style="min-height:60px">No data yet</div>';
    }
    html += '</div>';

    // Query stats
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#queries" class="ss-dash-widget-link">Query Stats</a></div>';
    html += '<ul class="ss-dash-secondary-list">';
    html += '<li><span>Total Queries</span><span class="ss-dash-secondary-list-value">' + (queryStats.total || 0) + '</span></li>';
    html += '<li><span>Avg Duration</span><span class="ss-dash-secondary-list-value">' + (queryStats.avgDuration || 0).toFixed(1) + 'ms</span></li>';
    html += '<li><span>Queries / Request</span><span class="ss-dash-secondary-list-value">' + (queryStats.perRequest || 0).toFixed(1) + '</span></li>';
    html += '</ul>';
    html += '</div>';

    // Recent errors
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#logs?level=error" class="ss-dash-widget-link">Recent Errors</a></div>';
    if (recentErrors.length > 0) {
      html += '<ul class="ss-dash-secondary-list">';
      recentErrors.forEach(function (err) {
        html += '<li><a href="#logs?id=' + encodeURIComponent(err.id || '') + '" class="ss-dash-widget-row-link"><span style="color:var(--ss-red-fg)" title="' + esc(err.message || '') + '">' + esc(err.message || '') + '</span><span class="ss-dash-secondary-list-value">' + timeAgo(err.createdAt || err.created_at || err.timestamp) + '</span></a></li>';
      });
      html += '</ul>';
    } else {
      html += '<div class="ss-dash-empty" style="min-height:60px">No recent errors</div>';
    }
    html += '</div>';

    // Top Events
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#events" class="ss-dash-widget-link">Top Events</a></div>';
    if (topEvents.length > 0) {
      html += '<ul class="ss-dash-secondary-list">';
      topEvents.slice(0, 5).forEach(function (ev) {
        html += '<li><a href="#events?event_name=' + encodeURIComponent(ev.name || ev.event || '') + '" class="ss-dash-widget-row-link"><span title="' + esc(ev.name || ev.event || '') + '">' + esc(ev.name || ev.event || '') + '</span><span class="ss-dash-secondary-list-value">' + (ev.count || 0) + '</span></a></li>';
      });
      html += '</ul>';
    } else {
      html += '<div class="ss-dash-empty" style="min-height:60px">No events yet</div>';
    }
    html += '</div>';

    // Email Activity
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#emails" class="ss-dash-widget-link">Email Activity</a></div>';
    html += '<ul class="ss-dash-secondary-list">';
    html += '<li><a href="#emails?status=sent" class="ss-dash-widget-row-link"><span>Sent</span><span class="ss-dash-secondary-list-value">' + (emailActivity.sent || 0) + '</span></a></li>';
    html += '<li><a href="#emails?status=queued" class="ss-dash-widget-row-link"><span>Queued</span><span class="ss-dash-secondary-list-value">' + (emailActivity.queued || 0) + '</span></a></li>';
    html += '<li><a href="#emails?status=failed" class="ss-dash-widget-row-link"><span>Failed</span><span class="ss-dash-secondary-list-value">' + (emailActivity.failed || 0) + '</span></a></li>';
    html += '</ul>';
    html += '</div>';

    // Log Level Breakdown
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#logs" class="ss-dash-widget-link">Log Levels</a></div>';
    html += '<ul class="ss-dash-secondary-list">';
    html += '<li><a href="#logs?level=error" class="ss-dash-widget-row-link"><span style="color:var(--ss-red-fg)">Error</span><span class="ss-dash-secondary-list-value">' + (logLevelBreakdown.error || 0) + '</span></a></li>';
    html += '<li><a href="#logs?level=warn" class="ss-dash-widget-row-link"><span style="color:var(--ss-amber-fg)">Warn</span><span class="ss-dash-secondary-list-value">' + (logLevelBreakdown.warn || 0) + '</span></a></li>';
    html += '<li><a href="#logs?level=info" class="ss-dash-widget-row-link"><span style="color:var(--ss-green-fg)">Info</span><span class="ss-dash-secondary-list-value">' + (logLevelBreakdown.info || 0) + '</span></a></li>';
    html += '<li><a href="#logs?level=debug" class="ss-dash-widget-row-link"><span style="color:var(--ss-muted)">Debug</span><span class="ss-dash-secondary-list-value">' + (logLevelBreakdown.debug || 0) + '</span></a></li>';
    html += '</ul>';
    html += '</div>';

    // Cache Stats
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#cache" class="ss-dash-widget-link">Cache</a></div>';
    if (cacheStats) {
      html += '<div class="ss-dash-widget-stat"><span class="ss-dash-widget-stat-label">Connected</span><span class="ss-dash-widget-stat-value" style="color:var(--ss-green-fg)">\u2713</span></div>';
      html += '<div class="ss-dash-widget-stat"><span class="ss-dash-widget-stat-label">Total Keys</span><span class="ss-dash-widget-stat-value">' + (cacheStats.totalKeys || 0) + '</span></div>';
      html += '<div class="ss-dash-widget-stat"><span class="ss-dash-widget-stat-label">Hit Rate</span><span class="ss-dash-widget-stat-value">' + (cacheStats.hitRate || 0).toFixed(1) + '%</span></div>';
      html += '<div class="ss-dash-widget-stat"><span class="ss-dash-widget-stat-label">Memory</span><span class="ss-dash-widget-stat-value">' + esc(cacheStats.memory || '-') + '</span></div>';
    } else {
      html += '<div class="ss-dash-empty" style="min-height:60px">Not available</div>';
    }
    html += '</div>';

    // Job Queue
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#jobs" class="ss-dash-widget-link">Job Queue</a></div>';
    if (jobQueueStatus) {
      html += '<ul class="ss-dash-secondary-list">';
      html += '<li><a href="#jobs?status=active" class="ss-dash-widget-row-link"><span>Active</span><span class="ss-dash-secondary-list-value">' + (jobQueueStatus.active || 0) + '</span></a></li>';
      html += '<li><a href="#jobs?status=waiting" class="ss-dash-widget-row-link"><span>Waiting</span><span class="ss-dash-secondary-list-value">' + (jobQueueStatus.waiting || 0) + '</span></a></li>';
      html += '<li><a href="#jobs?status=failed" class="ss-dash-widget-row-link"><span>Failed</span><span class="ss-dash-secondary-list-value">' + (jobQueueStatus.failed || 0) + '</span></a></li>';
      html += '<li><a href="#jobs?status=completed" class="ss-dash-widget-row-link"><span>Completed</span><span class="ss-dash-secondary-list-value">' + (jobQueueStatus.completed || 0) + '</span></a></li>';
      html += '</ul>';
    } else {
      html += '<div class="ss-dash-empty" style="min-height:60px">Not available</div>';
    }
    html += '</div>';

    // Response Status
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#requests" class="ss-dash-widget-link">Response Status</a></div>';
    html += '<ul class="ss-dash-secondary-list">';
    html += '<li><a href="#requests?status=2xx" class="ss-dash-widget-row-link"><span style="color:var(--ss-green-fg)">2xx</span><span class="ss-dash-secondary-list-value">' + (statusDistribution['2xx'] || 0) + '</span></a></li>';
    html += '<li><a href="#requests?status=3xx" class="ss-dash-widget-row-link"><span style="color:var(--ss-blue-fg)">3xx</span><span class="ss-dash-secondary-list-value">' + (statusDistribution['3xx'] || 0) + '</span></a></li>';
    html += '<li><a href="#requests?status=4xx" class="ss-dash-widget-row-link"><span style="color:var(--ss-amber-fg)">4xx</span><span class="ss-dash-secondary-list-value">' + (statusDistribution['4xx'] || 0) + '</span></a></li>';
    html += '<li><a href="#requests?status=5xx" class="ss-dash-widget-row-link"><span style="color:var(--ss-red-fg)">5xx</span><span class="ss-dash-secondary-list-value">' + (statusDistribution['5xx'] || 0) + '</span></a></li>';
    html += '</ul>';
    html += '</div>';

    // Slowest Queries
    html += '<div class="ss-dash-secondary-card">';
    html += '<div class="ss-dash-secondary-card-title"><a href="#queries" class="ss-dash-widget-link">Slowest Queries</a></div>';
    if (slowQueries.length > 0) {
      html += '<ul class="ss-dash-secondary-list">';
      slowQueries.slice(0, 5).forEach(function (q) {
        var sql = q.normalizedSql || q.sql || '-';
        html += '<li><a href="#queries" class="ss-dash-widget-row-link"><span title="' + esc(sql) + '">' + esc(sql) + '</span><span class="ss-dash-secondary-list-value ss-dash-duration ' + durationClass(q.avgDuration || 0) + '">' + (q.avgDuration || 0).toFixed(1) + 'ms</span></a></li>';
      });
      html += '</ul>';
    } else {
      html += '<div class="ss-dash-empty" style="min-height:60px">No queries yet</div>';
    }
    html += '</div>';

    html += '</div></div>';
    el.innerHTML = html;

    // Bind range buttons
    el.querySelectorAll('[data-range]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        overviewRange = btn.getAttribute('data-range');
        fetchOverview();
      });
    });

    // Render SVG chart
    if (chart.length > 0) renderBarChart(chart);
  };

  var renderCard = function (title, value, colorClass, sparkline) {
    var html = '<div class="ss-dash-card">';
    html += '<div class="ss-dash-card-title">' + esc(title) + '</div>';
    html += '<div class="ss-dash-card-value ' + colorClass + '">' + esc(value) + '</div>';
    if (sparkline && sparkline.length > 1) {
      html += '<div class="ss-dash-sparkline">' + renderSparklineSVG(sparkline) + '</div>';
    }
    html += '</div>';
    return html;
  };

  var renderSparklineSVG = function (points) {
    var w = 200, h = 30;
    var max = Math.max.apply(null, points) || 1;
    var step = w / (points.length - 1);

    var coords = points.map(function (v, i) {
      return (i * step).toFixed(1) + ',' + (h - (v / max * h * 0.9 + h * 0.05)).toFixed(1);
    });
    var pathD = 'M' + coords.join(' L');
    var areaD = pathD + ' L' + w + ',' + h + ' L0,' + h + ' Z';

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
      + '<path class="ss-dash-sparkline-area" d="' + areaD + '"/>'
      + '<path class="ss-dash-sparkline-line" d="' + pathD + '"/>'
      + '</svg>';
  };

  var renderBarChart = function (data) {
    var container = document.getElementById('ss-dash-chart-area');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="ss-dash-empty" style="height:100%;display:flex;align-items:center;justify-content:center">No chart data for this range</div>';
      return;
    }

    var w = container.clientWidth || 600;
    var h = container.clientHeight || 200;
    var pad = { top: 12, right: 12, bottom: 28, left: 38 };
    var cw = w - pad.left - pad.right;
    var ch = h - pad.top - pad.bottom;

    var maxCount = 0;
    data.forEach(function (d) {
      var total = (d.requestCount || 0) + (d.request_count || 0);
      if (total > maxCount) maxCount = total;
    });
    // Add 10% headroom so bars don't touch the top
    var yMax = maxCount > 0 ? Math.ceil(maxCount * 1.1) : 1;

    // Choose nice Y-axis tick values
    var yTicks = niceYTicks(yMax, 4);
    var yTop = yTicks[yTicks.length - 1] || yMax;

    var toY = function (val) { return pad.top + ch - (val / yTop) * ch; };
    var toX = function (i) { return pad.left + (i / (data.length - 1 || 1)) * cw; };

    // Build point arrays for the area chart
    var totalPoints = [];
    var errorPoints = [];
    data.forEach(function (d, i) {
      var total = (d.requestCount || 0) + (d.request_count || 0);
      var errors = (d.errorCount || 0) + (d.error_count || 0);
      totalPoints.push({ x: toX(i), y: toY(total), val: total });
      errorPoints.push({ x: toX(i), y: toY(errors), val: errors });
    });

    // Smooth curve helper (monotone cubic spline)
    var smoothPath = function (points) {
      if (points.length < 2) return '';
      if (points.length === 2) return 'M' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1) + 'L' + points[1].x.toFixed(1) + ',' + points[1].y.toFixed(1);

      var d = 'M' + points[0].x.toFixed(1) + ',' + points[0].y.toFixed(1);
      for (var pi = 1; pi < points.length; pi++) {
        var p0 = points[pi - 1];
        var p1 = points[pi];
        var cpx = (p0.x + p1.x) / 2;
        d += ' C' + cpx.toFixed(1) + ',' + p0.y.toFixed(1) + ' ' + cpx.toFixed(1) + ',' + p1.y.toFixed(1) + ' ' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1);
      }
      return d;
    };

    var baseline = pad.top + ch;

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ss-dash-chart-svg">';

    // Defs: gradients
    svg += '<defs>';
    svg += '<linearGradient id="ss-cg-total" x1="0" y1="0" x2="0" y2="1">';
    svg += '<stop offset="0%" stop-color="var(--ss-accent)" stop-opacity="0.3"/>';
    svg += '<stop offset="100%" stop-color="var(--ss-accent)" stop-opacity="0.02"/>';
    svg += '</linearGradient>';
    svg += '<linearGradient id="ss-cg-error" x1="0" y1="0" x2="0" y2="1">';
    svg += '<stop offset="0%" stop-color="var(--ss-red-fg)" stop-opacity="0.35"/>';
    svg += '<stop offset="100%" stop-color="var(--ss-red-fg)" stop-opacity="0.02"/>';
    svg += '</linearGradient>';
    svg += '</defs>';

    // Horizontal grid lines
    yTicks.forEach(function (val) {
      var yy = toY(val);
      svg += '<line x1="' + pad.left + '" y1="' + yy.toFixed(1) + '" x2="' + (w - pad.right) + '" y2="' + yy.toFixed(1) + '" stroke="var(--ss-border-faint)" stroke-width="0.5" stroke-dasharray="3,3"/>';
      svg += '<text x="' + (pad.left - 6) + '" y="' + yy.toFixed(1) + '" text-anchor="end" fill="var(--ss-dim)" font-size="9" dominant-baseline="middle">' + val + '</text>';
    });

    // Total requests: filled area + line
    var totalPath = smoothPath(totalPoints);
    if (totalPath) {
      var last = totalPoints[totalPoints.length - 1];
      var first = totalPoints[0];
      svg += '<path d="' + totalPath + ' L' + last.x.toFixed(1) + ',' + baseline + ' L' + first.x.toFixed(1) + ',' + baseline + ' Z" fill="url(#ss-cg-total)"/>';
      svg += '<path d="' + totalPath + '" fill="none" stroke="var(--ss-accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }

    // Error requests: filled area + line (if any errors)
    var hasErrors = errorPoints.some(function (p) { return p.val > 0; });
    if (hasErrors) {
      var errorPath = smoothPath(errorPoints);
      if (errorPath) {
        var eLast = errorPoints[errorPoints.length - 1];
        var eFirst = errorPoints[0];
        svg += '<path d="' + errorPath + ' L' + eLast.x.toFixed(1) + ',' + baseline + ' L' + eFirst.x.toFixed(1) + ',' + baseline + ' Z" fill="url(#ss-cg-error)"/>';
        svg += '<path d="' + errorPath + '" fill="none" stroke="var(--ss-red-fg)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="4,2"/>';
      }
    }

    // Interactive dots and hover zones
    data.forEach(function (d, i) {
      var total = (d.requestCount || 0) + (d.request_count || 0);
      var errors = (d.errorCount || 0) + (d.error_count || 0);
      var success = total - errors;
      var cx = totalPoints[i].x;
      var cy = totalPoints[i].y;

      // Invisible wide hover target
      var sliceW = cw / (data.length || 1);
      svg += '<rect x="' + (cx - sliceW / 2).toFixed(1) + '" y="' + pad.top + '" width="' + sliceW.toFixed(1) + '" height="' + ch + '" fill="transparent" class="ss-dash-chart-hover-zone" data-idx="' + i + '"/>';

      // Visible dot (only for non-zero)
      if (total > 0) {
        svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.5" fill="var(--ss-accent)" stroke="var(--ss-surface)" stroke-width="1" class="ss-dash-chart-dot" data-idx="' + i + '"/>';
      }
      if (errors > 0) {
        var ey = errorPoints[i].y;
        svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="2" fill="var(--ss-red-fg)" stroke="var(--ss-surface)" stroke-width="1" class="ss-dash-chart-dot ss-dash-chart-dot-err" data-idx="' + i + '"/>';
      }
    });

    // X axis labels
    var maxLabels = Math.min(10, data.length);
    var labelInterval = Math.max(1, Math.ceil(data.length / maxLabels));
    data.forEach(function (d, i) {
      if (i % labelInterval === 0 || i === data.length - 1) {
        var x = toX(i);
        var label = '';
        if (d.bucket) {
          var bd = new Date(d.bucket);
          label = bd.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        }
        svg += '<text x="' + x.toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle" fill="var(--ss-dim)" font-size="9">' + esc(label) + '</text>';
      }
    });

    svg += '</svg>';

    // Tooltip element
    svg += '<div class="ss-dash-chart-tooltip" id="ss-dash-chart-tip" style="display:none"></div>';

    container.innerHTML = svg;

    // Hover interactivity
    var tip = document.getElementById('ss-dash-chart-tip');
    var svgEl = container.querySelector('svg');
    if (svgEl && tip) {
      var dots = container.querySelectorAll('.ss-dash-chart-dot');
      var zones = container.querySelectorAll('.ss-dash-chart-hover-zone');

      var showTip = function (idx, x) {
        var d = data[idx];
        if (!d) return;
        var total = (d.requestCount || 0) + (d.request_count || 0);
        var errors = (d.errorCount || 0) + (d.error_count || 0);
        var success = total - errors;
        var time = '';
        if (d.bucket) {
          var bd = new Date(d.bucket);
          time = bd.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        }
        tip.innerHTML = '<div style="font-weight:600;margin-bottom:2px;color:var(--ss-text)">' + esc(time) + '</div>'
          + '<div style="color:var(--ss-accent)">' + total + ' requests</div>'
          + (errors > 0 ? '<div style="color:var(--ss-red-fg)">' + errors + ' errors</div>' : '');
        tip.style.display = 'block';

        // Position tooltip
        var tipW = tip.offsetWidth || 100;
        var left = x - tipW / 2;
        if (left < 0) left = 4;
        if (left + tipW > w) left = w - tipW - 4;
        tip.style.left = left + 'px';
        tip.style.top = (pad.top - 4) + 'px';

        // Highlight dots for this index
        dots.forEach(function (dot) {
          var isActive = dot.getAttribute('data-idx') === String(idx);
          dot.setAttribute('r', isActive ? (dot.classList.contains('ss-dash-chart-dot-err') ? '3.5' : '4') : (dot.classList.contains('ss-dash-chart-dot-err') ? '2' : '2.5'));
          dot.style.opacity = isActive ? '1' : '0.5';
        });
      };

      var hideTip = function () {
        tip.style.display = 'none';
        dots.forEach(function (dot) {
          dot.setAttribute('r', dot.classList.contains('ss-dash-chart-dot-err') ? '2' : '2.5');
          dot.style.opacity = '1';
        });
      };

      zones.forEach(function (zone) {
        zone.addEventListener('mouseenter', function () {
          var idx = parseInt(zone.getAttribute('data-idx'), 10);
          var rect = container.getBoundingClientRect();
          var px = totalPoints[idx] ? totalPoints[idx].x : 0;
          showTip(idx, px);
        });
        zone.addEventListener('mouseleave', hideTip);
      });
    }

    // Legend
    var legend = document.getElementById('ss-dash-chart-legend');
    if (!legend) {
      legend = document.createElement('div');
      legend.id = 'ss-dash-chart-legend';
      legend.className = 'ss-dash-chart-legend';
      container.parentNode.insertBefore(legend, container.nextSibling);
    }
    legend.innerHTML = '<span class="ss-dash-chart-legend-item"><span class="ss-dash-legend-dot" style="background:var(--ss-accent)"></span>Requests</span>'
      + (hasErrors ? '<span class="ss-dash-chart-legend-item"><span class="ss-dash-legend-dot" style="background:var(--ss-red-fg)"></span>Errors</span>' : '');
  };

  // Compute nice Y-axis tick values
  var niceYTicks = function (max, count) {
    if (max <= 0) return [0];
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var nice = raw / mag;
    var step;
    if (nice <= 1) step = mag;
    else if (nice <= 2) step = 2 * mag;
    else if (nice <= 5) step = 5 * mag;
    else step = 10 * mag;

    var ticks = [];
    for (var v = step; v <= max + step * 0.5; v += step) {
      ticks.push(Math.round(v));
    }
    return ticks;
  };

  // ── Requests ──────────────────────────────────────────────────
  var requestUrlFilter = '';
  var requestStatusFilter = '';

  var fetchRequests = function () {
    var ps = getPage('requests');
    var url = API + '/requests?page=' + ps.page + '&limit=' + PER_PAGE;
    if (requestUrlFilter) url += '&url=' + encodeURIComponent(requestUrlFilter);
    if (requestStatusFilter) url += '&status=' + encodeURIComponent(requestStatusFilter);
    requestUrlFilter = '';
    requestStatusFilter = '';
    fetchJSON(url)
      .then(function (data) { renderRequests(data); })
      .catch(function () { setInner('ss-dash-requests-body', '<div class="ss-dash-empty">Failed to load requests</div>'); });
  };

  var renderRequests = function (data) {
    var items = data.data || data.requests || [];
    var ps = getPage('requests');
    ps.total = data.meta ? data.meta.total : (data.total || items.length);

    setInner('ss-dash-requests-summary', ps.total + ' requests');

    if (items.length === 0) {
      setInner('ss-dash-requests-body', '<div class="ss-dash-empty">No requests recorded yet</div>');
      renderPagination('requests', ps);
      return;
    }

    var CT = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:50px">#</th>'
      + '<th style="width:60px">Method</th>'
      + '<th>URL</th>'
      + '<th style="width:55px">Status</th>'
      + '<th style="width:80px">Duration</th>'
      + '<th style="width:50px">Spans</th>'
      + '<th style="width:30px" title="Warnings">&#x26A0;</th>'
      + '<th style="width:60px">Time</th>'
      + '</tr></thead><tbody>';

    items.forEach(function (r) {
      html += '<tr class="ss-dash-clickable" data-request-id="' + r.id + '">'
        + '<td style="color:var(--ss-dim);' + CT + '">' + r.id + '</td>'
        + '<td><span class="' + methodClass(r.method) + '">' + esc(r.method) + '</span></td>'
        + '<td style="color:var(--ss-text);' + CT + '" title="' + esc(r.url) + '">' + esc(r.url) + '</td>'
        + '<td><span class="ss-dash-status ' + statusClass(r.status_code || r.statusCode) + '">' + (r.status_code || r.statusCode) + '</span></td>'
        + '<td class="ss-dash-duration ' + durationClass(r.duration) + '">' + (r.duration || 0).toFixed(1) + 'ms</td>'
        + '<td style="color:var(--ss-muted);text-align:center">' + (r.span_count || r.spanCount || 0) + '</td>'
        + '<td style="text-align:center">' + ((r.warning_count || r.warningCount || 0) > 0 ? '<span style="color:var(--ss-amber-fg)">' + (r.warning_count || r.warningCount) + '</span>' : '<span style="color:var(--ss-dim)">-</span>') + '</td>'
        + '<td class="ss-dash-event-time" style="white-space:nowrap">' + timeAgo(r.createdAt || r.created_at || r.timestamp) + '</td>'
        + '</tr>';
    });
    html += '</tbody></table>';

    setInner('ss-dash-requests-body', html);
    updateBadge('requests', ps.total);
    renderPagination('requests', ps);

    // Click to expand trace
    var body = document.getElementById('ss-dash-requests-body');
    if (body) {
      body.querySelectorAll('[data-request-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-request-id');
          fetchJSON(API + '/requests/' + id)
            .then(function (trace) { showRequestDetail(trace); })
            .catch(function () { /* ignore */ });
        });
      });
    }
  };

  var showRequestDetail = function (trace) {
    var listEl = document.getElementById('ss-dash-requests-list');
    var detailEl = document.getElementById('ss-dash-requests-detail');
    var titleEl = document.getElementById('ss-dash-requests-detail-title');
    var waterfallEl = document.getElementById('ss-dash-requests-waterfall');
    if (!listEl || !detailEl) return;

    listEl.style.display = 'none';
    detailEl.style.display = 'flex';
    detailEl.classList.add('ss-dash-active');

    if (titleEl) {
      titleEl.innerHTML = '<span class="' + methodClass(trace.method) + '">' + esc(trace.method) + '</span> '
        + esc(trace.url) + ' '
        + '<span class="ss-dash-status ' + statusClass(trace.status_code || trace.statusCode) + '">' + (trace.status_code || trace.statusCode) + '</span>'
        + '<span class="ss-dash-tl-meta">' + (trace.total_duration || trace.totalDuration || trace.duration || 0).toFixed(1) + 'ms</span>';
    }

    if (waterfallEl) renderWaterfall(waterfallEl, trace);
  };

  // Back button for requests detail
  var reqBackBtn = document.getElementById('ss-dash-requests-back');
  if (reqBackBtn) {
    reqBackBtn.addEventListener('click', function () {
      var listEl = document.getElementById('ss-dash-requests-list');
      var detailEl = document.getElementById('ss-dash-requests-detail');
      if (listEl) listEl.style.display = '';
      if (detailEl) { detailEl.style.display = 'none'; detailEl.classList.remove('ss-dash-active'); }
    });
  }

  // ── Queries ───────────────────────────────────────────────────
  var queryGrouped = false;

  var fetchQueries = function () {
    if (queryGrouped) {
      fetchJSON(API + '/queries/grouped')
        .then(function (data) { renderQueriesGrouped(data); })
        .catch(function () { setInner('ss-dash-queries-body', '<div class="ss-dash-empty">Failed to load queries</div>'); });
    } else {
      var ps = getPage('queries');
      fetchJSON(API + '/queries?page=' + ps.page + '&limit=' + PER_PAGE)
        .then(function (data) { renderQueries(data); })
        .catch(function () { setInner('ss-dash-queries-body', '<div class="ss-dash-empty">Failed to load queries</div>'); });
    }
  };

  var renderQueries = function (data) {
    var items = data.data || data.queries || [];
    var summary = data.summary || data.meta || {};
    var ps = getPage('queries');
    ps.total = summary.total || (data.meta ? data.meta.total : items.length);

    setInner('ss-dash-queries-summary', (ps.total || items.length) + ' queries'
      + (summary.slow > 0 ? ', ' + summary.slow + ' slow' : '')
      + (summary.duplicates > 0 ? ', ' + summary.duplicates + ' dup' : '')
      + ', avg ' + (summary.avgDuration || 0).toFixed(1) + 'ms');

    updateBadge('queries', ps.total);

    if (items.length === 0) {
      setInner('ss-dash-queries-body', '<div class="ss-dash-empty">No queries recorded yet</div>');
      renderPagination('queries', ps);
      return;
    }

    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:50px">#</th>'
      + '<th>SQL</th>'
      + '<th style="width:75px">Duration</th>'
      + '<th style="width:60px">Method</th>'
      + '<th style="width:100px">Model</th>'
      + '<th style="width:80px">Connection</th>'
      + '<th style="width:50px">Time</th>'
      + '<th style="width:70px">EXPLAIN</th>'
      + '</tr></thead><tbody>';

    items.forEach(function (q) {
      var dur = q.duration || 0;
      var sqlMethod = q.method || q.sql_method || '';
      var modelName = q.model || '-';
      html += '<tr>'
        + '<td style="color:var(--ss-dim)">' + q.id + '</td>'
        + '<td><span class="ss-dash-sql" title="Click to expand" onclick="this.classList.toggle(\'ss-dash-expanded\')">' + esc(q.sql || q.sql_text || '') + '</span></td>'
        + '<td class="ss-dash-duration ' + durationClass(dur) + '">' + dur.toFixed(2) + 'ms</td>'
        + '<td><span class="' + methodClass(sqlMethod) + '">' + esc(sqlMethod) + '</span></td>'
        + '<td style="color:var(--ss-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(modelName) + '">' + esc(modelName) + '</td>'
        + '<td style="color:var(--ss-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(q.connection || '-') + '</td>'
        + '<td class="ss-dash-event-time" style="white-space:nowrap">' + timeAgo(q.createdAt || q.created_at || q.timestamp) + '</td>'
        + '<td>' + ((sqlMethod || '').toLowerCase() === 'select' ? '<button class="ss-dash-explain-btn" data-query-id="' + q.id + '">EXPLAIN</button>' : '') + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-queries-body', html);
    renderPagination('queries', ps);
    bindExplainButtons();
  };

  var renderQueriesGrouped = function (data) {
    var groups = data.groups || data.data || [];

    setInner('ss-dash-queries-summary', groups.length + ' query patterns');
    updateBadge('queries', groups.length);

    if (groups.length === 0) {
      setInner('ss-dash-queries-body', '<div class="ss-dash-empty">No queries recorded yet</div>');
      return;
    }

    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th>Pattern</th>'
      + '<th style="width:55px">Count</th>'
      + '<th style="width:70px">Avg</th>'
      + '<th style="width:70px">Min</th>'
      + '<th style="width:70px">Max</th>'
      + '<th style="width:70px">Total</th>'
      + '<th style="width:55px">% Time</th>'
      + '</tr></thead><tbody>';

    groups.forEach(function (g) {
      var isDup = (g.count || 0) >= 3;
      html += '<tr>'
        + '<td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="ss-dash-sql" onclick="this.classList.toggle(\'ss-dash-expanded\')">' + esc(g.pattern || g.sql_normalized || '') + '</span>'
        + (isDup ? ' <span class="ss-dash-dup">DUP</span>' : '') + '</td>'
        + '<td style="color:var(--ss-muted);text-align:center">' + (g.count || 0) + '</td>'
        + '<td class="ss-dash-duration ' + durationClass(g.avg_duration || 0) + '">' + (g.avg_duration || 0).toFixed(2) + 'ms</td>'
        + '<td class="ss-dash-duration">' + (g.min_duration || 0).toFixed(2) + 'ms</td>'
        + '<td class="ss-dash-duration ' + durationClass(g.max_duration || 0) + '">' + (g.max_duration || 0).toFixed(2) + 'ms</td>'
        + '<td class="ss-dash-duration">' + (g.total_duration || 0).toFixed(1) + 'ms</td>'
        + '<td style="color:var(--ss-muted);text-align:center">' + (g.pct_time || 0).toFixed(1) + '%</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-queries-body', html);
  };

  // ── EXPLAIN: render a PostgreSQL JSON plan as a tree ──────────
  var renderPlanNode = function (node, depth) {
    if (!node) return '';
    depth = depth || 0;
    var indent = depth * 20;
    var html = '<div class="ss-dash-explain-node" style="margin-left:' + indent + 'px">';
    var nodeType = node['Node Type'] || 'Unknown';
    var relation = node['Relation Name'] ? ' on <strong>' + esc(node['Relation Name']) + '</strong>' : '';
    var alias = node['Alias'] && node['Alias'] !== node['Relation Name'] ? ' (' + esc(node['Alias']) + ')' : '';
    var idx = node['Index Name'] ? ' using <em>' + esc(node['Index Name']) + '</em>' : '';

    html += '<div class="ss-dash-explain-node-header">'
      + '<span class="ss-dash-explain-node-type">' + esc(nodeType) + '</span>'
      + relation + alias + idx
      + '</div>';

    // Key metrics row
    var metrics = [];
    if (node['Startup Cost'] != null) metrics.push('cost=' + node['Startup Cost'] + '..' + node['Total Cost']);
    if (node['Plan Rows'] != null) metrics.push('rows=' + node['Plan Rows']);
    if (node['Plan Width'] != null) metrics.push('width=' + node['Plan Width']);
    if (node['Filter']) metrics.push('filter: ' + esc(node['Filter']));
    if (node['Index Cond']) metrics.push('cond: ' + esc(node['Index Cond']));
    if (node['Hash Cond']) metrics.push('hash: ' + esc(node['Hash Cond']));
    if (node['Join Type']) metrics.push('join: ' + esc(node['Join Type']));
    if (node['Sort Key']) metrics.push('sort: ' + esc(Array.isArray(node['Sort Key']) ? node['Sort Key'].join(', ') : node['Sort Key']));

    if (metrics.length > 0) {
      html += '<div class="ss-dash-explain-metrics">' + metrics.join(' &middot; ') + '</div>';
    }

    // Recurse into child plans
    var plans = node['Plans'] || [];
    for (var i = 0; i < plans.length; i++) {
      html += renderPlanNode(plans[i], depth + 1);
    }

    html += '</div>';
    return html;
  };

  var renderExplainPlan = function (plan) {
    if (!plan || !Array.isArray(plan) || plan.length === 0) {
      return '<div class="ss-dash-explain-result">No plan data returned</div>';
    }

    // JSON format: array of objects with a "Plan" key
    var topPlan = plan[0];
    if (topPlan && topPlan['Plan']) {
      return '<div class="ss-dash-explain-result">' + renderPlanNode(topPlan['Plan'], 0) + '</div>';
    }

    // Fallback: plain rows table (for non-JSON EXPLAIN output)
    if (typeof topPlan === 'object') {
      var cols = Object.keys(topPlan);
      var tbl = '<table><thead><tr>';
      cols.forEach(function (c) { tbl += '<th>' + esc(c) + '</th>'; });
      tbl += '</tr></thead><tbody>';
      plan.forEach(function (r) {
        tbl += '<tr>';
        cols.forEach(function (c) { tbl += '<td>' + esc(r[c] != null ? String(r[c]) : '-') + '</td>'; });
        tbl += '</tr>';
      });
      tbl += '</tbody></table>';
      return '<div class="ss-dash-explain-result">' + tbl + '</div>';
    }

    return '<div class="ss-dash-explain-result">No plan data returned</div>';
  };

  // EXPLAIN buttons
  var bindExplainButtons = function () {
    var body = document.getElementById('ss-dash-queries-body');
    if (!body) return;
    body.querySelectorAll('.ss-dash-explain-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-query-id');
        var row = btn.closest('tr');
        if (!row) return;

        // Toggle: if already shown, remove it
        var existing = row.nextElementSibling;
        if (existing && existing.classList.contains('ss-dash-explain-row')) {
          existing.remove();
          btn.classList.remove('ss-dash-explain-btn-active');
          return;
        }

        btn.textContent = '...';
        btn.disabled = true;
        fetchJSON(API + '/queries/' + id + '/explain')
          .then(function (data) {
            // Remove any existing explain row
            var prev = row.nextElementSibling;
            if (prev && prev.classList.contains('ss-dash-explain-row')) prev.remove();

            var tr = document.createElement('tr');
            tr.className = 'ss-dash-explain-row';
            var td = document.createElement('td');
            td.colSpan = 8;
            td.className = 'ss-dash-explain';

            if (data.error) {
              td.innerHTML = '<div class="ss-dash-explain-result ss-dash-explain-error">'
                + '<strong>Error:</strong> ' + esc(data.error)
                + (data.message ? '<br>' + esc(data.message) : '')
                + '</div>';
            } else {
              td.innerHTML = renderExplainPlan(data.plan || data.rows || []);
            }

            tr.appendChild(td);
            row.parentNode.insertBefore(tr, row.nextSibling);
            btn.textContent = 'EXPLAIN';
            btn.disabled = false;
            btn.classList.add('ss-dash-explain-btn-active');
          })
          .catch(function (err) {
            btn.textContent = 'EXPLAIN';
            btn.disabled = false;
          });
      });
    });
  };

  // Grouped toggle
  var queryGroupBtn = document.getElementById('ss-dash-queries-group-btn');
  if (queryGroupBtn) {
    queryGroupBtn.addEventListener('click', function () {
      queryGrouped = !queryGrouped;
      queryGroupBtn.classList.toggle('ss-dash-active', queryGrouped);
      queryGroupBtn.textContent = queryGrouped ? 'List View' : 'Grouped';
      fetchQueries();
    });
  }

  // ── Events ────────────────────────────────────────────────────
  var eventNameFilter = '';

  var fetchEvents = function () {
    var ps = getPage('events');
    var url = API + '/events?page=' + ps.page + '&limit=' + PER_PAGE;
    if (eventNameFilter) url += '&event_name=' + encodeURIComponent(eventNameFilter);
    eventNameFilter = '';
    fetchJSON(url)
      .then(function (data) { renderEvents(data); })
      .catch(function () { setInner('ss-dash-events-body', '<div class="ss-dash-empty">Failed to load events</div>'); });
  };

  var renderEvents = function (data) {
    var items = data.data || data.events || [];
    var ps = getPage('events');
    ps.total = data.meta ? data.meta.total : (data.total || items.length);

    setInner('ss-dash-events-summary', ps.total + ' events');

    if (items.length === 0) {
      setInner('ss-dash-events-body', '<div class="ss-dash-empty">No events recorded yet</div>');
      renderPagination('events', ps);
      return;
    }

    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:50px">#</th>'
      + '<th style="width:200px">Event</th>'
      + '<th>Data</th>'
      + '<th style="width:80px">Time</th>'
      + '</tr></thead><tbody>';

    items.forEach(function (ev, idx) {
      var hasData = ev.data && ev.data !== '-';
      var preview = hasData ? eventPreview(ev.data) : '-';
      var evName = ev.event_name || ev.event || '';
      html += '<tr>'
        + '<td style="color:var(--ss-dim)">' + ev.id + '</td>'
        + '<td class="ss-dash-event-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(evName) + '">' + esc(evName) + '</td>'
        + '<td class="ss-dash-event-data" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        + (hasData
          ? '<span class="ss-dash-data-preview" data-ev-idx="' + idx + '">' + esc(preview) + '</span>'
            + '<pre class="ss-dash-data-full" id="ss-dash-evdata-' + idx + '" style="display:none">' + esc(typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2)) + '</pre>'
          : '<span style="color:var(--ss-dim)">-</span>')
        + '</td>'
        + '<td class="ss-dash-event-time">' + timeAgo(ev.createdAt || ev.created_at || ev.timestamp) + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-events-body', html);
    renderPagination('events', ps);
    bindDataExpand('ss-dash-events-body');
  };

  // ── Routes ────────────────────────────────────────────────────
  var fetchRoutes = function () {
    fetchJSON(API + '/routes')
      .then(function (data) {
        sectionLoaded.routes = true;
        renderRoutes(data);
      })
      .catch(function () { setInner('ss-dash-routes-body', '<div class="ss-dash-empty">Failed to load routes</div>'); });
  };

  var renderRoutes = function (data) {
    var items = data.routes || data.data || [];
    setInner('ss-dash-routes-summary', items.length + ' routes');

    if (items.length === 0) {
      setInner('ss-dash-routes-body', '<div class="ss-dash-empty">No routes available</div>');
      return;
    }

    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:70px">Method</th>'
      + '<th style="width:25%">Pattern</th>'
      + '<th style="width:18%">Name</th>'
      + '<th style="width:32%">Handler</th>'
      + '<th style="width:120px">Middleware</th>'
      + '</tr></thead><tbody>';

    var cellTrunc = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    items.forEach(function (r) {
      html += '<tr>'
        + '<td><span class="' + methodClass(r.method) + '">' + esc(r.method) + '</span></td>'
        + '<td style="color:var(--ss-text);' + cellTrunc + '" title="' + esc(r.pattern) + '">' + esc(r.pattern) + '</td>'
        + '<td style="color:var(--ss-muted);' + cellTrunc + '" title="' + esc(r.name || '-') + '">' + esc(r.name || '-') + '</td>'
        + '<td style="color:var(--ss-handler-color);' + cellTrunc + '" title="' + esc(r.handler) + '">' + esc(r.handler) + '</td>'
        + '<td style="color:var(--ss-dim);font-size:10px;' + cellTrunc + '" title="' + (r.middleware && r.middleware.length ? esc(r.middleware.join(', ')) : '-') + '">' + (r.middleware && r.middleware.length ? esc(r.middleware.join(', ')) : '-') + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-routes-body', html);
  };

  // ── Logs ──────────────────────────────────────────────────────
  var logLevelFilter = 'all';
  var logReqIdFilter = '';
  var logDeepLevelFilter = '';
  var logStructuredFilters = [];
  var logSavedFilters = [];

  var fetchLogs = function () {
    var ps = getPage('logs');
    var params = 'page=' + ps.page + '&limit=' + PER_PAGE;
    if (logDeepLevelFilter) {
      logLevelFilter = logDeepLevelFilter;
      logDeepLevelFilter = '';
    }
    if (logLevelFilter !== 'all') params += '&level=' + logLevelFilter;
    if (logReqIdFilter) params += '&request_id=' + encodeURIComponent(logReqIdFilter);
    logStructuredFilters.forEach(function (f) {
      params += '&filter_field=' + encodeURIComponent(f.field)
        + '&filter_op=' + encodeURIComponent(f.op)
        + '&filter_value=' + encodeURIComponent(f.value);
    });

    fetchJSON(API + '/logs?' + params)
      .then(function (data) { renderLogs(data); })
      .catch(function () { setInner('ss-dash-logs-body', '<div class="ss-dash-empty">Failed to load logs</div>'); });
  };

  var renderLogs = function (data) {
    var items = data.data || data.logs || data.entries || [];
    var ps = getPage('logs');
    ps.total = data.meta ? data.meta.total : (data.total || items.length);

    if (items.length === 0) {
      var hint = '';
      if (logReqIdFilter) hint = ' matching request ' + logReqIdFilter;
      else if (logLevelFilter !== 'all') hint = ' for ' + logLevelFilter;
      setInner('ss-dash-logs-body', '<div class="ss-dash-empty">No log entries' + hint + '</div>');
      renderPagination('logs', ps);
      return;
    }

    var html = '';
    items.forEach(function (e) {
      var level = (e.level || e.levelName || e.level_name || 'info').toLowerCase();
      var msg = e.message || e.msg || '';
      var ts = e.createdAt || e.created_at || e.time || e.timestamp || 0;
      var reqId = e.request_id || e['x-request-id'] || '';

      html += '<div class="ss-dash-log-entry">'
        + '<span class="ss-dash-log-level ss-dash-log-level-' + esc(level) + '">' + esc(level.toUpperCase()) + '</span>'
        + '<span class="ss-dash-log-time">' + (ts ? formatTime(ts) : '-') + '</span>'
        + (reqId
          ? '<span class="ss-dash-log-reqid" data-reqid="' + esc(reqId) + '" title="' + esc(reqId) + '">' + esc(shortReqId(reqId)) + '</span>'
          : '<span class="ss-dash-log-reqid-empty">-</span>')
        + '<span class="ss-dash-log-msg">' + esc(msg) + '</span>'
        + '</div>';
    });

    setInner('ss-dash-logs-body', html);
    updateBadge('logs', ps.total);
    renderPagination('logs', ps);

    // Click request ID to filter
    var logBody = document.getElementById('ss-dash-logs-body');
    if (logBody) {
      logBody.querySelectorAll('.ss-dash-log-reqid').forEach(function (el) {
        el.addEventListener('click', function () {
          logReqIdFilter = el.getAttribute('data-reqid') || '';
          var input = document.getElementById('ss-dash-log-reqid-input');
          if (input) input.value = logReqIdFilter;
          var clearBtn = document.getElementById('ss-dash-log-reqid-clear');
          if (clearBtn) clearBtn.style.display = logReqIdFilter ? '' : 'none';
          getPage('logs').page = 1;
          fetchLogs();
        });
      });
    }
  };

  // Log level filters
  root.querySelectorAll('[data-ss-log-level]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      root.querySelectorAll('[data-ss-log-level]').forEach(function (b) { b.classList.remove('ss-dash-active'); });
      btn.classList.add('ss-dash-active');
      logLevelFilter = btn.getAttribute('data-ss-log-level');
      getPage('logs').page = 1;
      fetchLogs();
    });
  });

  // Log request ID filter
  var logReqIdInput = document.getElementById('ss-dash-log-reqid-input');
  var logReqIdClear = document.getElementById('ss-dash-log-reqid-clear');
  if (logReqIdInput) {
    logReqIdInput.addEventListener('input', function () {
      logReqIdFilter = logReqIdInput.value.trim();
      if (logReqIdClear) logReqIdClear.style.display = logReqIdFilter ? '' : 'none';
      getPage('logs').page = 1;
      fetchLogs();
    });
  }
  if (logReqIdClear) {
    logReqIdClear.addEventListener('click', function () {
      logReqIdFilter = '';
      if (logReqIdInput) logReqIdInput.value = '';
      logReqIdClear.style.display = 'none';
      getPage('logs').page = 1;
      fetchLogs();
    });
  }

  // Structured search: add filter
  var logAddFilterBtn = document.getElementById('ss-dash-log-add-filter');
  if (logAddFilterBtn) {
    logAddFilterBtn.addEventListener('click', function () {
      var fieldEl = document.getElementById('ss-dash-log-filter-field');
      var opEl = document.getElementById('ss-dash-log-filter-op');
      var valEl = document.getElementById('ss-dash-log-filter-value');
      if (!fieldEl || !opEl || !valEl) return;
      var field = fieldEl.value;
      var op = opEl.value;
      var val = valEl.value.trim();
      if (!field || !val) return;
      logStructuredFilters.push({ field: field, op: op, value: val });
      valEl.value = '';
      renderFilterChips();
      getPage('logs').page = 1;
      fetchLogs();
    });
  }

  var renderFilterChips = function () {
    var container = document.getElementById('ss-dash-log-filter-chips');
    if (!container) return;
    var html = '';
    logStructuredFilters.forEach(function (f, i) {
      html += '<span class="ss-dash-filter-chip">'
        + esc(f.field) + ' ' + esc(f.op) + ' ' + esc(f.value)
        + ' <button class="ss-dash-filter-chip-remove" data-chip-idx="' + i + '">&times;</button>'
        + '</span>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.ss-dash-filter-chip-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-chip-idx'), 10);
        logStructuredFilters.splice(idx, 1);
        renderFilterChips();
        getPage('logs').page = 1;
        fetchLogs();
      });
    });
  };

  // Saved filters
  var fetchSavedFilters = function () {
    fetchJSON(API + '/filters?section=logs')
      .then(function (data) {
        logSavedFilters = data.filters || data.data || [];
        renderSavedFilters();
      })
      .catch(function () { /* ignore */ });
  };

  var renderSavedFilters = function () {
    var sel = document.getElementById('ss-dash-log-saved-select');
    if (!sel) return;
    var html = '<option value="">Saved Filters...</option>';
    logSavedFilters.forEach(function (f) {
      html += '<option value="' + f.id + '">' + esc(f.name) + '</option>';
    });
    sel.innerHTML = html;
  };

  var savedFilterSelect = document.getElementById('ss-dash-log-saved-select');
  if (savedFilterSelect) {
    savedFilterSelect.addEventListener('change', function () {
      var id = savedFilterSelect.value;
      if (!id) return;
      var filter = logSavedFilters.find(function (f) { return String(f.id) === id; });
      if (filter && filter.filter_config) {
        try {
          var cfg = typeof filter.filter_config === 'string' ? JSON.parse(filter.filter_config) : filter.filter_config;
          if (cfg.level) logLevelFilter = cfg.level;
          if (cfg.filters) logStructuredFilters = cfg.filters;
          renderFilterChips();
          getPage('logs').page = 1;
          fetchLogs();
        } catch (e) { /* ignore */ }
      }
      savedFilterSelect.value = '';
    });
  }

  var saveFilterBtn = document.getElementById('ss-dash-log-save-filter');
  if (saveFilterBtn) {
    saveFilterBtn.addEventListener('click', function () {
      var name = prompt('Filter preset name:');
      if (!name) return;
      var config = {
        level: logLevelFilter,
        requestId: logReqIdFilter,
        filters: logStructuredFilters
      };
      fetch(API + '/filters', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, section: 'logs', filter_config: config })
      }).then(function () { fetchSavedFilters(); }).catch(function () { /* ignore */ });
    });
  }

  var deleteFilterBtn = document.getElementById('ss-dash-log-delete-filter');
  if (deleteFilterBtn) {
    deleteFilterBtn.addEventListener('click', function () {
      var sel = document.getElementById('ss-dash-log-saved-select');
      if (!sel || !sel.value) return;
      fetch(API + '/filters/' + sel.value, { method: 'DELETE', credentials: 'same-origin' })
        .then(function () { fetchSavedFilters(); }).catch(function () { /* ignore */ });
    });
  }

  fetchSavedFilters();

  // ── Emails ────────────────────────────────────────────────────
  var emailStatusFilter = '';

  var fetchEmails = function () {
    var ps = getPage('emails');
    var url = API + '/emails?page=' + ps.page + '&limit=' + PER_PAGE;
    if (emailStatusFilter) url += '&status=' + encodeURIComponent(emailStatusFilter);
    emailStatusFilter = '';
    fetchJSON(url)
      .then(function (data) { renderEmails(data); })
      .catch(function () { setInner('ss-dash-emails-body', '<div class="ss-dash-empty">Failed to load emails</div>'); });
  };

  var renderEmails = function (data) {
    var items = data.data || data.emails || [];
    var ps = getPage('emails');
    ps.total = data.meta ? data.meta.total : (data.total || items.length);

    setInner('ss-dash-emails-summary', ps.total + ' emails');

    if (items.length === 0) {
      setInner('ss-dash-emails-body', '<div class="ss-dash-empty">No emails captured yet</div>');
      renderPagination('emails', ps);
      return;
    }

    var CT = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:40px">#</th>'
      + '<th style="width:160px">From</th>'
      + '<th style="width:160px">To</th>'
      + '<th>Subject</th>'
      + '<th style="width:70px">Status</th>'
      + '<th style="width:70px">Mailer</th>'
      + '<th style="width:30px" title="Attachments">ATT</th>'
      + '<th style="width:60px">Time</th>'
      + '</tr></thead><tbody>';

    items.forEach(function (e) {
      var fromAddr = e.from_addr || e.from || '';
      var toAddr = e.to_addr || e.to || '';
      html += '<tr class="ss-dash-email-row" data-email-id="' + e.id + '">'
        + '<td style="color:var(--ss-dim)">' + e.id + '</td>'
        + '<td style="color:var(--ss-text-secondary);' + CT + '" title="' + esc(fromAddr) + '">' + esc(fromAddr) + '</td>'
        + '<td style="color:var(--ss-text-secondary);' + CT + '" title="' + esc(toAddr) + '">' + esc(toAddr) + '</td>'
        + '<td style="color:var(--ss-sql-color);' + CT + '" title="' + esc(e.subject || '') + '">' + esc(e.subject || '') + '</td>'
        + '<td><span class="ss-dash-email-status ss-dash-email-status-' + esc(e.status || '') + '">' + esc(e.status || '') + '</span></td>'
        + '<td style="color:var(--ss-muted);' + CT + '">' + esc(e.mailer || '') + '</td>'
        + '<td style="color:var(--ss-dim);text-align:center">' + ((e.attachment_count || e.attachmentCount || 0) > 0 ? (e.attachment_count || e.attachmentCount) : '-') + '</td>'
        + '<td class="ss-dash-event-time" style="white-space:nowrap">' + timeAgo(e.createdAt || e.created_at || e.timestamp) + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-emails-body', html);
    renderPagination('emails', ps);

    var body = document.getElementById('ss-dash-emails-body');
    if (body) {
      body.querySelectorAll('.ss-dash-email-row').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-email-id');
          showEmailPreview(id, items);
        });
      });
    }
  };

  var showEmailPreview = function (id, emails) {
    var previewEl = document.getElementById('ss-dash-email-preview');
    var metaEl = document.getElementById('ss-dash-email-preview-meta');
    var iframeEl = document.getElementById('ss-dash-email-iframe');
    if (!previewEl || !iframeEl) return;

    var email = emails.find(function (e) { return String(e.id) === String(id); });
    if (metaEl && email) {
      metaEl.innerHTML =
        '<strong>Subject:</strong> ' + esc(email.subject || '')
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>From:</strong> ' + esc(email.from_addr || email.from || '')
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>To:</strong> ' + esc(email.to_addr || email.to || '')
        + (email.cc ? '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>CC:</strong> ' + esc(email.cc) : '')
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Status:</strong> <span class="ss-dash-email-status ss-dash-email-status-' + esc(email.status || '') + '">' + esc(email.status || '') + '</span>'
        + '&nbsp;&nbsp;|&nbsp;&nbsp;<strong>Mailer:</strong> ' + esc(email.mailer || '');
    }

    iframeEl.src = API + '/emails/' + id + '/preview';
    previewEl.style.display = 'flex';
  };

  var emailPreviewClose = document.getElementById('ss-dash-email-preview-close');
  if (emailPreviewClose) {
    emailPreviewClose.addEventListener('click', function () {
      var previewEl = document.getElementById('ss-dash-email-preview');
      var iframeEl = document.getElementById('ss-dash-email-iframe');
      if (previewEl) previewEl.style.display = 'none';
      if (iframeEl) iframeEl.src = 'about:blank';
    });
  }

  // ── Timeline / Traces ─────────────────────────────────────────
  var fetchTraces = function () {
    if (!tracingEnabled) {
      setInner('ss-dash-timeline-body', '<div class="ss-dash-empty">Tracing is not enabled. Set tracing: true in config.</div>');
      return;
    }
    var ps = getPage('timeline');
    fetchJSON(API + '/traces?page=' + ps.page + '&limit=' + PER_PAGE)
      .then(function (data) { renderTraces(data); })
      .catch(function () { setInner('ss-dash-timeline-body', '<div class="ss-dash-empty">Failed to load traces</div>'); });
  };

  var renderTraces = function (data) {
    var items = data.data || data.traces || [];
    var ps = getPage('timeline');
    ps.total = data.meta ? data.meta.total : (data.total || items.length);

    setInner('ss-dash-timeline-summary', ps.total + ' requests');

    if (items.length === 0) {
      setInner('ss-dash-timeline-body', '<div class="ss-dash-empty">No requests traced yet</div>');
      renderPagination('timeline', ps);
      return;
    }

    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:50px">#</th>'
      + '<th style="width:60px">Method</th>'
      + '<th>URL</th>'
      + '<th style="width:55px">Status</th>'
      + '<th style="width:80px">Duration</th>'
      + '<th style="width:50px">Spans</th>'
      + '<th style="width:60px">Time</th>'
      + '</tr></thead><tbody>';

    items.forEach(function (t) {
      html += '<tr class="ss-dash-clickable" data-trace-id="' + t.id + '">'
        + '<td style="color:var(--ss-dim)">' + t.id + '</td>'
        + '<td><span class="' + methodClass(t.method) + '">' + esc(t.method) + '</span></td>'
        + '<td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ss-text)" title="' + esc(t.url) + '">' + esc(t.url) + '</td>'
        + '<td><span class="ss-dash-status ' + statusClass(t.status_code || t.statusCode) + '">' + (t.status_code || t.statusCode) + '</span></td>'
        + '<td class="ss-dash-duration ' + durationClass(t.total_duration || t.totalDuration) + '">' + (t.total_duration || t.totalDuration || 0).toFixed(1) + 'ms</td>'
        + '<td style="color:var(--ss-muted);text-align:center">' + (t.span_count || t.spanCount || 0) + '</td>'
        + '<td class="ss-dash-event-time" style="white-space:nowrap">' + timeAgo(t.createdAt || t.created_at || t.timestamp) + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-timeline-body', html);
    renderPagination('timeline', ps);

    var body = document.getElementById('ss-dash-timeline-body');
    if (body) {
      body.querySelectorAll('[data-trace-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-trace-id');
          fetchJSON(API + '/traces/' + id)
            .then(function (trace) { showTraceDetail(trace); })
            .catch(function () { /* ignore */ });
        });
      });
    }
  };

  var showTraceDetail = function (trace) {
    var listEl = document.getElementById('ss-dash-timeline-list');
    var detailEl = document.getElementById('ss-dash-timeline-detail');
    var titleEl = document.getElementById('ss-dash-timeline-detail-title');
    var waterfallEl = document.getElementById('ss-dash-timeline-waterfall');
    if (!listEl || !detailEl) return;

    listEl.style.display = 'none';
    detailEl.style.display = 'flex';
    detailEl.classList.add('ss-dash-active');

    if (titleEl) {
      titleEl.innerHTML = '<span class="' + methodClass(trace.method) + '">' + esc(trace.method) + '</span> '
        + esc(trace.url) + ' '
        + '<span class="ss-dash-status ' + statusClass(trace.status_code || trace.statusCode) + '">' + (trace.status_code || trace.statusCode) + '</span>'
        + '<span class="ss-dash-tl-meta">' + (trace.total_duration || trace.totalDuration || 0).toFixed(1) + 'ms &middot; '
        + (trace.span_count || trace.spanCount || 0) + ' spans</span>';
    }

    if (waterfallEl) renderWaterfall(waterfallEl, trace);
  };

  var timelineBackBtn = document.getElementById('ss-dash-timeline-back');
  if (timelineBackBtn) {
    timelineBackBtn.addEventListener('click', function () {
      var listEl = document.getElementById('ss-dash-timeline-list');
      var detailEl = document.getElementById('ss-dash-timeline-detail');
      if (listEl) listEl.style.display = '';
      if (detailEl) { detailEl.style.display = 'none'; detailEl.classList.remove('ss-dash-active'); }
    });
  }

  // ── Waterfall renderer (shared) ───────────────────────────────
  var renderWaterfall = function (container, trace) {
    var spans = trace.spans || [];
    if (typeof spans === 'string') { try { spans = JSON.parse(spans); } catch (e) { spans = []; } }
    var total = trace.total_duration || trace.totalDuration || trace.duration || 1;

    var html = '<div class="ss-dash-tl-legend">'
      + '<div class="ss-dash-tl-legend-item"><span class="ss-dash-tl-legend-dot" style="background:#6d28d9"></span>DB</div>'
      + '<div class="ss-dash-tl-legend-item"><span class="ss-dash-tl-legend-dot" style="background:#1e3a5f"></span>Request</div>'
      + '<div class="ss-dash-tl-legend-item"><span class="ss-dash-tl-legend-dot" style="background:#059669"></span>Mail</div>'
      + '<div class="ss-dash-tl-legend-item"><span class="ss-dash-tl-legend-dot" style="background:#b45309"></span>Event</div>'
      + '<div class="ss-dash-tl-legend-item"><span class="ss-dash-tl-legend-dot" style="background:#0e7490"></span>View</div>'
      + '<div class="ss-dash-tl-legend-item"><span class="ss-dash-tl-legend-dot" style="background:var(--ss-dim)"></span>Custom</div>'
      + '</div>';

    if (spans.length === 0) {
      html += '<div class="ss-dash-empty">No spans captured for this request</div>';
    } else {
      var depthMap = {};
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i];
        depthMap[s.id] = s.parentId ? (depthMap[s.parentId] || 0) + 1 : 0;
      }
      var sorted = spans.slice().sort(function (a, b) { return a.startOffset - b.startOffset; });

      for (var j = 0; j < sorted.length; j++) {
        var sp = sorted[j];
        var depth = depthMap[sp.id] || 0;
        var leftPct = (sp.startOffset / total * 100).toFixed(2);
        var widthPct = Math.max(sp.duration / total * 100, 0.5).toFixed(2);
        var indent = depth * 16;
        var catLabel = sp.category === 'db' ? 'DB' : sp.category;
        var metaStr = sp.metadata ? Object.entries(sp.metadata).filter(function (e) { return e[1] != null; }).map(function (e) { return e[0] + '=' + e[1]; }).join(', ') : '';
        var tooltip = sp.label + ' (' + sp.duration.toFixed(2) + 'ms)' + (metaStr ? '\n' + metaStr : '');

        var badgeCat = sp.category === 'db' ? 'purple' : sp.category === 'mail' ? 'green' : sp.category === 'event' ? 'amber' : sp.category === 'view' ? 'blue' : 'muted';

        html += '<div class="ss-dash-tl-row">'
          + '<div class="ss-dash-tl-label" style="padding-left:' + (8 + indent) + 'px" title="' + esc(tooltip) + '">'
          + '<span class="ss-dash-badge ss-dash-badge-' + badgeCat + '" style="font-size:9px;margin-right:4px">' + esc(catLabel) + '</span>'
          + esc(sp.label.length > 50 ? sp.label.slice(0, 50) + '...' : sp.label)
          + '</div>'
          + '<div class="ss-dash-tl-track">'
          + '<div class="ss-dash-tl-bar ss-dash-tl-bar-' + esc(sp.category) + '" style="left:' + leftPct + '%;width:' + widthPct + '%" title="' + esc(tooltip) + '"></div>'
          + '</div>'
          + '<span class="ss-dash-tl-dur">' + sp.duration.toFixed(2) + 'ms</span>'
          + '</div>';
      }
    }

    // Warnings
    var warnings = trace.warnings || [];
    if (typeof warnings === 'string') { try { warnings = JSON.parse(warnings); } catch (e) { warnings = []; } }
    if (warnings.length > 0) {
      html += '<div class="ss-dash-tl-warnings">'
        + '<div class="ss-dash-tl-warnings-title">Warnings (' + warnings.length + ')</div>';
      warnings.forEach(function (w) {
        html += '<div class="ss-dash-tl-warning">' + esc(w) + '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  };

  // ── Cache ─────────────────────────────────────────────────────
  var fetchCache = function () {
    fetchJSON(API + '/cache')
      .then(function (data) { renderCache(data); })
      .catch(function () { setInner('ss-dash-cache-body', '<div class="ss-dash-empty">Cache not available</div>'); });
  };

  var renderCache = function (data) {
    var stats = data.stats || {};
    var keys = data.keys || data.data || [];

    var statsHtml = '<div class="ss-dash-cache-stats">'
      + '<div class="ss-dash-cache-stat"><span class="ss-dash-cache-stat-label">Hit Rate:</span><span class="ss-dash-cache-stat-value">' + (stats.hitRate || 0).toFixed(1) + '%</span></div>'
      + '<div class="ss-dash-cache-stat"><span class="ss-dash-cache-stat-label">Hits:</span><span class="ss-dash-cache-stat-value">' + (stats.hits || 0) + '</span></div>'
      + '<div class="ss-dash-cache-stat"><span class="ss-dash-cache-stat-label">Misses:</span><span class="ss-dash-cache-stat-value">' + (stats.misses || 0) + '</span></div>'
      + '<div class="ss-dash-cache-stat"><span class="ss-dash-cache-stat-label">Keys:</span><span class="ss-dash-cache-stat-value">' + (stats.keyCount || keys.length || 0) + '</span></div>'
      + '</div>';

    setInner('ss-dash-cache-stats-area', statsHtml);

    if (keys.length === 0) {
      setInner('ss-dash-cache-body', '<div class="ss-dash-empty">No cache keys found</div>');
      return;
    }

    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th>Key</th>'
      + '<th style="width:80px">Type</th>'
      + '<th style="width:80px">TTL</th>'
      + '<th style="width:80px">Size</th>'
      + '</tr></thead><tbody>';

    keys.forEach(function (k) {
      html += '<tr class="ss-dash-clickable" data-cache-key="' + esc(k.key || '') + '">'
        + '<td style="color:var(--ss-sql-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(k.key || '') + '">' + esc(k.key || '') + '</td>'
        + '<td style="color:var(--ss-muted)">' + esc(k.type || '-') + '</td>'
        + '<td style="color:var(--ss-muted)">' + (k.ttl != null ? k.ttl + 's' : '-') + '</td>'
        + '<td style="color:var(--ss-dim)">' + (k.size != null ? k.size + 'B' : '-') + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-cache-body', html);

    var body = document.getElementById('ss-dash-cache-body');
    if (body) {
      body.querySelectorAll('[data-cache-key]').forEach(function (row) {
        row.addEventListener('click', function () {
          var key = row.getAttribute('data-cache-key');
          fetchJSON(API + '/cache/' + encodeURIComponent(key))
            .then(function (data) {
              setInner('ss-dash-cache-detail', '<div class="ss-dash-cache-detail"><strong>Key:</strong> ' + esc(key) + '<pre class="ss-dash-data-full" style="display:block">' + esc(JSON.stringify(data.value || data, null, 2)) + '</pre></div>');
            })
            .catch(function () { /* ignore */ });
        });
      });
    }
  };

  // ── Jobs ──────────────────────────────────────────────────────
  var jobStatusFilter = '';

  var fetchJobs = function () {
    var ps = getPage('jobs');
    var params = 'page=' + ps.page + '&limit=' + PER_PAGE;
    if (jobStatusFilter) params += '&status=' + jobStatusFilter;

    fetchJSON(API + '/jobs?' + params)
      .then(function (data) { renderJobs(data); })
      .catch(function () { setInner('ss-dash-jobs-body', '<div class="ss-dash-empty">Jobs/Queue not available</div>'); });
  };

  var renderJobs = function (data) {
    var items = data.data || data.jobs || [];
    var stats = data.stats || {};
    var ps = getPage('jobs');
    ps.total = data.meta ? data.meta.total : (data.total || items.length);

    var statsHtml = '<div class="ss-dash-job-stats">'
      + '<div class="ss-dash-job-stat"><span class="ss-dash-job-stat-label">Active:</span><span class="ss-dash-job-stat-value">' + (stats.active || 0) + '</span></div>'
      + '<div class="ss-dash-job-stat"><span class="ss-dash-job-stat-label">Waiting:</span><span class="ss-dash-job-stat-value">' + (stats.waiting || 0) + '</span></div>'
      + '<div class="ss-dash-job-stat"><span class="ss-dash-job-stat-label">Delayed:</span><span class="ss-dash-job-stat-value">' + (stats.delayed || 0) + '</span></div>'
      + '<div class="ss-dash-job-stat"><span class="ss-dash-job-stat-label">Completed:</span><span class="ss-dash-job-stat-value">' + (stats.completed || 0) + '</span></div>'
      + '<div class="ss-dash-job-stat"><span class="ss-dash-job-stat-label">Failed:</span><span class="ss-dash-job-stat-value" style="color:var(--ss-red-fg)">' + (stats.failed || 0) + '</span></div>'
      + '</div>';
    setInner('ss-dash-jobs-stats-area', statsHtml);

    if (items.length === 0) {
      setInner('ss-dash-jobs-body', '<div class="ss-dash-empty">No jobs found</div>');
      renderPagination('jobs', ps);
      return;
    }

    var CT = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var html = '<table class="ss-dash-table" style="table-layout:fixed"><thead><tr>'
      + '<th style="width:50px">ID</th>'
      + '<th style="width:160px">Name</th>'
      + '<th style="width:80px">Status</th>'
      + '<th>Payload</th>'
      + '<th style="width:55px">Tries</th>'
      + '<th style="width:75px">Duration</th>'
      + '<th style="width:60px">Time</th>'
      + '<th style="width:50px"></th>'
      + '</tr></thead><tbody>';

    items.forEach(function (j) {
      var statusBadge = j.status === 'failed' ? 'red' : j.status === 'completed' ? 'green' : j.status === 'active' ? 'blue' : 'amber';
      html += '<tr class="ss-dash-clickable" data-job-id="' + j.id + '">'
        + '<td style="color:var(--ss-dim)">' + j.id + '</td>'
        + '<td style="color:var(--ss-sql-color);' + CT + '" title="' + esc(j.name || '') + '">' + esc(j.name || '') + '</td>'
        + '<td><span class="ss-dash-badge ss-dash-badge-' + statusBadge + '">' + esc(j.status || '') + '</span></td>'
        + '<td style="color:var(--ss-muted);font-size:10px;' + CT + '">' + esc(j.payload ? compactPreview(j.payload, 60) : '-') + '</td>'
        + '<td style="color:var(--ss-muted);text-align:center">' + (j.attempts || j.attemptsMade || 0) + '</td>'
        + '<td class="ss-dash-duration">' + (j.duration != null ? j.duration.toFixed(0) + 'ms' : '-') + '</td>'
        + '<td class="ss-dash-event-time" style="white-space:nowrap">' + timeAgo(j.timestamp || j.processedOn || j.created_at) + '</td>'
        + '<td>' + (j.status === 'failed' ? '<button class="ss-dash-retry-btn" data-retry-id="' + j.id + '">Retry</button>' : '') + '</td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    setInner('ss-dash-jobs-body', html);
    renderPagination('jobs', ps);

    // Retry buttons
    var body = document.getElementById('ss-dash-jobs-body');
    if (body) {
      body.querySelectorAll('.ss-dash-retry-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.getAttribute('data-retry-id');
          btn.textContent = '...';
          btn.disabled = true;
          fetch(API + '/jobs/' + id + '/retry', { method: 'POST', credentials: 'same-origin' })
            .then(function () { btn.textContent = 'OK'; setTimeout(fetchJobs, 1000); })
            .catch(function () { btn.textContent = 'Retry'; btn.disabled = false; });
        });
      });
    }
  };

  // Job status filter buttons
  root.querySelectorAll('[data-ss-job-status]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      root.querySelectorAll('[data-ss-job-status]').forEach(function (b) { b.classList.remove('ss-dash-active'); });
      btn.classList.add('ss-dash-active');
      jobStatusFilter = btn.getAttribute('data-ss-job-status');
      getPage('jobs').page = 1;
      fetchJobs();
    });
  });

  // ── Config ────────────────────────────────────────────────────
  // ── Config: state ─────────────────────────────────────────────
  var configRawData = null;
  var configActiveTab = 'config';
  var configSearchTerm = '';

  /** Check if a value is a redacted marker object. */
  var isRedactedObj = function (val) {
    return val && typeof val === 'object' && val.__redacted === true;
  };

  /** Render a redacted value with reveal/copy buttons. */
  var renderRedacted = function (val, prefix) {
    var cls = prefix + '-config-redacted';
    var realVal = esc(val.value || '');
    return '<span class="' + cls + ' ' + prefix + '-redacted-wrap" data-redacted-value="' + realVal + '">'
      + '<span class="' + prefix + '-redacted-display">' + esc(val.display) + '</span>'
      + '<span class="' + prefix + '-redacted-real" style="display:none">' + realVal + '</span>'
      + '<button type="button" class="' + prefix + '-redacted-reveal" title="Reveal value">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      + '</button>'
      + '<button type="button" class="' + prefix + '-redacted-copy" title="Copy value">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
      + '</button>'
      + '</span>';
  };

  /** Bind reveal/copy click handlers inside a container. */
  var bindRedactedButtons = function (container, prefix) {
    container.querySelectorAll('.' + prefix + '-redacted-reveal').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wrap = btn.closest('.' + prefix + '-redacted-wrap');
        if (!wrap) return;
        var display = wrap.querySelector('.' + prefix + '-redacted-display');
        var real = wrap.querySelector('.' + prefix + '-redacted-real');
        if (!display || !real) return;
        var isHidden = real.style.display === 'none';
        display.style.display = isHidden ? 'none' : '';
        real.style.display = isHidden ? '' : 'none';
        // Toggle icon between eye and eye-off
        btn.innerHTML = isHidden
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        btn.title = isHidden ? 'Hide value' : 'Reveal value';
      });
    });

    container.querySelectorAll('.' + prefix + '-redacted-copy').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var wrap = btn.closest('.' + prefix + '-redacted-wrap');
        if (!wrap) return;
        var val = wrap.getAttribute('data-redacted-value');
        if (!val) return;
        navigator.clipboard.writeText(val).then(function () {
          btn.innerHTML = '\u2713';
          btn.classList.add(prefix + '-copy-row-ok');
          setTimeout(function () {
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            btn.classList.remove(prefix + '-copy-row-ok');
          }, 1200);
        });
      });
    });
  };

  var fetchConfig = function () {
    fetchJSON(API + '/config')
      .then(function (data) {
        sectionLoaded.config = true;
        configRawData = data;
        renderConfig();
      })
      .catch(function () { setInner('ss-dash-config-body', '<div class="ss-dash-empty">Config not available</div>'); });
  };

  var renderConfig = function () {
    var body = document.getElementById('ss-dash-config-body');
    if (!body || !configRawData) return;

    var source = configActiveTab === 'env' ? (configRawData.env || {}) : (configRawData.config || configRawData);

    // Flatten to dot-notation paths for search
    var flat = flattenConfig(source, '');
    var filtered = flat;
    var term = configSearchTerm.toLowerCase();
    if (term) {
      filtered = flat.filter(function (item) {
        var valStr = isRedactedObj(item.value) ? item.value.display : String(item.value);
        return item.path.toLowerCase().indexOf(term) !== -1 || valStr.toLowerCase().indexOf(term) !== -1;
      });
    }

    var html = '';

    if (configActiveTab === 'env') {
      // Env vars: simple table
      html += '<div class="ss-dash-config-table-wrap"><table class="ss-dash-table ss-dash-config-env-table"><thead><tr>'
        + '<th>Variable</th><th>Value</th><th style="width:36px"></th>'
        + '</tr></thead><tbody>';
      filtered.forEach(function (item) {
        var redacted = isRedactedObj(item.value);
        var displayVal = redacted ? item.value.display : String(item.value);
        var copyVal = esc(item.path + '=' + displayVal);
        html += '<tr>'
          + '<td class="ss-dash-env-key"><span class="ss-dash-config-key">' + highlightMatch(esc(item.path), term) + '</span></td>'
          + '<td class="ss-dash-env-val">' + (redacted ? renderRedacted(item.value, 'ss-dash') : '<span class="ss-dash-config-val">' + highlightMatch(esc(displayVal), term) + '</span>') + '</td>'
          + '<td>' + (redacted ? '' : '<button class="ss-dash-copy-row-btn" data-copy-val="' + copyVal + '" title="Copy">\u2398</button>') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
    } else {
      // App config: grouped by top-level section
      if (term) {
        // Search mode: flat list of matching paths
        html += '<div class="ss-dash-config-table-wrap"><table class="ss-dash-table"><thead><tr>'
          + '<th>Path</th><th>Value</th><th style="width:36px"></th>'
          + '</tr></thead><tbody>';
        filtered.forEach(function (item) {
          var redacted = isRedactedObj(item.value);
          var displayVal = redacted ? item.value.display : String(item.value);
          var copyVal = esc(item.path + ': ' + displayVal);
          html += '<tr>'
            + '<td><span class="ss-dash-config-key" style="white-space:nowrap">' + highlightMatch(esc(item.path), term) + '</span></td>'
            + '<td>' + (redacted ? renderRedacted(item.value, 'ss-dash') : '<span class="ss-dash-config-val" style="word-break:break-all">' + highlightMatch(esc(displayVal), term) + '</span>') + '</td>'
            + '<td>' + (redacted ? '' : '<button class="ss-dash-copy-row-btn" data-copy-val="' + copyVal + '" title="Copy">\u2398</button>') + '</td>'
            + '</tr>';
        });
        html += '</tbody></table></div>';
        html += '<div style="padding:4px 16px;font-size:10px;color:var(--ss-muted)">' + filtered.length + ' of ' + flat.length + ' entries</div>';
      } else {
        // Browse mode: collapsible sections by top-level key
        var topKeys = Object.keys(source);
        html += '<div class="ss-dash-config-sections">';
        topKeys.forEach(function (sectionKey) {
          var sectionVal = source[sectionKey];
          var childCount = countLeaves(sectionVal);
          var isObj = typeof sectionVal === 'object' && sectionVal !== null && !sectionVal.__redacted;

          html += '<div class="ss-dash-config-section">';
          if (isObj) {
            html += '<div class="ss-dash-config-section-header" data-config-section="' + esc(sectionKey) + '">'
              + '<span class="ss-dash-config-toggle">\u25B6</span>'
              + '<span class="ss-dash-config-key">' + esc(sectionKey) + '</span>'
              + '<span class="ss-dash-config-count">' + childCount + ' entries</span>'
              + '</div>';
            html += '<div class="ss-dash-config-section-body" style="display:none">';
            html += renderConfigTable(sectionVal, sectionKey);
            html += '</div>';
          } else {
            html += '<div class="ss-dash-config-section-header ss-dash-config-leaf">'
              + '<span class="ss-dash-config-key">' + esc(sectionKey) + '</span>'
              + '<span class="ss-dash-config-val" style="margin-left:8px">' + esc(String(sectionVal)) + '</span>'
              + '</div>';
          }
          html += '</div>';
        });
        html += '</div>';
      }
    }

    body.innerHTML = html;

    // Bind section toggles
    body.querySelectorAll('[data-config-section]').forEach(function (header) {
      header.addEventListener('click', function () {
        var sectionBody = header.nextElementSibling;
        if (!sectionBody) return;
        var isHidden = sectionBody.style.display === 'none';
        sectionBody.style.display = isHidden ? '' : 'none';
        var toggle = header.querySelector('.ss-dash-config-toggle');
        if (toggle) toggle.textContent = isHidden ? '\u25BC' : '\u25B6';
      });
    });

    // Bind row copy buttons
    body.querySelectorAll('.ss-dash-copy-row-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var val = btn.getAttribute('data-copy-val');
        if (!val) return;
        navigator.clipboard.writeText(val).then(function () {
          btn.textContent = '\u2713';
          btn.classList.add('ss-dash-copy-row-ok');
          setTimeout(function () { btn.textContent = '\u2398'; btn.classList.remove('ss-dash-copy-row-ok'); }, 1200);
        });
      });
    });

    // Bind redacted reveal/copy buttons
    bindRedactedButtons(body, 'ss-dash');
  };

  /** Render a nested object as a flat key-value table. */
  var renderConfigTable = function (obj, prefix) {
    var flat = flattenConfig(obj, prefix);
    var html = '<table class="ss-dash-table ss-dash-config-inner-table"><thead><tr>'
      + '<th style="width:35%">Key</th><th>Value</th><th style="width:36px"></th>'
      + '</tr></thead><tbody>';
    flat.forEach(function (item) {
      // Show relative path (strip the section prefix)
      var relPath = item.path.indexOf(prefix + '.') === 0 ? item.path.slice(prefix.length + 1) : item.path;
      var redacted = isRedactedObj(item.value);
      var displayVal = redacted ? item.value.display : String(item.value);
      var copyVal = esc(item.path + ': ' + displayVal);
      var valStr = redacted ? item.value.display : ((typeof item.value === 'object' && item.value !== null) ? JSON.stringify(item.value) : String(item.value));
      html += '<tr>'
        + '<td title="' + esc(relPath) + '"><span class="ss-dash-config-key">' + esc(relPath) + '</span></td>'
        + '<td title="' + esc(valStr) + '">' + (redacted ? renderRedacted(item.value, 'ss-dash') : '<span class="ss-dash-config-val">' + formatConfigValue(item.value) + '</span>') + '</td>'
        + '<td>' + (redacted ? '' : '<button class="ss-dash-copy-row-btn" data-copy-val="' + copyVal + '" title="Copy">\u2398</button>') + '</td>'
        + '</tr>';
    });
    html += '</tbody></table>';
    return html;
  };

  /** Flatten a nested object into [{path, value}] dot-notation entries. */
  var flattenConfig = function (obj, prefix) {
    var results = [];
    if (typeof obj !== 'object' || obj === null) {
      results.push({ path: prefix, value: obj });
      return results;
    }
    var keys = Object.keys(obj);
    keys.forEach(function (key) {
      var fullPath = prefix ? prefix + '.' + key : key;
      var val = obj[key];
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && !val.__redacted) {
        results = results.concat(flattenConfig(val, fullPath));
      } else {
        results.push({ path: fullPath, value: val });
      }
    });
    return results;
  };

  /** Count leaf values in a nested object. */
  var countLeaves = function (obj) {
    if (typeof obj !== 'object' || obj === null || obj.__redacted) return 1;
    var count = 0;
    Object.keys(obj).forEach(function (k) { count += countLeaves(obj[k]); });
    return count;
  };

  /** Format a config value with type-aware coloring. */
  var formatConfigValue = function (val) {
    if (val === null || val === undefined) return '<span style="color:var(--ss-dim)">null</span>';
    if (val === true) return '<span style="color:var(--ss-green-fg)">true</span>';
    if (val === false) return '<span style="color:var(--ss-red-fg)">false</span>';
    if (typeof val === 'number') return '<span style="color:var(--ss-amber-fg)">' + val + '</span>';
    if (Array.isArray(val)) {
      var items = val.map(function (item) {
        if (item === null || item === undefined) return 'null';
        if (typeof item === 'object') {
          try { return JSON.stringify(item); } catch (e) { return String(item); }
        }
        return String(item);
      });
      return '<span style="color:var(--ss-purple-fg)">[' + esc(items.join(', ')) + ']</span>';
    }
    if (typeof val === 'object') {
      try { return '<span style="color:var(--ss-dim)">' + esc(JSON.stringify(val, null, 2)) + '</span>'; } catch (e) { /* fall through */ }
    }
    return esc(String(val));
  };

  /** Highlight matching substring in text. */
  var highlightMatch = function (text, term) {
    if (!term) return text;
    var idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx) + '<mark class="ss-dash-config-match">' + text.slice(idx, idx + term.length) + '</mark>' + text.slice(idx + term.length);
  };

  // ── Config: tab switching ───────────────────────────────────────
  document.querySelectorAll('[data-config-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      configActiveTab = btn.getAttribute('data-config-tab');
      document.querySelectorAll('[data-config-tab]').forEach(function (b) { b.classList.remove('ss-dash-active'); });
      btn.classList.add('ss-dash-active');
      renderConfig();
    });
  });

  // ── Config: search ──────────────────────────────────────────────
  var configSearchEl = document.getElementById('ss-dash-config-search');
  if (configSearchEl) {
    var configSearchTimer = null;
    configSearchEl.addEventListener('input', function () {
      clearTimeout(configSearchTimer);
      configSearchTimer = setTimeout(function () {
        configSearchTerm = configSearchEl.value.trim();
        renderConfig();
      }, 200);
    });
  }

  // ── Config: expand/collapse all ─────────────────────────────────
  var expandAllBtn = document.getElementById('ss-dash-config-expand-all');
  var collapseAllBtn = document.getElementById('ss-dash-config-collapse-all');
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', function () {
      var body = document.getElementById('ss-dash-config-body');
      if (!body) return;
      body.querySelectorAll('.ss-dash-config-section-body').forEach(function (el) { el.style.display = ''; });
      body.querySelectorAll('.ss-dash-config-toggle').forEach(function (el) { el.textContent = '\u25BC'; });
    });
  }
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', function () {
      var body = document.getElementById('ss-dash-config-body');
      if (!body) return;
      body.querySelectorAll('.ss-dash-config-section-body').forEach(function (el) { el.style.display = 'none'; });
      body.querySelectorAll('.ss-dash-config-toggle').forEach(function (el) { el.textContent = '\u25B6'; });
    });
  }

  // ── Config: copy button ─────────────────────────────────────────
  var configCopyBtn = document.getElementById('ss-dash-config-copy');
  if (configCopyBtn) {
    configCopyBtn.addEventListener('click', function () {
      if (!configRawData) return;
      var source = configActiveTab === 'env' ? (configRawData.env || {}) : (configRawData.config || configRawData);
      navigator.clipboard.writeText(JSON.stringify(source, null, 2)).then(function () {
        configCopyBtn.textContent = 'Copied!';
        setTimeout(function () { configCopyBtn.textContent = 'Copy JSON'; }, 1500);
      });
    });
  }

  // ── Custom Panes ──────────────────────────────────────────────
  var customPaneState = {};
  customPanes.forEach(function (cp) {
    customPaneState[cp.id] = { data: [], fetched: false, filter: '' };
  });

  var getNestedValue = function (obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  };

  var fetchCustomPane = function (pane) {
    fetchJSON(pane.endpoint)
      .then(function (data) {
        var key = pane.dataKey || pane.id;
        var rows = getNestedValue(data, key) || (Array.isArray(data) ? data : []);
        customPaneState[pane.id].data = rows;
        customPaneState[pane.id].fetched = true;
        renderCustomPane(pane);
      })
      .catch(function () {
        setInner('ss-dash-' + pane.id + '-body', '<div class="ss-dash-empty">Failed to load ' + esc(pane.label) + '</div>');
      });
  };

  var renderCustomPane = function (pane) {
    var state = customPaneState[pane.id];
    if (!state) return;
    var bodyEl = document.getElementById('ss-dash-' + pane.id + '-body');
    var summaryEl = document.getElementById('ss-dash-' + pane.id + '-summary');
    if (!bodyEl) return;

    var filter = state.filter.toLowerCase();
    var rows = state.data;

    if (summaryEl) summaryEl.textContent = rows.length + ' ' + pane.label.toLowerCase();

    if (filter) {
      var searchCols = pane.columns.filter(function (c) { return c.searchable; });
      if (searchCols.length > 0) {
        rows = rows.filter(function (row) {
          return searchCols.some(function (c) {
            var v = row[c.key];
            return v != null && String(v).toLowerCase().indexOf(filter) !== -1;
          });
        });
      }
    }

    if (rows.length === 0) {
      bodyEl.innerHTML = '<div class="ss-dash-empty">' + (filter ? 'No matching ' + esc(pane.label.toLowerCase()) : 'No ' + esc(pane.label.toLowerCase()) + ' recorded yet') + '</div>';
      return;
    }

    var html = '<table class="ss-dash-table"><thead><tr>';
    pane.columns.forEach(function (col) {
      html += '<th' + (col.width ? ' style="width:' + col.width + '"' : '') + '>' + esc(col.label) + '</th>';
    });
    html += '</tr></thead><tbody>';

    rows.forEach(function (row) {
      html += '<tr>';
      pane.columns.forEach(function (col) {
        var val = row[col.key];
        html += '<td>' + formatCell(val, col) + '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    bodyEl.innerHTML = html;
  };

  // Bind search/clear for custom panes
  customPanes.forEach(function (cp) {
    var searchInput = document.getElementById('ss-dash-search-' + cp.id);
    var clearBtn = document.getElementById('ss-dash-' + cp.id + '-clear');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        customPaneState[cp.id].filter = searchInput.value;
        renderCustomPane(cp);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        customPaneState[cp.id].data = [];
        customPaneState[cp.id].fetched = false;
        if (searchInput) searchInput.value = '';
        customPaneState[cp.id].filter = '';
        renderCustomPane(cp);
      });
    }
  });

  // ── Pagination ────────────────────────────────────────────────
  var renderPagination = function (section, ps) {
    var el = document.getElementById('ss-dash-pagination-' + section);
    if (!el) return;

    var totalPages = Math.ceil(ps.total / PER_PAGE) || 1;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    var html = '<button class="ss-dash-page-btn" data-page="prev" ' + (ps.page <= 1 ? 'disabled' : '') + '>&laquo; Prev</button>';
    html += '<span class="ss-dash-page-info">Page ' + ps.page + ' of ' + totalPages + '</span>';
    html += '<button class="ss-dash-page-btn" data-page="next" ' + (ps.page >= totalPages ? 'disabled' : '') + '>Next &raquo;</button>';

    el.innerHTML = html;
    el.querySelectorAll('.ss-dash-page-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dir = btn.getAttribute('data-page');
        if (dir === 'prev' && ps.page > 1) ps.page--;
        else if (dir === 'next' && ps.page < totalPages) ps.page++;
        loadSection(section);
      });
    });
  };

  // ── Badge updates ─────────────────────────────────────────────
  var updateBadge = function (section, count) {
    var badge = root.querySelector('[data-ss-section="' + section + '"] .ss-dash-nav-badge');
    if (badge && count != null) badge.textContent = count;
  };

  // ── DOM helpers ───────────────────────────────────────────────
  var setInner = function (id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  var bindDataExpand = function (containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.ss-dash-data-preview').forEach(function (el) {
      el.addEventListener('click', function () {
        var idx = el.getAttribute('data-ev-idx');
        var pre = document.getElementById('ss-dash-evdata-' + idx);
        if (pre) {
          var open = pre.style.display !== 'none';
          pre.style.display = open ? 'none' : 'block';
          el.style.display = open ? '' : 'none';
        }
      });
    });
    container.querySelectorAll('.ss-dash-data-full').forEach(function (el) {
      el.addEventListener('click', function () {
        el.style.display = 'none';
        var idx = el.id.replace('ss-dash-evdata-', '');
        var preview = container.querySelector('[data-ev-idx="' + idx + '"]');
        if (preview) preview.style.display = '';
      });
    });
  };

  // ── Auto-refresh ──────────────────────────────────────────────
  var startRefresh = function () {
    stopRefresh();
    if (isLive) return; // Transmit handles live updates
    refreshTimer = setInterval(function () {
      loadSection(activeSection);
    }, activeSection === 'overview' ? 5000 : 3000);
  };

  var stopRefresh = function () {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  };

  // ── Transmit real-time ────────────────────────────────────────
  var ssLog = function (msg, data) {
    var prefix = '%c[server-stats]%c ';
    if (data !== undefined) {
      console.log(prefix + msg, 'color:#34d399;font-weight:bold', 'color:inherit', data);
    } else {
      console.log(prefix + msg, 'color:#34d399;font-weight:bold', 'color:inherit');
    }
  };
  var ssWarn = function (msg, data) {
    var prefix = '[server-stats] ';
    if (data !== undefined) {
      console.warn(prefix + msg, data);
    } else {
      console.warn(prefix + msg);
    }
  };

  var setConnectionStatus = function (status) {
    var dot = document.getElementById('ss-dash-live-dot');
    var label = document.getElementById('ss-dash-live-label');
    if (status === 'live') {
      isLive = true;
      if (dot) dot.classList.add('ss-dash-connected');
      if (label) { label.textContent = 'Live'; label.classList.add('ss-dash-connected'); }
      stopRefresh();
    } else {
      isLive = false;
      if (dot) dot.classList.remove('ss-dash-connected');
      if (label) { label.textContent = 'Polling'; label.classList.remove('ss-dash-connected'); }
      startRefresh();
    }
  };

  var initTransmit = function () {
    ssLog('Initializing real-time connection...');

    if (typeof Transmit === 'undefined' && typeof window.Transmit === 'undefined') {
      ssWarn('Transmit client not found. The @adonisjs/transmit-client package may not be installed. Falling back to polling.');
      startRefresh();
      return;
    }

    ssLog('Transmit client found, creating subscription...');

    try {
      var TransmitClass = typeof Transmit !== 'undefined' ? Transmit : window.Transmit;
      ssLog('TransmitClass type: ' + typeof TransmitClass);

      // onSubscription and onReconnectFailed are constructor options, NOT subscription methods
      var transmit = new TransmitClass({
        baseUrl: window.location.origin,
        onSubscription: function (channel) {
          ssLog('Subscription active on channel: ' + channel + ' — switched to live mode');
          setConnectionStatus('live');
        },
        onReconnectAttempt: function (attempt) {
          ssLog('Reconnect attempt #' + attempt);
        },
        onReconnectFailed: function () {
          ssWarn('Transmit reconnection failed — falling back to polling');
          setConnectionStatus('polling');
        },
        onSubscribeFailed: function (channel) {
          ssWarn('Subscribe failed for channel: ' + channel + ' — falling back to polling');
          setConnectionStatus('polling');
        }
      });

      transmitSub = transmit.subscription('server-stats/dashboard');
      ssLog('Subscription instance created');

      // Start polling while we wait for subscription to connect
      startRefresh();

      transmitSub.onMessage(function (message) {
        try {
          var event = typeof message === 'string' ? JSON.parse(message) : message;
          var kind = event.type || (event.avgResponseTime !== undefined ? 'overview' : 'unknown');
          ssLog('Live event received: ' + kind);
          handleLiveEvent(event);
        } catch (e) { /* ignore */ }
      });

      ssLog('Calling transmitSub.create()...');
      var createResult = transmitSub.create();
      if (createResult && typeof createResult.then === 'function') {
        createResult.then(function () {
          ssLog('transmitSub.create() resolved — subscription is active');
        }).catch(function (err) {
          ssWarn('transmitSub.create() rejected:', err && err.message ? err.message : err);
          setConnectionStatus('polling');
        });
      }
    } catch (e) {
      ssWarn('Transmit init error:', e && e.message ? e.message : e);
      startRefresh();
    }
  };

  var handleLiveEvent = function (event) {
    // Detect overview data broadcast (has avgResponseTime but no type)
    if (event && typeof event.avgResponseTime === 'number') {
      if (activeSection === 'overview') {
        renderOverview(event, null);
      }
      return;
    }

    // Typed events for specific sections
    var type = event.type;
    var sectionMap = {
      'request': 'requests',
      'query': 'queries',
      'event': 'events',
      'log': 'logs',
      'email': 'emails',
      'trace': 'timeline'
    };
    var section = sectionMap[type];

    if (activeSection === 'overview') { fetchOverview(); return; }
    if (section && section === activeSection) { loadSection(activeSection); }
  };

  // ── Hash-based routing ────────────────────────────────────────
  var parseHash = function () {
    var hash = location.hash.replace('#', '');
    var parts = hash.split('?');
    var section = parts[0] || 'overview';
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (p) {
        var kv = p.split('=');
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    return { section: section, params: params };
  };

  var applyRouteParams = function (route) {
    var section = route.section;
    if (route.params.requestId && section === 'logs') {
      logReqIdFilter = route.params.requestId;
      var input = document.getElementById('ss-dash-log-reqid-input');
      if (input) input.value = logReqIdFilter;
    }
    if (route.params.level && section === 'logs') {
      logDeepLevelFilter = route.params.level;
    }
    if (route.params.url && section === 'requests') {
      requestUrlFilter = route.params.url;
    }
    if (route.params.status && section === 'requests') {
      requestStatusFilter = route.params.status;
    }
    if (route.params.status && section === 'emails') {
      emailStatusFilter = route.params.status;
    }
    if (route.params.event_name && section === 'events') {
      eventNameFilter = route.params.event_name;
    }
    if (route.params.status && section === 'jobs') {
      jobStatusFilter = route.params.status;
    }
  };

  var initRoute = function () {
    var route = parseHash();
    var section = route.section;

    // Validate section exists
    var valid = ['overview', 'requests', 'queries', 'events', 'routes', 'logs', 'emails', 'timeline', 'cache', 'jobs', 'config'];
    customPanes.forEach(function (cp) { valid.push(cp.id); });
    if (valid.indexOf(section) === -1) section = 'overview';

    // Apply deep link params
    applyRouteParams({ section: section, params: route.params });

    // Switch to section
    activeSection = section;
    navItems.forEach(function (item) {
      item.classList.toggle('ss-dash-active', item.getAttribute('data-ss-section') === section);
    });
    root.querySelectorAll('.ss-dash-pane').forEach(function (p) {
      p.classList.toggle('ss-dash-active', p.id === 'ss-dash-pane-' + section);
    });

    loadSection(section);
  };

  window.addEventListener('hashchange', function () {
    var route = parseHash();
    if (route.section !== activeSection) {
      applyRouteParams(route);
      switchSection(route.section);
    } else if (Object.keys(route.params).length > 0) {
      applyRouteParams(route);
      loadSection(activeSection);
    }
  });

  // ── Init ──────────────────────────────────────────────────────
  initRoute();
  initTransmit();
})();
