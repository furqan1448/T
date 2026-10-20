/* ===== منصة التواصل الموحد — الواجهة ===== */
const $ = id => document.getElementById(id);
const U_KEY = 'tw_user', P_KEY = 'tw_pw', C_KEY = 'tw_cache';
const ST = { WAIT: 'بانتظار الرد', FOLLOW: 'قيد المتابعة', DONE: 'تم الرد', CLOSED: 'مغلقة' };
const ST_CLS = { 'بانتظار الرد': 'wait', 'قيد المتابعة': 'follow', 'تم الرد': 'done', 'مغلقة': 'closed' };
let CONVS = [], USERS = [], ME = '', ROLE = '', CHANNELS = {}, CUR = null, CUR_MSGS = [], fSt = ST.WAIT, timer = null;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ok = true) {
  const el = $('toast'); el.textContent = msg; el.className = 'show' + (ok ? '' : ' err');
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 3200);
}
function busy(btn, on, txt) {
  if (!btn) return;
  if (on) { btn.dataset.t = btn.innerHTML; btn.disabled = true; btn.innerHTML = txt || '...'; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.t || btn.innerHTML; }
}
async function api(action, data) {
  const body = JSON.stringify(Object.assign({ action, username: localStorage.getItem(U_KEY) || '', password: localStorage.getItem(P_KEY) || '' }, data || {}));
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, signal: ctrl.signal });
      clearTimeout(t);
      const out = await res.json();
      if (!out.ok) throw Object.assign(new Error(out.error || 'حدث خطأ'), { final: true, auth: !!out.auth });
      return out;
    } catch (e) { clearTimeout(t); if (e.final) throw e; }
  }
  throw new Error('تعذّر الاتصال بالخادم، تأكدي من الإنترنت ورابط النشر في config.js');
}

/* ---------- الوقت ---------- */
const toDate = s => s ? new Date(String(s).replace(' ', 'T') + '+03:00') : null;
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
function ago(s) {
  const d = toDate(s); if (!d || isNaN(d)) return '';
  const min = Math.floor((Date.now() - d) / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return 'منذ ' + AR(min) + ' د';
  if (min < 24 * 60) return 'منذ ' + AR(Math.floor(min / 60)) + ' س';
  if (min < 7 * 24 * 60) return 'منذ ' + AR(Math.floor(min / 1440)) + ' يوم';
  return AR(s.slice(0, 10));
}
const full = s => s ? AR(s.slice(0, 16).replace(' ', ' — ')) : '';
const hoursSince = s => { const d = toDate(s); return d ? (Date.now() - d) / 3600000 : 0; };
const showContact = c => c.channel === 'واتساب' && /^9665\d{8}$/.test(c.contact) ? '0' + c.contact.slice(3) : c.contact;

/* ---------- الدخول ---------- */
async function login() {
  const u = $('un').value.trim(), p = $('pw').value.trim();
  if (!u || !p) return toast('أدخلي اسم المستخدم وكلمة المرور', false);
  localStorage.setItem(U_KEY, u); localStorage.setItem(P_KEY, p);
  const btn = $('loginBtn'); busy(btn, true, 'جارِ التحقق...');
  try { const o = await api('login'); enter(o.user); }
  catch (e) { localStorage.removeItem(P_KEY); toast(e.message, false); }
  finally { busy(btn, false); }
}
['un', 'pw'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') login(); }));
function enter(user) {
  ME = user.name; ROLE = user.role;
  $('meName').textContent = user.name; $('tbUser').classList.remove('hidden');
  $('usersBtn').classList.toggle('hidden', ROLE !== 'مديرة');
  $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
  try { const c = JSON.parse(localStorage.getItem(C_KEY) || 'null'); if (c) { CONVS = c.d || []; USERS = c.u || []; renderAll(); } } catch (e) {}
  loadList();
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden) { loadList(true); if (CUR && !$('replyIn').value.trim()) openConv(CUR.id, true); } }, 60000);
}
function logout() {
  [P_KEY, C_KEY].forEach(k => localStorage.removeItem(k));
  clearInterval(timer); CUR = null;
  $('appView').classList.add('hidden'); $('tbUser').classList.add('hidden'); $('loginView').classList.remove('hidden'); $('pw').value = '';
}

