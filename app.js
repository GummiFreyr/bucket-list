'use strict';
/* Our Bucket List: static PWA. The list and photos are encrypted on the phone (AES-GCM, key from the shared passcode)
   and synced through textdb.online, a free no-signup text store. The storage key is also derived from the passcode,
   so nothing in this public code says where the data lives or how to read it. */
const API = 'https://textdb.online';
const VERIFIER = 'cB5K0bz8GMlw5FAjmURVxm/U1jxnKHRwNliGRXVtLChMYLu+aw==';
const SALT = 'our-bucket-list-v1', ITER = 310000;
const POLL_MS = 12000, PHOTO_MAX = 180000; // stored text per photo, under textdb's 200k-character cap
const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();

const CATS = [['🌌','Adventure'],['✈️','Travel'],['♨️','Relax'],['🍝','Food'],['🎬','Fun'],['💞','Us'],['🌋','Nature'],['🎁','Surprise']];
const STARTERS = [
  ['s01','🌌','See the Northern Lights together','Drive out of the city lights on a clear night'],
  ['s02','💙','Spend a day at the Blue Lagoon',''],
  ['s03','♨️','Sunset soak at Sky Lagoon',''],
  ['s04','🖤','Walk on Reynisfjara black sand beach','Stay far from the waves!'],
  ['s05','🍝','Cook a new dish together',''],
  ['s06','⛰️','Hike up Esja',''],
  ['s07','🚗','Golden Circle road trip','Þingvellir, Geysir and Gullfoss'],
  ['s08','🐋','Whale watching from the Old Harbour',''],
  ['s09','🌭','Bæjarins Beztu hot dogs at midnight',''],
  ['s10','💧','Walk behind Seljalandsfoss',''],
];

/* ---------- small helpers ---------- */
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rid = (n = 12) => b64(crypto.getRandomValues(new Uint8Array(n))).replace(/[^a-zA-Z0-9]/g, '').slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = s => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const ICONS = {
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  heart: '<path d="M12 20.3s-7.5-4.5-9.3-9.1C1.5 8 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.4 3.5 4.2 6.7-1.8 4.6-9.3 9.1-9.3 9.1z"/>',
  'heart-fill': '<path fill="currentColor" stroke="none" d="M12 20.3s-7.5-4.5-9.3-9.1C1.5 8 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.4 3.5 4.2 6.7-1.8 4.6-9.3 9.1-9.3 9.1z"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-width="2.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="3"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.4-2h4.8l1.4 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
};
const icon = n => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[n] || '') + '</svg>';
function paintIcons(root = document) { root.querySelectorAll('i[data-ic]').forEach(i => { i.outerHTML = icon(i.dataset.ic); }); }
function haptic() { try { $('hap').click(); } catch (e) {} try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} }
let toastT; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
function hearts(x, y, n = 14) {
  const set = ['❤️','💕','💖','💗','✨'];
  for (let i = 0; i < n; i++) { const h = document.createElement('div'); h.className = 'hfx'; h.textContent = set[i % set.length];
    h.style.left = (x - 11) + 'px'; h.style.top = (y - 11) + 'px';
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
    h.style.setProperty('--dx', Math.cos(a) * d + 'px'); h.style.setProperty('--dy', (Math.sin(a) * d - 80) + 'px'); h.style.setProperty('--r', (Math.random() * 60 - 30) + 'deg');
    h.style.animationDelay = (i * 25) + 'ms'; document.body.appendChild(h); setTimeout(() => h.remove(), 1700); }
}

/* ---------- crypto ---------- */
let KEY = null, NS = null; // AES key + storage namespace
async function derive(pass) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFC').trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ITER }, base, 512));
}
async function useBits(bits) {
  KEY = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  NS = 'bl' + Array.from(bits.slice(32, 48), b => b.toString(16).padStart(2, '0')).join('') + (localStorage.getItem('bl.testns') || '');
}
async function encBytes(u8) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, u8)); const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12); return b64(all); }
async function decBytes(s, key = KEY) { const all = unb64(s.trim()); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12))); }

