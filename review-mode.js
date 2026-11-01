/* review-mode.js — review widget for the Marketing Hub (loads only on ?review=1). Classic script.
 * MH-95 (operator 27 Oct 2026): "add the commenting / review module to the marketing hub". Composed from the
 * review-widget feature (organization-template/library/features/review-widget, feature_version 1.3.0), starting from
 * the review-widget feature and adapted to a hash-routed single-page app:
 *
 *  · Pages are screens. The hub is one document whose screen is its hash route (#/ads/…, with ?tab=…), and an open
 *    drawer adds d=<item>&dt=<tab> to the hash (MH-79 permalinks). A comment's `page` is
 *    "lc-marketing-hub:<route>[?tab=…]"; a comment left inside a drawer also stores `drawer` = "d=…&dt=…".
 *  · Anchors are deterministic per screen, not sticky. Each pass numbers the commentable elements of each root afresh
 *    in document order — main panel "m-", right drawer "d-", search-terms drawer "l-" — so the same screen always gets
 *    the same ids however the reviewer got there (anchor-strategy's 1-indexed tag counter, scoped to the root).
 *    The side navigation, the top bar and the password gate are chrome and never anchored.
 *  · The route changes without a page load (hashchange, and history.replaceState when a drawer opens), so the widget
 *    re-reads the hash on every pass and every 400 ms, and redraws when it changes.
 *  · "All screens" lists the hub's comments only (records whose page starts with the hub prefix), grouped by screen;
 *    clicking one on another screen or drawer sets the hash, the hub renders that screen and opens the drawer, and the
 *    widget spotlights the element (global-comment-list's focus handoff without a reload).
 *  · No text preview is stored (operator 27 Oct): the database is readable without the hub password.
 *  · Not composed here: variant-anchors, cross-page-slot-comments and the live-page chip (landing-page features).
 *
 * Statuses, tabs, outlines and dots, spotlight, edit / resolve / reopen / delete and the Firebase adapter are as in the
 * 1.3.0 composition. */
(function(){
const CFG = (window.HUB_REVIEW_CONFIG) || {};
const L = Object.assign({
  bannerTitle:'Review mode', localOnly:'Local-only', exit:'Exit review', sidebarTitle:'Comments',
  empty:'No comments here yet. Hover any text and click the +.',
  add:'+ Comment', save:'Post comment', cancel:'Cancel',
  edit:'Edit', del:'Delete', resolve:'Resolve', reopen:'Reopen',
  tabOpen:'Open', tabResolved:'Resolved', resolvePrompt:'Resolution note (what was done):',
  scopePage:'This screen', scopeAll:'All screens', thisPage:'This screen', hideSide:'Hide comments', showSide:'Show comments',
  placeholder:'Your feedback…', replacementPlaceholder:'Suggested change (optional)…', namePrompt:'Your name:'
}, CFG.REVIEW_LABELS || {});
const FB = CFG.FIREBASE_CONFIG || {};
const FB_OK = FB.apiKey && FB.apiKey.indexOf('PASTE') !== 0 && FB.databaseURL && FB.databaseURL.indexOf('PASTE') < 0;
const PREFIX = CFG.PAGE_PREFIX || 'lc-marketing-hub:';
const _MEM = {};
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return (k in _MEM)?_MEM[k]:null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){_MEM[k]=v}}};

/* commentable-everything, 'direct-text' mode : any element with ≥2 chars of its own text, except
 * the deny-list. */
const NEVER_ANCHOR = new Set([
  'input','select','textarea','option','optgroup','datalist','fieldset','legend',
  'script','style','template','noscript','meta','link','title','head','html','body',
  'svg','path','circle','rect','ellipse','polygon','polyline','line','g','use','defs','symbol','marker',
  'iframe','embed','object','param',
  'br','hr','img','video','audio','source','track','picture',
  'col','colgroup'
]);
const CHROME_SEL = '.review-banner,.review-sidebar,.review-modal-overlay,.review-floating-pill,.review-toggle-btn,[data-review-skip],.rw-dots';
/* the commentable roots: [selector, anchor prefix, is a drawer] */
const ROOTS = [['#app-main','m',false],['#drawer-body','d',true],['#ldrawer-body','l',true]];
function hasDirectText(el){
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length >= 2) return true;
  }
  return false;
}

