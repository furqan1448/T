/* ===== منصة التواصل الموحد — جمعية فرقان =====
   كل الرسائل في مكان واحد: البريد الإلكتروني (يُسحب تلقائياً كل ٥ دقائق) وواتساب (عبر Webhook من WhatsApp Cloud API،
   أو تُسجَّل يدوياً)، مع حالة كل محادثة (بانتظار الرد / قيد المتابعة / تم الرد / مغلقة) ومن ردّت ومتى.
   الدخول لكل الموظفات بأسمائهن من ورقة «المستخدمات»، وكل شيء محفوظ في هذا الشيت فقط.

   أول مرة: شغّلي الدالة setup مرة واحدة من المحرر (تُنشئ الأوراق والمؤقت وتطلب الأذونات).
   الإعدادات (Project Settings ← Script properties) — اختيارية:
     ORG_NAME        اسم الجهة في توقيع ردود البريد (افتراضي: جمعية فرقان لتحفيظ القرآن الكريم)
     SYNC_DAYS       عدد أيام البريد التي تُسحب في كل مرة (افتراضي 3)
     WA_VERIFY       كلمة سرية تختارينها لربط Webhook واتساب (تُكتب في رابط Webhook وفي Verify token)
     WA_TOKEN        Access token من Meta (للرد على واتساب من الموقع مباشرة)
     WA_PHONE_ID     Phone number ID من Meta                                                     */

const SH = { USERS: 'المستخدمات', CONV: 'المحادثات', MSG: 'الرسائل' };
const USER_H = ['الاسم', 'اسم المستخدم', 'كلمة المرور', 'الصلاحية', 'الحالة'];
const CONV_H = ['المعرف', 'القناة', 'الجهة', 'الاسم', 'الموضوع', 'آخر رسالة', 'وقت آخر رسالة', 'الحالة', 'المسؤولة',
  'آخر رد بواسطة', 'وقت آخر رد', 'المعرف الخارجي', 'ملاحظات داخلية', 'وقت آخر وارد', 'وقت الإنشاء'];
const MSG_H = ['المعرف', 'معرف المحادثة', 'الاتجاه', 'النص', 'الوقت', 'بواسطة', 'المعرف الخارجي', 'القناة'];
const ST = { WAIT: 'بانتظار الرد', FOLLOW: 'قيد المتابعة', DONE: 'تم الرد', CLOSED: 'مغلقة' };
const CH = { MAIL: 'بريد', WA: 'واتساب', OTHER: 'أخرى' };
const ROLE_ADMIN = 'مديرة';
const TZ = 'Asia/Riyadh';
const MAX_FAILS = 5, LOCK_MIN = 15;

/* ============ التهيئة ============ */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SH.USERS, USER_H], [SH.CONV, CONV_H], [SH.MSG, MSG_H]].forEach(([n, h]) => {
    let sh = ss.getSheetByName(n);
    if (!sh) sh = ss.insertSheet(n);
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, h.length).setValues([h]);
    sh.getRange(1, 1, 1, h.length).setFontWeight('bold').setBackground('#7a1f2b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.setRightToLeft(true);
  });
  const us = ss.getSheetByName(SH.USERS);
  if (us.getLastRow() < 2) us.appendRow(['المديرة', 'admin', '1234', ROLE_ADMIN, 'فعّال']);
  // مؤقت سحب البريد كل ٥ دقائق
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncEmail').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncEmail').timeBased().everyMinutes(5).create();
  syncEmail();
  Logger.log('تمت التهيئة. الحساب الأول: admin / 1234 — غيّري كلمة المرور من ورقة «المستخدمات». البريد المرتبط: ' + Session.getEffectiveUser().getEmail());
}