/* ---------- القائمة ---------- */
async function loadList(silent) {
  try {
    const o = await api('list');
    CONVS = o.data || []; USERS = o.users || []; CHANNELS = o.channels || {};
    try { localStorage.setItem(C_KEY, JSON.stringify({ d: CONVS, u: USERS })); } catch (e) {}
    renderAll();
  } catch (e) { if (e.auth) { toast(e.message, false); logout(); } else if (!silent) toast(e.message, false); }
}
function renderAll() {
  const cnt = s => CONVS.filter(c => c.status === s).length;
  $('stats').innerHTML = [[ST.WAIT, 'wait'], [ST.FOLLOW, 'follow'], [ST.DONE, 'done'], [ST.CLOSED, 'closed']].map(([s, k]) =>
    '<div class="stat ' + k + (fSt === s ? ' on' : '') + '" onclick="setFilter(\'' + s + '\')"><b>' + AR(cnt(s)) + '</b><span>' + s + '</span></div>').join('');
  const cur = $('fOwner').value;
  $('fOwner').innerHTML = '<option value="">كل المسؤولات</option><option value="__me">المسندة لي</option><option value="__none">غير مسندة</option>' + USERS.map(u => '<option>' + esc(u) + '</option>').join('');
  $('fOwner').value = cur;
  renderList();
  const ch = [CHANNELS.mail ? 'البريد: ' + CHANNELS.mail : '', CHANNELS.waHook ? 'واتساب: مربوط' : 'واتساب: يُسجَّل يدوياً'].filter(Boolean);
  $('foot').textContent = ch.join(' — ');
}
function setFilter(s) { fSt = fSt === s ? '' : s; renderAll(); }
function renderList() {
  const q = $('q').value.trim().toLowerCase(), ch = $('fCh').value, ow = $('fOwner').value;
  let L = CONVS.filter(c => (!fSt || c.status === fSt) && (!ch || c.channel === ch) &&
    (!ow || (ow === '__me' ? c.owner === ME : ow === '__none' ? !c.owner : c.owner === ow)) &&
    (!q || [c.name, c.contact, showContact(c), c.subject, c.last].join(' ').toLowerCase().indexOf(q) > -1));
  // بانتظار الرد: الأقدم أولاً (حتى لا تُنسى)، وغيرها: الأحدث أولاً
  const rank = { 'بانتظار الرد': 0, 'قيد المتابعة': 1, 'تم الرد': 2, 'مغلقة': 3 };
  L.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.status === ST.WAIT ? String(a.lastInAt || a.lastAt).localeCompare(String(b.lastInAt || b.lastAt)) : String(b.lastAt).localeCompare(String(a.lastAt))));
  if (!L.length) { $('list').innerHTML = '<p class="empty">' + (CONVS.length ? 'لا توجد محادثات بهذا التصفية' : 'لا توجد رسائل بعد') + '</p>'; return; }
  $('list').innerHTML = L.map(c => {
    const late = c.status === ST.WAIT && hoursSince(c.lastInAt || c.lastAt) >= 24;
    return '<button class="it' + (CUR && CUR.id === c.id ? ' sel' : '') + '" onclick="openConv(\'' + esc(c.id) + '\')">' +
      '<div class="it-top"><span class="ch-badge c-' + esc(c.channel) + '">' + esc(c.channel) + '</span><span class="it-name">' + esc(c.name || showContact(c)) + '</span><span class="it-time">' + ago(c.lastAt) + '</span></div>' +
      '<div class="it-last">' + (c.subject ? '<b>' + esc(c.subject) + '</b> — ' : '') + esc(c.last) + '</div>' +
      '<div class="it-tags"><span class="tag ' + ST_CLS[c.status] + '">' + esc(c.status) + '</span>' +
        (late ? '<span class="tag late">متأخرة أكثر من يوم</span>' : '') +
        (c.owner ? '<span class="tag">👤 ' + esc(c.owner) + '</span>' : '') +
        (c.repliedBy && c.status !== ST.WAIT ? '<span class="tag">ردّت: ' + esc(c.repliedBy) + '</span>' : '') +
        (c.hasNotes ? '<span class="tag">📝 ملاحظات</span>' : '') + '</div></button>';
  }).join('');
}

