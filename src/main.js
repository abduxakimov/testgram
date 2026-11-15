import './style.css';
import { Buffer } from 'buffer';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { getDisplayName } from 'telegram/Utils';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';

const $ = id => document.getElementById(id);
const NATIVE = Capacitor.isNativePlatform();
const LS = {
  get: k => localStorage.getItem('tg_' + k),
  set: (k, v) => localStorage.setItem('tg_' + k, v),
  del: k => localStorage.removeItem('tg_' + k),
};
const COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];
const TYPE_LABEL = { group: 'guruh', channel: 'kanal', user: 'shaxsiy chat', bot: 'bot' };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let client = null, phone = '', phoneHash = '';
let dialogs = [], filter = 'all', cur = null, oldest = 0, ended = false, loading = false;
const entities = new Map(), msgCache = new Map(), photoUrls = new Map();
window.busy = false;

/* ================= Telegram ulanishi ================= */
async function getClient() {
  if (client) return client;
  const id = LS.get('api_id'), hash = LS.get('api_hash');
  if (!id || !hash) return null;
  client = new TelegramClient(new StringSession(LS.get('session') || ''), Number(id), hash, {
    connectionRetries: 5, useWSS: true,
    deviceModel: 'TestGram', systemVersion: NATIVE ? 'Android' : 'Web', appVersion: '1.0', langCode: 'uz',
  });
  client.setLogLevel('error');
  await client.connect();
  return client;
}
const saveSession = () => LS.set('session', client.session.save());

function errText(e) {
  const m = e?.errorMessage || e?.message || String(e);
  const map = {
    PHONE_NUMBER_INVALID: 'Telefon raqam noto\'g\'ri',
    PHONE_CODE_INVALID: 'Kod noto\'g\'ri',
    PHONE_CODE_EXPIRED: 'Kod eskirgan, qaytadan yuboring',
    PASSWORD_HASH_INVALID: 'Parol noto\'g\'ri',
    API_ID_INVALID: 'API ID/Hash noto\'g\'ri. Sozlamani qayta kiriting',
    PHONE_NUMBER_BANNED: 'Bu raqam Telegram tomonidan bloklangan',
  };
  if (m === 'FLOOD' || e?.seconds) return `Juda ko'p urinish. ${e.seconds || ''} soniyadan keyin qayta urining`;
  return map[m] || m;
}

