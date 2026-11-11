/* M13 key-gated gate: personal sign-in in front of the hub (library/features/auth-gate/key-gated-bundle.md and
 * email-link-sign-in.md). Loaded by chassis/index.key-gated.html after hub.config.js and hub-core.js; never edited per hub.
 *
 * Mode. The flag file (gate.flag, default gate-mode.js) sets window.HUB_GATED. Absent or false: local work, the plaintext
 * files sit beside the page and the chassis boots as usual, with no sign-in. true: the published mirror, where only the
 * bundle (gate.bundle, default data/bundle.enc) holds the data. A flag rather than a probe, so neither side requests a file
 * that is not there.
 *
 * Gated. The visitor signs in by email link. An account with a role reads the hub's key ring, the keys are tried newest first
 * (AES-256-GCM, then gunzip, then JSON { path: file text }), and the chassis boots with Hub.loadData running the decrypted
 * files in the order hub.config.js lists them: data, dataOptional, views. Views missing from the bundle load as public files.
 * HTML files in the bundle land in window.HUB_EMBEDS. Nothing that opens the hub is kept in the browser. When no key opens
 * the bundle, or a file in it fails to run, the card says gateOpenFailed with a sign-out, and auth-denied fires (open-failed).
 *
 * The store is project-owned, a global named by gate.store (default HubAuth), loaded from gate.scripts:
 *   init() -> Promise          finishes a sign-in link in the address, then settles on the first auth state
 *   user                       null, or { email, ... } once init settles
 *   signInError                set when a sign-in link failed
 *   canRead() -> boolean       the account has a role that may open the hub
 *   gateKeys() -> Promise<[]>  the key ring, base64 raw keys, newest first
 *   signIn(email) -> Promise   sends the link; rejects with { code } (auth/admin-restricted-operation: not on the list)
 *   signOut() -> Promise
 * Every word is a config label (gate*), the only text a signed-out visitor sees. Fires auth-granted and auth-denied on window. */