/* ---------- backend (textdb.online) ---------- */
async function rget(key) { const r = await fetch(API + '/' + key + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('get ' + r.status); return (await r.text()).trim(); }
async function rput(key, value) {
  const r = await fetch(API + '/update', { method: 'POST', body: new URLSearchParams({ key, value }) });
  const j = await r.json().catch(() => null); if (!j || j.status !== 1) throw new Error('put failed'); return true;
}
const listKey = () => NS + 'L';

/* ---------- photo cache (IndexedDB) ---------- */
let dbp; function db() { return dbp || (dbp = new Promise((res, rej) => { const q = indexedDB.open('bucketlist', 1); q.onupgradeneeded = () => q.result.createObjectStore('ph'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); })); }
async function idb(mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('ph', mode); const r = fn(tx.objectStore('ph')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const phGet = k => idb('readonly', s => s.get(k)), phPut = (k, v) => idb('readwrite', s => s.put(v, k));
const urls = {};
async function photoURL(k) {
  if (!k) return null; if (urls[k]) return urls[k];
  let blob = await phGet(k).catch(() => null);
  if (!blob) { try { const t = await rget(k); if (!t) return null; blob = new Blob([await decBytes(t)], { type: 'image/jpeg' }); await phPut(k, blob); } catch (e) { return null; } }
  return (urls[k] = URL.createObjectURL(blob));
}
async function compress(file) {
  const bmp = await (window.createImageBitmap ? createImageBitmap(file).catch(() => null) : null) || await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
  let side = 1080, q = 0.78;
  for (let i = 0; i < 12; i++) {
    const w = bmp.width, h = bmp.height, s = Math.min(1, side / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (blob.size * 1.37 + 40 < PHOTO_MAX) return blob;
    if (q > 0.55) q -= 0.1; else side = Math.round(side * 0.82);
  }
  throw new Error('too big');
}

/* ---------- data + sync ---------- */
let DOC = { items: {} };
const me = () => localStorage.getItem('bl.me') || '';
function loadLocal() { try { DOC = JSON.parse(localStorage.getItem('bl.doc')) || { items: {} }; } catch (e) { DOC = { items: {} }; } if (!DOC.items) DOC.items = {}; }
function saveLocal() { localStorage.setItem('bl.doc', JSON.stringify(DOC)); }
const queue = () => JSON.parse(localStorage.getItem('bl.pq') || '[]');
const setQueue = q => localStorage.setItem('bl.pq', JSON.stringify(q));
function canon(doc) { const o = {}; Object.keys(doc.items).sort().forEach(k => o[k] = doc.items[k]); return JSON.stringify(o); }
function newer(a, b) { if (!a) return b; if (!b) return a; if (a.u !== b.u) return a.u > b.u ? a : b; return JSON.stringify(a) > JSON.stringify(b) ? a : b; }
function merge(a, b) { const out = { items: {} }; new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})]).forEach(k => out.items[k] = newer((a.items || {})[k], (b.items || {})[k])); return out; }
function starters() { const d = { items: {} }; STARTERS.forEach(([id, e, t, n], i) => d.items[id] = { id, e, t, n, by: '', c: 1700000000000 - i, u: 1700000000000 + i, done: false }); return d; }
function touch(it) { it.u = Math.max(Date.now(), (it.u || 0) + 1); DOC.items[it.id] = it; saveLocal(); render(); sync(); }

let syncing = false, again = false, online = true;
function setSync(state) { const s = $('sync'); s.className = 'sync ' + state; s.querySelector('span').textContent = state === 'busy' ? 'Syncing' : state === 'off' ? 'Offline' : 'Synced'; }
async function sync() {
  if (!KEY) return; if (syncing) { again = true; return; } syncing = true; setSync('busy');
  try {
    // 1) photos first, so the other phone can load them as soon as it sees the item
    for (const k of queue()) { const blob = await phGet(k); if (blob) await rput(k, await encBytes(new Uint8Array(await blob.arrayBuffer()))); setQueue(queue().filter(x => x !== k)); }
    // 2) list: read, merge, write back only if something changed
    const txt = await rget(listKey());
    let remote = null;
    if (txt) { try { remote = JSON.parse(dec.decode(await decBytes(txt))); } catch (e) { throw new Error('cannot read list'); } }
    let merged = merge(DOC, remote || { items: {} });
    if (!remote && !Object.keys(merged.items).length) merged = starters();
    const changedLocal = canon(merged) !== canon(DOC);
    if (!remote || canon(merged) !== canon(remote)) await rput(listKey(), await encBytes(enc.encode(JSON.stringify(merged))));
    DOC = merged; saveLocal(); if (changedLocal) render();
    online = true; setSync('');
    keepAlive();
  } catch (e) { online = false; setSync('off'); }
  syncing = false; if (again) { again = false; setTimeout(sync, 300); }
}
// textdb removes text nobody touches for 30 days. Once a day, read every photo (and re-upload any that went missing).
async function keepAlive() {
  if (localStorage.getItem('bl.alive') === today()) return; localStorage.setItem('bl.alive', today());
  for (const it of Object.values(DOC.items)) { if (!it.p || it.del) continue;
    try { const t = await rget(it.p); if (!t) { const blob = await phGet(it.p); if (blob) await rput(it.p, await encBytes(new Uint8Array(await blob.arrayBuffer()))); } else if (!(await phGet(it.p))) { await phPut(it.p, new Blob([await decBytes(t)], { type: 'image/jpeg' })); } } catch (e) {} }
}