/* ================= yordamchilar ================= */
const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkify = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const initials = t => (t || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const color = id => COLORS[Math.abs(Number(String(id).slice(-6))) % 7];
const T = x => (x && typeof x === 'object' && 'text' in x) ? (x.text || '') : (x || '');
const iso = unix => unix ? new Date(unix * 1000).toISOString() : '';
const safeName = s => (s || 'chat').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 60) || 'chat';
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
const fmtDate = unix => { if (!unix) return ''; const d = new Date(unix * 1000), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function avatar(el, id, title) { el.style.background = color(id); el.textContent = initials(title); }
function size(b) { b = Number(b) || 0; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
function hm(s) { return new Date(s).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }); }
function shortDate(s) {
  if (!s) return '';
  const d = new Date(s), now = new Date();
  if (d.toDateString() === now.toDateString()) return hm(s);
  if ((now - d) < 6 * 864e5) return ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Juma', 'Shan'][d.getDay()];
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function dayLabel(s) {
  const d = new Date(s), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Bugun';
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  return d.getDate() + '-' + months[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
}
let toastT;
function toast(t, ms = 2500) {
  const el = $('toast'); el.textContent = t; el.classList.remove('hidden');
  clearTimeout(toastT); if (ms) toastT = setTimeout(() => el.classList.add('hidden'), ms);
}

const isService = m => m?.className === 'MessageService';
const sender = m => { try { const s = m.sender || m._sender; return s ? getDisplayName(s) : ''; } catch { return ''; } };
const fileName = m => (m.file && m.file.name) || `fayl_${m.id}${m.file?.ext || ''}`;

function pollData(md) {
  const poll = md.poll, res = md.results;
  const opts = poll.answers.map(a => T(a.text));
  const voters = opts.map(() => null);
  let correct = null;
  if (res?.results) {
    const idx = new Map(poll.answers.map((a, i) => [Buffer.from(a.option).toString('hex'), i]));
    for (const r of res.results) {
      const i = idx.get(Buffer.from(r.option).toString('hex'));
      if (i === undefined) continue;
      voters[i] = r.voters;
      if (r.correct) correct = i;
    }
  }
  return { question: T(poll.question), options: opts, correct, voters, quiz: !!poll.quiz,
    total: res?.totalVoters ?? null, solution: res?.solution || '' };
}

function mediaOf(m) {
  const md = m.media;
  if (md instanceof Api.MessageMediaPoll) return { type: 'poll', ...pollData(md) };
  if (md instanceof Api.MessageMediaPhoto && md.photo) return { type: 'photo' };
  if (md instanceof Api.MessageMediaDocument && md.document)
    return { type: 'doc', name: fileName(m), size: Number(m.file?.size || 0), mime: m.file?.mimeType || '' };
  return null;
}

function preview(m) {
  if (!m) return '';
  const md = mediaOf(m);
  if (md?.type === 'poll') return '📊 ' + md.question;
  if (md?.type === 'photo') return '🖼 ' + (m.message || 'Rasm');
  if (md?.type === 'doc') return '📎 ' + md.name;
  return m.message || '';
}

/* ================= fayl saqlash / ulashish ================= */
const toB64 = buf => Buffer.from(buf).toString('base64');
let saveDir = Directory.Documents;

async function ensurePerm() {
  if (!NATIVE) return;
  try { await Filesystem.requestPermissions(); } catch { /* Android 11+ da shart emas */ }
}
async function writeNative(path, data /* Uint8Array | base64 string */) {
  const b64 = typeof data === 'string' ? data : toB64(data);
  try {
    await Filesystem.writeFile({ path, data: b64, directory: saveDir, recursive: true });
  } catch (e) {
    if (saveDir === Directory.Documents) { saveDir = Directory.External; return writeNative(path, b64); }
    throw e;
  }
}
async function shareFile(name, data, title) {
  if (!NATIVE) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return;
  }
  const path = 'share/' + name;
  await Filesystem.writeFile({ path, data: typeof data === 'string' ? data : toB64(data), directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: title || name, files: [uri], dialogTitle: 'Ochish yoki yuborish' });
}
const dirLabel = () => saveDir === Directory.Documents ? 'Hujjatlar (Documents)' : 'Android/data/uz.testgram.app/files';

/* ================= kirish ================= */
const STEPS = { cfg: 'sCfg', phone: 'sPhone', code: 'sCode', pass: 'sPass' };
function step(s) {
  Object.entries(STEPS).forEach(([k, id]) => $(id).classList.toggle('hidden', k !== s));
  $('aErr').textContent = '';
  $('aSub').innerHTML = {
    cfg: 'Birinchi marta sozlash: <a href="https://my.telegram.org" target="_blank">my.telegram.org</a> → API development tools bo\'limidan API ID va API Hash oling.',
    phone: 'Telegram akkauntingiz telefon raqamini kiriting.',
    code: 'Telegram ilovangizga yuborilgan kodni kiriting.',
    pass: 'Akkauntingizda ikki bosqichli himoya yoqilgan. Parolni kiriting.',
  }[s];
  const inp = { cfg: 'apiId', phone: 'phone', code: 'code', pass: 'pass' }[s];
  setTimeout(() => $(inp).focus(), 50);
}
async function guard(fn) {
  const btns = document.querySelectorAll('#auth button'); btns.forEach(b => b.disabled = true);
  try { await fn(); } catch (e) { $('aErr').textContent = errText(e); }
  finally { btns.forEach(b => b.disabled = false); }
}
async function resetClient() { try { await client?.disconnect(); } catch { } client = null; }

window.step = step;
window.saveCfg = () => guard(async () => {
  const id = $('apiId').value.trim(), hash = $('apiHash').value.trim().toLowerCase();
  if (!/^\d+$/.test(id) || !/^[0-9a-f]{32}$/.test(hash)) throw new Error('API ID (raqam) yoki API Hash (32 belgi) noto\'g\'ri');
  LS.set('api_id', id); LS.set('api_hash', hash); LS.del('session');
  await resetClient(); step('phone');
});
window.resetCfg = () => guard(async () => { await resetClient(); ['api_id', 'api_hash', 'session'].forEach(LS.del); step('cfg'); });
window.sendCode = () => guard(async () => {
  phone = $('phone').value.replace(/[^\d+]/g, '');
  const c = await getClient();
  const r = await c.sendCode({ apiId: Number(LS.get('api_id')), apiHash: LS.get('api_hash') }, phone);
  phoneHash = r.phoneCodeHash; step('code');
});
window.signIn = () => guard(async () => {
  const c = await getClient();
  try {
    await c.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: phoneHash, phoneCode: $('code').value.replace(/\D/g, '') }));
  } catch (e) {
    if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') return step('pass');
    throw e;
  }
  saveSession(); init();
});
window.sendPass = () => guard(async () => {
  const c = await getClient();
  const pwd = await c.invoke(new Api.account.GetPassword());
  await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, $('pass').value) }));
  saveSession(); init();
});
window.logout = async () => {
  if (!confirm('Akkauntdan chiqasizmi?')) return;
  try { await client?.invoke(new Api.auth.LogOut()); } catch { }
  LS.del('session'); await resetClient(); location.reload();
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || $('auth').classList.contains('hidden')) return;
  const vis = Object.entries(STEPS).find(([, id]) => !$(id).classList.contains('hidden'))?.[0];
  ({ cfg: window.saveCfg, phone: window.sendCode, code: window.signIn, pass: window.sendPass })[vis]?.();
});