/* ---------- المحادثة ---------- */
async function openConv(id, silent) {
  const c = CONVS.find(x => x.id === id);
  if (!silent) {
    CUR = c || { id }; renderList();
    $('convEmpty').classList.add('hidden'); $('convBox').classList.remove('hidden'); $('appView').classList.add('open');
    if (c) fillHead(c);
    $('msgs').innerHTML = '<p class="empty">جارِ التحميل...</p>';
    $('replyIn').value = ''; $('notesBox').open = false;
  }
  try {
    const o = await api('conv', { id });
    if (!CUR || CUR.id !== id) return;
    CUR = o.data; CUR_MSGS = o.messages || [];
    fillHead(CUR); renderMsgs(); renderReply(); renderNotes();
  } catch (e) { if (!silent) toast(e.message, false); }
}
function closeConv() { CUR = null; $('appView').classList.remove('open'); $('convBox').classList.add('hidden'); $('convEmpty').classList.remove('hidden'); renderList(); }
function fillHead(c) {
  $('cChannel').className = 'ch-badge c-' + c.channel; $('cChannel').textContent = c.channel;
  $('cName').textContent = c.name || showContact(c);
  $('cContact').textContent = showContact(c);
  $('cSubject').textContent = c.subject ? 'الموضوع: ' + c.subject : '';
  $('cStatus').value = c.status;
  $('cOwner').innerHTML = '<option value="">— بدون —</option>' + USERS.map(u => '<option>' + esc(u) + '</option>').join('') + (c.owner && USERS.indexOf(c.owner) < 0 ? '<option>' + esc(c.owner) + '</option>' : '');
  $('cOwner').value = c.owner || '';
  $('cReplied').innerHTML = c.repliedBy ? 'آخر رد: <b>' + esc(c.repliedBy) + '</b> — ' + full(c.repliedAt) : '<span style="color:var(--err)">لم يُرَد عليها بعد</span>';
}
function renderMsgs() {
  $('msgs').innerHTML = CUR_MSGS.length ? CUR_MSGS.map(m => '<div class="m ' + (m.dir === 'صادر' ? 'out' : 'in') + '">' + esc(m.text) +
    '<small>' + (m.dir === 'صادر' ? '↩ ' + esc(m.by) + ' — ' : '') + full(m.at) + '</small></div>').join('') : '<p class="empty">لا توجد رسائل</p>';
  $('msgs').scrollTop = $('msgs').scrollHeight;
}
function renderReply() {
  const c = CUR, a = $('replyActs'), h = $('replyHint');
  const done = '<button class="btn light" onclick="markReplied(this)">✔ تسجيل أنه تم الرد</button>';
  if (c.channel === 'بريد') {
    a.innerHTML = '<button class="btn" onclick="sendReply(this)">إرسال الرد بالبريد</button>' + done;
    h.textContent = 'يُرسَل الرد من بريد الجمعية إلى ' + c.contact + ' في نفس سلسلة الرسائل. «تسجيل أنه تم الرد» إن رددتِ بطريقة أخرى (اتصال مثلاً).';
  } else if (c.channel === 'واتساب') {
    a.innerHTML = (c.waApi ? '<button class="btn wa" onclick="sendReply(this)">إرسال عبر واتساب</button>' : '<button class="btn wa" onclick="openWa()">فتح واتساب بالرد</button>') + done;
    h.textContent = c.waApi ? 'يُرسَل الرد من رقم الجمعية مباشرة.'
      : 'يفتح واتساب بالرد جاهزاً، أرسليه ثم اضغطي «تسجيل أنه تم الرد» ليُحفظ الرد هنا ويعرف الفريق أنه تم.';
  } else {
    a.innerHTML = done;
    h.textContent = 'اكتبي ما تم (مثال: تم الاتصال بها وإفادتها)، ثم «تسجيل أنه تم الرد».';
  }
}
function renderNotes() {
  const L = String(CUR.notes || '').split('\n').filter(Boolean);
  $('notesCount').textContent = L.length ? '(' + AR(L.length) + ')' : '';
  $('notesList').innerHTML = L.map(x => '<div>' + esc(x) + '</div>').join('') || '<div style="color:var(--muted)">لا توجد ملاحظات</div>';
}
async function act(action, data, btn, okMsg) {
  busy(btn, true, '...');
  try { const o = await api(action, Object.assign({ id: CUR.id }, data)); if (okMsg) toast(okMsg); await openConv(CUR.id, true); loadList(true); return o; }
  catch (e) { toast(e.message, false); }
  finally { busy(btn, false); }
}
async function sendReply(btn) {
  const t = $('replyIn').value.trim(); if (!t) return toast('اكتبي نص الرد', false);
  const o = await act('reply', { text: t }, btn, 'تم إرسال الرد');
  if (o) $('replyIn').value = '';
}
async function markReplied(btn) {
  const o = await act('markReplied', { text: $('replyIn').value.trim() }, btn, 'تم تسجيل الرد');
  if (o) $('replyIn').value = '';
}
function openWa() {
  const t = $('replyIn').value.trim();
  window.open('https://wa.me/' + CUR.contact + (t ? '?text=' + encodeURIComponent(t) : ''), '_blank', 'noopener');
}
const setStatus = s => act('status', { status: s }, null, 'تم تغيير الحالة');
const assign = to => act('assign', { to }, null, to ? 'أُسندت إلى ' + to : 'أُلغي الإسناد');
async function addNote(btn) {
  const t = $('noteIn').value.trim(); if (!t) return;
  const o = await act('note', { text: t }, btn); if (o) $('noteIn').value = '';
}
function renameConv() { const n = prompt('اسم المرسل:', CUR.name || ''); if (n !== null) act('rename', { name: n.trim() }, null, 'تم الحفظ'); }

