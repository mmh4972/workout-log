'use strict';
// 重訓紀錄：資料存在 Firebase Firestore（和洗腎叫車月曆同一個專案，放在 workout 區塊）
// 沒網路時先存在手機，連上網路後自動上傳
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=12';

// ---------- 資料 ----------
const LEGACY_KEY = 'workout-log.v1';          // 改用 Firebase 前存在手機裡的資料
const MIGRATED_KEY = 'workout-log.migrated';  // 已經把手機裡的資料搬上 Firebase
const DEFAULT_PARTS = ['胸', '背', '肩', '腿', '二頭'];
const TITLES = { log: '記錄', history: '歷史', stats: '統計', backup: '備份' };

let db = { entries: [], parts: DEFAULT_PARTS.slice(), lastBackup: null };
let fs = null, unsubs = [], syncText = '';
const metaRef = () => doc(fs, 'workout', 'main');
const entryRef = (id) => doc(fs, 'workout', 'main', 'entries', id);
const cleanEntry = (e) => ({
  t: e.t || 0, date: e.date, part: e.part, note: e.note || '',
  sets: e.sets.map((s) => ({ w: +s.w || 0, r: +s.r || 0, s: +s.s || 0 })),
});
function writeError(e) { setSync('儲存失敗（' + (e.code || e.message) + '）'); toast('儲存失敗，請確認有登入'); }
function putEntry(e) { setDoc(entryRef(e.id), cleanEntry(e)).catch(writeError); }
function delEntry(id) { deleteDoc(entryRef(id)).catch(writeError); }
function saveMeta() { setDoc(metaRef(), { parts: db.parts, lastBackup: db.lastBackup || null }, { merge: true }).catch(writeError); }
// 一次寫很多筆（匯入、清除），每批最多 400 筆
function batchWrite(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(fs);
    for (const [kind, id, e] of ops.slice(i, i + 400)) {
      if (kind === 'set') b.set(entryRef(id), cleanEntry(e)); else b.delete(entryRef(id));
    }
    b.commit().catch(writeError);
  }
}
function setSync(t) { syncText = t; renderHeader(); }

const $ = (s) => document.querySelector(s);
const vol = (sets) => sets.reduce((t, s) => t + (+s.w || 0) * (+s.r || 0) * (+s.s || 0), 0);
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const WEEK = '日一二三四五六';
const dayLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return `${y}/${m}/${d}（${WEEK[w]}）`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sorted = () => db.entries.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- 分頁 ----------
let tab = 'log';
function go(name) {
  tab = name;
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 'tab-' + name;
  for (const b of document.querySelectorAll('nav.tabs button')) b.classList.toggle('on', b.dataset.go === name);
  $('#title').textContent = TITLES[name];
  renderHeader();
  if (name === 'history') renderHistory();
  if (name === 'stats') renderStats();
  if (name === 'backup') renderBackup();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

function renderHeader() {
  $('#headSub').textContent = `共 ${db.entries.length} 筆` + (syncText ? ` · ${syncText}` : '');
}

// ---------- 記錄表單 ----------
let form = { part: null, editing: null };

function renderPartChips() {
  $('#partChips').innerHTML = db.parts.map((p) =>
    `<button class="chip${p === form.part ? ' on' : ''}" data-part="${esc(p)}">${esc(p)}</button>`).join('');
}
$('#partChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-part]'); if (!b) return;
  form.part = b.dataset.part; renderPartChips();
});