/* ================= dialoglar ================= */
async function init() {
  const showAuth = s => { $('auth').classList.remove('hidden'); $('app').classList.add('hidden'); step(s); };
  if (!LS.get('api_id')) return showAuth('cfg');
  let c;
  try {
    c = await getClient();
    if (!(await c.checkAuthorization())) return showAuth('phone');
  } catch (e) {
    showAuth('phone'); $('aErr').textContent = 'Ulanib bo\'lmadi: ' + errText(e); return;
  }
  $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
  const me = await c.getMe();
  const name = getDisplayName(me);
  $('meName').innerHTML = esc(name) + '<small>+' + esc(me.phone || '') + '</small>';
  avatar($('meAv'), me.id?.toString() || '0', name);
  loadDialogs();
}
async function loadDialogs() {
  $('list').innerHTML = '<div class="loader">Yuklanmoqda…</div>';
  try {
    const c = await getClient();
    const ds = await c.getDialogs({ limit: 500 });
    dialogs = ds.map(d => {
      const id = d.id.toString();
      entities.set(id, d.entity);
      const type = d.isGroup ? 'group' : d.isChannel ? 'channel' : d.entity?.bot ? 'bot' : 'user';
      return { id, title: d.title || d.name || '—', type, unread: d.unreadCount, pinned: d.pinned,
        date: iso(d.message?.date), preview: preview(d.message).slice(0, 90) };
    });
    renderList();
  } catch (e) {
    $('list').innerHTML = '<div class="loader">' + esc(errText(e)) + '</div>';
  }
}
window.loadDialogs = loadDialogs;
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const items = dialogs.filter(c => (filter === 'all' || c.type === filter) && (!q || c.title.toLowerCase().includes(q)));
  if (!items.length) { $('list').innerHTML = '<div class="loader">Hech narsa topilmadi</div>'; return; }
  $('list').innerHTML = items.map(c => `
    <div class="chat ${cur && cur.id === c.id ? 'on' : ''}" data-id="${c.id}">
      <div class="av" style="background:${color(c.id)}">${esc(initials(c.title))}</div>
      <div class="c-body">
        <div class="c-row"><div class="c-title">${c.type === 'channel' ? '📢 ' : c.type === 'group' ? '👥 ' : ''}${esc(c.title)}</div><div class="c-date">${shortDate(c.date)}</div></div>
        <div class="c-row"><div class="c-prev">${esc(c.preview)}</div>${c.unread ? `<span class="badge ${c.type === 'user' ? 'blue' : ''}">${c.unread > 999 ? '999+' : c.unread}</span>` : c.pinned ? '📌' : ''}</div>
      </div>
    </div>`).join('');
}
window.renderList = renderList;
$('list').addEventListener('click', e => {
  const el = e.target.closest('.chat'); if (!el) return;
  openChat(dialogs.find(c => c.id === el.dataset.id));
});
$('tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  filter = t.dataset.f; renderList();
});