/* ───── the screen and the drawer, from the hash ───── */
function hashParts(){
  const h = location.hash || '#/overview', i = h.indexOf('?');
  return { path: (i < 0 ? h : h.slice(0, i)).replace(/^#/, '') || '/overview', q: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) };
}
function screenKey(){ const p = hashParts(), tab = p.q.get('tab'); return PREFIX + p.path + (tab ? '?tab=' + encodeURIComponent(tab) : ''); }   /* encoded: a tab name with & or ? stays one key */
function drawerKey(){
  const p = hashParts(), d = p.q.get('d'); if (!d) return '';
  const dt = p.q.get('dt'); const s = new URLSearchParams(); s.set('d', d); if (dt) s.set('dt', dt); return s.toString();
}
function drawerOpen(sel){ const r = document.querySelector(sel); const a = r && r.closest('aside'); return !!(a && a.classList.contains('open')); }
let SLUG = screenKey(), DRAWER = drawerKey(), LASTHASH = location.hash;

/* Deterministic anchors: every pass renumbers each root from 1, so an id names the same element on every visit to the
 * same screen. An element whose id changes (the screen re-rendered differently) simply carries its new id. */
function anchorPass(){
  ROOTS.forEach(([sel, pre, isDrawer]) => {
    const root = document.querySelector(sel); if (!root) return;
    if (isDrawer && !drawerOpen(sel)) return;
    const counters = {};
    root.querySelectorAll('*').forEach(elm => {
      if (elm.closest(CHROME_SEL)) return;
      const tag = elm.tagName.toLowerCase();
      if (NEVER_ANCHOR.has(tag)) return;
      let id = null;
      if (hasDirectText(elm)) { counters[tag] = (counters[tag] || 0) + 1; id = pre + '-' + tag + '-' + counters[tag]; }
      else if (tag !== 'span' && elm.querySelector(':scope > img, :scope > picture, :scope > video')) { counters.img = (counters.img || 0) + 1; id = pre + '-img-' + counters.img; }   /* image-anchoring: the image's container */
      if (id) { if (elm.getAttribute('data-comment-id') !== id) elm.setAttribute('data-comment-id', id); }
      else if (elm.hasAttribute('data-comment-id')) elm.removeAttribute('data-comment-id');
    });
  });
}
function rootIsDrawer(elm){ return !!(elm && elm.closest && elm.closest('#drawer-body,#ldrawer-body')); }

function reviewer(){let n=store.get('lc_reviewer');if(!n){let asked='';try{asked=window.prompt(L.namePrompt,'')}catch(e){}n=(asked||'Anonymous').trim()||'Anonymous';store.set('lc_reviewer',n);}return n;}
function statusOf(c){ const s=c.status; if(s==='resolved'||s==='applied'||s==='archived'||c.archived||c.applied)return 'resolved'; return 'pending'; }
const isHub = c => c && typeof c.page === 'string' && c.page.indexOf(PREFIX) === 0;
/* on this screen: same screen key; a drawer comment only while that drawer is open on the same tab */
const onScreen = c => isHub(c) && c.page === SLUG;
const visibleHere = c => onScreen(c) && (!c.drawer || c.drawer === DRAWER);

/* ---- adapters (as 1.3.0) ---- */
function localAdapter(){
  const KEY='lc_review_comments'; let cb=null;
  const read=()=>{try{return JSON.parse(store.get(KEY)||'{}')}catch(e){return {}}};
  const write=o=>store.set(KEY,JSON.stringify(o)); const ping=()=>cb&&cb(read());
  return { local:true,
    subscribe(fn){cb=fn;fn(read());window.addEventListener('storage',e=>{if(e.key===KEY)fn(read())});return()=>{cb=null}},
    create(rec){const o=read();const id='c'+Date.now()+Math.random().toString(36).slice(2,7);o[id]=rec;write(o);ping();return Promise.resolve(id)},
    update(id,patch){const o=read();o[id]=Object.assign({},o[id],patch);write(o);ping();return Promise.resolve()},
    remove(id){const o=read();delete o[id];write(o);ping();return Promise.resolve()} };
}
async function firebaseAdapter(){
  const A=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const D=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const app=(A.getApps&&A.getApps().length)?A.getApp():A.initializeApp(FB);
  const db=D.getDatabase(app); const root=D.ref(db,'comments');
  return { local:false,
    subscribe(fn){return D.onValue(root,s=>fn(s.val()||{}))},
    create(rec){const r=D.push(root);return D.set(r,rec).then(()=>r.key)},
    update(id,patch){return D.update(D.ref(db,'comments/'+id),patch)},
    remove(id){return D.remove(D.ref(db,'comments/'+id))} };
}

function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function when(ts){const d=new Date(ts||Date.now());return d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
const cssq = v => (window.CSS && CSS.escape) ? CSS.escape(v) : v;

let SIDE,LIST,TABS,PILL,ROUTE,ADAPTER,ME,COMMENTS={},FILTER='open',curEl=null,curId=null,hideT=null;
let SELID=null,SELANCHOR=null;
const TAB_OF={open:'pending',resolved:'resolved'};
let SCOPE='page';   /* 'page' (default: this screen) | 'all' (every hub comment, grouped by screen); session-only */
let FOCUS=null;     /* a comment to spotlight once its screen has rendered (cross-screen jump) */

/* Screen labels come from the hash itself (nothing extra is stored): "/ads/garnishment-pause?tab=x" → "ads › garnishment-pause · x".
 * The current screen also shows the hub's own title. */
function pageLabel(page){
  const s = String(page||'').slice(PREFIX.length), i = s.indexOf('?tab=');
  const path = (i < 0 ? s : s.slice(0, i)).replace(/^\//, '').split('/').map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } }).join(' › ');
  return (path || 'overview') + (i < 0 ? '' : ' · ' + decodeURIComponent(s.slice(i + 5)));
}
function drawerLabel(dr){ const q = new URLSearchParams(dr||''); return (q.get('d')||'').replace(/-/g,' ') + (q.get('dt') ? ' · ' + q.get('dt') : ''); }
function currentTitle(){ return (document.title||'').split(' · ')[0] || pageLabel(SLUG); }

function setSide(hidden){ document.documentElement.setAttribute('data-rw-side', hidden ? 'hidden' : 'shown'); if (SIDE) SIDE.classList.toggle('rw-collapsed', hidden); const b = document.querySelector('.rw-side-btn'); if (b) b.textContent = hidden ? L.showSide : L.hideSide; store.set('mh_rw_side', hidden ? 'hidden' : 'shown'); }

function buildChrome(){
  const ban=el('div','review-banner');
  ban.innerHTML='<span class="rw-title">'+esc(L.bannerTitle)+'</span><span class="rw-route"></span>'+(ADAPTER.local?'<span class="rw-local">'+esc(L.localOnly)+'</span>':'')+'<span class="rw-spacer"></span><span class="rw-name">'+esc(ME)+'</span>';
  const side=el('button','rw-side-btn',esc(L.hideSide)); side.type='button'; side.onclick=()=>setSide(!SIDE.classList.contains('rw-collapsed'));
  const exit=el('button',null,esc(L.exit)); exit.onclick=()=>{const u=new URL(location.href);u.searchParams.delete('review');location.href=u.toString()};
  ban.appendChild(side); ban.appendChild(exit); document.body.appendChild(ban);
  ROUTE = ban.querySelector('.rw-route');

  SIDE=el('aside','review-sidebar');
  SIDE.appendChild(el('h3',null,'<span>'+esc(L.sidebarTitle)+'</span>'));
  const SCOPEBAR=el('div','rw-scopebar');
  [['page',L.scopePage],['all',L.scopeAll]].forEach(([k,lbl])=>{
    const b=el('button',k===SCOPE?'on':null,esc(lbl)); b.dataset.s=k;
    b.onclick=()=>{SCOPE=k;SCOPEBAR.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.s===k));render();};
    SCOPEBAR.appendChild(b);
  });
  SIDE.appendChild(SCOPEBAR);
  TABS=el('div','review-tabs');
  [['open',L.tabOpen],['resolved',L.tabResolved]].forEach(([k,lbl])=>{
    const b=el('button',k===FILTER?'on':null,esc(lbl)+' <span class="rw-c">0</span>'); b.dataset.k=k;
    b.onclick=()=>{FILTER=k;TABS.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.k===k));render();};
    TABS.appendChild(b);
  });
  SIDE.appendChild(TABS);
  LIST=el('div','review-list'); SIDE.appendChild(LIST); document.body.appendChild(SIDE);
  /* phones start with the sidebar hidden (it would cover the screen); elsewhere the last choice is kept */
  const saved = store.get('mh_rw_side');
  setSide(saved ? saved === 'hidden' : window.matchMedia('(max-width:900px)').matches);

  PILL=el('button','review-floating-pill',esc(L.add)); PILL.type='button'; PILL.setAttribute('data-review-skip','');
  document.body.appendChild(PILL);
  PILL.addEventListener('mouseenter',()=>clearTimeout(hideT));
  PILL.addEventListener('mouseleave',hidePillSoon);
  PILL.addEventListener('click',()=>{if(curId&&curEl)openComposer(curId,curEl)});
  document.addEventListener('mouseover',e=>{
    if(e.target.closest(CHROME_SEL))return;
    let a=e.target.closest('[data-comment-id]');
    if(!a && e.target.closest(ROOTS.map(r=>r[0]).join(','))){ anchorPass(); a=e.target.closest('[data-comment-id]'); }
    if(a){clearTimeout(hideT);placePill(a);}
  });
  /* touch (phones, tablets): no hover, so a tap on commentable text shows the pill there; the tap still does what it
   * does in the hub (open a drawer, follow a link). A tap elsewhere hides it. */
  document.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch'||e.target.closest(CHROME_SEL))return;
    if(e.target.closest(ROOTS.map(r=>r[0]).join(',')))anchorPass();
    const a=e.target.closest('[data-comment-id]');
    if(a){clearTimeout(hideT);placePill(a);} else hidePillSoon();
  },true);
  document.addEventListener('mouseout',e=>{const to=e.relatedTarget;if(to&&(to===PILL||(to.closest&&to.closest('[data-comment-id]'))))return;hidePillSoon();});
  window.addEventListener('scroll',()=>{if(curEl&&PILL.style.display==='block')placePill(curEl)},true);
}
function placePill(elm){curEl=elm;curId=elm.getAttribute('data-comment-id');PILL.style.display='block';const r=elm.getBoundingClientRect();PILL.style.top=Math.max(52,Math.min(r.top+6,window.innerHeight-34))+'px';PILL.style.left=Math.max(6,r.right-PILL.offsetWidth-8)+'px';}
function hidePillSoon(){hideT=setTimeout(()=>{PILL.style.display='none';curEl=null;curId=null;},140);}