/* ---------- render ---------- */
let filter = 'all', view = 'list';
const live = () => Object.values(DOC.items).filter(i => !i.del);
function render() {
  const all = live(), todo = all.filter(i => !i.done).sort((a, b) => b.c - a.c), done = all.filter(i => i.done).sort((a, b) => (b.dd || '').localeCompare(a.dd || '') || b.u - a.u);
  const n = all.length, d = done.length;
  $('sub').innerHTML = n ? `${todo.length} idea${todo.length === 1 ? '' : 's'} waiting · <b>${d} done</b>` : 'Add your first dream together';
  $('heroT').textContent = d + ' done together';
  $('heroS').textContent = !d ? 'Start with something small ✨' : d === n ? 'All of them! Add more dreams 🥹' : `${Math.round(d / n * 100)}% of our list · ${n - d} to go`;
  $('ring').style.strokeDashoffset = 169.6 * (1 - (n ? d / n : 0));
  // chips: only types in use
  const used = [...new Set(todo.map(i => i.e))];
  if (filter !== 'all' && !used.includes(filter)) filter = 'all';
  $('chips').innerHTML = used.length > 1 ? ['all', ...used].map(e => `<button class="chip tap${filter === e ? ' on' : ''}" data-f="${esc(e)}">${e === 'all' ? 'All' : esc(e)}</button>`).join('') : '';
  const shown = todo.filter(i => filter === 'all' || i.e === filter);
  $('list').innerHTML = shown.length ? shown.map((i, k) => `<div class="item tap" data-id="${esc(i.id)}" style="animation-delay:${Math.min(k, 8) * 35}ms">
      <div class="emo">${esc(i.e || '💞')}</div><div class="mid"><div class="tt">${esc(i.t)}</div>${i.n || i.by ? `<div class="nn">${esc(i.n || ('Added by ' + i.by))}</div>` : ''}</div>
      <button class="check" data-done="${esc(i.id)}" aria-label="Mark done"></button></div>`).join('')
    : `<div class="empty"><div class="big">💭</div>${todo.length ? 'Nothing here yet' : 'Everything is done!<br>Tap <b>+</b> to dream up more.'}</div>`;
  $('sub2').innerHTML = d ? `<b>${d}</b> memor${d === 1 ? 'y' : 'ies'} made together` : '';
  $('grid').innerHTML = d ? done.map((i, k) => `<button class="tile tap" data-view="${esc(i.id)}" style="animation-delay:${Math.min(k, 8) * 40}ms"><div class="ph">${esc(i.e || '💞')}${i.p ? `<img data-ph="${esc(i.p)}" alt="">` : ''}</div>
      <div class="cap"><div class="tt">${esc(i.t)}</div><div class="dd">${esc(fmtDate(i.dd))}</div></div></button>`).join('')
    : `<div class="empty" style="grid-column:1/-1"><div class="big">📸</div>Tick off an idea and add a photo.<br>Your memories show up here.</div>`;
  $('grid').querySelectorAll('img[data-ph]').forEach(async im => { const u = await photoURL(im.dataset.ph); if (u) { im.onload = () => im.classList.add('ld'); im.src = u; } });
}