/* ================= xabarlar ================= */
function openChat(c) {
  cur = c; oldest = 0; ended = false;
  $('empty').classList.add('hidden'); $('head').classList.remove('hidden'); $('msgs').classList.remove('hidden');
  $('app').classList.add('open');
  $('hTitle').textContent = c.title; $('hSub').textContent = TYPE_LABEL[c.type] || '';
  avatar($('hAv'), c.id, c.title);
  $('msgs').innerHTML = '<div class="loader">Yuklanmoqda…</div>';
  renderList(); loadMore(true);
}
function closeChat() { $('app').classList.remove('open'); cur = null; renderList(); }
window.closeChat = closeChat;

async function loadMore(first) {
  if (loading || ended || !cur) return;
  loading = true; const chat = cur.id;
  let msgs;
  try {
    const c = await getClient();
    msgs = await c.getMessages(entities.get(chat), { limit: 40, offsetId: oldest });
  } catch (e) {
    loading = false;
    if (first) $('msgs').innerHTML = '<div class="loader">' + esc(errText(e)) + '</div>';
    return;
  }
  loading = false;
  if (!cur || cur.id !== chat) return;
  ended = msgs.length < 40;
  if (msgs.length) oldest = msgs[msgs.length - 1].id;
  const items = [...msgs].reverse().filter(m => !isService(m));
  items.forEach(m => msgCache.set(`${chat}:${m.id}`, m));

  const box = $('msgs');
  if (first) box.innerHTML = '';
  box.querySelector('.loader')?.remove();
  const prevH = box.scrollHeight, prevTop = box.scrollTop;
  const firstDayEl = box.querySelector('.day');
  let html = '', day = null;
  items.forEach(m => {
    const dl = dayLabel(iso(m.date));
    if (dl !== day) { html += `<div class="day">${dl}</div>`; day = dl; }
    html += renderMsg(m, chat);
  });
  if (firstDayEl && firstDayEl.textContent === day) firstDayEl.remove();
  if (!items.length && first) html = '<div class="empty">Xabarlar yo\'q</div>';
  box.insertAdjacentHTML('afterbegin', html);
  box.querySelectorAll('img.ph:not([data-obs])').forEach(img => { img.dataset.obs = 1; photoObserver.observe(img); });
  if (first) box.scrollTop = box.scrollHeight;
  else box.scrollTop = box.scrollHeight - prevH + prevTop;
}
$('msgs').addEventListener('scroll', () => { if ($('msgs').scrollTop < 150) loadMore(false); });

function renderMsg(m, chat) {
  const md = mediaOf(m), key = `${chat}:${m.id}`;
  const snd = cur.type === 'group' && !m.out ? sender(m) : '';
  let body = '';
  if (md?.type === 'photo') {
    body += `<img class="ph" data-k="${key}" alt="">`;
  } else if (md?.type === 'doc') {
    const ext = (md.name.split('.').pop() || 'file').slice(0, 4);
    body += `<a class="doc" href="#" data-k="${key}"><div class="ic">${esc(ext)}</div>
      <div><div class="dn">${esc(md.name)}</div><div class="ds">${size(md.size)} · ochish</div></div></a>`;
  } else if (md?.type === 'poll') {
    const tot = md.total || 0;
    const hidden = md.quiz && md.correct === null ? ' · javob yashirin' : '';
    body += `<div class="poll"><div class="q">${esc(md.question)}</div><div class="k">${md.quiz ? 'Viktorina' : 'So\'rovnoma'}${hidden}${tot ? ` · ${tot} ta ovoz` : ''}</div>`;
    md.options.forEach((o, i) => {
      const ok = md.correct === i, v = md.voters[i];
      const pc = tot && v != null ? Math.round(v * 100 / tot) + '%' : '';
      body += `<div class="opt ${ok ? 'ok' : ''}"><span class="mk">${ok ? '✓' : ''}</span><span>${LETTERS[i]}) ${esc(o)}</span><span class="pc">${pc}</span></div>`;
    });
    if (md.solution) body += `<div class="sol">💡 ${esc(md.solution)}</div>`;
    body += '</div>';
  }
  if (m.message) body += `<div class="tx">${linkify(m.message)}</div>`;
  if (!body) body = '<div class="tx" style="color:#8a9aa6"><i>[qo\'llab-quvvatlanmaydigan xabar]</i></div>';
  return `<div class="msg ${m.out ? 'out' : ''}">${snd ? `<div class="snd">${esc(snd)}</div>` : ''}${body}<span class="tm">${hm(iso(m.date))}</span></div>`;
}