/* ---------- تحديث البريد الآن ---------- */
async function syncNow(btn) {
  busy(btn, true, 'جارِ السحب...');
  try { const o = await api('syncNow'); toast(o.added ? 'وصلت ' + AR(o.added) + ' رسالة جديدة' : 'لا توجد رسائل بريد جديدة'); await loadList(true); }
  catch (e) { toast(e.message, false); }
  finally { busy(btn, false); }
}

/* ---------- تسجيل رسالة يدوياً ---------- */
function openAdd() { ['aContact', 'aName', 'aSubject', 'aText'].forEach(id => $(id).value = ''); addChChanged(); $('addModal').classList.remove('hidden'); }
function addChChanged() {
  const c = $('aCh').value;
  $('aContactLbl').textContent = c === 'واتساب' ? 'رقم الجوال' : c === 'بريد' ? 'البريد الإلكتروني' : 'الجهة (اسم أو رقم)';
  $('aContact').inputMode = c === 'واتساب' ? 'tel' : c === 'بريد' ? 'email' : 'text';
}
async function saveManual(btn) {
  busy(btn, true, 'جارِ الحفظ...');
  try {
    const o = await api('addManual', { channel: $('aCh').value, contact: $('aContact').value, name: $('aName').value, subject: $('aSubject').value, text: $('aText').value });
    closeModal('addModal'); toast('تم تسجيل الرسالة'); await loadList(true); openConv(o.id);
  } catch (e) { toast(e.message, false); }
  finally { busy(btn, false); }
}
function closeModal(id) { $(id).classList.add('hidden'); }

/* ---------- المستخدمات (للمديرة) ---------- */
async function openUsers() {
  $('usersModal').classList.remove('hidden'); $('usersList').innerHTML = '<p class="empty">جارِ التحميل...</p>';
  try {
    const o = await api('users');
    $('usersList').innerHTML = o.data.map(u => '<div class="u-row"><span><b>' + esc(u.name) + '</b> — ' + esc(u.username) + ' <span class="tag">' + esc(u.role || 'موظفة') + '</span>' +
      (u.state === 'موقوف' ? ' <span class="tag wait">موقوف</span>' : '') + '</span><button class="lnk" onclick=\'editUser(' + JSON.stringify(u).replace(/'/g, '&#39;') + ')\'>تعديل</button></div>').join('');
  } catch (e) { $('usersList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; }
}
function editUser(u) { $('uName').value = u.name; $('uUser').value = u.username; $('uPass').value = ''; $('uRole').value = u.role === 'مديرة' ? 'مديرة' : 'موظفة'; $('uState').value = u.state === 'موقوف' ? 'موقوف' : 'فعّال'; }
async function saveUser(btn) {
  busy(btn, true, 'جارِ الحفظ...');
  try {
    await api('saveUser', { name: $('uName').value, uUsername: $('uUser').value, uPassword: $('uPass').value, role: $('uRole').value, state: $('uState').value });
    toast('تم الحفظ'); ['uName', 'uUser', 'uPass'].forEach(id => $(id).value = ''); openUsers(); loadList(true);
  } catch (e) { toast(e.message, false); }
  finally { busy(btn, false); }
}

/* ---------- استعادة الجلسة ---------- */
(function () {
  if (localStorage.getItem(U_KEY) && localStorage.getItem(P_KEY)) {
    $('un').value = localStorage.getItem(U_KEY);
    api('login').then(o => enter(o.user)).catch(e => { if (e.auth) localStorage.removeItem(P_KEY); toast(e.message, false); });
  } else if (localStorage.getItem(U_KEY)) $('un').value = localStorage.getItem(U_KEY);
})();