function setRowHtml(s, i) {
  const v = (x) => (x === undefined || x === null || x === '' ? '' : x);
  return `<div class="set-row">
    <span class="n">${i + 1}</span>
    <input inputmode="decimal" data-k="w" value="${v(s.w)}" aria-label="重量">
    <input inputmode="numeric" data-k="r" value="${v(s.r)}" aria-label="次數">
    <input inputmode="numeric" data-k="s" value="${v(s.s)}" aria-label="組數">
    <button class="del" aria-label="刪除這列">×</button>
  </div>`;
}
function readSets() {
  return [...document.querySelectorAll('#setRows .set-row')].map((row) => {
    const o = {};
    for (const inp of row.querySelectorAll('input')) o[inp.dataset.k] = inp.value.trim();
    return o;
  });
}
function writeSets(sets) {
  if (!sets.length) sets = [{}, {}, {}];
  $('#setRows').innerHTML = sets.map(setRowHtml).join('');
  updateTotal();
}
function updateTotal() {
  const sets = readSets().map((s) => ({ w: parseFloat(s.w), r: parseFloat(s.r), s: parseFloat(s.s) }));
  $('#liveTotal').textContent = fmt(vol(sets));
}
$('#setRows').addEventListener('input', updateTotal);
$('#setRows').addEventListener('click', (e) => {
  if (!e.target.classList.contains('del')) return;
  const sets = readSets(); const rows = [...document.querySelectorAll('#setRows .set-row')];
  sets.splice(rows.indexOf(e.target.closest('.set-row')), 1);
  writeSets(sets.length ? sets : [{}]);
});
$('#addSet').addEventListener('click', () => {
  const sets = readSets(); const last = sets[sets.length - 1] || {};
  // 新的一列沿用上一列的次數與組數，通常只需改重量
  sets.push({ w: '', r: last.r || '', s: last.s || '' });
  writeSets(sets);
  const rows = document.querySelectorAll('#setRows .set-row');
  rows[rows.length - 1].querySelector('input').focus();
});

function setsText(sets) {
  return sets.map((s) => `<span>${fmt(s.w)}×${s.r}×${s.s}</span>`).join('、');
}
function resetForm() {
  form = { part: null, editing: null };
  $('#fDate').value = today();
  writeSets([]); renderPartChips();
  $('#cancelEdit').hidden = true; $('#saveBtn').textContent = '儲存';
}
$('#cancelEdit').addEventListener('click', () => { resetForm(); go('history'); });

$('#saveBtn').addEventListener('click', () => {
  const date = $('#fDate').value;
  if (!date) return toast('請選日期');
  if (!form.part) return toast('請選部位');
  const sets = readSets()
    .filter((s) => s.w !== '' || s.r !== '' || s.s !== '')
    .map((s) => ({ w: parseFloat(s.w) || 0, r: parseFloat(s.r) || 0, s: parseFloat(s.s) || 1 }));
  if (!sets.length || vol(sets) === 0) return toast('請填重量、次數、組數');
  let e;
  if (form.editing) {
    e = db.entries.find((x) => x.id === form.editing);
    Object.assign(e, { date, part: form.part, sets });
  } else {
    e = { id: uid(), t: Date.now(), date, part: form.part, sets };
    db.entries.push(e);
  }
  putEntry(e);
  const wasEditing = !!form.editing;
  toast(`已儲存 ${form.part} ${fmt(vol(sets))} kg`);
  resetForm(); renderHeader();
  if (wasEditing) go('history');
});

function editEntry(id) {
  const e = db.entries.find((x) => x.id === id); if (!e) return;
  form = { part: e.part, editing: id };
  if (!db.parts.includes(e.part)) { db.parts.push(e.part); saveMeta(); }
  $('#fDate').value = e.date;
  writeSets(e.sets.map((s) => ({ ...s })));
  renderPartChips();
  $('#cancelEdit').hidden = false; $('#saveBtn').textContent = '儲存修改';
  go('log');
}

