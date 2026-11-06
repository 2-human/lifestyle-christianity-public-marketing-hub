/* Marketing Hub chassis: three panels (navigation · main · drawer).
 * Knows nothing about the client. Client screens register themselves in views.js:
 *   Hub.nav      = [{ sec, items:[{ id, label, route, cnt? }] }]   left menu, first-level entries only
 *   Hub.home     = the route an empty address opens
 *   Hub.route(prefix, fn(rest, query) → html)                      main panel, longest prefix wins
 *   Hub.drawer(type, fn(id) → { title, tabs:[[key,label,html]] })  right panel, opened by [data-d="type:id"]
 * Rule: every entity exists once; more information = tabs on it.
 * An open drawer adds d=type:id&dt=tab to the hash, so any drawer has a permalink.
 * Navigation follows the Library's hub-chassis 1.2 (C3 drawer, C6 breadcrumb switcher, C10 keyboard and focus):
 * the main column redraws only when its own address changes; Hub.render(true) forces it. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
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
  function replaceHash(path, query) { history.replaceState(history.state, '', location.pathname + location.search + hashFor(path, query)); }
  function find(path) {
    var best = null;
    ROUTES.forEach(function (r) { if ((path === r.prefix || path.indexOf(r.prefix + '/') === 0) && (!best || r.prefix.length > best.prefix.length)) best = r; });
    return best;
  }
  /* the main column redraws only when its own address changes; opening, closing or switching a drawer leaves it (and its
   * scroll) alone. render(true) forces a redraw, for data changes. */
  var lastMain = null, lastFocus = null, curDrawer = null;
  function mainKey(p) { var q = Object.assign({}, p.query); delete q.d; delete q.dt; return p.path + '|' + JSON.stringify(q); }
  function render(force) {
    var p = parse(), key = mainKey(p), main = $('app-main'), first = lastMain === null;
    state.path = p.path; state.query = p.query;
    if (force === true || key !== lastMain) {
      lastMain = key;
      var r = find(p.path), rest = r ? p.path.slice(r.prefix.length + 1) : '';
      main.innerHTML = r ? crumbs(p.path) + r.fn(rest, p.query) : '<h1>Not found</h1><p class="lead">No screen at ' + esc(p.path) + '. Pick one from the menu.</p>';
      if (force !== true) main.scrollTop = 0;
      drawTree(); document.body.setAttribute('data-brand', state.brand);
      var ttl = pageTitle(p.path); document.title = (ttl ? ttl + ' · ' : '') + (Hub.siteTitle || document.title.split(' · ').pop());
      onRender.forEach(function (fn) { fn(); });
      if (!first && force !== true && !p.query.d) main.focus({ preventScroll: true });
      $('app-nav').classList.remove('open'); $('app-menu').setAttribute('aria-expanded', 'false');
    }
    if (p.query.d) { if (p.query.d !== state.d || (p.query.dt || undefined) !== state.dt || force === true) openDrawer(p.query.d, p.query.dt, true); else markSelected(state.d); } else if (state.d) closeDrawer(true);
  }

  /* ─── navigation tree ─── */
  function navItems() { var o = []; (Hub.nav || []).forEach(function (s) { s.items.forEach(function (i) { o.push(i); }); }); return o; }
  function navFind(path) { return navItems().filter(function (n) { return n.route === path; })[0] || null; }
  function pageTitle(path) { var n = navFind(path); return (Hub.titles || {})[path] || (n && n.label) || ''; }
  function countOf(n) { return typeof n.cnt === 'function' ? n.cnt() : n.cnt; }
  function drawTree() {
    var f = norm($('app-filter').value || ''), cur = state.path;
    $('app-tree').innerHTML = Hub.nav.map(function (s) {
      var rows = s.items.filter(function (it) { return !f || norm(it.label).indexOf(f) >= 0 || norm(s.sec).indexOf(f) >= 0; });
      if (!rows.length) return '';
      return '<div class="sec">' + esc(s.sec) + '</div><ul>' + rows.map(function (it) {
        var on = cur === it.route || cur.indexOf(it.route + '/') === 0, cnt = countOf(it);
        return '<li><a class="row' + (on ? ' cur' : '') + '" href="#' + it.route + '"' + (on ? ' aria-current="page"' : '') + '><span>' + esc(it.label) + '</span>' + (cnt != null ? '<span class="cnt">' + esc(cnt) + '</span>' : '') + '</a></li>';
      }).join('') + '</ul>';
    }).join('');
  }

  /* ─── breadcrumb: a trail with a dropdown of the items beside each step (the other entries of its menu section) ─── */
  function siblingsOf(route) { var hit = null; (Hub.nav || []).some(function (s) { if (s.items.some(function (i) { return i.route === route; })) { hit = s.items; return true; } return false; }); return hit && hit.length > 1 ? hit : null; }
  var crumbSets = [];
  function crumbs(path) {
    var parts = path.split('/').filter(Boolean), acc = '', tr = [];
    parts.forEach(function (seg) {
      acc += '/' + seg; var n = navFind(acc), ttl = (Hub.titles || {})[acc] || (n && n.label);
      if (!ttl) { if (find(acc) && acc !== path) return; ttl = seg.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
      tr.push([ttl, acc, !!(find(acc) || n)]);
    });
    crumbSets = tr.map(function (c) { return siblingsOf(c[1]); });
    if (!tr.length || (tr.length === 1 && !crumbSets[0])) return '';
    return '<nav class="crumbs" aria-label="Breadcrumb">' + tr.map(function (c, i) {
      var last = i === tr.length - 1, label = c[2] ? '<a href="#' + esc(c[1]) + '"' + (last ? ' aria-current="page"' : '') + '>' + esc(c[0]) + '</a>' : '<span>' + esc(c[0]) + '</span>';
      return (i ? '<span class="sep" aria-hidden="true">›</span>' : '') + '<span class="bc-item' + (last ? ' last' : '') + '">' + label +
        (crumbSets[i] ? '<button type="button" class="bc-dd" data-bc="' + i + '" aria-haspopup="true" aria-expanded="false" aria-label="' + esc('Switch to another page beside ' + c[0]) + '">&#9662;</button>' : '') + '</span>';
    }).join('') + '</nav>';
  }
  function bcClose(refocus) { var m = document.querySelector('.bc-menu'); if (!m) return; var b = m.parentNode.querySelector('.bc-dd'); m.remove(); if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); } }
  function bcOpen(b) {
    bcClose(); var list = crumbSets[+b.getAttribute('data-bc')], m = document.createElement('div'), here = state.path, ph = 'Filter ' + list.length + ' pages';
    m.className = 'bc-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = (list.length > 12 ? '<input type="search" class="bc-filter" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '">' : '') + '<div class="bc-list">' +
      list.map(function (x) { var on = x.route === here, c = countOf(x); return '<a role="menuitem" href="#' + esc(x.route) + '"' + (on ? ' aria-current="true" class="cur"' : '') + '><span>' + esc(x.label) + '</span>' + (c != null ? '<span class="cnt">' + esc(c) + '</span>' : '') + '</a>'; }).join('') + '</div>';
    b.parentNode.appendChild(m); b.setAttribute('aria-expanded', 'true');
    (m.querySelector('.bc-filter') || m.querySelector('a.cur') || m.querySelector('a')).focus();
  }

  /* ─── drawer ─── */
  function markSelected(ref) {
    document.querySelectorAll('.sel').forEach(function (e) { e.classList.remove('sel'); });
    if (ref) document.querySelectorAll('[data-d="' + CSS.escape(ref) + '"]').forEach(function (e) { e.classList.add('sel'); });
  }
  function say(msg) { var el = $('hub-status'); if (!el) return; el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 30); }
  var tabMem = function (v) { try { if (v === undefined) return sessionStorage.getItem('lc_drawer_tab'); sessionStorage.setItem('lc_drawer_tab', v); } catch (x) { return null; } };
  /* Trail: the drawers opened since the last one opened from outside the drawer. Arrows move along it without changing it;
   * opening a new drawer from inside cuts anything ahead, and closing the drawer ends it. A step keeps its tab and scroll.
   * "From inside" is read from the last real click or key press, because an anchor opens its drawer later, through
   * hashchange. Only a recent one counts, so browser Back or a redraw is never mistaken for a user's choice. */
  var GESTURE_MS = 1000, visits = [], at = -1, gesture = null;
  function noteGesture(e) { gesture = { inside: !!(e.target.closest && e.target.closest('#app-drawer')), t: Date.now() }; }
  function takeGesture() { var g = gesture; gesture = null; return g && Date.now() - g.t < GESTURE_MS ? g : null; }
  document.addEventListener('click', noteGesture, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') noteGesture(e); }, true);
  function stepTrail(ref, item, cur, same, fromRoute, tab) {
    var g = takeGesture(), step = { ref: ref, tab: cur[0], title: item.title, top: 0 };
    if (same && at >= 0) {   /* a redraw or a tab change stays on this step; the same row clicked again in main starts over */
      visits[at].tab = cur[0]; visits[at].title = item.title;
      if (!fromRoute && tab == null && g && !g.inside) { visits = [visits[at]]; at = 0; }
      return;
    }
    if (g && g.inside && at >= 0) { visits[at].top = $('drawer-body').scrollTop; visits = visits.slice(0, at + 1).concat(step); at++; }
    else { visits = [step]; at = 0; }
  }
  function moveTrail(by, btn) {
    var step = visits[at + by]; if (!step) return;
    visits[at].top = $('drawer-body').scrollTop; at += by;
    if (!openDrawer(step.ref, step.tab, false, true)) return;
    $('drawer-body').scrollTop = step.top;
    /* an arrow that just disabled itself can't hold focus: the other arrow takes it, or close */
    if (btn.disabled) { var other = $(by < 0 ? 'drawer-fwd' : 'drawer-back'); (other.disabled ? $('drawer-close') : other).focus({ preventScroll: true }); }
  }
  function drawArrows() {
    [['drawer-back', -1, 'Previous drawer', 'Back to: '], ['drawer-fwd', 1, 'Next drawer', 'Forward to: ']].forEach(function (b) {
      var el = $(b[0]), step = visits[at + b[1]], tip = step ? b[3] + step.title : ''; if (!el) return;
      el.disabled = !step; el.title = tip; el.setAttribute('aria-label', tip || b[2]);
    });
  }
  function paintDrawer(item, cur, keep) {
    var tabs = item.tabs, body = $('drawer-body'), bar = '', pos = keep ? body.scrollTop : 0;
    if (tabs.length > 1) bar = '<div class="dtabs" role="tablist">' + tabs.map(function (x) {
      var on = x[0] === cur[0];
      return '<button type="button" role="tab" id="dtab-' + esc(x[0]) + '" aria-controls="dpanel" data-dt="' + esc(x[0]) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    body.innerHTML = bar + '<div class="dpanel" id="dpanel" role="tabpanel"' + (tabs.length > 1 ? ' aria-labelledby="dtab-' + esc(cur[0]) + '"' : ' aria-labelledby="drawer-title"') + ' tabindex="-1">' + cur[2] + '</div>';
    body.scrollTop = pos;
  }
  function openDrawer(ref, tab, fromRoute, moving) {
    var i = ref.indexOf(':'), type = i < 0 ? '' : ref.slice(0, i), id = i < 0 ? '' : ref.slice(i + 1), fn = DRAWERS[type], item = fn ? fn(id) : null;
    if (!item) {   /* the item is gone: the page stays, and the address drops the dead reference */
      if (fromRoute || moving) { var q0 = Object.assign({}, state.query); delete q0.d; delete q0.dt; replaceHash(state.path, q0); state.query = q0; say('That item is no longer here.'); }
      closeDrawer(true); return false;
    }
    var d = $('app-drawer'), tabs = item.tabs, same = state.d === ref;
    if (!d.classList.contains('open')) lastFocus = document.activeElement;
    /* an explicit tab wins; a permalink without dt= means the first tab; a click reuses the last picked tab if this item has it */
    var want = tab != null ? tab : !fromRoute ? tabMem() : null;
    var cur = tabs.filter(function (x) { return x[0] === want; })[0] || tabs[0];
    if (moving) { gesture = null; visits[at].title = item.title; } else stepTrail(ref, item, cur, same, fromRoute, tab);
    state.d = ref; state.dt = cur[0] === tabs[0][0] ? undefined : cur[0]; curDrawer = item;
    $('drawer-title').textContent = item.title; $('drawer-sub').innerHTML = item.sub || '';
    paintDrawer(item, cur, same);
    d.classList.add('open'); d.classList.toggle('wide', !!item.wide && item.wide !== 'x'); d.classList.toggle('xwide', item.wide === 'x');
    d.setAttribute('aria-hidden', 'false'); d.removeAttribute('inert');
    document.body.classList.add('has-drawer'); document.body.classList.toggle('drawer-wide', !!item.wide && item.wide !== 'x'); document.body.classList.toggle('drawer-xwide', item.wide === 'x');
    $('app-scrim').hidden = false;
    markSelected(ref);
    if (!fromRoute) { var q = Object.assign({}, state.query, { d: ref, dt: state.dt || '' }); if (!state.dt) delete q.dt; replaceHash(state.path, q); state.query = q; if (tab != null && !moving) tabMem(cur[0]); }
    if (!same) { var sel = document.querySelector('#app-main [data-d="' + CSS.escape(ref) + '"]'); if (sel) sel.scrollIntoView({ block: 'nearest' }); if (!moving) $('drawer-close').focus({ preventScroll: true }); }
    drawArrows();
    return true;
  }
  function closeDrawer(fromRoute) {
    var d = $('app-drawer'), was = d.classList.contains('open');
    d.classList.remove('open', 'wide', 'xwide'); d.setAttribute('aria-hidden', 'true'); d.setAttribute('inert', '');
    document.body.classList.remove('has-drawer', 'drawer-wide', 'drawer-xwide'); $('app-scrim').hidden = true;
    var ref = state.d; state.d = null; state.dt = undefined; curDrawer = null;
    visits = []; at = -1; gesture = null; drawArrows(); markSelected(null);
    if (!fromRoute && state.query.d) { var q = Object.assign({}, state.query); delete q.d; delete q.dt; replaceHash(state.path, q); state.query = q; }
    if (was) {   /* focus goes back to what opened the drawer; if that was redrawn, to its match; else to main */
      var back = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : (ref && document.querySelector('[data-d="' + CSS.escape(ref) + '"]')) || $('app-main');
      back.focus({ preventScroll: true }); lastFocus = null;
    }
  }
  function pickTab(key) {
    if (!curDrawer) return;
    var cur = curDrawer.tabs.filter(function (x) { return x[0] === key; })[0]; if (!cur) return;
    tabMem(key); state.dt = key === curDrawer.tabs[0][0] ? undefined : key;
    if (visits[at]) visits[at].tab = key;
    paintDrawer(curDrawer, cur, false);
    var q = Object.assign({}, state.query); if (state.dt) q.dt = state.dt; else delete q.dt; replaceHash(state.path, q); state.query = q;
    var b = $('drawer-body').querySelector('[data-dt="' + CSS.escape(key) + '"]'); if (b) b.focus({ preventScroll: true });
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

  /* ─── events ─── */
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var c;
    if ((c = e.target.closest('.bc-dd'))) { e.preventDefault(); if (c.getAttribute('aria-expanded') === 'true') bcClose(true); else bcOpen(c); return; }
    if (!e.target.closest('.bc-menu') || e.target.closest('a')) bcClose();
    if (e.target.matches('input')) return;   /* a checkbox in a clickable row ticks, it does not open the row */
    if ((c = e.target.closest('[data-dt]'))) { pickTab(c.getAttribute('data-dt')); return; }
    if ((c = e.target.closest('[data-tbl]'))) { var fig = c.closest('.fig'), on = fig.classList.toggle('as-table'); c.setAttribute('aria-pressed', on); c.textContent = on ? 'Chart' : 'Table'; return; }
    var a = e.target.closest('a[href]');
    if (a && a.closest('[data-d]') && a.getAttribute('data-d') == null) return;   /* a real link inside a row keeps its meaning */
    if ((c = e.target.closest('[data-d]'))) { e.preventDefault(); openDrawer(c.getAttribute('data-d')); }
  });
  document.addEventListener('input', function (e) {
    var tg = e.target; if (!tg.classList || !tg.classList.contains('bc-filter')) return;
    var q = norm(tg.value.trim()); tg.parentNode.querySelectorAll('.bc-list a').forEach(function (a) { a.hidden = !!q && norm(a.textContent).indexOf(q) < 0; });
  });
  document.addEventListener('keydown', function (e) {
    var m = document.querySelector('.bc-menu'), tg = e.target;
    if (m) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); bcClose(true); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var as = [].filter.call(m.querySelectorAll('.bc-list a'), function (x) { return !x.hidden; }), i = as.indexOf(document.activeElement); if (as.length) { e.preventDefault(); as[e.key === 'ArrowDown' ? Math.min(as.length - 1, i + 1) : Math.max(0, i - 1)].focus(); } return; }
    }
    if (e.key === 'Escape') { if (document.querySelector('[data-hub-esc]')) return; if ($('app-drawer').classList.contains('open')) closeDrawer(); else if ($('app-nav').classList.contains('open')) { $('app-nav').classList.remove('open'); $('app-menu').setAttribute('aria-expanded', 'false'); $('app-menu').focus(); } return; }
    if ((e.key === 'Enter' || e.key === ' ') && tg.matches && tg.matches('[data-d][tabindex]') && !tg.matches('a,button')) { e.preventDefault(); openDrawer(tg.getAttribute('data-d')); return; }
    /* arrow keys walk any tab bar; the matching tab becomes active */
    var bar = tg.closest && tg.closest('[role="tablist"]');
    if (bar && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
      var list = [].slice.call(bar.querySelectorAll('[role="tab"]')), k0 = list.indexOf(tg), to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (k0 + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      e.preventDefault(); list[to].focus(); if (list[to].click) list[to].click(); return;
    }
    /* below the docking width the drawer is a dialog: Tab stays inside it */
    if (e.key === 'Tab' && $('app-drawer').classList.contains('open') && !window.matchMedia('(min-width:1200px)').matches) {
      var f = [].filter.call($('app-drawer').querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null && !x.disabled; });
      if (!f.length) return;
      if (!$('app-drawer').contains(document.activeElement)) { e.preventDefault(); f[0].focus(); } else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
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
    setBrand: function (b) { state.brand = b; try { localStorage.setItem('lc_hub_brand', b); } catch (x) {} render(true); },
    inBrand: function (o) { return state.brand === 'all' || !o.brand || o.brand === state.brand || o.brand === 'all'; }
  };
  window.addEventListener('hashchange', function () { render(); });
  /* gate.js calls this once the client screens have loaded, which can be long after the page itself */
  window.Hub.start = function () {
    $('app-filter').addEventListener('input', drawTree);
    $('drawer-close').addEventListener('click', function () { closeDrawer(); });
    $('drawer-back').addEventListener('click', function () { moveTrail(-1, this); });
    $('drawer-fwd').addEventListener('click', function () { moveTrail(1, this); });
    $('app-scrim').addEventListener('click', function () { closeDrawer(); });
    Hub.siteTitle = document.title;
    $('app-menu').addEventListener('click', function () { var n = $('app-nav'), on = n.classList.toggle('open'); this.setAttribute('aria-expanded', on); });
    $('app-tree').addEventListener('click', function () { $('app-nav').classList.remove('open'); });
    $('app-drawer').setAttribute('inert', '');
    render();
  };
})();
