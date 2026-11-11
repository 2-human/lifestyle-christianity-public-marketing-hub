/* The public view of a share (view.html#<token>), one hub page or a set of them. Plain shell code, published in the clear
 * by design: it holds no hub data and needs no sign-in. It fetches the copy public-view.js made from Storage
 * (hubs/lc/public/<token>.json, the manifest, and the parts <token>.<n>.json as they are needed; readable by anyone who
 * has the token, listing refused) and draws it: a menu of the set's pages (when there are several), the main column with
 * its views (data-pv) and the drawers (data-pd), Save as PDF and “Copy link to this screen”.
 * Every screen has its own address, view.html#<token>/<page>?<view>&d=<drawer>&dt=<tab>, so Back and Forward work and a
 * page with a drawer open can be sent as it is. Nothing here leads to a hub page outside the copy: the copy has no such
 * links. Words: the pub* labels in hub.config.js. Look: the hub's tokens, fonts and logo from hub.config.js, set the way
 * the chassis sets them, and skin.css. */
(function () {
  var cfg = window.HUB_CONFIG || {}, L = cfg.labels || {}, fb = window.FIREBASE_CONFIG || {};
  var ROOT = 'hubs/lc/public/';
  var $ = function (id) { return document.getElementById(id); };
  var all = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var t = function (k, v) { var s = L[k] || k; Object.keys(v || {}).forEach(function (x) { s = s.split('{' + x + '}').join(v[x]); }); return s; };
  var TOKEN = '', MAN = null, PARTS = {}, CUR = { view: '', ref: '', tab: '' }, DRAWER = null, lastFocus = null, SEQ = 0;
  var HUBNAME = cfg.title || (cfg.brand || {}).name || '';

  /* ─── identity: the chassis' token names (hub-core.js applyTokens), fonts, favicon, logo and name ─── */
  (function () {
    var BRAND = { accent: 'primary-deep', bg: 'surface-base', soft: 'surface-tint', line: 'rule', ink: 'text-default', mute: 'text-soft', head: 'neutral-deep' }, KEY = {};
    Object.keys(BRAND).forEach(function (k) { KEY[BRAND[k]] = k; });
    var hubVar = function (k) { return '--hub-' + (KEY[k] || k).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); };
    var name = function (k) { return BRAND[k] ? '--' + BRAND[k] : KEY[k] ? '--' + k : hubVar(k); };
    var tk = cfg.tokens || {}, body = Object.keys(tk).filter(function (k) { return /^[a-z0-9][a-zA-Z0-9-]*$/.test(k); }).map(function (k) { return name(k) + ':' + String(tk[k]).replace(/[;{}]/g, ''); }).join(';');
    var st = document.createElement('style'); st.textContent = ':root{' + body + '}'; document.head.appendChild(st);
    var f = cfg.fonts || {}, b = cfg.brand || {};
    if (cfg.lang) { document.documentElement.setAttribute('lang', cfg.lang); }
    if (f.body) { document.documentElement.style.setProperty('--hub-font', f.body); }
    if (f.display) { document.documentElement.style.setProperty('--hub-font-head', f.display); }
    if (f.import && /^https:\/\/fonts\.googleapis\.com\//.test(f.import)) { var fl = document.createElement('link'); fl.rel = 'stylesheet'; fl.href = f.import; document.head.appendChild(fl); }
    if (b.favicon) { var ic = document.createElement('link'); ic.rel = 'icon'; ic.href = b.favicon; document.head.appendChild(ic); }
    $('app-brand').innerHTML = (typeof b.logo === 'string' ? b.logo : '') + '<span>' + esc(b.name || '') + '</span>' + (b.sub ? '<small>' + esc(b.sub) + '</small>' : '');
    document.title = HUBNAME;
    $('drawer-close').setAttribute('aria-label', t('pubClose'));
    $('pv-menu').setAttribute('aria-label', t('pubMenu'));
    document.documentElement.style.setProperty('--htop', $('app-bar').offsetHeight + 'px');
  })();

  function message(title, body) {
    $('app-main').innerHTML = '<div class="pg"><div class="notfound"><h1>' + esc(title) + '</h1>' + (body ? '<p class="lead">' + esc(body) + '</p>' : '') + '</div></div>';
    document.title = title + ' · ' + HUBNAME;
  }
  function source(n) {
    var path = encodeURIComponent(ROOT + TOKEN + (n ? '.' + n : '') + '.json'), emu = fb.emulator;
    var host = emu ? 'http://127.0.0.1:' + ((emu === true ? null : emu.storage) || 9299) : 'https://firebasestorage.googleapis.com';
    return host + '/v0/b/' + encodeURIComponent(fb.storageBucket || '') + '/o/' + path + '?alt=media';
  }
  function fetchJson(n) {
    return fetch(source(n), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
      if (r.status === 404 || r.status === 403) { return null; }
      if (!r.ok) { throw new Error('status ' + r.status); }
      return r.json();
    });
  }
  function part(n) {
    if (!PARTS[n]) { PARTS[n] = fetchJson(n).then(function (p) { if (!p) { throw new Error('part ' + n + ' missing'); } return p; }); PARTS[n].catch(function () { delete PARTS[n]; }); }
    return PARTS[n];
  }

  /* ─── addresses: #<token>/<page>?<view query>&d=<drawer>&dt=<tab> ─── */
  function resolveView(id) {
    if (!id) { return MAN.first; }
    if (MAN.views[id] != null) { return id; }
    if (MAN.alias && MAN.alias[id] != null && MAN.views[MAN.alias[id]] != null) { return MAN.alias[id]; }
    var page = MAN.menu.filter(function (p) { return p.route === id.split('?')[0]; })[0];
    return page ? page.first : MAN.first;
  }
  function parse(h) {
    h = String(h || '').replace(/^#/, '');
    var tok = h.slice(0, 22), rest = h.slice(22), out = { tok: tok, view: '', ref: '', tab: '' };
    if (rest.charAt(0) !== '/') { return out; }
    var i = rest.indexOf('?'), path = i < 0 ? rest : rest.slice(0, i), keep = [];
    (i < 0 ? [] : rest.slice(i + 1).split('&')).forEach(function (kv) {
      if (/^d=/.test(kv)) { out.ref = decodeURIComponent(kv.slice(2)); } else if (/^dt=/.test(kv)) { out.tab = decodeURIComponent(kv.slice(3)); } else if (kv) { keep.push(kv); }
    });
    out.view = decodeURI(path) + (keep.length ? '?' + decodeURI(keep.join('&')) : '');
    return out;
  }
  function hashOf(s) {
    var q = [];
    if (s.ref) { q.push('d=' + encodeURIComponent(s.ref).replace(/%3A/gi, ':')); }
    if (s.ref && s.tab) { q.push('dt=' + encodeURIComponent(s.tab)); }
    return '#' + TOKEN + encodeURI(s.view) + (q.length ? (s.view.indexOf('?') < 0 ? '?' : '&') + q.join('&') : '');
  }
  function write(push) {
    var h = hashOf(CUR); if (location.hash === h) { return; }
    history[push ? 'pushState' : 'replaceState'](null, '', location.pathname + location.search + h);
  }

  /* ─── the menu of the set (several pages only) ─── */
  function drawMenu() {
    var m = MAN.menu, nav = $('pv-menu');
    if (m.length < 2) { nav.hidden = true; document.body.classList.remove('pv-has-menu'); return; }
    nav.innerHTML = '<p class="pv-menu-head">' + esc(MAN.title) + '</p><ul>' + m.map(function (p) {
      return '<li style="--d:' + (+p.depth || 0) + '"><a href="' + esc(hashOf({ view: p.first })) + '" data-pv="' + esc(p.first) + '" data-page="' + esc(p.route) + '">' + esc(p.title) + '</a></li>';
    }).join('') + '</ul>';
    nav.hidden = false; document.body.classList.add('pv-has-menu');
  }
  function markMenu() {
    var path = CUR.view.split('?')[0];
    all('#pv-menu [data-page]').forEach(function (a) { if (a.getAttribute('data-page') === path) { a.setAttribute('aria-current', 'page'); } else { a.removeAttribute('aria-current'); } });
  }

  /* ─── main: one view at a time ─── */
  function showView(id, focus) {
    id = resolveView(id);
    if (id === CUR.view && $('app-main').querySelector('.pv-foot')) { return Promise.resolve(); }
    var seq = ++SEQ;
    return part(MAN.views[id]).then(function (p) {
      if (seq !== SEQ) { return; }
      var html = p.views[id], m = $('app-main');
      CUR.view = id;
      m.innerHTML = html + '<p class="pv-foot">' + esc(t('pubFoot', { date: day(MAN.takenAt) })) + '</p>';
      var page = MAN.menu.filter(function (x) { return x.route === id.split('?')[0]; })[0];
      document.title = (page && MAN.menu.length > 1 ? page.title + ' · ' : '') + MAN.title + ' · ' + HUBNAME;
      markMenu(); markSelected();
      m.scrollTop = 0;
      if (focus) { m.focus({ preventScroll: true }); }
      prefetch();
    });
  }
  /* the parts holding this view's drawers, loaded while the reader reads */
  function prefetch() {
    var want = {};
    all('#app-main [data-pd]').forEach(function (e) { var n = MAN.drawers[e.getAttribute('data-pd')]; if (n != null) { want[n] = true; } });
    Object.keys(want).slice(0, 4).forEach(function (n) { part(+n).catch(function () {}); });
  }
  function day(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(cfg.locale || 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toTimeString().slice(0, 5); }
  function markSelected() {
    all('#app-main .sel').forEach(function (e) { e.classList.remove('sel'); });
    if (DRAWER) { all('#app-main [data-pd]').forEach(function (e) { if (e.getAttribute('data-pd') === DRAWER.ref) { e.classList.add('sel'); } }); }
  }

  /* ─── drawers, as the chassis draws them (title, sub, tabs, panel) ─── */
  function openDrawer(ref, tab) {
    if (MAN.drawers[ref] == null) { return Promise.resolve(false); }
    return part(MAN.drawers[ref]).then(function (p) {
      var it = p.drawers[ref]; if (!it) { return false; }
      var d = $('app-drawer');
      if (!d.classList.contains('open')) { lastFocus = document.activeElement; }
      DRAWER = { ref: ref, it: it }; CUR.ref = ref;
      $('drawer-title').textContent = it.title;
      $('drawer-sub').innerHTML = it.sub || '';
      paint(tab || it.tabs[0][0]);
      d.classList.add('open'); d.classList.toggle('wide', !!it.wide); d.classList.toggle('xwide', it.wide === 'x');
      d.setAttribute('aria-hidden', 'false'); d.removeAttribute('inert');
      document.body.classList.add('has-drawer'); document.body.classList.toggle('drawer-wide', !!it.wide && it.wide !== 'x'); document.body.classList.toggle('drawer-xwide', it.wide === 'x');
      $('app-scrim').hidden = false;
      markSelected();
      $('drawer-close').focus({ preventScroll: true });
      return true;
    });
  }
  function paint(key) {
    var it = DRAWER.it, cur = it.tabs.filter(function (x) { return x[0] === key; })[0] || it.tabs[0], bar = '';
    CUR.tab = cur[0] === it.tabs[0][0] ? '' : cur[0];
    if (it.tabs.length > 1) {
      bar = '<div class="dtabs" role="tablist">' + it.tabs.map(function (x) {
        var on = x[0] === cur[0];
        return '<button type="button" role="tab" id="dtab-' + esc(x[0]) + '" aria-controls="dpanel" data-dt="' + esc(x[0]) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>';
    }
    $('drawer-body').innerHTML = bar + '<div class="dpanel" id="dpanel" role="tabpanel" tabindex="-1">' + cur[2] + '</div>';
    $('drawer-body').scrollTop = 0;
  }
  function closeDrawer(refocus) {
    var d = $('app-drawer'); CUR.ref = ''; CUR.tab = '';
    if (!d.classList.contains('open')) { return; }
    d.classList.remove('open', 'wide', 'xwide'); d.setAttribute('aria-hidden', 'true'); d.setAttribute('inert', '');
    document.body.classList.remove('has-drawer', 'drawer-wide', 'drawer-xwide'); $('app-scrim').hidden = true;
    var ref = DRAWER && DRAWER.ref; DRAWER = null; markSelected();
    if (refocus !== false) {
      var back = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : (ref && document.querySelector('#app-main [data-pd="' + CSS.escape(ref) + '"]')) || $('app-main');
      back.focus({ preventScroll: true });
    }
    lastFocus = null;
  }

  /* ─── one screen: a view, and a drawer on it or none ─── */
  function go(s, push) {
    var view = resolveView(s.view || CUR.view);
    return showView(view, push && view !== CUR.view).then(function () {
      if (s.ref && MAN.drawers[s.ref] != null) {
        return (DRAWER && DRAWER.ref === s.ref ? Promise.resolve(paint(s.tab || DRAWER.it.tabs[0][0])) : openDrawer(s.ref, s.tab)).then(function () { write(push); });
      }
      closeDrawer(push); write(push);
    }).catch(function (e) { console.error('[view]', e); message(t('pubFailed')); });
  }

  /* ─── events ─── */
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-dt], [data-pd], [data-pv], #drawer-close, #app-scrim, #pv-print, #pv-share');
    if (!c || !MAN) { return; }
    if (c.id === 'drawer-close' || c.id === 'app-scrim') { closeDrawer(); write(true); return; }
    if (c.id === 'pv-print') { window.print(); return; }
    if (c.id === 'pv-share') { copyScreen(c); return; }
    if (c.hasAttribute('data-dt')) { paint(c.getAttribute('data-dt')); write(false); var b = $('drawer-body').querySelector('[data-dt="' + CSS.escape(c.getAttribute('data-dt')) + '"]'); if (b) { b.focus({ preventScroll: true }); } return; }
    if (e.ctrlKey || e.metaKey || e.shiftKey) { if (c.getAttribute('href')) { return; } }   /* a menu link opened in a new tab */
    e.preventDefault();
    var pv = c.getAttribute('data-pv'), pd = c.getAttribute('data-pd');
    go({ view: pv || CUR.view, ref: pd || '' }, true);
  });
  document.addEventListener('keydown', function (e) {
    var tg = e.target;
    if (e.key === 'Escape') { if (DRAWER) { closeDrawer(); write(true); } return; }
    if ((e.key === 'Enter' || e.key === ' ') && tg.matches && tg.matches('[data-pd], [data-pv]') && !tg.matches('button, a[href]')) { e.preventDefault(); tg.click(); return; }
    var bar = tg.closest && tg.closest('[role="tablist"]');
    if (bar && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
      var list = all('[role="tab"]', bar), at = list.indexOf(tg), to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      e.preventDefault(); list[to].focus(); list[to].click();
    }
  });
  /* Back, Forward and an address typed in: another token loads afresh, the same token moves to the screen */
  function onAddress() {
    var s = parse(location.hash);
    if (s.tok !== TOKEN) { location.reload(); return; }
    if (!MAN || (resolveView(s.view) === CUR.view && s.ref === CUR.ref && (s.tab || '') === CUR.tab)) { return; }
    go(s, false);
  }
  window.addEventListener('popstate', onAddress);
  window.addEventListener('hashchange', onAddress);
  function copyScreen(b) {
    var url = location.href, done = function () { b.textContent = t('pubCopied'); setTimeout(function () { b.textContent = t('pubCopyLink'); }, 1400); };
    if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done, function () { window.prompt(t('pubCopyLink'), url); }); } else { window.prompt(t('pubCopyLink'), url); }
  }

  /* ─── load ─── */
  var first = parse(location.hash);
  TOKEN = first.tok;
  $('app-main').innerHTML = '<div class="pg"><p class="note">' + esc(t('pubLoading')) + '</p></div>';
  if (!/^[A-Za-z0-9_-]{22}$/.test(TOKEN) || !fb.storageBucket) { message(t('pubNotShared'), t('pubNotSharedBody')); return; }
  fetchJson(0).then(function (data) {
    if (!(data && data.v === 1 && data.menu && data.menu.length && data.views && data.views[data.first] != null)) { message(t('pubNotShared'), t('pubNotSharedBody')); return; }
    MAN = data;
    var p = $('pv-print'); p.textContent = t('pubPdf'); p.hidden = false;
    var sh = $('pv-share'); sh.textContent = t('pubCopyLink'); sh.title = t('pubCopyLinkHint'); sh.hidden = false;
    drawMenu();
    return go({ view: first.view || MAN.first, ref: first.ref, tab: first.tab }, false);
  }).catch(function (e) { console.error('[view]', e); message(t('pubFailed')); });
})();