// ---------- 歷史 ----------
let histPart = null, histLimit = 40;
function renderHistory() {
  const parts = [...new Set(db.entries.map((e) => e.part))];
  $('#histFilter').innerHTML = [`<button class="chip${histPart ? '' : ' on'}" data-hp="">全部</button>`]
    .concat(parts.map((p) => `<button class="chip${p === histPart ? ' on' : ''}" data-hp="${esc(p)}">${esc(p)}</button>`)).join('');
  const list = sorted().filter((e) => !histPart || e.part === histPart);
  if (!list.length) {
    $('#histList').innerHTML = `<div class="empty">還沒有紀錄。<br>可以到「備份」匯入舊資料。</div>`;
    $('#histMore').hidden = true; return;
  }
  const shown = list.slice(0, histLimit);
  let html = '', cur = null, dayTotal = 0, buf = '';
  const flush = () => { if (cur) html += `<div class="day"><span>${dayLabel(cur)}</span><span>${fmt(dayTotal)} kg</span></div>` + buf; };
  for (const e of shown) {
    if (e.date !== cur) { flush(); cur = e.date; dayTotal = 0; buf = ''; }
    const v = vol(e.sets); dayTotal += v;
    buf += `<div class="card entry" data-id="${e.id}">
      <div class="part">${esc(e.part)}</div>
      <div class="body"><div class="setline">${setsText(e.sets)}</div>${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}</div>
      <div class="vol">${fmt(v)}<small>kg</small></div>
    </div>`;
  }
  flush();
  $('#histList').innerHTML = html;
  $('#histMore').hidden = list.length <= histLimit;
}
$('#histFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hp]'); if (!b) return;
  histPart = b.dataset.hp || null; histLimit = 40; renderHistory();
});
$('#histMore').addEventListener('click', () => { histLimit += 60; renderHistory(); });
$('#histList').addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]');
  const c = ev.target.closest('.entry'); if (!c) return;
  const id = c.dataset.id;
  if (!act) {
    // 點一下展開「編輯／刪除」
    const open = c.querySelector('.acts');
    document.querySelectorAll('#histList .acts').forEach((x) => x.remove());
    if (!open) c.insertAdjacentHTML('beforeend', `<div class="acts row"><button class="btn" data-act="edit" style="flex:1">編輯</button><button class="btn-danger" data-act="del" style="flex:1">刪除</button></div>`);
    return;
  }
  if (act.dataset.act === 'edit') editEntry(id);
  else if (confirm('確定刪除這筆紀錄？')) {
    db.entries = db.entries.filter((x) => x.id !== id); delEntry(id); renderHistory(); renderHeader(); toast('已刪除');
  }
});

