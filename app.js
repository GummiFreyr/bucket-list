'use strict';
/* Our Bucket List v2: static PWA. The list and photos are encrypted on the phone (AES-GCM, key from the shared passcode)
   and synced through textdb.online, a free no-signup text store. The storage key is also derived from the passcode,
   so nothing in this public code says where the data lives or how to read it. */
const API = 'https://textdb.online';
const VERIFIER = 'cB5K0bz8GMlw5FAjmURVxm/U1jxnKHRwNliGRXVtLChMYLu+aw==';
const SALT = 'our-bucket-list-v1', ITER = 310000;
const POLL_MS = 12000, PHOTO_MAX = 180000; // stored text per photo, under textdb's 200k-character cap
const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();
const EMOJIS = ['🌌','✈️','🏔️','🌊','♨️','🍝','🍷','🎬','🎢','🎨','🐾','🎁','💞'];

const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rid = (n = 12) => b64(crypto.getRandomValues(new Uint8Array(n))).replace(/[^a-zA-Z0-9]/g, '').slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const niceDate = s => s === today() ? 'Today' : fmtDate(s);
const ICONS = {
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1" fill="currentColor"/><circle cx="4.5" cy="12" r="1.1" fill="currentColor"/><circle cx="4.5" cy="18" r="1.1" fill="currentColor"/>',
  heart: '<path d="M12 20.3s-7.5-4.5-9.3-9.1C1.5 8 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.4 3.5 4.2 6.7-1.8 4.6-9.3 9.1-9.3 9.1z"/>',
  'heart-fill': '<path fill="currentColor" stroke="none" d="M12 20.3s-7.5-4.5-9.3-9.1C1.5 8 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.4 3.5 4.2 6.7-1.8 4.6-9.3 9.1-9.3 9.1z"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-width="2.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="3"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.4-2h4.8l1.4 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  cake: '<path d="M4.5 20h15v-6.5a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2z"/><path d="M4.5 15.5c1.3 1 2.6 1 3.8 0 1.3 1 2.6 1 3.7 0 1.3 1 2.6 1 3.8 0 1.2 1 2.5 1 3.7 0M12 11.5V8"/><path d="M12 3.5c.9 1 1.2 1.8 0 3-1.2-1.2-.9-2 0-3z" fill="currentColor"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
};
const icon = n => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[n] || '') + '</svg>';
function paintIcons(root = document) { root.querySelectorAll('i[data-ic]').forEach(i => { i.outerHTML = icon(i.dataset.ic); }); }
function haptic() { try { $('hap').click(); } catch (e) {} try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} }
let toastT; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2000); }
function hearts(x, y, n = 12) {
  const set = ['❤️','💕','💗','✨'];
  for (let i = 0; i < n; i++) { const h = document.createElement('div'); h.className = 'hfx'; h.textContent = set[i % set.length];
    h.style.left = (x - 10) + 'px'; h.style.top = (y - 10) + 'px';
    const a = -Math.PI / 2 + (Math.random() - .5) * 2.2, d = 70 + Math.random() * 120;
    h.style.setProperty('--dx', Math.cos(a) * d + 'px'); h.style.setProperty('--dy', Math.sin(a) * d + 'px'); h.style.setProperty('--r', (Math.random() * 50 - 25) + 'deg');
    h.style.animationDelay = (i * 30) + 'ms'; document.body.appendChild(h); setTimeout(() => h.remove(), 1900); }
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
function loadLocal() { try { DOC = JSON.parse(localStorage.getItem('bl.doc')) || { items: {} }; } catch (e) { DOC = { items: {} }; } if (!DOC.items) DOC.items = {}; DOC = merge(DOC, { items: {} }); }
function saveLocal() { localStorage.setItem('bl.doc', JSON.stringify(DOC)); }
const queue = () => JSON.parse(localStorage.getItem('bl.pq') || '[]');
const setQueue = q => localStorage.setItem('bl.pq', JSON.stringify(q));
function canon(doc) { const o = {}; Object.keys(doc.items).sort().forEach(k => o[k] = doc.items[k]); return JSON.stringify(o); }
function newer(a, b) { if (!a) return b; if (!b) return a; if (a.u !== b.u) return a.u > b.u ? a : b; return JSON.stringify(a) > JSON.stringify(b) ? a : b; }
// v1 seeded ten starter ideas (ids s01–s10, fixed timestamps). Untouched ones are dropped everywhere; edited ones stay.
const isSeed = i => /^s\d\d$/.test(i.id) && i.u < 1700000001000 && !i.done;
function merge(a, b) { const out = { items: {} }; new Set([...Object.keys(a.items || {}), ...Object.keys(b.items || {})]).forEach(k => { const it = newer((a.items || {})[k], (b.items || {})[k]); if (!isSeed(it)) out.items[k] = it; }); return out; }
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
    const merged = merge(DOC, remote || { items: {} });
    const changedLocal = canon(merged) !== canon(DOC);
    if (remote ? canon(merged) !== canon(remote) : Object.keys(merged.items).length) await rput(listKey(), await encBytes(enc.encode(JSON.stringify(merged))));
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
let view = 'list';
const live = () => Object.values(DOC.items).filter(i => !i.del);
function render() {
  const all = live(), todo = all.filter(i => !i.done).sort((a, b) => b.c - a.c), done = all.filter(i => i.done).sort((a, b) => (b.dd || '').localeCompare(a.dd || '') || b.u - a.u);
  const n = all.length, d = done.length;
  $('hello').hidden = n > 0; fabState(); $('prog').hidden = n === 0;
  $('sub').textContent = !n ? 'Just the two of you ❤️' : todo.length ? `${todo.length} dream${todo.length === 1 ? '' : 's'} to go` + (d ? ` · ${d} done together` : '') : 'All done! Time to dream up more ✨';
  $('barI').style.width = (n ? d / n * 100 : 0) + '%'; $('progT').textContent = d + ' / ' + n;
  $('list').innerHTML = todo.map((i, k) => `<div class="item tap" data-id="${esc(i.id)}" role="button" style="animation-delay:${Math.min(k, 8) * 30}ms">
      ${i.e ? `<span class="emo">${esc(i.e)}</span>` : ''}<div class="mid"><div class="tt">${esc(i.t)}</div>${i.by ? `<div class="by">${esc(i.by)}</div>` : ''}</div>
      <span class="check" aria-label="Mark done"></span></div>`).join('')
    + (n && !todo.length ? `<div class="soft-empty"><div class="big">🥹</div>You did everything on your list.<br>Tap <b>+</b> for the next dream.</div>` : '');
  $('sub2').textContent = d ? `${d} memor${d === 1 ? 'y' : 'ies'} made together` : '';
  $('wall').innerHTML = d ? done.map((i, k) => `<button class="mem${k === 0 ? ' hero' : ''}${i.p ? '' : ' nophoto'}" data-view="${esc(i.id)}" style="animation-delay:${Math.min(k, 8) * 45}ms">
      ${i.p ? `<img data-ph="${esc(i.p)}" alt="">` : `<span class="noph"><i data-ic="camera"></i>Add photo</span>`}
      <span class="cap"><div class="tt">${esc(i.e ? i.e + ' ' : '')}${esc(i.t)}</div><div class="dd">${esc(fmtDate(i.dd))}</div></span></button>`).join('')
    : `<div class="soft-empty" style="grid-column:1/-1"><div class="big">📸</div>When you do something on your list,<br>tick it off with a photo of you two.<br>It shows up here.</div>`;
  paintIcons($('wall'));
  $('wall').querySelectorAll('img[data-ph]').forEach(async im => { const u = await photoURL(im.dataset.ph); if (u) { im.onload = () => im.classList.add('ld'); im.src = u; } });
}

/* ---------- our dates (yearly countdowns, Iceland time) ---------- */
const DATES = [['Her birthday', '🎂', 4, 4], ["Gummi's birthday", '🎂', 11, 19], ['Our anniversary', '💞', 6, 12]];
function icelandToday() { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Reykjavik', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const g = t => +p.find(x => x.type === t).value; return [g('year'), g('month'), g('day')]; }
function countdowns() {
  const [y, m, d] = icelandToday(), t0 = Date.UTC(y, m - 1, d);
  return DATES.map(([name, e, mm, dd]) => { let t = Date.UTC(y, mm - 1, dd); if (t < t0) t = Date.UTC(y + 1, mm - 1, dd); return { name, e, days: Math.round((t - t0) / 864e5), when: new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }) }; }).sort((a, b) => a.days - b.days);
}
function renderDates() {
  $('dates').innerHTML = countdowns().map((c, k) => `<div class="dcard${k === 0 ? ' first' : ''}${c.days === 0 ? ' today' : ''}" style="animation-delay:${k * 60}ms"><span class="de">${c.e}</span>
    <div class="dm"><div class="dn">${esc(c.name)}</div><div class="dw">${esc(c.when)}</div></div>
    <div class="dc">${c.days === 0 ? '<b>Today! 🎉</b>' : c.days === 1 ? '<b>1</b><small>day · tomorrow</small>' : `<b>${c.days}</b><small>days</small>`}</div></div>`).join('');
}