function modal(title,ctx,initText,initRepl,onSave){
  const ov=el('div','review-modal-overlay');const m=el('div','review-modal');
  m.innerHTML='<h4>'+esc(title)+'</h4><div class="rw-ctx">'+esc(ctx)+'</div>';
  const ta=el('textarea');ta.placeholder=L.placeholder;ta.value=initText||'';
  const tr=el('textarea');tr.placeholder=L.replacementPlaceholder;tr.value=initRepl||'';tr.style.minHeight='44px';
  m.appendChild(ta);m.appendChild(tr);
  const acts=el('div','rw-modal-acts');
  const cancel=el('button','rw-cancel',esc(L.cancel));cancel.onclick=()=>ov.remove();
  const save=el('button','rw-save',esc(L.save));
  save.onclick=()=>{const t=ta.value.trim(),r=tr.value.trim(); if(!t&&!r)return; onSave(t,r); ov.remove();};
  acts.appendChild(cancel);acts.appendChild(save);m.appendChild(acts);ov.appendChild(m);
  ov.onclick=e=>{if(e.target===ov)ov.remove()};document.body.appendChild(ov);ta.focus();
}
function openComposer(anchor,elm){
  /* the composer shows the element's text so the reviewer knows what they are commenting on; it is not stored */
  const live=(elm.textContent||'').replace(/\s+/g,' ').trim().slice(0,90)||(elm.querySelector('img,video')?'[image]':'');
  const inDrawer = rootIsDrawer(elm);
  modal('Add comment', currentTitle()+(inDrawer&&DRAWER?' · '+drawerLabel(DRAWER):'')+' · '+live, '', '', (text, repl) => {
    const rec = { comment: text, replacement: repl || null, anchor: anchor, page: SLUG, author: ME, status: 'pending', timestamp: Date.now() };
    if (inDrawer && DRAWER) rec.drawer = DRAWER;
    saveOr(ADAPTER.create(rec), 'save the comment');
  });
}