/* rasmlarni ekranga chiqqanda navbat bilan yuklash */
let photoQueue = Promise.resolve();
const photoObserver = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    const img = en.target; photoObserver.unobserve(img);
    const k = img.dataset.k;
    if (photoUrls.has(k)) { img.src = photoUrls.get(k); img.classList.add('ok'); return; }
    photoQueue = photoQueue.then(async () => {
      try {
        const c = await getClient();
        const buf = await c.downloadMedia(msgCache.get(k), {});
        if (!buf) return;
        const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
        photoUrls.set(k, url); img.src = url; img.classList.add('ok');
      } catch { }
    });
  });
}, { root: $('msgs'), rootMargin: '300px' });

$('msgs').addEventListener('click', async e => {
  const img = e.target.closest('img.ph');
  if (img && img.src) {
    const m = msgCache.get(img.dataset.k);
    const blob = await (await fetch(img.src)).blob();
    return shareFile(`rasm_${m.id}.jpg`, new Uint8Array(await blob.arrayBuffer()));
  }
  const doc = e.target.closest('a.doc'); if (!doc) return;
  e.preventDefault();
  const m = msgCache.get(doc.dataset.k);
  toast('Yuklanmoqda…', 0);
  try {
    const c = await getClient();
    const buf = await c.downloadMedia(m, {});
    toast('Tayyor');
    await shareFile(fileName(m), buf);
  } catch (err) { toast('Xatolik: ' + errText(err), 4000); }
});