/* ---------- sheets ---------- */
let openSheet = null;
function sheet(id) { closeSheet(true); openSheet = $(id); $('dim').classList.add('on'); requestAnimationFrame(() => openSheet.classList.add('on')); }
function closeSheet(quick) { if (!openSheet) return; openSheet.classList.remove('on'); $('dim').classList.remove('on'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); openSheet = null; }
$('dim').onclick = () => closeSheet();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeSheet());
// swipe down to close
document.querySelectorAll('.sheet').forEach(s => { let y0 = null, dy = 0;
  s.addEventListener('touchstart', e => { y0 = s.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  s.addEventListener('touchmove', e => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { s.style.transition = 'none'; s.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  s.addEventListener('touchend', () => { s.style.transition = ''; s.style.transform = ''; if (y0 != null && dy > 110) closeSheet(); y0 = null; });
});

let editing = null, pickEmo = '🌌';
function paintEmo() { $('eEmo').innerHTML = CATS.map(([e, l]) => `<button class="tap${e === pickEmo ? ' on' : ''}" data-e="${e}" aria-label="${l}">${e}</button>`).join(''); }
$('eEmo').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; pickEmo = b.dataset.e; haptic(); paintEmo(); };
function openEdit(it) {
  editing = it || null; pickEmo = it ? it.e : '🌌'; if (it && !CATS.some(c => c[0] === it.e)) CATS.push([it.e, 'Custom']);
  $('eTitle').textContent = it ? 'Edit idea' : 'New idea'; $('eSave').textContent = it ? 'Save' : 'Add to our list';
  $('eName').value = it ? it.t : ''; $('eNote').value = it ? it.n || '' : ''; $('eDel').hidden = !it;
  $('eMeta').textContent = it && it.by ? 'Added by ' + it.by : ''; paintEmo(); sheet('sEdit');
  if (!it) setTimeout(() => $('eName').focus(), 350);
}
$('eSave').onclick = () => {
  const t = $('eName').value.trim(); if (!t) { $('eName').parentNode.classList.add('shake'); setTimeout(() => $('eName').parentNode.classList.remove('shake'), 450); return; }
  const it = editing ? { ...editing } : { id: Date.now().toString(36) + rid(6), c: Date.now(), by: me(), done: false };
  it.t = t; it.n = $('eNote').value.trim(); it.e = pickEmo; haptic(); closeSheet();
  if (view !== 'list') go('list'); touch(it); if (!editing) toast('Added to your list 💕');
};
$('eDel').onclick = () => { if (!editing || !confirm('Delete "' + editing.t + '"?')) return; const it = { ...editing, del: true }; closeSheet(); touch(it); toast('Deleted'); };

let doneIt = null, doneBlob = null;
function openDone(it) {
  doneIt = it; doneBlob = null; $('dName').textContent = (it.e || '') + ' ' + it.t; $('dDate').value = it.dd || today(); $('dNote').value = it.dn || '';
  $('dSave').textContent = it.done ? 'Save' : 'Mark as done ❤️';
  const ph = $('dPhoto'); ph.querySelector('img') && ph.querySelector('img').remove(); ph.querySelector('span').textContent = 'Add a photo';
  if (it.p) photoURL(it.p).then(u => { if (u && doneIt === it) { const im = new Image(); im.src = u; ph.prepend(im); ph.querySelector('span').textContent = ''; } });
  sheet('sDone');
}
$('dFile').onchange = async () => {
  const f = $('dFile').files[0]; $('dFile').value = ''; if (!f) return;
  const ph = $('dPhoto'); ph.querySelector('span').textContent = 'Preparing…';
  try { doneBlob = await compress(f); } catch (e) { doneBlob = null; ph.querySelector('span').textContent = "Couldn't use that photo"; return; }
  ph.querySelector('img') && ph.querySelector('img').remove(); const im = new Image(); im.src = URL.createObjectURL(doneBlob); ph.prepend(im); ph.querySelector('span').textContent = '';
};
$('dSave').onclick = async e => {
  if (!doneIt) return; const it = { ...doneIt, done: true, dd: $('dDate').value || today(), dn: $('dNote').value.trim(), doneBy: me() };
  if (doneBlob) { const k = NS + 'p' + rid(12); await phPut(k, doneBlob); urls[k] = URL.createObjectURL(doneBlob); setQueue([...queue(), k]); it.p = k; }
  const wasDone = doneIt.done; haptic(); closeSheet();
  const r = e.target.getBoundingClientRect(); const el = document.querySelector(`.item[data-id="${CSS.escape(it.id)}"]`);
  if (!wasDone) { hearts(window.innerWidth / 2, window.innerHeight * 0.55, 18); if (el) { el.querySelector('.check').classList.add('on'); el.querySelector('.check').innerHTML = icon('check'); el.classList.add('out'); } }
  setTimeout(() => { touch(it); if (!wasDone) toast('Done together! ❤️'); }, wasDone ? 0 : 420);
};

let viewIt = null;
function openView(it) {
  viewIt = it; $('vName').textContent = it.t; $('vWhen').textContent = (it.e || '') + '  ' + fmtDate(it.dd); $('vNote').textContent = it.dn || '';
  const ph = $('vPh'); ph.innerHTML = esc(it.e || '💞'); if (it.p) photoURL(it.p).then(u => { if (u && viewIt === it) { const im = new Image(); im.src = u; ph.appendChild(im); } });
  sheet('sView');
}
$('vEdit').onclick = () => { const it = viewIt; closeSheet(); setTimeout(() => openDone(it), 200); };
$('vUndo').onclick = () => { const it = { ...viewIt, done: false }; closeSheet(); touch(it); toast('Moved back to ideas'); };

/* ---------- events ---------- */
function go(v) { view = v; document.querySelectorAll('nav .tb').forEach(b => b.classList.toggle('on', b.dataset.v === v)); document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v)); $('scroller').scrollTo({ top: 0 }); }
document.querySelectorAll('nav .tb').forEach(b => b.onclick = () => { haptic(); if (view === b.dataset.v) $('scroller').scrollTo({ top: 0, behavior: 'smooth' }); else go(b.dataset.v); });
$('addBtn').onclick = () => { haptic(); openEdit(null); };
$('list').onclick = e => { const c = e.target.closest('[data-done]'); if (c) { haptic(); c.classList.add('on'); c.innerHTML = icon('check'); const it = DOC.items[c.dataset.done]; setTimeout(() => { c.classList.remove('on'); c.innerHTML = ''; openDone(it); }, 220); return; }
  const r = e.target.closest('.item'); if (r) openEdit(DOC.items[r.dataset.id]); };
$('chips').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; haptic(); filter = c.dataset.f; render(); };
$('grid').onclick = e => { const t = e.target.closest('[data-view]'); if (t) { haptic(); openView(DOC.items[t.dataset.view]); } };
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('focus', () => sync());
window.addEventListener('online', () => sync());
setInterval(() => { if (!document.hidden) sync(); }, POLL_MS);

