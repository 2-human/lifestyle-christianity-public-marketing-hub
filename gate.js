/* Password gate. Locally the plaintext files exist, so the hub simply loads them. On the public mirror only data/bundle.enc
 * is published (tools/marketing-hub/encrypt-bundle.py): ask for the password, decrypt in the browser (PBKDF2-SHA256 to
 * AES-256-GCM, then gunzip), run the files in order, start the hub. The derived key stays in this tab's sessionStorage. */
(function () {
  var FILES = ['data/facts.js', 'data/sample.js', 'data/audit.js', 'data/evidence.js', 'data/results.js', 'data/assets.js', 'views.js'], KEY = 'lc-gate-key';
  var $ = function (id) { return document.getElementById(id); };
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  var enc = function (u) { var s = ''; u.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); };
  function load(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
  function unlock(key, bundle) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(bundle.iv) }, key, b64(bundle.ct))
      .then(function (gz) { return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); })
      .then(function (json) {
        var files = JSON.parse(json);
        FILES.forEach(function (f) { var s = document.createElement('script'); s.textContent = files[f]; document.head.appendChild(s); });
        window.Hub.start();
      });
  }
  function derive(password, bundle) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) { return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(bundle.salt), iterations: bundle.iter }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']); });
  }
  function gate() {
    var g = $('gate'), form = $('gate-form'), msg = $('gate-msg'), pw = $('gate-pw');
    fetch('data/bundle.enc', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('no bundle'); return r.json(); }).then(function (bundle) {
      var saved = null; try { saved = sessionStorage.getItem(KEY); } catch (e) {}
      var first = saved ? crypto.subtle.importKey('raw', b64(saved), 'AES-GCM', true, ['decrypt']).then(function (k) { return unlock(k, bundle); }) : Promise.reject();
      first.catch(function () {
        try { sessionStorage.removeItem(KEY); } catch (e) {}
        g.hidden = false; pw.focus();
        form.onsubmit = function (e) {
          e.preventDefault(); msg.textContent = 'Unlocking…'; form.querySelector('button').disabled = true;
          derive(pw.value, bundle).then(function (k) {
            return unlock(k, bundle).then(function () { return crypto.subtle.exportKey('raw', k); }).then(function (raw) { try { sessionStorage.setItem(KEY, enc(new Uint8Array(raw))); } catch (e2) {} g.hidden = true; });
          }).catch(function () { msg.textContent = 'That password did not open the hub.'; form.querySelector('button').disabled = false; pw.select(); });
        };
      });
    }).catch(function () { g.hidden = false; form.querySelector('input').hidden = true; form.querySelector('button').hidden = true; msg.textContent = 'The hub is not available.'; });
  }
  FILES.reduce(function (p, f) { return p.then(function () { return load(f + '?t=' + Date.now()); }); }, Promise.resolve()).then(function () { window.Hub.start(); }, gate);
})();