function saveOr(pr, what){ return Promise.resolve(pr).catch(e=>{ console.warn('[review] could not '+what, e); window.alert('Could not '+what+'. Check the connection and try again.'); }); }
function actBtn(label,cls,fn){const b=el('button',cls,esc(label));b.onclick=ev=>{ev.stopPropagation();fn()};return b;}
function targetOf(c){ if(!c||!visibleHere(c))return null; return visibleTarget(document.querySelector('[data-comment-id="'+cssq(c.anchor)+'"]')); }
function visibleTarget(e0){ for(let e=e0; e && e.getBoundingClientRect; e=e.parentElement){ const r=e.getBoundingClientRect(); if(r.width||r.height) return e; } return null; }
function render(){
  if(!LIST)return;
  if(ROUTE) ROUTE.textContent = '· ' + currentTitle() + (DRAWER ? ' · ' + drawerLabel(DRAWER) : '');
  const all=Object.entries(COMMENTS).filter(([id,c])=>isHub(c));
  const screen=all.filter(([id,c])=>onScreen(c));
  const here=screen.filter(([id,c])=>visibleHere(c));
  const listSource=SCOPE==='all'?all:screen;
  const counts={pending:0,resolved:0};
  listSource.forEach(([id,c])=>{counts[statusOf(c)]=(counts[statusOf(c)]||0)+1});
  TABS.querySelectorAll('button').forEach(b=>{b.querySelector('.rw-c').textContent=counts[TAB_OF[b.dataset.k]]||0;});
  /* comment-status-indicators: outline + one dot per comment (red open, green resolved) on what is on screen now */
  document.querySelectorAll('.has-comment,.has-applied-comment').forEach(e=>e.classList.remove('has-comment','has-applied-comment'));
  document.querySelectorAll('.rw-dots').forEach(e=>e.remove());
  const byTarget={};
  here.forEach(([id,c])=>{ const r=byTarget[c.anchor]||(byTarget[c.anchor]={active:0,resolved:0}); if(statusOf(c)==='resolved')r.resolved++;else r.active++; });
  Object.keys(byTarget).forEach(an=>{
    const r=byTarget[an];
    document.querySelectorAll('[data-comment-id="'+cssq(an)+'"]').forEach(a=>{
      a.classList.add(r.active>0?'has-comment':'has-applied-comment');
      const d=document.createElement('span');d.className='rw-dots';d.setAttribute('aria-hidden','true');
      let h='';for(let i=0;i<r.active;i++)h+='<i class="rw-dot rw-dot-active"></i>';for(let i=0;i<r.resolved;i++)h+='<i class="rw-dot rw-dot-resolved"></i>';
      d.innerHTML=h;a.appendChild(d);
    });
  });
  const want=TAB_OF[FILTER];
  const rows=readingOrder(listSource.filter(([id,c])=>statusOf(c)===want));
  LIST.innerHTML='';
  if(!rows.length){LIST.appendChild(el('div','review-empty',esc(L.empty)));applyActive();return}
  const grouped=SCOPE==='all', groups={};
  let order;
  if(grouped){
    rows.forEach(entry=>{(groups[entry[1].page]||(groups[entry[1].page]=[])).push(entry);});
    order=Object.keys(groups).sort((a,b)=>{ if(a===SLUG)return -1; if(b===SLUG)return 1; return pageLabel(a).localeCompare(pageLabel(b)); });
  } else { groups['']=rows; order=['']; }
  order.forEach(pg=>{
    if(grouped){
      const hdr=el('div','rw-group'+(pg===SLUG?' rw-group-here':''));
      hdr.innerHTML='<span class="rw-group-name">'+esc(pg===SLUG?L.thisPage:pageLabel(pg))+'</span><span class="rw-group-count">'+groups[pg].length+'</span>';
      LIST.appendChild(hdr);
    }
    groups[pg].forEach(([id,c])=>{
      const st=statusOf(c), vis=visibleHere(c);
      const row=el('div','review-row'+(id===SELID?' rw-selected':'')+(vis?'':' rw-offpage'));
      const drawerChip = c.drawer ? ' <span class="rw-drawer-chip" title="Left in a drawer">'+esc(drawerLabel(c.drawer))+'</span>' : '';
      const jumpChip = vis ? '' : ' <span class="rw-jump">opens ↗</span>';
      row.innerHTML='<div class="rw-meta"><b>'+esc(c.author||'Anonymous')+'</b><span class="rw-badge rw-'+st+'">'+(st==='resolved'?'resolved':'open')+'</span>'+drawerChip+jumpChip+'<span>'+when(c.timestamp)+(c.edited_at?' · edited':'')+'</span></div>'+
        '<div class="rw-body">'+esc(c.comment||'')+'</div>'+
        (c.replacement?'<div class="rw-repl">↳ '+esc(c.replacement)+'</div>':'')+
        (st==='resolved'&&c.resolution?'<div class="rw-resolution">✓ '+esc(c.resolution)+'</div>':'')+
        '<div class="rw-anchor">'+esc(c.anchor)+'</div>';
      const acts=el('div','rw-acts');
      if(st==='pending'){
        acts.appendChild(actBtn(L.edit,'edit-btn',()=>modal('Edit comment',c.anchor,c.comment||'',c.replacement||'',(t,r)=>saveOr(ADAPTER.update(id,{comment:t,replacement:r||null,edited_at:Date.now()}),'save the edit'))));
        acts.appendChild(actBtn(L.resolve,'resolve-btn',()=>{const note=(window.prompt(L.resolvePrompt,'')||'').trim();saveOr(ADAPTER.update(id,{status:'resolved',resolution:note||('Resolved · '+ME),resolved_at:Date.now(),resolved_by:ME}),'resolve the comment');}));
      } else {
        acts.appendChild(actBtn(L.reopen,'restore-btn',()=>saveOr(ADAPTER.update(id,{status:'pending',resolution:null}),'reopen the comment')));
      }
      acts.appendChild(actBtn(L.del,'delete-btn',()=>{if(confirm('Delete this comment?'))saveOr(ADAPTER.remove(id),'delete the comment')}));
      row.appendChild(acts);
      row.onclick = vis ? (()=>{SELID=id;spotlight(c);render();}) : (()=>jumpTo(id,c));
      LIST.appendChild(row);
    });
  });
  applyActive();
}
/* reading order of the components on screen (top row left→right, then down); off-screen comments after, oldest first */
function readingOrder(entries){
  const pos=new Map();
  entries.forEach(e=>{ const t=targetOf(e[1]); if(!t) return; const r=t.getBoundingClientRect(); if(!r.width && !r.height) return;
    pos.set(e[0],{top:r.top+window.pageYOffset,bottom:r.bottom+window.pageYOffset,left:r.left+window.pageXOffset}); });
  const ts=e=>e[1].timestamp||0;
  const placed=entries.filter(e=>pos.has(e[0])).sort((a,b)=>pos.get(a[0]).top-pos.get(b[0]).top||ts(a)-ts(b));
  const band=new Map(); let row=0, bottom=-Infinity;
  placed.forEach(e=>{ const p=pos.get(e[0]); if(p.top>=bottom){ row++; bottom=p.bottom; } else bottom=Math.min(bottom,p.bottom); band.set(e[0],row); });
  placed.sort((a,b)=> band.get(a[0])-band.get(b[0]) || pos.get(a[0]).left-pos.get(b[0]).left || pos.get(a[0]).top-pos.get(b[0]).top || ts(a)-ts(b));
  return placed.concat(entries.filter(e=>!pos.has(e[0])).sort((a,b)=>ts(a)-ts(b)));
}
function applyActive(){
  document.querySelectorAll('.rw-active-anchor').forEach(e=>e.classList.remove('rw-active-anchor'));
  if(!SELANCHOR)return;
  document.querySelectorAll('[data-comment-id="'+cssq(SELANCHOR)+'"]').forEach(a=>{const t=visibleTarget(a); if(t) t.classList.add('rw-active-anchor');});
}
function spotlight(c){
  SELANCHOR=c.anchor; applyActive();
  const a=targetOf(c); if(!a)return null;
  a.scrollIntoView({behavior:'smooth',block:'center'});
  a.classList.remove('rw-spot');void a.offsetWidth;a.classList.add('rw-spot');setTimeout(()=>a.classList.remove('rw-spot'),1200);
  return a;
}
/* Another screen or drawer: set the hash (the hub renders the screen and, with d/dt, opens the drawer), then spotlight
 * once the anchor exists. The review session lives in ?review=1 (the query), so it survives the hash change. */