/* ---------- lock ---------- */
function lockErr(m) { $('lockErr').textContent = m; $('lockIn').classList.remove('shake'); void $('lockIn').offsetWidth; $('lockIn').classList.add('shake'); }
async function unlock() {
  const btn = $('lockBtn');
  if (!$('nameF').hidden) { const n = $('me').value.trim(); if (!n) return lockErr('Type your name.'); localStorage.setItem('bl.me', n); return finishGate(); }
  const pw = $('pw').value; if (!pw.trim()) return lockErr('Type the passcode.');
  btn.disabled = true; btn.textContent = 'Unlocking…'; $('lockErr').textContent = '';
  let bits = null; try { bits = await derive(pw); const v = dec.decode(await decBytes(VERIFIER, await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['decrypt']))); if (v !== 'bucket-ok') bits = null; } catch (e) { bits = null; }
  btn.disabled = false; btn.textContent = 'Unlock';
  if (!bits) { $('pw').select(); return lockErr("That passcode isn't right."); }
  localStorage.setItem('bl.k', b64(bits)); await useBits(bits); $('pw').value = ''; $('pw').blur(); haptic();
  if (!me()) { $('pw').parentNode.hidden = true; $('nameF').hidden = false; $('lockSub').textContent = "Unlocked 💕 What's your name? It shows on ideas you add."; btn.textContent = 'Continue'; setTimeout(() => $('me').focus(), 100); return; }
  finishGate();
}
function finishGate() { const g = $('lock'); g.classList.add('gone'); setTimeout(() => { g.hidden = true; g.classList.remove('gone'); }, 520); render(); sync(); }
$('lockBtn').onclick = unlock;
$('pw').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
$('me').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });

/* ---------- boot ---------- */
paintIcons(); loadLocal(); render();
(async () => {
  const k = localStorage.getItem('bl.k');
  if (k) { await useBits(unb64(k)); if (me()) { sync(); return; } $('pw').parentNode.hidden = true; $('nameF').hidden = false; $('lockSub').textContent = "What's your name? It shows on ideas you add."; $('lockBtn').textContent = 'Continue'; }
  $('lock').hidden = false;
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.BL = { doc: () => DOC, sync, merge, state: () => ({ NS, online }) };