/* ================= Excel ================= */
const clip = v => typeof v === 'string' ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 32000) : v;
function buildExcel(polls, texts) {
  const wb = XLSX.utils.book_new();
  const n = Math.max(4, ...polls.map(p => p.options.length));
  const rows = [['#', 'Savol', ...LETTERS.slice(0, n).split(''), "To'g'ri javob", 'Izoh', 'Sana']];
  polls.forEach((p, i) => {
    const corr = p.correct !== null ? `${LETTERS[p.correct]}) ${p.options[p.correct]}` : (p.quiz ? "noma'lum" : "so'rovnoma");
    rows.push([i + 1, p.question, ...p.options, ...Array(n - p.options.length).fill(''), corr, p.solution, p.date].map(clip));
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 5 }, { wch: 60 }, ...Array(n).fill({ wch: 25 }), { wch: 30 }, { wch: 35 }, { wch: 17 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, 'Testlar');
  if (texts.length) {
    const ws2 = XLSX.utils.aoa_to_sheet([['#', 'Sana', 'Yuboruvchi', 'Matn'],
      ...texts.map((t, i) => [i + 1, t.date, t.sender, t.text].map(clip))]);
    ws2['!cols'] = [{ wch: 5 }, { wch: 17 }, { wch: 22 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Matnlar');
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

/* ================= eksport ================= */
window.openExport = () => {
  $('mChat').textContent = cur.title; $('mForm').classList.remove('hidden'); $('mProg').classList.add('hidden');
  $('modal').classList.remove('hidden');
};
window.closeModal = () => $('modal').classList.add('hidden');

let lastExcel = null;
window.shareExcel = () => lastExcel && shareFile(lastExcel.name, lastExcel.data, 'Testlar');
window.shareZip = () => lastZip && shareFile(lastZip.name, lastZip.data, 'Testlar arxivi');
let lastZip = null;

window.startExport = async () => {
  const types = new Set([...document.querySelectorAll('#mForm input[type=checkbox]:checked')].map(x => x.value));
  if (!types.size) return alert('Kamida bitta turini tanlang');
  const limitV = $('mLimit').value.trim();
  const limit = /^\d+$/.test(limitV) ? Number(limitV) : undefined;
  const exts = new Set($('mExt').value.split(',').map(x => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean));
  const keyword = $('mKey').value.trim() || undefined;
  const chat = cur, ent = entities.get(chat.id);

  window.busy = true; lastExcel = lastZip = null;
  $('mForm').classList.add('hidden'); $('mProg').classList.remove('hidden');
  $('pTitle').textContent = 'Yuklanmoqda…'; $('pSub').textContent = chat.title; $('pErr').textContent = ''; $('pLinks').innerHTML = '';
  $('pBar').style.width = '0';
  const st = { polls: 0, files: 0, photos: 0, texts: 0 };
  const show = () => { $('nPolls').textContent = st.polls; $('nFiles').textContent = st.files; $('nPhotos').textContent = st.photos; $('nTexts').textContent = st.texts; };
  show();

  const folder = `TestGram/${safeName(chat.title)}_${stamp()}`;
  const zip = NATIVE ? null : new JSZip();
  const put = async (rel, buf) => NATIVE ? writeNative(`${folder}/${rel}`, buf) : zip.file(rel, buf);
  const download = async (c, m) => {
    for (let i = 0; i < 3; i++) {
      try { return await c.downloadMedia(m, {}); }
      catch (e) { if (e.seconds) await new Promise(r => setTimeout(r, (e.seconds + 1) * 1000)); else return null; }
    }
    return null;
  };

  try {
    await ensurePerm();
    const c = await getClient();
    const total0 = (await c.getMessages(ent, { limit: 1, search: keyword })).total || 0;
    const total = limit ? Math.min(limit, total0) : total0;
    const polls = [], texts = [];
    let done = 0;
    for await (const m of c.iterMessages(ent, { limit, reverse: !limit, search: keyword })) {
      done++;
      if (done % 5 === 0 || done === total) {
        $('pBar').style.width = (total ? Math.min(100, Math.round(done * 100 / total)) : 0) + '%';
        $('pSub').textContent = `${done} / ${total} xabar ko'rib chiqildi`;
      }
      if (isService(m)) continue;
      const md = mediaOf(m), date = fmtDate(m.date);
      if (md?.type === 'poll') {
        if (types.has('polls')) { polls.push({ ...md, id: m.id, date }); st.polls++; show(); }
        continue;
      }
      if (md?.type === 'doc' && types.has('files')) {
        const ext = (md.name.split('.').pop() || '').toLowerCase();
        if (!exts.size || exts.has(ext)) {
          const buf = await download(c, m);
          if (buf) { await put(`fayllar/${m.id}_${safeName(md.name)}`, buf); st.files++; show(); }
        }
      } else if (md?.type === 'photo' && types.has('photos')) {
        const buf = await download(c, m);
        if (buf) { await put(`rasmlar/${m.id}.jpg`, buf); st.photos++; show(); }
      }
      if (types.has('texts') && m.message) {
        texts.push({ id: m.id, date, sender: sender(m), text: m.message }); st.texts++; show();
      }
    }
    polls.sort((a, b) => a.id - b.id); texts.sort((a, b) => a.id - b.id);
    const json = new TextEncoder().encode(JSON.stringify(polls, null, 2));
    await put('testlar.json', json);
    if (polls.length || texts.length) {
      const xl = new Uint8Array(buildExcel(polls, texts));
      await put('testlar.xlsx', xl);
      lastExcel = { name: `${safeName(chat.title)}_testlar.xlsx`, data: xl };
    }
    if (zip) {
      $('pSub').textContent = 'ZIP arxiv tayyorlanmoqda…';
      lastZip = { name: `${safeName(chat.title)}_${stamp()}.zip`, data: await zip.generateAsync({ type: 'blob' }) };
    }
    $('pBar').style.width = '100%';
    $('pTitle').textContent = '✅ Tayyor';
    $('pSub').innerHTML = NATIVE
      ? `Saqlandi: <div class="path">${esc(dirLabel())} / ${esc(folder)}</div>`
      : 'Yuklab olish uchun tugmani bosing';
    $('pLinks').innerHTML =
      (lastExcel ? `<a class="btn" href="#" onclick="shareExcel();return false">📊 Excel'ni ochish / yuborish</a>` : '') +
      (lastZip ? `<a class="btn ${lastExcel ? 'ghost' : ''}" href="#" onclick="shareZip();return false">🗂 Hammasi (ZIP)</a>` : '') +
      `<a class="btn ghost" href="#" onclick="closeModal();return false">Yopish</a>`;
  } catch (e) {
    $('pTitle').textContent = 'Xatolik'; $('pErr').textContent = errText(e);
    $('pLinks').innerHTML = '<a class="btn ghost" href="#" onclick="closeModal();return false">Yopish</a>';
  } finally {
    window.busy = false;
  }
};

/* ================= Android "orqaga" tugmasi ================= */
if (NATIVE) {
  App.addListener('backButton', () => {
    if (!$('modal').classList.contains('hidden')) { if (!window.busy) window.closeModal(); return; }
    if ($('app').classList.contains('open')) return closeChat();
    App.minimizeApp();
  });
}

init();
