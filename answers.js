/* Answers to hub questions, their files, and the Feedback Drawer's comments. One store with two backends:
 * shared (Firestore + Storage, when data/backend.js sets window.HUB_BACKEND) or this browser (localStorage + IndexedDB).
 * The shared login sits in the encrypted bundle, so only someone with the hub password can reach the database. */
(function () {
  var KEY = 'lc_hub_answers', cache = null, listeners = [], DB = null, F = null, SDK = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-', ROOT = 'hubs/lc', settle;
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

  function connect(cfg) {
    return Promise.all(['app', 'auth', 'firestore', 'storage'].map(function (m) { return import(SDK + m + '.js'); })).then(function (M) {
      var A = M[0], Au = M[1], Fs = M[2], St = M[3], app = A.initializeApp(cfg.firebase), auth = Au.getAuth(app), store = Fs.getFirestore(app), files = St.getStorage(app);
      if (cfg.emulator) { Au.connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true }); Fs.connectFirestoreEmulator(store, '127.0.0.1', 8180); St.connectStorageEmulator(files, '127.0.0.1', 9299); }
      F = { Fs: Fs, St: St, store: store, files: files, col: function (n) { return Fs.collection(store, ROOT + '/' + n); }, doc: function (n, id) { return Fs.doc(store, ROOT + '/' + n, id); } };
      return Au.signInWithEmailAndPassword(auth, cfg.email, cfg.password);
    }).then(function () {
      return new Promise(function (ok, no) {
        F.Fs.onSnapshot(F.col('answers'), function (snap) { var o = {}; snap.forEach(function (d) { o[d.id] = d.data(); }); cache = o; api.shared = true; ok(); notify(); }, function (e) { no(e); });
      });
    });
  }

  var api = window.HubAnswers = {
    shared: false, error: false,
    /* settles once the backend is known; the Feedback Drawer waits for it */
    ready: new Promise(function (ok) { settle = ok; }),
    start: function () {
      var cfg = window.HUB_BACKEND;
      (cfg ? connect(cfg).catch(function (e) { F = null; cache = null; api.error = true; console.error('[answers] shared storage unavailable', e); }) : Promise.resolve()).then(function () { settle(); notify(); });
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
    /* the Feedback Drawer's comments, when shared storage is on */
    comments: function () {
      if (!F) return null;
      return { local: false,
        subscribe: function (fn) { return F.Fs.onSnapshot(F.col('comments'), function (snap) { var o = {}; snap.forEach(function (d) { o[d.id] = d.data(); }); fn(o); }, fail); },
        create: function (rec) { return F.Fs.addDoc(F.col('comments'), rec).then(function (r) { return r.id; }); },
        update: function (id, patch) { return F.Fs.updateDoc(F.doc('comments', id), patch); },
        remove: function (id) { return F.Fs.deleteDoc(F.doc('comments', id)); } };
    }
  };
  window.addEventListener('storage', function (e) { if (e.key === KEY && !F) notify(); });
})();