/* ============ أدوات ============ */
const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();
const sh_ = n => ss_().getSheetByName(n);
const now_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
const fmt_ = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k) || '';
const s_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 500);
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const uid_ = () => Utilities.getUuid().slice(0, 13);
function withLock_(fn) {
  const l = LockService.getScriptLock();
  l.waitLock(25000);
  try { return fn(); } finally { l.releaseLock(); }
}
function rows_(name, H) {
  const sh = sh_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, H.length).getDisplayValues().map((r, i) => ({ r, row: i + 2 })).filter(x => x.r[0]);
}
// الجوال بصيغة دولية بلا رموز (9665xxxxxxxx)
function phone_(v) {
  let d = String(v || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = '966' + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = '966' + d;
  return d;
}

/* ============ المحادثات والرسائل ============ */
const convOf_ = x => ({ id: x.r[0], channel: x.r[1], contact: x.r[2], name: x.r[3], subject: x.r[4], last: x.r[5], lastAt: x.r[6],
  status: x.r[7], owner: x.r[8], repliedBy: x.r[9], repliedAt: x.r[10], ext: x.r[11], notes: x.r[12], lastInAt: x.r[13], createdAt: x.r[14], row: x.row });
const convs_ = () => rows_(SH.CONV, CONV_H).map(convOf_);
function convSet_(c, patch) {
  const sh = sh_(SH.CONV);
  Object.assign(c, patch);
  const vals = [c.id, c.channel, c.contact, c.name, c.subject, c.last, c.lastAt, c.status, c.owner, c.repliedBy, c.repliedAt, c.ext, c.notes, c.lastInAt, c.createdAt];
  if (!c.row) c.row = sh.getLastRow() + 1;
  sh.getRange(c.row, 1, 1, vals.length).setNumberFormat('@').setValues([vals.map(v => String(v == null ? '' : v))]);
  return c;
}
function newConv_(channel, contact, name, subject, ext) {
  const t = now_();
  return convSet_({ id: uid_(), channel, contact, name: name || '', subject: subject || '', last: '', lastAt: '', status: ST.WAIT, owner: '',
    repliedBy: '', repliedAt: '', ext: ext || '', notes: '', lastInAt: '', createdAt: t }, {});
}
function addMsg_(convId, dir, text, at, by, ext, channel) {
  const sh = sh_(SH.MSG);
  sh.getRange(sh.getLastRow() + 1, 1, 1, MSG_H.length).setNumberFormat('@')
    .setValues([[uid_(), convId, dir, s_(text, 6000), at, by || '', ext || '', channel]]);
}
const msgsOf_ = id => rows_(SH.MSG, MSG_H).filter(x => x.r[1] === id)
  .map(x => ({ id: x.r[0], dir: x.r[2], text: x.r[3], at: x.r[4], by: x.r[5], ext: x.r[6], channel: x.r[7] }))
  .sort((a, b) => a.at.localeCompare(b.at));
const knownExt_ = () => new Set(rows_(SH.MSG, MSG_H).map(x => x.r[6]).filter(Boolean));

// رسالة واردة: تُضاف للمحادثة (أو تُنشأ) وتصبح «بانتظار الرد»
function incoming_(c, text, at, ext, channel) {
  addMsg_(c.id, 'وارد', text, at, c.name || c.contact, ext, channel);
  const later = !c.lastAt || at >= c.lastAt;
  convSet_(c, Object.assign({ lastInAt: at > (c.lastInAt || '') ? at : c.lastInAt },
    later ? { last: s_(text, 300), lastAt: at } : {},
    (later || c.status === ST.CLOSED) && at > (c.repliedAt || '') ? { status: ST.WAIT } : {}));
}
// رد صادر: يُسجَّل ويصبح «تم الرد»
function outgoing_(c, text, at, by, ext, channel) {
  addMsg_(c.id, 'صادر', text, at, by, ext, channel);
  const patch = { repliedBy: by, repliedAt: at };
  if (!c.lastAt || at >= c.lastAt) Object.assign(patch, { last: s_(text, 300), lastAt: at });
  if (at >= (c.lastInAt || '')) patch.status = ST.DONE;
  convSet_(c, patch);
}

/* ============ البريد الإلكتروني (Gmail الحساب المالك للسكربت) ============ */
const emailOf_ = from => { const m = String(from || '').match(/<([^>]+)>/); return (m ? m[1] : String(from || '')).trim().toLowerCase(); };
const nameOf_ = from => String(from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim();
// حذف النص المقتبس من الرسائل السابقة
function cleanBody_(t) {
  const L = String(t || '').replace(/\r/g, '').split('\n'), out = [];
  for (const line of L) {
    if (/^(On .+wrote:|في .+كتب|-----Original Message|من: |From: |________________)/.test(line.trim())) break;
    if (/^>/.test(line.trim())) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function syncEmail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { added: 0 };
  let added = 0;
  try {
    const me = Session.getEffectiveUser().getEmail().toLowerCase();
    const mine = new Set([me].concat(GmailApp.getAliases().map(a => a.toLowerCase())));
    const days = Math.max(1, Math.min(30, parseInt(prop_('SYNC_DAYS') || '3', 10) || 3));
    const threads = GmailApp.search('in:inbox newer_than:' + days + 'd -category:promotions -category:social', 0, 60);
    if (!threads.length) return { added: 0 };
    const known = knownExt_();
    const all = convs_(), byExt = {};
    all.forEach(c => { if (c.channel === CH.MAIL && c.ext) byExt[c.ext] = c; });
    const pendingOut = rows_(SH.MSG, MSG_H).filter(x => x.r[2] === 'صادر' && !x.r[6] && x.r[7] === CH.MAIL);
    threads.forEach(th => {
      const tid = 'gt:' + th.getId();
      th.getMessages().forEach(m => {
        const ext = 'gm:' + m.getId();
        if (known.has(ext)) return;
        const from = emailOf_(m.getFrom()), at = fmt_(m.getDate());
        if (mine.has(from)) {   // رد أُرسل من البريد مباشرة (أو من الموقع)
          const c = byExt[tid]; if (!c) return;
          const body = cleanBody_(m.getPlainBody());
          const p = pendingOut.find(x => x.r[1] === c.id && body.indexOf(String(x.r[3]).slice(0, 40)) > -1);
          if (p) { sh_(SH.MSG).getRange(p.row, 7).setValue(ext); known.add(ext); return; }   // رد من الموقع: يُربط فقط
          outgoing_(c, body, at, 'من البريد مباشرة', ext, CH.MAIL);
          known.add(ext); added++;
          return;
        }
        let c = byExt[tid];
        if (!c) { c = newConv_(CH.MAIL, from, nameOf_(m.getFrom()), m.getSubject(), tid); byExt[tid] = c; }
        incoming_(c, cleanBody_(m.getPlainBody()) || '(رسالة بلا نص — قد تحتوي مرفقات)', at, ext, CH.MAIL);
        known.add(ext); added++;
      });
    });
  } finally { lock.releaseLock(); }
  return { added };
}
function replyEmail_(c, text, user) {
  const th = GmailApp.getThreadById(String(c.ext).replace(/^gt:/, ''));
  if (!th) throw new Error('تعذّر العثور على الرسالة في البريد');
  const org = prop_('ORG_NAME') || 'جمعية فرقان لتحفيظ القرآن الكريم';
  const msgs = th.getMessages();
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const lastIn = msgs.slice().reverse().find(m => emailOf_(m.getFrom()) !== me) || msgs[msgs.length - 1];
  lastIn.reply(text + '\n\n' + org, { name: org });
  outgoing_(c, text, now_(), user.name, '', CH.MAIL);
}

/* ============ واتساب (WhatsApp Cloud API) ============ */
function waText_(m) {
  if (!m) return '';
  if (m.text && m.text.body) return m.text.body;
  const cap = k => (m[k] && m[k].caption) ? ' ' + m[k].caption : '';
  const t = { image: '[صورة]' + cap('image'), video: '[فيديو]' + cap('video'), audio: '[رسالة صوتية]', voice: '[رسالة صوتية]',
    document: '[ملف' + (m.document && m.document.filename ? ': ' + m.document.filename : '') + ']' + cap('document'),
    sticker: '[ملصق]', location: '[موقع]', contacts: '[جهة اتصال]' }[m.type];
  if (t) return t;
  if (m.button && m.button.text) return m.button.text;
  if (m.interactive) { const i = m.interactive; return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '[رد تفاعلي]'; }
  return '[' + (m.type || 'رسالة') + ']';
}
const waTs_ = t => t ? fmt_(new Date(Number(t) * 1000)) : now_();
function waConv_(phone, name, all) {
  let c = all.find(x => x.channel === CH.WA && x.contact === phone);
  if (!c) { c = newConv_(CH.WA, phone, name, '', ''); all.push(c); }
  else if (name && !c.name) convSet_(c, { name });
  return c;
}
function waWebhook_(body) {
  withLock_(() => {
    const known = knownExt_(), all = convs_();
    (body.entry || []).forEach(en => (en.changes || []).forEach(ch => {
      const v = ch.value || {};
      const names = {};
      (v.contacts || []).forEach(c => { names[c.wa_id] = (c.profile && c.profile.name) || ''; });
      (v.messages || []).forEach(m => {
        const ext = 'wa:' + m.id; if (known.has(ext)) return;
        const p = phone_(m.from);
        incoming_(waConv_(p, names[m.from] || '', all), waText_(m), waTs_(m.timestamp), ext, CH.WA);
        known.add(ext);
      });
      // رسائل أُرسلت من تطبيق واتساب للأعمال على الجوال (Coexistence): تُسجَّل رداً
      (v.message_echoes || []).forEach(m => {
        const ext = 'wa:' + m.id; if (known.has(ext)) return;
        const p = phone_(m.to);
        outgoing_(waConv_(p, '', all), waText_(m), waTs_(m.timestamp), 'من تطبيق واتساب', ext, CH.WA);
        known.add(ext);
      });
    }));
  });
}
const waApiReady_ = () => !!(prop_('WA_TOKEN') && prop_('WA_PHONE_ID'));
function waWithin24_(c) {
  if (!c.lastInAt) return false;
  const t = new Date(c.lastInAt.replace(' ', 'T') + '+03:00').getTime();
  return Date.now() - t < 24 * 3600 * 1000 - 60000;
}
function waSend_(c, text, user) {
  const res = UrlFetchApp.fetch('https://graph.facebook.com/v21.0/' + prop_('WA_PHONE_ID') + '/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + prop_('WA_TOKEN') },
    payload: JSON.stringify({ messaging_product: 'whatsapp', to: c.contact, type: 'text', text: { body: text } })
  });
  const out = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !out.messages) throw new Error('تعذّر الإرسال عبر واتساب: ' + ((out.error && out.error.message) || res.getResponseCode()));
  outgoing_(c, text, now_(), user.name, 'wa:' + out.messages[0].id, CH.WA);
}

/* ============ الدخول ============ */
function auth_(r) {
  const u = s_(r.username, 80).toLowerCase(), p = s_(r.password, 80);
  if (!u || !p) throw Object.assign(new Error('أدخلي اسم المستخدم وكلمة المرور'), { auth: true });
  const cache = CacheService.getScriptCache(), key = 'f_' + u;
  const fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) throw Object.assign(new Error('تم إيقاف المحاولات مؤقتاً، حاولي بعد ' + LOCK_MIN + ' دقيقة'), { auth: true });
  const x = rows_(SH.USERS, USER_H).find(x => String(x.r[1]).trim().toLowerCase() === u);
  if (!x || String(x.r[2]).trim() !== p) { cache.put(key, String(fails + 1), LOCK_MIN * 60); throw Object.assign(new Error('اسم المستخدم أو كلمة المرور غير صحيحة'), { auth: true }); }
  if (String(x.r[4]).trim() === 'موقوف') throw Object.assign(new Error('هذا الحساب موقوف'), { auth: true });
  if (fails) cache.remove(key);
  return { name: String(x.r[0]).trim() || u, username: u, role: String(x.r[3]).trim() === ROLE_ADMIN ? ROLE_ADMIN : 'موظفة', row: x.row };
}
const usersPublic_ = () => rows_(SH.USERS, USER_H).filter(x => String(x.r[4]).trim() !== 'موقوف').map(x => String(x.r[0]).trim()).filter(Boolean);

