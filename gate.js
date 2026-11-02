/* Sign-in gate. Locally the plaintext files exist, so the hub simply loads them. On the public mirror only data/bundle.enc
 * is published (tools/marketing-hub/encrypt-bundle.py): the visitor signs in with their own account by email link, the
 * hub reads its decryption keys from the database (only accounts with a role may), decrypts in the browser (AES-256-GCM,
 * then gunzip), runs the files in order and starts. Nothing that opens the hub is stored in the browser. */
(function () {
  var FILES = ['data/facts.js', 'data/audit.js', 'data/evidence.js', 'data/results.js', 'data/assets.js', 'data/proposal.js', 'views.js'];
  var $ = function (id) { return document.getElementById(id); };
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  function load(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
  function unlock(raw, bundle) {
    return crypto.subtle.importKey('raw', b64(raw), 'AES-GCM', false, ['decrypt'])
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(bundle.iv) }, key, b64(bundle.ct)); })
      .then(function (gz) { return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); })
      .then(function (json) {
        var files = JSON.parse(json);
        FILES.forEach(function (f) { if (files[f] == null) return; var s = document.createElement('script'); s.textContent = files[f]; document.head.appendChild(s); });
        window.Hub.start();
      });
  }
  /* the newest key first; the previous ones still open a bundle published moments before */
  function tryKeys(keys, bundle) { return keys.reduce(function (p, k) { return p.catch(function () { return unlock(k, bundle); }); }, Promise.reject()); }
  function gate() {
    var g = $('gate'), form = $('gate-form'), msg = $('gate-msg'), email = $('gate-email'), btn = form.querySelector('button[type=submit]'), out = $('gate-out'), A = window.HubAnswers;
    var show = function (text, signedIn) { g.hidden = false; msg.textContent = text || ''; email.parentNode.hidden = btn.hidden = !!signedIn; out.hidden = !signedIn; if (!signedIn) email.focus(); };
    out.onclick = function () { A.signOut(); };
    form.onsubmit = function (e) {
      e.preventDefault(); var v = email.value.trim(); if (!v) return; btn.disabled = true; msg.textContent = 'Sending…';
      A.signIn(v).then(function () { msg.textContent = 'Check your inbox for a sign-in link and open it in this browser.'; }, function (x) { btn.disabled = false; msg.textContent = x && x.code === 'auth/admin-restricted-operation' ? 'That address is not on the account list.' : 'The link could not be sent. Try again.'; });
    };
    fetch('data/bundle.enc', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('no bundle'); return r.json(); }).then(function (bundle) {
      return A.init().then(function () {
        if (A.signInError) return show('That sign-in link did not work. It may have expired or been used already. Ask for a new one.');
        if (!A.user) return show('');
        if (!A.canAnswer()) return show('Signed in as ' + A.user.email + ', but this account does not have access to the hub. Ask North Star Communications.', true);
        msg.textContent = 'Opening…';
        return A.gateKeys().then(function (keys) { return tryKeys(keys, bundle); }).then(function () { g.hidden = true; }, function (e) { console.error('[gate]', e); show('The hub could not be opened. Reload the page to try again.', true); });
      });
    }).catch(function (e) { console.error('[gate]', e); g.hidden = false; form.hidden = true; out.hidden = true; msg.textContent = 'The hub is not available.'; });
  }
  load(FILES[0] + '?t=' + Date.now()).then(function () {
    return FILES.slice(1).reduce(function (p, f) { return p.then(function () { return load(f + '?t=' + Date.now()); }); }, Promise.resolve());
  }).then(function () { window.Hub.start(); }, gate);
})();
