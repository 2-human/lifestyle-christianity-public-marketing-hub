/* Answers to hub questions, their files, task outcomes, and the Feedback Drawer's comments. One store with two backends:
 * shared (Firestore + Storage, when firebase-config.js sets window.FIREBASE_CONFIG) or this browser (localStorage + IndexedDB).
 * With a backend, people sign in with their own account by email link. The account's role decides what they reach:
 * team = answers and QA comments, client = answers only. Roles are set by an admin; the rules enforce them. */
(function () {
  var KEY = 'lc_hub_answers', cache = null, listeners = [], DB = null, F = null, SDK = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-', ROOT = 'hubs/lc', settle, AU = null, MAILKEY = 'lc_signin_email', HASHKEY = 'lc_signin_hash', OKEY = 'lc_audit_outcomes', ocache = null;
  var notify = function () { listeners.forEach(function (f) { f(); }); };
  var local = function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  var write = function (o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} notify(); };
  var localO = function () { try { return JSON.parse(localStorage.getItem(OKEY) || '{}'); } catch (e) { return {}; } };
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
    /* the screen asked for when the link was sent goes back before the hub renders (auth-gate email-link-sign-in.md) */
    var back = ''; try { back = localStorage.getItem(HASHKEY) || ''; localStorage.removeItem(HASHKEY); } catch (e) {}
    var u = new URL(href); ['mode', 'oobCode', 'apiKey', 'lang', 'continueUrl', 'tenantId'].forEach(function (k) { u.searchParams.delete(k); }); history.replaceState(null, '', u.pathname + u.search + (u.hash || back));
    if (!email) return null;
    return Au.signInWithEmailLink(auth, email, href).then(function () { try { localStorage.removeItem(MAILKEY); } catch (e) {} }).catch(function (e) { api.signInError = e.code || 'failed'; console.warn('[answers] sign-in link', e.code || e); });
  }
  /* sign-in state, once per page: the chassis gate (chassis/gate-key.js) needs it before the hub loads, the store after */
  var INIT = null, SDKS = null;
  function init() {
    var cfg = window.FIREBASE_CONFIG; api.backend = !!cfg;
    if (!cfg) return Promise.resolve();
    if (INIT) return INIT;
    INIT = Promise.all(['app', 'auth', 'firestore', 'storage'].map(function (m) { return import(SDK + m + '.js'); })).then(function (M) {
      var A = M[0], Au = M[1], Fs = M[2], St = M[3], opts = Object.assign({}, cfg), emu = cfg.emulator === true ? {} : cfg.emulator; delete opts.emulator;
      var app = A.initializeApp(opts), auth = Au.getAuth(app), store = Fs.getFirestore(app), files = St.getStorage(app);
      /* the emulators: emulator true (this project's ports) or { auth, firestore, storage } ports (the chassis gate check) */
      if (emu) { Au.connectAuthEmulator(auth, 'http://127.0.0.1:' + (emu.auth || 9199), { disableWarnings: true }); Fs.connectFirestoreEmulator(store, '127.0.0.1', emu.firestore || 8180); St.connectStorageEmulator(files, '127.0.0.1', emu.storage || 9299); }
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
      var live = function (name, set) {
        return new Promise(function (ok, no) { F.Fs.onSnapshot(F.col(name), function (snap) { var o = {}; snap.forEach(function (d) { o[d.id] = d.data(); }); set(o); ok(); notify(); }, function (e) { no(e); }); });
      };
      return Promise.all([live('answers', function (o) { cache = o; }), live('outcomes', function (o) { ocache = o; })]).then(function () { api.shared = true; notify(); });
    });
  }

  var api = window.HubAnswers = {
    shared: false, error: false, backend: false, user: null, signInError: null,
    canAnswer: function () { return !!api.user && (api.user.role === 'team' || api.user.role === 'client'); },
    /* the chassis gate's name for the same check (hub-chassis M13): an account with a role may open the hub */
    canRead: function () { return api.canAnswer(); },
    canQA: function () { return !!api.user && api.user.role === 'team'; },
    /* emails a one-time sign-in link; only accounts an admin created can use it (sign-up is closed) */
    signIn: function (email) {
      if (!AU) return Promise.reject(new Error('no backend'));
      /* no #route in the continue address (Firebase's parameters would land after it): it waits in this browser instead */
      return AU.Au.sendSignInLinkToEmail(AU.auth, email, { url: location.origin + location.pathname + location.search, handleCodeInApp: true }).then(function () { try { localStorage.setItem(MAILKEY, email); localStorage.setItem(HASHKEY, location.hash); } catch (e) {} });
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
      (window.FIREBASE_CONFIG ? connect().catch(function (e) { F = null; cache = null; api.shared = false; api.error = true; console.error('[answers] shared storage unavailable', e); }) : Promise.resolve()).then(function () { settle(); notify(); });
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
    /* task outcomes: { text, done, by, date }, keyed by task id. Claude's generated results are the default the hub shows
     * until a person saves one; saving needs a signed-in account with a role, or no backend at all (this browser). */
    outcome: function (id) { return (ocache || localO())[id] || null; },
    canEditOutcomes: function () { return api.shared || !api.backend; },
    saveOutcome: function (id, rec) {
      if (F) { ocache[id] = rec; notify(); return F.Fs.setDoc(F.doc('outcomes', id), rec).catch(fail); }
      var o = localO(); o[id] = rec; try { localStorage.setItem(OKEY, JSON.stringify(o)); } catch (e) {} notify(); return Promise.resolve();
    },
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
  /* hub-chassis 1.3.0 M13: this store is also the gate's sign-in store (init, user, signInError, canRead, gateKeys, signIn, signOut) */
  window.HubAuth = api;
  window.addEventListener('storage', function (e) { if ((e.key === KEY || e.key === OKEY) && !F) notify(); });
})();