/* ============ نقاط الدخول ============ */
function doGet(e) {
  const p = (e && e.parameter) || {};
  // التحقق من Webhook واتساب (Meta)
  if (p['hub.mode'] === 'subscribe') {
    const ok = prop_('WA_VERIFY') && p['hub.verify_token'] === prop_('WA_VERIFY');
    return ContentService.createTextOutput(ok ? String(p['hub.challenge'] || '') : 'forbidden');
  }
  return ContentService.createTextOutput('منصة التواصل الموحد تعمل');
}
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'طلب غير صالح' }); }
  if (body.object === 'whatsapp_business_account') {   // رسائل واتساب الواردة
    const key = prop_('WA_VERIFY');
    if (key && (e.parameter || {}).wa === key) { try { waWebhook_(body); } catch (err) { console.error(err); } }
    return ContentService.createTextOutput('ok');
  }
  try { return json_(route_(body)); }
  catch (err) { return json_({ ok: false, error: String(err && err.message ? err.message : err), auth: !!(err && err.auth) }); }
}

function route_(r) {
  const user = auth_(r);
  const conv = () => { const c = convs_().find(x => x.id === s_(r.id, 40)); if (!c) throw new Error('المحادثة غير موجودة'); return c; };
  switch (r.action) {
    case 'login': return { ok: true, user: { name: user.name, username: user.username, role: user.role } };
    case 'list': {
      const L = convs_().map(c => { const o = Object.assign({}, c); delete o.row; delete o.ext; delete o.notes; o.hasNotes = !!c.notes; return o; });
      return { ok: true, data: L, users: usersPublic_(), me: user.name,
        channels: { mail: Session.getEffectiveUser().getEmail(), waHook: !!prop_('WA_VERIFY'), waApi: waApiReady_() } };
    }
    case 'conv': {
      const c = conv(), o = Object.assign({}, c); delete o.row; delete o.ext;
      o.waApi = c.channel === CH.WA && waApiReady_() && waWithin24_(c);
      return { ok: true, data: o, messages: msgsOf_(c.id) };
    }
    case 'reply': return withLock_(() => {
      const c = conv(), text = s_(r.text, 5000);
      if (!text) throw new Error('اكتبي نص الرد');
      if (c.channel === CH.MAIL) { replyEmail_(c, text, user); return { ok: true, sent: 'mail' }; }
      if (c.channel === CH.WA && waApiReady_() && waWithin24_(c)) { waSend_(c, text, user); return { ok: true, sent: 'wa' }; }
      return { ok: false, error: 'لا يمكن الإرسال من الموقع لهذه المحادثة، استخدمي «فتح واتساب» ثم «تسجيل أنه تم الرد»' };
    });
    case 'markReplied': return withLock_(() => {   // رُدّ عليها خارج الموقع (واتساب، اتصال...)
      const c = conv();
      outgoing_(c, s_(r.text, 5000) || '(تم الرد خارج الموقع)', now_(), user.name, '', c.channel);
      return { ok: true };
    });
    case 'status': return withLock_(() => {
      const c = conv(), st = s_(r.status, 30);
      if ([ST.WAIT, ST.FOLLOW, ST.DONE, ST.CLOSED].indexOf(st) < 0) throw new Error('حالة غير معروفة');
      convSet_(c, { status: st }); return { ok: true };
    });
    case 'assign': return withLock_(() => {
      const c = conv(), to = s_(r.to, 80);
      if (to && usersPublic_().indexOf(to) < 0) throw new Error('الاسم غير موجود في المستخدمات');
      convSet_(c, { owner: to }); return { ok: true };
    });
    case 'note': return withLock_(() => {
      const c = conv(), t = s_(r.text, 1000);
      if (!t) throw new Error('اكتبي الملاحظة');
      const line = '[' + now_().slice(0, 16) + '] ' + user.name + ': ' + t.replace(/\n/g, ' ');
      convSet_(c, { notes: (c.notes ? c.notes + '\n' : '') + line }); return { ok: true, notes: c.notes };
    });
    case 'rename': return withLock_(() => { const c = conv(); convSet_(c, { name: s_(r.name, 120) }); return { ok: true }; });
    case 'addManual': return withLock_(() => {   // تسجيل رسالة وصلت بطريقة أخرى (واتساب على جوال آخر، اتصال، حضور...)
      const channel = [CH.WA, CH.MAIL, CH.OTHER].indexOf(r.channel) > -1 ? r.channel : CH.OTHER;
      let contact = s_(r.contact, 120);
      if (channel === CH.WA) contact = phone_(contact);
      if (channel === CH.MAIL) contact = contact.toLowerCase();
      const text = s_(r.text, 5000);
      if (!contact) throw new Error(channel === CH.WA ? 'اكتبي رقم الجوال' : channel === CH.MAIL ? 'اكتبي البريد الإلكتروني' : 'اكتبي الجهة (اسم أو رقم)');
      if (!text) throw new Error('اكتبي نص الرسالة');
      const all = convs_();
      let c = all.find(x => x.channel === channel && x.contact === contact && x.status !== ST.CLOSED) || all.find(x => x.channel === channel && x.contact === contact);
      if (!c) c = newConv_(channel, contact, s_(r.name, 120), s_(r.subject, 200), '');
      else if (r.name && !c.name) convSet_(c, { name: s_(r.name, 120) });
      incoming_(c, text, now_(), 'man:' + uid_(), channel);
      return { ok: true, id: c.id };
    });
    case 'syncNow': return { ok: true, added: syncEmail().added };
    case 'users': {
      if (user.role !== ROLE_ADMIN) throw new Error('هذه الصفحة للمديرة فقط');
      return { ok: true, data: rows_(SH.USERS, USER_H).map(x => ({ name: x.r[0], username: x.r[1], role: x.r[3], state: x.r[4] || 'فعّال', row: x.row })) };
    }
    case 'saveUser': return withLock_(() => {
      if (user.role !== ROLE_ADMIN) throw new Error('هذه الصفحة للمديرة فقط');
      const name = s_(r.name, 80), un = s_(r.uUsername, 80).toLowerCase(), pw = s_(r.uPassword, 80);   // بيانات المستخدمة المُعدَّلة (منفصلة عن بيانات الدخول)
      const role = r.role === ROLE_ADMIN ? ROLE_ADMIN : 'موظفة', state = r.state === 'موقوف' ? 'موقوف' : 'فعّال';
      if (!name || !un) throw new Error('اكتبي الاسم واسم المستخدم');
      const sh = sh_(SH.USERS), L = rows_(SH.USERS, USER_H);
      const ex = L.find(x => String(x.r[1]).trim().toLowerCase() === un);
      if (ex) {
        if (ex.row === user.row && (state === 'موقوف' || role !== ROLE_ADMIN)) throw new Error('لا يمكنكِ إيقاف حسابكِ أو إزالة صلاحيتكِ');
        sh.getRange(ex.row, 1, 1, 5).setNumberFormat('@').setValues([[name, un, pw || ex.r[2], role, state]]);
      } else {
        if (!pw) throw new Error('اكتبي كلمة المرور للمستخدمة الجديدة');
        sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setNumberFormat('@').setValues([[name, un, pw, role, state]]);
      }
      return { ok: true };
    });
    default: throw new Error('إجراء غير معروف');
  }
}