(function () {
  var C = window.HUB_CONFIG || {}, G = C.gate || {}, t = Hub.t;
  var $ = function (id) { return document.getElementById(id); };
  var bare = function (f) { return String(f).replace(/\?.*$/, ''); };
  var DATA = (C.data || []).map(bare), OPTIONAL = (C.dataOptional || []).map(bare), VIEWS = (C.views || []).map(bare);
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  var emit = function (name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} };
  var inOrder = function (list, fn) { return (list || []).reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve()); };
  Hub.labelDefaults({
    gateTitle: '', gatePrompt: 'Sign in with your email. We send you a link that opens the hub.', gateEmail: 'Email',
    gateSend: 'Email me a sign-in link', gateSending: 'Sending…',
    gateSent: 'Check your inbox for a sign-in link and open it in this browser. Look in spam if it is not there.',
    gateNotListed: 'That address is not on the account list.', gateSendFailed: 'The link could not be sent. Try again.',
    gateLinkFailed: 'That sign-in link did not work. It may have expired or been used already. Ask for a new one.',
    gateNoAccess: '{email} is signed in, but this account does not have access to the hub.', gateSignOut: 'Sign out',
    gateOpenFailed: 'The hub could not be opened. Reload the page, or sign out and in again.', gateUnavailable: 'The hub is not available right now.'
  });

  /* an inline script's own error goes to window, not to the caller */
  function run(text, name) {
    var failed = null, watch = function (e) { failed = e.error || new Error(e.message); };
    window.addEventListener('error', watch);
    var s = document.createElement('script'); s.textContent = text + '\n//# sourceURL=' + encodeURI(name); document.head.appendChild(s);
    window.removeEventListener('error', watch);
    if (failed) throw failed;
  }
  function unlock(raw, bundle) {
    return crypto.subtle.importKey('raw', b64(raw), 'AES-GCM', false, ['decrypt'])
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(bundle.iv) }, key, b64(bundle.ct)); })
      .then(function (gz) { return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); })
      .then(JSON.parse);
  }
  /* the newest key first; an older one still opens a bundle published moments before */
  function tryKeys(keys, bundle) { return (keys || []).reduce(function (p, k) { return p.catch(function () { return unlock(k, bundle); }); }, Promise.reject(new Error('no key opens the bundle'))); }
  /* the chassis boots as usual, with the files coming from the bundle instead of the network */
  function start(files) {
    DATA.forEach(function (f) { if (files[f] == null) throw new Error('bundle has no ' + f); });
    var inside = VIEWS.filter(function (f) { return files[f] != null; });
    if (inside.length && inside.length < VIEWS.length) throw new Error('bundle has some views but not all');
    Object.keys(files).forEach(function (f) { if (/\.html$/.test(f)) (window.HUB_EMBEDS = window.HUB_EMBEDS || {})[f] = files[f]; });
    Hub.loadData = function () { DATA.concat(OPTIONAL, inside).forEach(function (f) { if (files[f] != null) run(files[f], f); }); return Promise.resolve(); };
    if (inside.length) C.views = [];
    /* boot shows its own failure screen and still resolves; the gate must see it, or it would grant a hub that never started */
    return Hub.boot().then(function () { if (!document.documentElement.hasAttribute('data-hub-started')) throw new Error('the hub did not start'); });
  }

  function gate() {
    var g = $('gate'), form = $('gate-form'), input = $('gate-input') || $('gate-pw'), msg = $('gate-msg'), out = $('gate-out') || $('gate-retry');
    var btn = form.querySelector('button[type=submit]'), A = window[G.store || 'HubAuth'];
    input.type = 'email'; input.setAttribute('autocomplete', 'email');
    $('gate-title').textContent = t('gateTitle') || (C.brand || {}).name || ''; $('gate-prompt').textContent = t('gatePrompt'); $('gate-label').textContent = t('gateEmail');
    btn.textContent = t('gateSend'); out.textContent = t('gateSignOut');
    var show = function (text, signedIn) {
      g.hidden = false; form.hidden = false; msg.textContent = text || '';
      [$('gate-prompt'), $('gate-label'), input, btn].forEach(function (e) { e.hidden = !!signedIn; });
      out.hidden = !signedIn; btn.disabled = false;
      if (!signedIn) input.focus();
    };
    var unavailable = function (e) {
      console.error('[gate]', e); g.hidden = false; form.hidden = false;
      [$('gate-prompt'), $('gate-label'), input, btn, out].forEach(function (x) { x.hidden = true; });
      msg.textContent = t('gateUnavailable');
    };
    if (!A) return unavailable(new Error('no sign-in store: window.' + (G.store || 'HubAuth')));
    /* the store reloads on an account change as well; reloading here keeps the gate right if it does not */
    out.onclick = function () { Promise.resolve(A.signOut()).then(function () { location.reload(); }); };
    form.onsubmit = function (e) {
      e.preventDefault(); var v = input.value.trim(); if (!v) return;
      btn.disabled = true; msg.textContent = t('gateSending');
      Promise.resolve(A.signIn(v)).then(function () { msg.textContent = t('gateSent'); }, function (x) {
        btn.disabled = false; msg.textContent = t(x && x.code === 'auth/admin-restricted-operation' ? 'gateNotListed' : 'gateSendFailed');
      });
    };
    return fetch(G.bundle || 'data/bundle.enc', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('no bundle'); return r.json(); }).then(function (bundle) {
      return A.init().then(function () {
        if (A.signInError) { emit('auth-denied', { reason: 'sign-in-failed' }); return show(t('gateLinkFailed')); }
        if (!A.user) return show('');
        if (!A.canRead()) { emit('auth-denied', { reason: 'not-allowlisted', email: A.user.email }); return show(t('gateNoAccess', { email: A.user.email }), true); }
        g.hidden = true;
        return A.gateKeys().then(function (keys) { return tryKeys(keys, bundle); }).then(start).then(function () {
          emit('auth-granted', { email: A.user.email, surface: C.id });
        }, function (e) { console.error('[gate]', e); emit('auth-denied', { reason: 'open-failed', email: A.user.email }); show(t('gateOpenFailed'), true); });
      });
    }).catch(unavailable);
  }

  /* the hub's look first (title, tokens light and dark, skin), so the gate card wears it; then the flag, the store, and either way in */
  Hub.look();
  Hub.load(G.flag || 'gate-mode.js', true)
    .then(function () { return inOrder(G.scripts, function (f) { return Hub.load(f); }); })
    .then(function () { return window.HUB_GATED === true ? gate() : Hub.boot(); })
    .catch(function (e) { console.error('[gate]', e); if (window.HUB_GATED === true) { $('gate').hidden = false; $('gate-msg').textContent = t('gateUnavailable'); } else Hub.boot(); });
})();