/* ---------- sheets + keyboard ---------- */
let openSheet = null;
function sheet(id) { if (openSheet) closeSheet(); openSheet = $(id); openSheet.scrollTop = 0; $('dim').classList.add('on'); requestAnimationFrame(() => openSheet.classList.add('on')); }
function closeSheet() { if (!openSheet) return; openSheet.classList.remove('on'); $('dim').classList.remove('on'); const a = document.activeElement; a && a.blur && a.blur(); openSheet = null; }
$('dim').onclick = () => closeSheet();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeSheet());
document.querySelectorAll('.sheet').forEach(s => { let y0 = null, dy = 0;
  s.addEventListener('touchstart', e => { y0 = s.scrollTop <= 0 && !e.target.closest('input,textarea') ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  s.addEventListener('touchmove', e => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { s.style.transition = 'none'; s.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  s.addEventListener('touchend', () => { s.style.transition = ''; s.style.transform = ''; if (y0 != null && dy > 110) closeSheet(); y0 = null; });
});
// keep sheets above the iOS keyboard
if (window.visualViewport) { const vv = visualViewport; const f = () => { const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop); document.documentElement.style.setProperty('--kb', kb + 'px'); document.querySelectorAll('.sheet').forEach(s => s.classList.toggle('kbd', kb > 80)); };
  vv.addEventListener('resize', f); vv.addEventListener('scroll', f); }

/* add / edit: iOS only opens the keyboard for a focus() inside the tap, so focus a proxy now and hand over after the slide-in */
let editing = null, pickEmo = '';
function paintEmo() { $('eEmo').innerHTML = EMOJIS.map(e => `<button class="tap${e === pickEmo ? ' on' : ''}" data-e="${e}">${e}</button>`).join(''); }
['pointerdown', 'mousedown', 'touchstart'].forEach(ev => $('eEmo').addEventListener(ev, e => { if (e.target.closest('[data-e]') && e.cancelable && ev !== 'touchstart') e.preventDefault(); }, { passive: false })); // keep the keyboard up
$('eEmo').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; pickEmo = pickEmo === b.dataset.e ? '' : b.dataset.e; haptic(); paintEmo(); if (!editing) $('eName').focus({ preventScroll: true }); };
function openEdit(it) {
  editing = it || null; pickEmo = it ? it.e || '' : '';
  if (pickEmo && !EMOJIS.includes(pickEmo)) EMOJIS.unshift(pickEmo);
  $('eTitle').textContent = it ? 'Edit' : 'New dream'; $('eSave').textContent = it ? 'Save' : 'Add';
  $('eName').value = it ? it.t : ''; $('eNote').value = it ? it.n || '' : ''; $('eNote').hidden = !it; $('eDel').hidden = !it;
  $('eSave').disabled = !$('eName').value.trim(); paintEmo();
  $('kbProxy').focus(); sheet('sEdit');
  setTimeout(() => { $('eName').focus({ preventScroll: true }); }, 60);
}
$('eName').addEventListener('input', () => { $('eSave').disabled = !$('eName').value.trim(); });
$('eName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } });
$('eSave').onclick = () => saveEdit();
function saveEdit() {
  const t = $('eName').value.trim(); if (!t) return;
  const it = editing ? { ...editing } : { id: Date.now().toString(36) + rid(6), c: Date.now(), by: me(), done: false };
  it.t = t; it.e = pickEmo; if (editing) it.n = $('eNote').value.trim();
  haptic(); closeSheet(); if (view !== 'list') go('list'); touch(it); if (!editing) toast('Added to our list 💕');
}
$('eDel').onclick = () => { if (!editing || !confirm('Delete "' + editing.t + '"?')) return; const it = { ...editing, del: true }; closeSheet(); touch(it); };

/* complete with a photo */
let doneIt = null, doneBlob = null, busyPhoto = false;
function shotEmpty() { $('dShot').innerHTML = `<span class="cam">${icon('camera')}</span><b>Add a photo of you two</b><small>Take one or pick from your library</small><input type="file" accept="image/*" id="dFile">`; $('dFile').onchange = pickPhoto; }
function shotShow(url) { $('dShot').innerHTML = `<img src="${url}" alt=""><span class="chg">Change</span><input type="file" accept="image/*" id="dFile">`; $('dFile').onchange = pickPhoto; }
function setDate(v) { $('dDate').value = v; $('dDateT').textContent = niceDate(v); }
$('dDate').onchange = () => setDate($('dDate').value || today());
function doneBtn() { $('dSave').textContent = doneIt && doneIt.done ? 'Save' : (doneBlob || (doneIt && doneIt.p)) ? 'Save memory ❤️' : 'Mark as done'; $('dSave').classList.toggle('quiet', !doneBlob && !(doneIt && doneIt.p) && !(doneIt && doneIt.done)); }
function openDone(it) {
  doneIt = it; doneBlob = null; $('dName').textContent = (it.e ? it.e + ' ' : '') + it.t;
  $('dBy').textContent = it.by ? 'Added by ' + it.by : ''; $('dEdit').hidden = !!it.done;
  setDate(it.dd || today()); $('dNote').value = it.dn || ''; shotEmpty(); doneBtn();
  if (it.p) photoURL(it.p).then(u => { if (u && doneIt === it && !doneBlob) { shotShow(u); doneBtn(); } });
  sheet('sDone');
}
async function pickPhoto(ev) {
  const f = ev.target.files[0]; if (!f) return; busyPhoto = true;
  $('dShot').innerHTML = '<span class="spin"></span>';
  try { doneBlob = await compress(f); shotShow(URL.createObjectURL(doneBlob)); haptic(); } catch (e) { doneBlob = null; shotEmpty(); toast("Couldn't use that photo"); }
  busyPhoto = false; doneBtn();
}
async function storePhoto(blob) { const k = NS + 'p' + rid(12); await phPut(k, blob); urls[k] = URL.createObjectURL(blob); setQueue([...queue(), k]); return k; }
$('dEdit').onclick = () => { const it = doneIt; closeSheet(); setTimeout(() => openEdit(it), 10); };
$('dSave').onclick = async () => {
  if (!doneIt || busyPhoto) return; const wasDone = doneIt.done;
  const it = { ...doneIt, done: true, dd: $('dDate').value || today(), dn: $('dNote').value.trim(), doneBy: doneIt.doneBy || me() };
  if (doneBlob) it.p = await storePhoto(doneBlob);
  haptic(); closeSheet();
  if (wasDone) { touch(it); if (viewIt) openView(it); return; }
  const el = document.querySelector(`.item[data-id="${CSS.escape(it.id)}"]`);
  if (el) { const c = el.querySelector('.check'); c.classList.add('on'); c.innerHTML = icon('check'); const r = c.getBoundingClientRect(); hearts(r.left + r.width / 2, r.top, 12); setTimeout(() => el.classList.add('out'), 350); }
  else hearts(innerWidth / 2, innerHeight / 2, 12);
  setTimeout(() => { touch(it); toast(it.p ? 'Memory saved ❤️' : 'Done together ❤️'); }, el ? 800 : 0);
};

/* memory detail (add a photo later straight from here) */
let viewIt = null;
function openView(it) {
  viewIt = it; $('vName').textContent = (it.e ? it.e + ' ' : '') + it.t; $('vWhen').textContent = fmtDate(it.dd); $('vNote').textContent = it.dn || ''; $('vNote').hidden = !it.dn;
  const ph = $('vPh');
  if (it.p) { ph.innerHTML = ''; photoURL(it.p).then(u => { if (u && viewIt === it) ph.innerHTML = `<img src="${u}" alt="">`; }); }
  else { ph.innerHTML = `<span class="cam">${icon('camera')}</span><b>Add a photo of you two</b><input type="file" accept="image/*" id="vFile">`;
    $('vFile').onchange = async ev => { const f = ev.target.files[0]; if (!f) return; ph.innerHTML = '<span class="spin" style="width:28px;height:28px;border-radius:50%;border:3px solid var(--soft2);border-top-color:var(--pink);animation:spin .8s linear infinite"></span>';
      try { const blob = await compress(f); const k = await storePhoto(blob); const nu = { ...viewIt, p: k }; touch(nu); haptic(); openView(nu); toast('Photo added ❤️'); } catch (e) { toast("Couldn't use that photo"); openView(viewIt); } }; }
  if (!openSheet || openSheet.id !== 'sView') sheet('sView');
}
$('vEdit').onclick = () => { const it = viewIt; closeSheet(); setTimeout(() => openDone(it), 10); };
$('vUndo').onclick = () => { const it = { ...viewIt, done: false }; viewIt = null; closeSheet(); touch(it); toast('Moved back to our list'); };
$('sView').addEventListener('transitionend', () => { if (!$('sView').classList.contains('on')) viewIt = null; });

/* ---------- events ---------- */
function fabState() { $('addBtn').classList.toggle('away', view !== 'list' || !live().length); }
function go(v) { view = v; fabState(); if (v === 'dates') renderDates(); document.querySelectorAll('nav .tb').forEach(b => b.classList.toggle('on', b.dataset.v === v)); document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v)); $('scroller').scrollTo({ top: 0 }); }
document.querySelectorAll('nav .tb').forEach(b => b.onclick = () => { haptic(); if (view === b.dataset.v) $('scroller').scrollTo({ top: 0, behavior: 'smooth' }); else go(b.dataset.v); });
$('addBtn').onclick = () => { haptic(); openEdit(null); };
$('firstBtn').onclick = () => { haptic(); openEdit(null); };
$('list').onclick = e => { const r = e.target.closest('.item'); if (!r) return; haptic(); const it = DOC.items[r.dataset.id];
  if (e.target.closest('.check')) { const c = r.querySelector('.check'); c.classList.add('on'); c.innerHTML = icon('check'); setTimeout(() => { c.classList.remove('on'); c.innerHTML = ''; }, 500); }
  openDone(it); };
$('wall').onclick = e => { const t = e.target.closest('[data-view]'); if (t) { haptic(); openView(DOC.items[t.dataset.view]); } };
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
window.addEventListener('focus', () => sync());
window.addEventListener('online', () => sync());
setInterval(() => { if (!document.hidden) sync(); }, POLL_MS);

/* ---------- lock ---------- */
function lockErr(m) { $('lockErr').textContent = m; $('lockIn').classList.remove('shake'); void $('lockIn').offsetWidth; $('lockIn').classList.add('shake'); }
function askName(msg) { $('pw').hidden = true; $('me').hidden = false; $('lockSub').textContent = msg; $('lockBtn').textContent = 'Continue'; }
async function unlock() {
  const btn = $('lockBtn');
  if (!$('me').hidden) { const n = $('me').value.trim(); if (!n) return lockErr('Type your name.'); localStorage.setItem('bl.me', n); $('me').blur(); return finishGate(); }
  const pw = $('pw').value; if (!pw.trim()) return lockErr('Type the passcode.');
  btn.disabled = true; btn.textContent = 'Unlocking…'; $('lockErr').textContent = '';
  let bits = null; try { bits = await derive(pw); const v = dec.decode(await decBytes(VERIFIER, await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['decrypt']))); if (v !== 'bucket-ok') bits = null; } catch (e) { bits = null; }
  btn.disabled = false; btn.textContent = 'Unlock';
  if (!bits) { $('pw').select(); return lockErr("That passcode isn't right."); }
  localStorage.setItem('bl.k', b64(bits)); await useBits(bits); $('pw').value = ''; haptic();
  if (!me()) { askName("Unlocked 💕 What's your name?"); $('me').focus(); return; }
  $('pw').blur(); finishGate();
}
function finishGate() { const g = $('lock'); g.classList.add('gone'); setTimeout(() => { g.hidden = true; g.classList.remove('gone'); }, 520); render(); sync(); }
$('lockBtn').onclick = unlock;
$('pw').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
$('me').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });

/* ---------- boot ---------- */
paintIcons(); loadLocal(); render();
(async () => {
  const k = localStorage.getItem('bl.k');
  if (k) { await useBits(unb64(k)); if (me()) { sync(); return; } askName("What's your name?"); }
  $('lock').hidden = false;
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.BL = { doc: () => DOC, sync, merge, state: () => ({ NS, online }) };
