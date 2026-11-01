/* Marketing Hub chassis: three panels (navigation · main · drawer).
 * Knows nothing about the client. Client screens register themselves in views.js:
 *   Hub.nav      = [{ sec, off?, items:[{ id, label, route, cnt? }] }]   left menu, first-level entries only; off = shown, not linked
 *   Hub.home     = the route an empty address opens
 *   Hub.route(prefix, fn(rest, query) → html)                      main panel, longest prefix wins
 *   Hub.drawer(type, fn(id) → { title, tabs:[[key,label,html]] })  right panel, opened by [data-d="type:id"]
 * Rule: every entity exists once; more information = tabs on it.
 * An open drawer adds d=type:id&dt=tab to the hash, so any drawer has a permalink. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ROUTES = [], DRAWERS = {}, onRender = [];
  var state = { brand: 'all', path: '', query: {}, d: null, dt: null };
  try { state.brand = localStorage.getItem('lc_hub_brand') || 'all'; } catch (x) {}

  /* ─── number formats ─── */
  var n0 = function (v) { return v == null ? '–' : Math.round(v).toLocaleString('en-US'); };
  var usd = function (v) { return v == null ? '–' : '$' + Math.round(v).toLocaleString('en-US'); };
  var usd2 = function (v) { return v == null ? '–' : '$' + Number(v).toFixed(2); };
  var pct = function (v, d) { return v == null ? '–' : (v * 100).toFixed(d == null ? 1 : d) + '%'; };
  var k = function (v) { return v == null ? '–' : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(v)); };
  var day = function (s) { if (!s) return '–'; var d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

  /* ─── routing ─── */
  function parse() {
    var raw = location.hash.replace(/^#/, '') || Hub.home, i = raw.indexOf('?'), q = {};
    var path = i < 0 ? raw : raw.slice(0, i);
    if (i >= 0) new URLSearchParams(raw.slice(i + 1)).forEach(function (v, key) { q[key] = v; });
    return { path: path, query: q };
  }
  function hashFor(path, query) {
    var u = new URLSearchParams(); Object.keys(query).forEach(function (key) { if (query[key] != null && query[key] !== '') u.set(key, query[key]); });
    var s = u.toString(); return '#' + path + (s ? '?' + s : '');
  }
  function find(path) {
    var best = null;
    ROUTES.forEach(function (r) { if ((path === r.prefix || path.indexOf(r.prefix + '/') === 0) && (!best || r.prefix.length > best.prefix.length)) best = r; });
    return best;
  }
  function render() {
    var p = parse(); state.path = p.path; state.query = p.query;
    var r = find(p.path), main = $('app-main');
    var rest = r ? p.path.slice(r.prefix.length + 1) : '';
    main.innerHTML = r ? crumbs(p.path) + r.fn(rest, p.query) : '<h1>Not found</h1><p class="lead">No screen at ' + esc(p.path) + '.</p>';
    main.scrollTop = 0;
    drawTree(); document.body.setAttribute('data-brand', state.brand);
    onRender.forEach(function (fn) { fn(); });
    if (p.query.d) openDrawer(p.query.d, p.query.dt, true); else closeDrawer(true);
  }
  function crumbs(path) {
    var parts = path.split('/').filter(Boolean), acc = '', html = [], titles = Hub.titles || {};
    parts.forEach(function (seg, i) {
      acc += '/' + seg;
      var label = titles[acc] || seg.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
      html.push(i === parts.length - 1 ? '<b>' + esc(label) + '</b>' : '<a href="#' + acc + '">' + esc(label) + '</a>');
    });
    return parts.length > 1 ? '<nav class="crumbs" aria-label="Breadcrumb">' + html.join('<span class="sep">/</span>') + '</nav>' : '';
  }

  /* ─── navigation ─── */
  function drawTree() {
    var f = ($('app-filter').value || '').toLowerCase(), cur = state.path;
    $('app-tree').innerHTML = Hub.nav.map(function (s) {
      var rows = s.items.filter(function (it) { return !f || it.label.toLowerCase().indexOf(f) >= 0; });
      if (!rows.length) return '';
      return '<div class="sec">' + esc(s.sec) + '</div><ul>' + rows.map(function (it) {
        if (s.off) return '<li><span class="row off" aria-disabled="true"><span>' + esc(it.label) + '</span></span></li>';
        var on = cur === it.route || cur.indexOf(it.route + '/') === 0;
        var cnt = typeof it.cnt === 'function' ? it.cnt() : it.cnt;
        return '<li><a class="row' + (on ? ' cur' : '') + '" href="#' + it.route + '"' + (on ? ' aria-current="page"' : '') + '><span>' + esc(it.label) + '</span>' + (cnt != null ? '<span class="cnt">' + esc(cnt) + '</span>' : '') + '</a></li>';
      }).join('') + '</ul>';
    }).join('');
  }

  /* ─── drawer ─── */
  /* Trail: the drawers opened since the last one opened from outside the drawer. Arrows move along it; opening a new
     drawer from inside cuts anything ahead of the current one, and closing the drawer ends the trail. */
  var trail = [], at = -1, fromDrawer = false;
  document.addEventListener('click', function (e) { fromDrawer = !!(e.target.closest && e.target.closest('#app-drawer')); }, true);
  function moveTrail(step) { var e = trail[at + step]; if (!e) return; trail[at].top = $('drawer-body').scrollTop; at += step; openDrawer(e.ref, e.tab, false, true); $('drawer-body').scrollTop = e.top || 0; }
  function drawArrows() {
    [['drawer-back', -1, 'Back to: '], ['drawer-fwd', 1, 'Forward to: ']].forEach(function (b) { var e = trail[at + b[1]], el = $(b[0]); el.disabled = !e; el.title = e ? b[2] + e.title : ''; });
  }
  function openDrawer(ref, tab, fromRoute, moving) {
    var i = ref.indexOf(':'), type = ref.slice(0, i), id = ref.slice(i + 1), fn = DRAWERS[type], item = fn && fn(id);
    if (!item) { closeDrawer(true); return; }
    var same = trail[at] && trail[at].ref === ref, top = same ? $('drawer-body').scrollTop : 0;
    if (same && !fromRoute && !moving && !fromDrawer && tab === undefined) { trail = [trail[at]]; at = 0; }   /* the same row clicked again in main starts over */
    state.d = ref; var tabs = item.tabs, cur = tabs.filter(function (t) { return t[0] === tab; })[0] || tabs[0];
    state.dt = cur[0];
    $('drawer-title').textContent = item.title;
    $('drawer-sub').innerHTML = item.sub || '';
    $('drawer-body').innerHTML = (tabs.length > 1 ? '<div class="dtabs" role="tablist">' + tabs.map(function (t) {
      return '<button role="tab" data-dt="' + esc(t[0]) + '" aria-selected="' + (t[0] === cur[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="dpanel">' + cur[2] + '</div>';
    $('drawer-body').scrollTop = top;
    if (same) trail[at].tab = cur[0];
    else if (!moving) { if (fromDrawer && at >= 0) { trail = trail.slice(0, at + 1); at++; } else { trail = []; at = 0; } trail[at] = { ref: ref, tab: cur[0], title: item.title }; }
    fromDrawer = false; drawArrows();
    $('app-drawer').classList.add('open'); $('app-drawer').setAttribute('aria-hidden', 'false');
    $('app-drawer').classList.toggle('wide', !!item.wide);
    document.querySelectorAll('.sel').forEach(function (e) { e.classList.remove('sel'); });
    document.querySelectorAll('[data-d="' + ref.replace(/"/g, '\\"') + '"]').forEach(function (e) { e.classList.add('sel'); });
    if (!fromRoute) { var q = Object.assign({}, state.query, { d: ref, dt: tabs[0][0] === cur[0] ? '' : cur[0] }); history.replaceState(null, '', hashFor(state.path, q)); state.query = q; }
  }
  function closeDrawer(fromRoute) {
    $('app-drawer').classList.remove('open'); $('app-drawer').setAttribute('aria-hidden', 'true'); state.d = null; trail = []; at = -1;
    document.querySelectorAll('.sel').forEach(function (e) { e.classList.remove('sel'); });
    if (!fromRoute && state.query.d) { var q = Object.assign({}, state.query); delete q.d; delete q.dt; history.replaceState(null, '', hashFor(state.path, q)); state.query = q; }
  }

  /* ─── tooltip for chart marks ─── */
  var tip;
  document.addEventListener('mousemove', function (e) {
    var m = e.target.closest && e.target.closest('[data-tip]');
    if (!tip) tip = $('chart-tip');
    if (!m) { tip.hidden = true; return; }
    tip.innerHTML = m.getAttribute('data-tip'); tip.hidden = false;
    var w = tip.offsetWidth, x = e.clientX + 14, y = e.clientY + 14;
    tip.style.left = Math.min(x, innerWidth - w - 8) + 'px'; tip.style.top = Math.min(y, innerHeight - tip.offsetHeight - 8) + 'px';
  });

  /* ─── clicks ─── */
  document.addEventListener('click', function (e) {
    if (e.target.matches('input')) return;   /* a checkbox in a clickable row ticks, it does not open the row */
    var t = e.target.closest('[data-dt]');
    if (t) { openDrawer(state.d, t.getAttribute('data-dt')); return; }
    var tg = e.target.closest('[data-tbl]');
    if (tg) { var fig = tg.closest('.fig'), on = fig.classList.toggle('as-table'); tg.setAttribute('aria-pressed', on); tg.textContent = on ? 'Chart' : 'Table'; return; }
    var a = e.target.closest('a[href]');
    if (a && a.closest('[data-d]') && a.getAttribute('target')) return;
    var d = e.target.closest('[data-d]');
    if (d) { e.preventDefault(); openDrawer(d.getAttribute('data-d')); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-d][tabindex]')) { e.preventDefault(); openDrawer(e.target.getAttribute('data-d')); }
  });

  /* ─── charts: hand-drawn SVG, one axis, 2px lines, thin rounded bars, hover on every mark ─── */
  function fig(title, sub, svg, table, legend) {
    return '<figure class="fig"><figcaption><div><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' +
      (table ? '<button type="button" class="linkbtn" data-tbl aria-pressed="false">Table</button>' : '') + '</figcaption>' +
      (legend || '') + '<div class="plot">' + svg + '</div>' + (table ? '<div class="scroll fig-table">' + table + '</div>' : '') + '</figure>';
  }
  function legendHtml(series) {
    return series.length < 2 ? '' : '<div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.color + (s.dash ? ';opacity:.45' : '') + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>';
  }
  function ticks(max) {
    var step = Math.pow(10, Math.floor(Math.log10(max || 1))), m = (max || 1) / step, s = m > 5 ? 2 : m > 2 ? 1 : .5, out = [];
    for (var v = 0; v <= (max || 1) + 1e-9; v += s * step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + s * step);
    return out;
  }
  /* series: [{name,color,values,dash?}]  labels: x labels  fmt: value format */
  function line(title, sub, labels, series, fmt, h) {
    fmt = fmt || k; h = h || 220;
    var W = 720, L = 48, R = 20, T = 12, B = 26, all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    var tk = ticks(Math.max.apply(null, all)), top = tk[tk.length - 1];
    var x = function (i) { return L + (W - L - R) * (labels.length < 2 ? 0 : i / (labels.length - 1)); }, y = function (v) { return T + (h - T - B) * (1 - v / top); };
    var grid = tk.map(function (v) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="gl"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + esc(fmt(v)) + '</text>'; }).join('');
    var nx = Math.min(7, labels.length), every = Math.max(1, Math.ceil((labels.length - 1) / (nx - 1 || 1)));
    var xl = labels.map(function (l, i) { return i % every === 0 ? '<text x="' + x(i) + '" y="' + (h - 6) + '" class="ax" text-anchor="middle">' + esc(l) + '</text>' : ''; }).join('');
    var paths = series.map(function (s) {
      var d = '', on = false; s.values.forEach(function (v, i) { if (v == null) { on = false; return; } d += (on ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); on = true; });
      var li = -1; s.values.forEach(function (v, i) { if (v != null) li = i; });
      return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (s.dash ? ' opacity=".45"' : '') + '/>' +
        (li >= 0 && !s.dash ? '<circle cx="' + x(li) + '" cy="' + y(s.values[li]) + '" r="4" fill="' + s.color + '" stroke="var(--card)" stroke-width="2"/>' : '');
    }).join('');
    var bw = (W - L - R) / Math.max(1, labels.length - 1);
    var hit = labels.map(function (l, i) {
      var rows = series.map(function (s) { return s.values[i] == null ? '' : '<div><i style="background:' + s.color + '"></i>' + esc(s.name) + ' <b>' + esc(fmt(s.values[i])) + '</b></div>'; }).join('');
      return '<rect class="hit" x="' + (x(i) - bw / 2) + '" y="' + T + '" width="' + bw + '" height="' + (h - T - B) + '" data-tip="' + esc('<div class="tt-h">' + esc(l) + '</div>' + rows) + '"/>';
    }).join('');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + h + '" role="img" aria-label="' + esc(title) + '">' + grid + xl + paths + hit + '</svg>';
    var table = '<table class="tbl"><thead><tr><th>Point</th>' + series.map(function (s) { return '<th class="num">' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      labels.map(function (l, i) { return '<tr><td>' + esc(l) + '</td>' + series.map(function (s) { return '<td class="num">' + esc(s.values[i] == null ? '–' : fmt(s.values[i])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    return fig(title, sub, svg, table, legendHtml(series));
  }
  /* rows: [{label,value,sub?,color?}]  horizontal bars, value at the tip */
  function bars(title, sub, rows, fmt) {
    fmt = fmt || n0;
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    var html = '<div class="hbars">' + rows.map(function (r) {
      return '<div class="hbar" data-tip="' + esc('<b>' + esc(r.label) + '</b> ' + esc(fmt(r.value)) + (r.sub ? '<div>' + esc(r.sub) + '</div>' : '')) + '"><div class="l">' + esc(r.label) + '</div><div class="t"><i style="width:' + (r.value / max * 100).toFixed(1) + '%;background:' + (r.color || 'var(--s1)') + '"></i><b>' + esc(fmt(r.value)) + '</b></div></div>';
    }).join('') + '</div>';
    var table = '<table class="tbl"><thead><tr><th>Item</th><th class="num">Value</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td class="num">' + esc(fmt(r.value)) + '</td></tr>'; }).join('') + '</tbody></table>';
    return fig(title, sub, html, table);
  }
  /* stages: [{label,value}]  each stage shows its share of the stage before it */
  function funnel(title, sub, stages) {
    var max = stages[0].value || 1;
    var html = '<div class="funnel">' + stages.map(function (s, i) {
      var conv = i ? s.value / (stages[i - 1].value || 1) : null;
      return '<div class="fstep" data-tip="' + esc('<b>' + esc(s.label) + '</b> ' + n0(s.value) + (conv != null ? '<div>' + pct(conv) + ' of the stage before</div>' : '')) + '"><div class="l">' + esc(s.label) + '</div><div class="t"><i style="width:' + Math.max(1.5, s.value / max * 100).toFixed(1) + '%"></i></div><div class="v"><b>' + n0(s.value) + '</b><span>' + (conv != null ? pct(conv, 0) : '') + '</span></div></div>';
    }).join('') + '</div>';
    return fig(title, sub, html);
  }
  function meter(value, goal, fmt, label) {
    fmt = fmt || n0; var p = goal ? value / goal : 0;
    return '<div class="meter"><div class="meter-t"><b>' + esc(fmt(value)) + '</b><span>of ' + esc(fmt(goal)) + (label ? ' ' + esc(label) : '') + ' · ' + pct(p, 0) + '</span></div><div class="meter-b" role="progressbar" aria-valuenow="' + Math.round(p * 100) + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i></div></div>';
  }
  function spark(values, color) {
    var w = 96, h = 26, max = Math.max.apply(null, values), min = Math.min.apply(null, values), r = (max - min) || 1;
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + (w * i / (values.length - 1)).toFixed(1) + ' ' + (h - 3 - (h - 6) * (v - min) / r).toFixed(1); }).join('');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (color || 'var(--s1)') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ─── boot ─── */
  window.Hub = {
    state: state, esc: esc, n0: n0, usd: usd, usd2: usd2, pct: pct, k: k, day: day,
    nav: [], titles: {}, chart: { line: line, bars: bars, funnel: funnel, meter: meter, spark: spark },
    route: function (prefix, fn) { ROUTES.push({ prefix: prefix, fn: fn }); },
    drawer: function (type, fn) { DRAWERS[type] = fn; },
    open: openDrawer, close: closeDrawer, render: render, onRender: function (fn) { onRender.push(fn); },
    setBrand: function (b) { state.brand = b; try { localStorage.setItem('lc_hub_brand', b); } catch (x) {} render(); },
    inBrand: function (o) { return state.brand === 'all' || !o.brand || o.brand === state.brand || o.brand === 'all'; }
  };
  window.addEventListener('hashchange', render);
  /* gate.js calls this once the client screens have loaded, which can be long after the page itself */
  window.Hub.start = function () {
    $('app-filter').addEventListener('input', drawTree);
    $('drawer-close').addEventListener('click', function () { closeDrawer(); });
    $('drawer-back').addEventListener('click', function () { moveTrail(-1); });
    $('drawer-fwd').addEventListener('click', function () { moveTrail(1); });
    $('app-menu').addEventListener('click', function () { var n = $('app-nav'), on = n.classList.toggle('open'); this.setAttribute('aria-expanded', on); });
    $('app-tree').addEventListener('click', function () { $('app-nav').classList.remove('open'); });
    render();
  };
})();
