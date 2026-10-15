'use strict';

// ---------- 資料 ----------
const KEY = 'workout-log.v1';
const DEFAULT_PARTS = ['胸', '背', '肩', '腿', '二頭'];
const TITLES = { log: '記錄', history: '歷史', stats: '統計', backup: '備份' };

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.entries)) return Object.assign({ parts: DEFAULT_PARTS.slice(), lastBackup: null }, d);
  } catch (e) {}
  return { entries: [], parts: DEFAULT_PARTS.slice(), lastBackup: null };
}
let db = load();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch (e) { alert('儲存失敗：' + e.message); return false; }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

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
  $('#headSub').textContent = `共 ${db.entries.length} 筆`;
  const days = db.lastBackup ? Math.floor((Date.now() - db.lastBackup) / 864e5) : null;
  const need = db.entries.length > 0 && (days === null || days >= 14);
  $('#backupBanner').hidden = !need || tab === 'backup';
  $('#backupMsg').textContent = days === null ? '還沒備份過' : `已 ${days} 天沒備份`;
}

// ---------- 記錄表單 ----------
let form = { part: null, editing: null };

function renderPartChips() {
  $('#partChips').innerHTML = db.parts.map((p) =>
    `<button class="chip${p === form.part ? ' on' : ''}" data-part="${esc(p)}">${esc(p)}</button>`).join('');
}
$('#partChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-part]'); if (!b) return;
  form.part = b.dataset.part; renderPartChips(); renderPrev();
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

function prevEntry() {
  if (!form.part) return null;
  return sorted().find((e) => e.part === form.part && e.id !== form.editing) || null;
}
function setsText(sets) {
  return sets.map((s) => `<span>${fmt(s.w)}×${s.r}×${s.s}</span>`).join('、');
}
function renderPrev() {
  const p = prevEntry();
  $('#prevCard').hidden = !p || !!form.editing;
  if (!p) return;
  $('#prevText').innerHTML = `上次${esc(p.part)}：${dayLabel(p.date)}<br><span class="t">${setsText(p.sets)}</span><br>總共 ${fmt(vol(p.sets))} kg`;
}
$('#copyPrev').addEventListener('click', () => {
  const p = prevEntry(); if (!p) return;
  writeSets(p.sets.map((s) => ({ w: s.w, r: s.r, s: s.s })));
  toast('已帶入上次的重量');
});

function resetForm() {
  form = { part: null, editing: null };
  $('#fDate').value = today(); $('#fNote').value = '';
  writeSets([]); renderPartChips(); renderPrev();
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
  const note = $('#fNote').value.trim();
  if (form.editing) {
    const e = db.entries.find((x) => x.id === form.editing);
    Object.assign(e, { date, part: form.part, sets, note });
  } else {
    db.entries.push({ id: uid(), t: Date.now(), date, part: form.part, sets, note });
  }
  if (!persist()) return;
  const wasEditing = !!form.editing;
  toast(`已儲存 ${form.part} ${fmt(vol(sets))} kg`);
  resetForm(); renderHeader();
  if (wasEditing) go('history');
});

function editEntry(id) {
  const e = db.entries.find((x) => x.id === id); if (!e) return;
  form = { part: e.part, editing: id };
  if (!db.parts.includes(e.part)) { db.parts.push(e.part); persist(); }
  $('#fDate').value = e.date; $('#fNote').value = e.note || '';
  writeSets(e.sets.map((s) => ({ ...s })));
  renderPartChips(); renderPrev();
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
    db.entries = db.entries.filter((x) => x.id !== id); persist(); renderHistory(); renderHeader(); toast('已刪除');
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
  renderHeader();
  $('#backupInfo').textContent = db.lastBackup
    ? `上次備份：${new Date(db.lastBackup).toLocaleString('zh-TW', { hour12: false })}`
    : '還沒備份過';
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
  if (ok) { db.lastBackup = Date.now(); persist(); renderBackup(); toast('已匯出備份'); }
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
  const have = new Set(db.entries.map((e) => e.id));
  let added = 0;
  for (const e of data.entries) {
    if (!e || !e.id || !e.date || !e.part || !Array.isArray(e.sets) || have.has(e.id)) continue;
    db.entries.push({ id: e.id, t: e.t, date: e.date, part: e.part, sets: e.sets.map((s) => ({ w: +s.w || 0, r: +s.r || 0, s: +s.s || 0 })), note: e.note || '' });
    have.add(e.id); added++;
    if (!db.parts.includes(e.part)) db.parts.push(e.part);
  }
  if (persist()) { renderBackup(); renderPartChips(); alert(`匯入完成：新增 ${added} 筆，略過 ${data.entries.length - added} 筆重複。`); }
});
$('#addPart').addEventListener('click', () => {
  const p = $('#newPart').value.trim();
  if (!p || db.parts.includes(p)) return;
  db.parts.push(p); persist(); $('#newPart').value = ''; renderBackup(); renderPartChips();
});
$('#partManage').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  if (!confirm(`從部位按鈕移除「${b.dataset.rm}」？（舊紀錄不受影響）`)) return;
  db.parts = db.parts.filter((p) => p !== b.dataset.rm); persist(); renderBackup(); renderPartChips();
});
$('#wipeAll').addEventListener('click', () => {
  if (!confirm('確定清除所有紀錄？建議先匯出備份。')) return;
  if (prompt('請輸入「清除」兩個字確認') !== '清除') return;
  db.entries = []; persist(); renderBackup(); toast('已清除');
});

// ---------- 啟動 ----------
resetForm();
renderHeader();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