// ---------- 統計（與 Excel「統計」表相同：次數＝有練的天數，平均＝總量÷次數） ----------
let statMode = 'count';
const HINT = {
  count: '每個部位有練的天數',
  avg: '每次練該部位的平均總重量（kg）',
  sum: '該部位的總重量加總（kg）',
};
function aggregate() {
  // key: 'YYYY' 或 'YYYY-MM' → part → {days:Set, sum}
  const m = new Map();
  const add = (k, p, d, v) => {
    if (!m.has(k)) m.set(k, new Map());
    const g = m.get(k);
    for (const kk of [p, '__all']) {
      if (!g.has(kk)) g.set(kk, { days: new Set(), sum: 0 });
      const c = g.get(kk); c.days.add(kk === '__all' ? d + '|' + p : d); c.sum += v;
    }
  };
  for (const e of db.entries) { const v = vol(e.sets); add(e.date.slice(0, 4), e.part, e.date, v); add(e.date.slice(0, 7), e.part, e.date, v); }
  return m;
}
function cellVal(c) {
  if (!c) return null;
  if (statMode === 'count') return c.days.size;
  if (statMode === 'sum') return c.sum;
  return c.sum / c.days.size;
}
function statParts() {
  const order = db.parts.slice();
  for (const e of db.entries) if (!order.includes(e.part)) order.push(e.part);
  return order.filter((p) => db.entries.some((e) => e.part === p));
}
function renderStats() {
  for (const b of document.querySelectorAll('#statMode button')) b.classList.toggle('on', b.dataset.m === statMode);
  $('#statHint').textContent = HINT[statMode];
  const agg = aggregate(), parts = statParts();
  const years = [...agg.keys()].filter((k) => k.length === 4).sort().reverse();
  if (!years.length) { $('#statTable').innerHTML = ''; $('#chartCard').hidden = true; return; }
  $('#chartCard').hidden = false;
  let h = `<tr><th></th>${parts.map((p) => `<th>${esc(p)}</th>`).join('')}<th>總計</th></tr>`;
  for (const y of years) {
    const row = (k, label, cls) => {
      const g = agg.get(k);
      return `<tr class="${cls}"><td>${label}</td>${parts.concat('__all').map((p) => { const v = cellVal(g.get(p)); return `<td>${v === null ? '' : fmt(Math.round(v))}</td>`; }).join('')}</tr>`;
    };
    h += row(y, y, 'yr');
    const months = [...agg.keys()].filter((k) => k.length === 7 && k.startsWith(y)).sort().reverse();
    for (const k of months) h += row(k, +k.slice(5) + ' 月', '');
  }
  $('#statTable').innerHTML = h;

  const sel = $('#chartYear');
  const keep = sel.value && years.includes(sel.value) ? sel.value : years[0];
  sel.innerHTML = years.map((y) => `<option${y === keep ? ' selected' : ''}>${y}</option>`).join('');
  renderChart(agg, keep);
}
function renderChart(agg, y) {
  $('#chartTitle').textContent = { count: '每月練習天數', avg: '每月平均重量', sum: '每月總重量' }[statMode];
  const vals = [];
  for (let i = 1; i <= 12; i++) {
    const g = agg.get(`${y}-${pad(i)}`); const c = g && g.get('__all');
    let v = 0;
    if (c) v = statMode === 'count' ? new Set([...c.days].map((x) => x.split('|')[0])).size : statMode === 'sum' ? c.sum : c.sum / c.days.size;
    vals.push(v);
  }
  const max = Math.max(...vals, 1);
  $('#bars').innerHTML = vals.map((v, i) =>
    `<div class="b" title="${i + 1}月：${fmt(Math.round(v))}"><i style="height:${(v / max) * 100}%"></i><span>${i + 1}</span></div>`).join('');
}
$('#statMode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; statMode = b.dataset.m; renderStats(); });
$('#chartYear').addEventListener('change', () => renderChart(aggregate(), $('#chartYear').value));

// ---------- 備份 ----------
function renderBackup() {
  $('#appVer').textContent = window.APP_VERSION || '';
  renderHeader();
  // 備份提醒只放在這一頁：超過 14 天沒備份就用醒目底色
  const days = db.lastBackup ? Math.floor((Date.now() - db.lastBackup) / 864e5) : null;
  const info = $('#backupInfo');
  info.textContent = db.lastBackup
    ? `上次備份：${new Date(db.lastBackup).toLocaleString('zh-TW', { hour12: false })}（${days} 天前）`
    : '還沒備份過';
  info.className = db.entries.length && (days === null || days >= 14) ? 'banner' : 'small';
  info.style.margin = '0';
  const ds = db.entries.map((e) => e.date).sort();
  $('#dataInfo').textContent = ds.length ? `共 ${ds.length} 筆，從 ${ds[0]} 到 ${ds[ds.length - 1]}` : '目前沒有紀錄';
  $('#partManage').innerHTML = db.parts.map((p) =>
    `<button class="chip" data-rm="${esc(p)}">${esc(p)} ✕</button>`).join('');
}
async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  // iPhone 會跳出分享選單，可選「儲存到檔案」存到 iCloud 雲碟
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}
const stamp = () => today().replace(/-/g, '');
$('#exportJson').addEventListener('click', async () => {
  const ok = await saveFile(`重訓備份-${stamp()}.json`, JSON.stringify({ app: 'workout-log', version: 1, exported: new Date().toISOString(), parts: db.parts, entries: db.entries }), 'application/json');
  if (ok) { db.lastBackup = Date.now(); saveMeta(); renderBackup(); toast('已匯出備份'); }
});
$('#exportCsv').addEventListener('click', () => {
  const max = Math.max(1, ...db.entries.map((e) => e.sets.length));
  const head = ['日期', '部位'];
  for (let i = 0; i < max; i++) head.push('重量', '次數', '組數');
  head.push('總共(kg)', '備註');
  const q = (s) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = [head.join(',')];
  for (const e of db.entries.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.t || 0) - (b.t || 0))) {
    const r = [e.date, q(e.part)];
    for (let i = 0; i < max; i++) { const s = e.sets[i]; r.push(s ? s.w : '', s ? s.r : '', s ? s.s : ''); }
    r.push(vol(e.sets), q(e.note || ''));
    lines.push(r.join(','));
  }
  saveFile(`重訓紀錄-${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (e) { return alert('這不是有效的備份檔'); }
  if (!data || !Array.isArray(data.entries)) return alert('這不是重訓紀錄的備份檔');
  const added = mergeEntries(data.entries);
  renderBackup(); renderPartChips();
  alert(`匯入完成：新增 ${added} 筆，略過 ${data.entries.length - added} 筆重複。`);
});
// 把備份檔（或手機裡的舊資料）中還沒有的紀錄加進 Firebase；用 id 判斷，重複匯入不會變兩筆
function mergeEntries(list) {
  const have = new Set(db.entries.map((e) => e.id));
  const ops = [];
  let partsChanged = false;
  for (const e of list) {
    if (!e || !e.id || !e.date || !e.part || !Array.isArray(e.sets) || have.has(e.id)) continue;
    const c = { id: e.id, ...cleanEntry(e) };
    db.entries.push(c); ops.push(['set', c.id, c]); have.add(c.id);
    if (!db.parts.includes(c.part)) { db.parts.push(c.part); partsChanged = true; }
  }
  if (ops.length) batchWrite(ops);
  if (partsChanged) saveMeta();
  return ops.length;
}
$('#addPart').addEventListener('click', () => {
  const p = $('#newPart').value.trim();
  if (!p || db.parts.includes(p)) return;
  db.parts.push(p); saveMeta(); $('#newPart').value = ''; renderBackup(); renderPartChips();
});
$('#partManage').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  if (!confirm(`從部位按鈕移除「${b.dataset.rm}」？（舊紀錄不受影響）`)) return;
  db.parts = db.parts.filter((p) => p !== b.dataset.rm); saveMeta(); renderBackup(); renderPartChips();
});
$('#wipeAll').addEventListener('click', () => {
  if (!confirm('確定清除所有紀錄？建議先匯出備份。')) return;
  if (prompt('請輸入「清除」兩個字確認') !== '清除') return;
  batchWrite(db.entries.map((e) => ['del', e.id])); db.entries = []; renderBackup(); toast('已清除');
});

// ---------- Firebase 同步 ----------
function rerender() {
  renderHeader(); renderPartChips();
  if (tab === 'history') renderHistory();
  if (tab === 'stats') renderStats();
  if (tab === 'backup') renderBackup();
}
let migrateChecked = false;
function migrateLegacy() {
  // 第一次登入、確定拿到雲端資料後，把手機裡原本的紀錄搬上去（只做一次；手機裡的舊資料保留不刪）
  if (migrateChecked) return;
  migrateChecked = true;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    if (old && Array.isArray(old.entries) && old.entries.length) {
      if (Array.isArray(old.parts)) for (const p of old.parts) if (!db.parts.includes(p)) db.parts.push(p);
      const added = mergeEntries(old.entries);
      saveMeta();
      if (added) toast(`已把手機裡的 ${added} 筆紀錄搬到雲端`);
    }
    localStorage.setItem(MIGRATED_KEY, String(Date.now()));
  } catch (e) {}
}
function listen() {
  unsubs.push(onSnapshot(collection(fs, 'workout', 'main', 'entries'), { includeMetadataChanges: true }, (snap) => {
    db.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const m = snap.metadata;
    setSync(m.hasPendingWrites ? (navigator.onLine ? '上傳中…' : '離線，連上網路後自動上傳') : m.fromCache ? '離線' : '已同步');
    if (!m.fromCache) migrateLegacy();
    rerender();
  }, (e) => setSync('讀取失敗（' + e.code + '）')));
  unsubs.push(onSnapshot(metaRef(), (snap) => {
    const d = snap.data();
    if (d) {
      if (Array.isArray(d.parts) && d.parts.length) db.parts = d.parts.slice();
      db.lastBackup = d.lastBackup || null;
    }
    rerender();
  }, () => {}));
}

// ---------- 登入 ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
onAuthStateChanged(auth, (user) => {
  unsubs.forEach((u) => u()); unsubs = [];
  db = { entries: [], parts: DEFAULT_PARTS.slice(), lastBackup: null };
  migrateChecked = false; syncText = '';
  $('#login').hidden = !!user;
  for (const id of ['#appHeader', '#appMain', '#appNav']) $(id).hidden = !user;
  if (user) { $('#who').textContent = user.email; resetForm(); rerender(); listen(); }
});
$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  $('#loginBtn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value);
  } catch (err) {
    const msg = {
      'auth/invalid-credential': 'Email 或密碼不對',
      'auth/invalid-email': 'Email 格式不對',
      'auth/too-many-requests': '試太多次了，請稍後再試',
      'auth/network-request-failed': '沒有網路，請連上網路再登入',
    }[err.code];
    $('#loginErr').textContent = msg || ('登入失敗（' + err.code + '）');
  }
  $('#loginBtn').disabled = false;
});
$('#logoutBtn').addEventListener('click', () => { if (confirm('確定登出？')) signOut(auth); });

// ---------- 啟動 ----------
resetForm();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