function jumpTo(id,c){
  SELID=id; FOCUS={id:id,tries:0};
  let h='#'+c.page.slice(PREFIX.length);
  if(c.drawer) h+=(h.indexOf('?')<0?'?':'&')+c.drawer;
  if(location.hash===h) tryFocus(); else location.hash=h;
}
function tryFocus(){
  if(!FOCUS)return;
  const c=COMMENTS[FOCUS.id]; if(!c){FOCUS=null;return;}
  anchorPass();
  const want=statusOf(c)==='resolved'?'resolved':'open';
  if(FILTER!==want){FILTER=want;TABS.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.k===want));}
  if(spotlight(c)){FOCUS=null;render();return;}
  if(++FOCUS.tries<12)setTimeout(tryFocus,250); else {FOCUS=null;render();}
}

/* re-read the screen from the hash; true when it changed */
function syncRoute(){
  if(location.hash===LASTHASH)return false;
  LASTHASH=location.hash; const s=screenKey(), d=drawerKey();
  if(s!==SLUG){ SLUG=s; SELANCHOR=null; SELID=null; }
  DRAWER=d; return true;
}

(async function init(){
  ME=reviewer();
  try{ADAPTER=FB_OK?await firebaseAdapter():localAdapter();}catch(e){console.warn('[review] firebase init failed, using local',e);ADAPTER=localAdapter();}
  buildChrome();
  anchorPass();
  /* re-anchor + redraw on new content (screen render, drawer open, list filters), batched to one microtask */
  let scheduled=false;
  function soon(){
    if(scheduled)return; scheduled=true;
    queueMicrotask(()=>{ scheduled=false; syncRoute(); anchorPass(); render(); if(FOCUS)tryFocus(); });
  }
  const mo=new MutationObserver(muts=>{
    for(const m of muts){
      if(!m.addedNodes||!m.addedNodes.length)continue;
      for(const node of m.addedNodes){
        if(!node||node.nodeType!==1)continue;
        if(node.closest&&node.closest(CHROME_SEL))continue;
        if(node.classList&&node.classList.contains('rw-dots'))continue;   /* our own status dots (else render() loops) */
        soon(); return;
      }
    }
  });
  mo.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('hashchange',soon);
  /* a drawer opening or closing changes the hash with history.replaceState (no event) or only a class: poll the hash
   * and the drawers' open state */
  let lastOpen='';
  setInterval(()=>{ const o=ROOTS.map(r=>drawerOpen(r[0])?1:0).join(''); if(location.hash!==LASTHASH||o!==lastOpen){ lastOpen=o; soon(); } },400);
  window.__rwRefresh=render;
  ADAPTER.subscribe(data=>{COMMENTS=data||{};render();if(FOCUS)tryFocus();});
})();
})();  /* js-isolation: the whole widget is one IIFE; window.__rwRefresh is the only hook */
