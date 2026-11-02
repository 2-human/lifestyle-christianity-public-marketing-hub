/* Answers to hub questions, their files, and the Feedback Drawer's comments. One store with two backends:
 * shared (Firestore + Storage, when data/backend.js sets window.HUB_BACKEND) or this browser (localStorage + IndexedDB).
 * With a backend, people sign in with their own account by email link. The account's role decides what they reach:
 * team = answers and QA comments, client = answers only. Roles are set by an admin; the rules enforce them. */
(function () {
  var KEY = 'lc_hub_answers', cache = null, listeners = [], DB = null, F = null, SDK = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-', ROOT = 'hubs/lc', settle, AU = null, MAILKEY = 'lc_signin_email';
  var notify = function () { listeners.forEach(function (f) { f(); }); };
  var local = function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  var write = function (o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} notify(); };
  function db() {
    if (DB) return DB;
    DB = new Promise(function (ok, no) { var r = indexedDB.open('lc_hub_files', 1); r.onupgradeneeded = function () { r.result.createObjectStore('files'); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; });
    return DB;
  }
  function tx(mode, fn) { return db().then(function (d) { return new Promise(function (ok, no) { var s = d.transaction('files', mode).objectStore('files'), q = fn(s); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { no(q.error); }; }); }); }
  var fail = function (e) { console.error('[answers]', e); api.error = true; notify(); };

  /* a sign-in link lands here with ?mode=signIn&oobCode=…; finish it, then drop those parameters from the address */
  function finishLink(Au, auth) {
    var href = location.href; if (!Au.isSignInWithEmailLink(auth, href)) return null;
    var email = ''; try { email = localStorage.getItem(MAILKEY) || ''; } catch (e) {}
    if (!email) { try { email = (window.prompt('Confirm your email address to finish signing in') || '').trim(); } catch (e) {} }
    var u = new URL(href); ['mode', 'oobCode', 'apiKey', 'lang', 'continueUrl', 'tenantId'].forEach(function (k) { u.searchParams.delete(k); }); history.replaceState(null, '', u.pathname + u.search + u.hash);
    if (!email) return null;
    return Au.signInWithEmailLink(auth, email, href).then(function () { try { localStorage.removeItem(MAILKEY); } catch (e) {} }).catch(function (e) { api.signInError = e.code || 'failed'; console.error('[answers] sign-in link', e); });
  }
  /* sign-in state, once per page: the gate needs it before the hub loads, the store after */
  var INIT = null, SDKS = null;
  function init() {
    var cfg = window.HUB_BACKEND; api.backend = !!cfg;
    if (!cfg) return Promise.resolve();
    if (INIT) return INIT;
    INIT = Promise.all(['app', 'auth', 'firestore', 'storage'].map(function (m) { return import(SDK + m + '.js'); })).then(function (M) {
      var A = M[0], Au = M[1], Fs = M[2], St = M[3], app = A.initializeApp(cfg.firebase), auth = Au.getAuth(app), store = Fs.getFirestore(app), files = St.getStorage(app);
      if (cfg.emulator) { Au.connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true }); Fs.connectFirestoreEmulator(store, '127.0.0.1', 8180); St.connectStorageEmulator(files, '127.0.0.1', 9299); }
      AU = { Au: Au, auth: auth }; SDKS = { Fs: Fs, St: St, store: store, files: files };
      return Promise.resolve(finishLink(Au, auth)).then(function () {
        return new Promise(function (ok) {
          var first = true;
          Au.onAuthStateChanged(auth, function (u) {
            /* a sign-in or sign-out after start (another tab, the menu) reloads, so every part of the hub sees one account */
            if (!first) { if ((u ? u.uid : null) !== (api.user ? api.user.uid : null)) location.reload(); return; }
            first = false; if (!u) return ok();
            u.getIdTokenResult().then(function (t) { api.user = { uid: u.uid, email: u.email, name: u.displayName || u.email, role: t.claims.role || '' }; ok(); }, function () { ok(); });
          });
        });
      });
    });
    return INIT;
  }
  function connect() {
    return init().then(function () {
      if (!api.canAnswer()) return;
      var Fs = SDKS.Fs, store = SDKS.store;
      F = { Fs: Fs, St: SDKS.St, store: store, files: SDKS.files, col: function (n) { return Fs.collection(store, ROOT + '/' + n); }, doc: function (n, id) { return Fs.doc(store, ROOT + '/' + n, id); } };
      return new Promise(function (ok, no) {
        F.Fs.onSnapshot(F.col('answers'), function (snap) { var o = {}; snap.forEach(function (d) { o[d.id] = d.data(); }); cache = o; api.shared = true; ok(); notify(); }, function (e) { no(e); });
      });
    });
  }

  var api = window.HubAnswers = {
    shared: false, error: false, backend: false, user: null, signInError: null,
    canAnswer: function () { return !!api.user && (api.user.role === 'team' || api.user.role === 'client'); },
    canQA: function () { return !!api.user && api.user.role === 'team'; },
    /* emails a one-time sign-in link; only accounts an admin created can use it (sign-up is closed) */
    signIn: function (email) {
      if (!AU) return Promise.reject(new Error('no backend'));
      return AU.Au.sendSignInLinkToEmail(AU.auth, email, { url: location.origin + location.pathname, handleCodeInApp: true }).then(function () { try { localStorage.setItem(MAILKEY, email); } catch (e) {} });
    },
    signOut: function () { return AU ? AU.Au.signOut(AU.auth) : Promise.resolve(); },
    /* the gate's way in: sign-in state first, then the hub's decryption keys, which only accounts with a role can read */
    init: init,
    gateKeys: function () {
      return init().then(function () {
        if (!api.canAnswer()) return [];
        return SDKS.Fs.getDoc(SDKS.Fs.doc(SDKS.store, ROOT + '/meta', 'gate')).then(function (d) { return (d.exists() && d.data().keys) || []; });
      });
    },
    /* settles once the backend is known; the Feedback Drawer waits for it */
    ready: new Promise(function (ok) { settle = ok; }),
    start: function () {
      (window.HUB_BACKEND ? connect().catch(function (e) { F = null; cache = null; api.shared = false; api.error = true; console.error('[answers] shared storage unavailable', e); }) : Promise.resolve()).then(function () { settle(); notify(); });
    },
    all: function () { return cache || local(); },
    get: function (id) { return api.all()[id] || null; },
    save: function (id, rec) { if (F) { cache[id] = rec; notify(); F.Fs.setDoc(F.doc('answers', id), rec).catch(fail); return; } var o = local(); o[id] = rec; write(o); },
    remove: function (id) {
      var r = api.get(id);
      ((r && r.files) || []).forEach(function (f) { api.dropFile(f.id, f.path); });
      if (F) { delete cache[id]; notify(); F.Fs.deleteDoc(F.doc('answers', id)).catch(fail); return; }
      var o = local(); delete o[id]; write(o);
    },
    onChange: function (fn) { listeners.push(fn); },
    putFile: function (file, qid) {
      var id = 'f' + Date.now() + Math.random().toString(36).slice(2, 7), meta = { id: id, name: file.name, size: file.size, type: file.type };
      if (F) { meta.path = ROOT + '/answers/' + qid + '/' + id; return F.St.uploadBytes(F.St.ref(F.files, meta.path), file, { contentType: file.type || 'application/octet-stream' }).then(function () { return meta; }); }
      return tx('readwrite', function (s) { return s.put(file, id); }).then(function () { return meta; });
    },
    getFile: function (meta) { return F && meta.path ? F.St.getBlob(F.St.ref(F.files, meta.path)) : tx('readonly', function (s) { return s.get(meta.id); }); },
    dropFile: function (id, path) { return F && path ? F.St.deleteObject(F.St.ref(F.files, path)).catch(fail) : tx('readwrite', function (s) { return s.delete(id); }); },
    /* the Feedback Drawer's QA comments: team accounts only */
    comments: function () {
      if (!F || !api.canQA()) return null;
      return { local: false,
        subscribe: function (fn) { return F.Fs.onSnapshot(F.col('comments'), function (snap) { var o = {}; snap.forEach(function (d) { o[d.id] = d.data(); }); fn(o); }, fail); },
        create: function (rec) { return F.Fs.addDoc(F.col('comments'), rec).then(function (r) { return r.id; }); },
        update: function (id, patch) { return F.Fs.updateDoc(F.doc('comments', id), patch); },
        remove: function (id) { return F.Fs.deleteDoc(F.doc('comments', id)); } };
    }
  };
  window.addEventListener('storage', function (e) { if (e.key === KEY && !F) notify(); });
})();
