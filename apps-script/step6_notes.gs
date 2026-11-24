var TXT_START = 'سلام 👋\nبه دستیار هرمس خوش آمدید.\nاگر کد عضویت دارید، همین‌جا بفرستید (مثل HRM-XXXX-XX).';
var TXT_OK = '✅ حساب شما ثبت شد.\nهر وقت پیام تازه‌ای برایتان داشتیم، همین‌جا خبرتان می‌کنیم.';
var TXT_BAD = '❌ این کد معتبر نیست یا قبلاً استفاده شده. لطفاً دوباره بررسی کنید.';
var TXT_WAIT = '⏳ تعداد تلاش‌ها زیاد بود. لطفاً یک ساعت دیگر دوباره امتحان کنید.';
var DOC_TITLE = 'یادداشت هرمس';
var DOC_EMPTY = 'یادداشت هرمس\n\nهنوز پیامی برای شما ثبت نشده است. این صفحه را نگه دارید؛ هر وقت در «بله» خبر دادیم، همین‌جا را باز کنید.';

var P = PropertiesService.getScriptProperties();

function setup() {
  if (!P.getProperty('SHEET_ID')) {
    var ss = SpreadsheetApp.create('Hermes Data');
    var sh = ss.getSheets()[0];
    sh.setName('codes');
    sh.appendRow(['hash', 'status', 'chat_id', 'created', 'linked_at', 'label']);
    sh.getRange('A:C').setNumberFormat('@');
    P.setProperty('SHEET_ID', ss.getId());
  }
  docsSheet_();
  if (!P.getProperty('FOLDER_ID')) P.setProperty('FOLDER_ID', DriveApp.createFolder('Hermes Notes').getId());
  if (!P.getProperty('PRIVATE_DOC')) {
    var d = DocumentApp.create('دفترچه‌ی خصوصی');
    d.getBody().setText('دفترچه‌ی خصوصی (فقط برای صاحب)\n');
    P.setProperty('PRIVATE_DOC', d.getId());
  }
  UrlFetchApp.fetch('https://tapi.bale.ai', {muteHttpExceptions: true});
  var missing = ['BALE_TOKEN', 'ADMIN_CHAT'].filter(function (k) { return !P.getProperty(k); });
  Logger.log('setup ok. Missing properties: ' + (missing.length ? missing.join(', ') : 'none'));
}

function ss_() { return SpreadsheetApp.openById(P.getProperty('SHEET_ID')); }
function sheet_() { return ss_().getSheetByName('codes'); }

function docsSheet_() {
  var ss = ss_(), sh = ss.getSheetByName('docs');
  if (!sh) {
    sh = ss.insertSheet('docs');
    sh.appendRow(['key', 'doc_id', 'status', 'created', 'updated']);
    sh.getRange('A:B').setNumberFormat('@');
  }
  return sh;
}

function hmac_(s) {
  var sig = Utilities.computeHmacSha256Signature(s, P.getProperty('ADMIN_KEY'));
  return sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function digits_(t) {
  return String(t).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); })
                  .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
}

function loose_(t) { return digits_(t).toUpperCase().replace(/[\s\-_.]/g, ''); }

function normCode_(t) {
  t = loose_(t);
  if (/^[A-Z0-9]{6}$/.test(t)) t = 'HRM' + t;
  return /^HRM[A-Z0-9]{6}$/.test(t) ? t : null;
}

function send_(chat, text) {
  return UrlFetchApp.fetch('https://tapi.bale.ai/bot' + P.getProperty('BALE_TOKEN') + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({chat_id: chat, text: text}), muteHttpExceptions: true
  }).getResponseCode();
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return ContentService.createTextOutput('ok'); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return json_({ok: false}); }
  if (body && body.admin_key !== undefined) return admin_(body);
  try { handleUpdate_(body); } catch (x) { console.error(x); }
  return ContentService.createTextOutput('ok');
}

// ---------- پیام‌های مشتری در بله ----------
function handleUpdate_(u) {
  var cache = CacheService.getScriptCache();
  if (u.update_id !== undefined) {
    if (cache.get('u' + u.update_id)) return;
    cache.put('u' + u.update_id, '1', 3600);
  }
  var m = u.message;
  if (!m || !m.text || !m.chat) return;
  var chat = String(m.chat.id), text = String(m.text).trim();
  var isAdmin = chat === String(P.getProperty('ADMIN_CHAT'));

  if (/^\/start/.test(text)) return send_(chat, TXT_START);
  if (isAdmin && /^\/status/.test(text)) return send_(chat, statusText_());

  var code = normCode_(text);
  var looksLike = /^[A-Z0-9]{5,12}$/.test(loose_(text));
  if (!code && !looksLike) return send_(chat, TXT_START);

  var tries = Number(cache.get('t' + chat) || 0);
  if (tries >= 5) return send_(chat, TXT_WAIT);

  if (code) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sh = sheet_(), h = hmac_(code);
      var data = sh.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] !== h) continue;
        if (data[i][1] === 'new') {
          sh.getRange(i + 1, 2, 1, 4).setValues([['linked', chat, data[i][3], new Date()]]);
          return send_(chat, TXT_OK);
        }
        if (data[i][1] === 'linked' && String(data[i][2]) === chat) return send_(chat, TXT_OK);
        break;
      }
    } finally { lock.releaseLock(); }
  }
  cache.put('t' + chat, String(tries + 1), 3600);
  send_(chat, TXT_BAD);
}

function counts_() {
  var data = sheet_().getDataRange().getValues(), c = {new: 0, linked: 0, revoked: 0};
  for (var i = 1; i < data.length; i++) if (c[data[i][1]] !== undefined) c[data[i][1]]++;
  var d = docsSheet_().getDataRange().getValues();
  c.docs = Math.max(0, d.length - 1);
  return c;
}

function statusText_() {
  var c = counts_();
  return '📊 وضعیت\nحساب‌های وصل‌شده: ' + c.linked + '\nکدهای آزاد: ' + c.new + '\nکدهای باطل: ' + c.revoked + '\nصفحه‌های شخصی: ' + c.docs;
}

// ---------- صفحه‌های شخصی (Google Docs) ----------
function docRow_(key) {
  var sh = docsSheet_(), d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) if (d[i][0] === key) return {sh: sh, i: i + 1, id: String(d[i][1]), status: d[i][2]};
  return null;
}

function createDoc_(key) {
  var r = docRow_(key);
  if (r) return {id: r.id, url: 'https://docs.google.com/document/d/' + r.id + '/edit?usp=sharing', existed: true};
  var doc = DocumentApp.create(DOC_TITLE);
  writeDir_(doc.getBody(), DOC_EMPTY);
  doc.saveAndClose();
  var f = DriveApp.getFileById(doc.getId());
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  f.moveTo(DriveApp.getFolderById(P.getProperty('FOLDER_ID')));
  docsSheet_().appendRow([key, doc.getId(), 'active', new Date(), '']);
  return {id: doc.getId(), url: 'https://docs.google.com/document/d/' + doc.getId() + '/edit?usp=sharing', existed: false};
}

function setDoc_(key, text) {
  var r = docRow_(key);
  if (!r) return {ok: false, error: 'nokey'};
  var doc = DocumentApp.openById(r.id);
  writeDir_(doc.getBody(), String(text));
  doc.saveAndClose();
  r.sh.getRange(r.i, 5).setValue(new Date());
  return {ok: true};
}

function shareDoc_(key, on) {
  var r = docRow_(key);
  if (!r) return {ok: false, error: 'nokey'};
  DriveApp.getFileById(r.id).setSharing(on ? DriveApp.Access.ANYONE_WITH_LINK : DriveApp.Access.PRIVATE,
                                        on ? DriveApp.Permission.VIEW : DriveApp.Permission.NONE);
  r.sh.getRange(r.i, 3).setValue(on ? 'active' : 'revoked');
  return {ok: true};
}

// ---------- متن راست‌چین / چپ‌چین ----------
var FA_RE = /[\u0600-\u06FF]/;
function rtl_(p, isRtl) { try { p.setLeftToRight(!isRtl); p.setAlignment(isRtl ? DocumentApp.HorizontalAlignment.RIGHT : DocumentApp.HorizontalAlignment.LEFT); } catch (x) {} return p; }
function writeDir_(body, text) {
  body.clear();
  var lines = String(text).split('\n');
  body.getParagraphs()[0].setText(lines[0]);
  rtl_(body.getParagraphs()[0], FA_RE.test(lines[0]));
  for (var i = 1; i < lines.length; i++) rtl_(body.appendParagraph(lines[i]), FA_RE.test(lines[i]));
}

// ---------- دفترچه‌ی خصوصی بخش‌بندی‌شده ----------
var SECTIONS = ['📡 پراکسی تلگرام', '🧭 تونل DNS — حساب من', '👤 حساب‌های تونل مشتری', '🧾 سفارش‌ها و مالی',
                '👥 کلاینت‌ها', '💬 پشتیبانی', '🖥 سرور / رفع مشکل', '🤖 دستیار', '📌 سایر'];
var H = DocumentApp.ParagraphHeading;

function tehran_(ts) { return Utilities.formatDate(ts ? new Date(Number(ts) * 1000) : new Date(), 'Asia/Tehran', 'yyyy-MM-dd HH:mm'); }

function notesFolder_() {
  var id = P.getProperty('NOTES_FOLDER');
  if (id) return DriveApp.getFolderById(id);
  var f = DriveApp.createFolder('دفترچه‌ی خصوصی');
  P.setProperty('NOTES_FOLDER', f.getId());
  return f;
}

function sectionIndex_(name) {
  name = String(name || '');
  for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i] === name) return i;
  for (i = 0; i < SECTIONS.length; i++) {           // تطبیق شل: بدون ایموجی
    var bare = SECTIONS[i].replace(/^\S+\s/, '');
    if (name.indexOf(bare) >= 0 || bare.indexOf(name.replace(/^\S+\s/, '')) === 0 && name.length > 2) return i;
  }
  return -1;
}

function classify_(text) {
  var t = String(text);
  if (/t\.me\/proxy|tg:\/\/proxy|MTProto|پراکسی تلگرام/i.test(t)) return 0;
  if (/SlowDNS|تونل DNS|dnstt/i.test(t)) return /حساب آزمایشی صاحب|hrmtest/.test(t) ? 1 : 2;
  if (/سفارش|رسید|واریز|تومان|مبلغ|پرداخت|فروش/.test(t)) return 3;
  if (/پشتیبانی|تیکت/.test(t)) return 5;
  if (/سرور|رفع کلی|سرویس|پورت|دیسک/.test(t)) return 6;
  if (/کلاینت|اکانت|vless:\/\/|vmess:\/\/|اشتراک/.test(t)) return 4;
  return 8;
}

function sectionDoc_(i) {
  var key = 'SEC_' + i, id = P.getProperty(key);
  if (id) { try { return DocumentApp.openById(id); } catch (x) {} }
  var d = DocumentApp.create(SECTIONS[i]);
  var b = d.getBody();
  var p0 = b.getParagraphs()[0]; p0.setText(SECTIONS[i]); p0.setHeading(H.TITLE); rtl_(p0, true);
  rtl_(b.appendParagraph('تازه‌ترین یادداشت بالاست. این صفحه را دستیار هرمس خودکار می‌نویسد.'), true)
    .editAsText().setFontSize(9).setForegroundColor('#777777');
  d.saveAndClose();
  DriveApp.getFileById(d.getId()).moveTo(notesFolder_());
  P.setProperty(key, d.getId());
  return DocumentApp.openById(d.getId());
}

function findHeading_(body, text, level) {
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH && el.asParagraph().getHeading() === level &&
        el.asParagraph().getText() === text) return i;
  }
  return -1;
}

// کارت: عنوان، خط درخواست/مشتری، متن در کادر تک‌فاصله، خط جداکننده
function insertCard_(body, at, n) {
  var h = body.insertParagraph(at, (n.emoji || '') + ' ' + n.title + ' — ' + tehran_(n.ts)).setHeading(H.HEADING3);
  rtl_(h, true);
  var meta = body.insertParagraph(at + 1, 'درخواست: ' + (n.request || '—') + '  ·  مشتری: ' + (n.customer || '—'));
  rtl_(meta, true); meta.editAsText().setFontSize(9).setForegroundColor('#666666');
  var tbl = body.insertTable(at + 2, [[String(n.body || '').slice(0, 20000)]]);
  tbl.setBorderColor('#d0d4da');
  var cell = tbl.getCell(0, 0); cell.setBackgroundColor('#f4f5f7');
  for (var k = 0; k < cell.getNumChildren(); k++) {
    var cp = cell.getChild(k);
    if (cp.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    cp = cp.asParagraph();
    var txt = cp.getText();
    rtl_(cp, FA_RE.test(txt) && !/^(https?|tg|vless|vmess|ss|trojan):\/\//.test(txt));
    cp.editAsText().setFontFamily('Roboto Mono').setFontSize(9);
  }
  body.insertParagraph(at + 3, '').appendHorizontalRule();
}

function addNote_(n) {
  var i = sectionIndex_(n.section);
  if (i < 0) i = classify_((n.title || '') + '\n' + (n.body || ''));
  n.title = String(n.title || 'یادداشت').slice(0, 120);
  n.emoji = SECTIONS[i].split(' ')[0];
  var doc = sectionDoc_(i), body = doc.getBody(), at = 2;
  if (n.customer) {                    // گروه مشتری: زیرعنوان خودش؛ کارت‌های قبلی «قدیمی» می‌شوند
    var head = '👤 ' + n.customer, hi = findHeading_(body, head, H.HEADING2);
    if (hi < 0) { hi = 2; rtl_(body.insertParagraph(hi, head).setHeading(H.HEADING2), true); }
    for (var j = hi + 1; j < body.getNumChildren(); j++) {
      var el = body.getChild(j);
      if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
      var p = el.asParagraph();
      if (p.getHeading() === H.HEADING2) break;
      if (p.getHeading() === H.HEADING3 && p.getText().indexOf('🗄 قدیمی') !== 0) {
        p.editAsText().insertText(0, '🗄 قدیمی — '); p.editAsText().setForegroundColor('#999999');
      }
    }
    at = hi + 1;
  }
  insertCard_(body, at, n);
  doc.saveAndClose();
  P.setProperty('SEC_TS_' + i, String(Date.now()));
  rebuildIndex_();
  return {ok: true, section: SECTIONS[i]};
}

// صفحه‌ی اصلی دفترچه (همان سندی که میان‌بر صاحب به آن اشاره دارد) = فهرست بخش‌ها
function rebuildIndex_() {
  if (!P.getProperty('NOTES_MIGRATED')) return;   // تا یادداشت‌های قدیمی منتقل نشده‌اند، صفحه‌ی اصلی پاک نشود
  var doc = DocumentApp.openById(P.getProperty('PRIVATE_DOC')), b = doc.getBody();
  b.clear();
  var t = b.getParagraphs()[0]; t.setText('📒 دفترچه‌ی خصوصی — فهرست'); t.setHeading(H.TITLE); rtl_(t, true);
  rtl_(b.appendParagraph('هر بخش یک صفحه‌ی جداست؛ روی اسم بخش بزنید. تازه‌ترین یادداشت هر بخش بالای همان صفحه است.'), true)
    .editAsText().setFontSize(10).setForegroundColor('#666666');
  for (var i = 0; i < SECTIONS.length; i++) {
    var id = P.getProperty('SEC_' + i); if (!id) continue;
    var ts = Number(P.getProperty('SEC_TS_' + i) || 0);
    var line = SECTIONS[i] + (ts ? '   ·   آخرین: ' + Utilities.formatDate(new Date(ts), 'Asia/Tehran', 'yyyy-MM-dd HH:mm') : '');
    var p = rtl_(b.appendParagraph(line).setHeading(H.HEADING2), true);
    p.editAsText().setLinkUrl(0, SECTIONS[i].length - 1, 'https://docs.google.com/document/d/' + id + '/edit');
  }
  doc.saveAndClose();
}

// سازگاری با فراخوانی قدیمی note <kind>: kind = "section > title > customer" یا هر متنی
function privateNote_(kind, text) {
  var parts = String(kind || '').split(' > '), req = '', body = String(text || '');
  var m = body.match(/^\s*درخواست:\s*(.*)\n?/);          // خط اول «درخواست: …» → فیلد درخواست
  if (m) { req = m[1].trim(); body = body.slice(m[0].length); }
  return addNote_({section: parts.length > 1 ? parts[0] : '', title: parts.length > 1 ? parts[1] : String(kind || 'یادداشت'),
                   customer: (parts[2] || '').trim(), request: req, ts: 0, body: body});
}

// یک‌بار: یادداشت‌های درهم قدیمی را بخش‌بندی کن (بکاپ کامل سند قدیمی در پوشه می‌ماند)
function migrateNotes_() {
  if (P.getProperty('NOTES_MIGRATED')) return {ok: true, already: true};
  var src = DriveApp.getFileById(P.getProperty('PRIVATE_DOC'));
  if (!P.getProperty('NOTES_BACKUP')) P.setProperty('NOTES_BACKUP', src.makeCopy('دفترچه‌ی خصوصی — بکاپ قدیمی', notesFolder_()).getId());
  var b = DocumentApp.openById(src.getId()).getBody(), entries = [], cur = null;
  for (var i = 0; i < b.getNumChildren(); i++) {
    var el = b.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    var p = el.asParagraph(), txt = p.getText();
    var m = p.getHeading() === H.HEADING3 && txt.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d) — (.*)$/);
    if (m) { cur = {when: m[1], kind: m[2], lines: []}; entries.push(cur); }
    else if (cur) cur.lines.push(txt);
  }
  for (var k = 0; k < entries.length; k++) {
    var e = entries[k], text = e.lines.join('\n').trim(), parts = e.kind.split(' > '), req0 = '';
    var mq = text.match(/^درخواست:\s*(.*)\n?/); if (mq) { req0 = mq[1].trim(); text = text.slice(mq[0].length); }
    var ts = Math.floor(Utilities.parseDate(e.when, 'Asia/Tehran', 'yyyy-MM-dd HH:mm').getTime() / 1000);
    var first = (text.split('\n')[0] || '').replace(/[`*_]/g, '').slice(0, 60);
    addNote_({section: parts.length > 1 ? parts[0] : '', title: parts.length > 1 ? parts[1] : (first || e.kind),
              customer: (parts[2] || '').trim(), request: req0 || ('یادداشت قدیمی: ' + e.kind), ts: ts, body: text});
  }
  P.setProperty('NOTES_MIGRATED', '1');
  rebuildIndex_();
  // سندهای خالی/یتیمی که از تلاش‌های ناموفق قبلی با اسم بخش‌ها ساخته شده‌اند → سطل زباله (۳۰ روز قابل بازگشت)
  var trashed = 0, keep = {};
  for (var s2 = 0; s2 < SECTIONS.length; s2++) keep[P.getProperty('SEC_' + s2)] = 1;
  for (s2 = 0; s2 < SECTIONS.length; s2++) {
    var it = DriveApp.getFilesByName(SECTIONS[s2]);
    while (it.hasNext()) { var f = it.next(); if (!keep[f.getId()]) { f.setTrashed(true); trashed++; } }
  }
  return {ok: true, migrated: entries.length, orphans_trashed: trashed};
}

// یک‌بار از ویرایشگر اجرا شود (Run → fixDirections): راست‌چین/چپ‌چین کردن صفحه‌های مشتری که قبلاً ساخته شده‌اند
function fixDirections() {
  var d = docsSheet_().getDataRange().getValues(), n = 0;
  for (var i = 1; i < d.length; i++) {
    try {
      var ps = DocumentApp.openById(String(d[i][1])).getBody().getParagraphs();
      for (var k = 0; k < ps.length; k++) {
        var t = ps[k].getText();
        rtl_(ps[k], FA_RE.test(t) && !/^(https?|tg|vless|vmess|ss|trojan):\/\//.test(t));
      }
      n++;
    } catch (x) {}
  }
  Logger.log('fixed docs: ' + n);
}

function broadcast_(text) {
  var d = sheet_().getDataRange().getValues(), seen = {}, sent = 0, fail = 0;
  for (var i = 1; i < d.length; i++) {
    if (d[i][1] !== 'linked' || !d[i][2] || seen[d[i][2]]) continue;
    seen[d[i][2]] = 1;
    if (send_(String(d[i][2]), text) === 200) sent++; else fail++;
    Utilities.sleep(60);
  }
  return {ok: true, sent: sent, failed: fail};
}

// ---------- API مدیر (فقط سرور ما، با ADMIN_KEY) ----------
function admin_(b) {
  var key = P.getProperty('ADMIN_KEY');
  if (!key && b.action === 'init' && /^[0-9a-f]{48}$/.test(String(b.admin_key))) {
    P.setProperty('ADMIN_KEY', String(b.admin_key));
    return json_({ok: true, init: true});
  }
  if (!key || String(b.admin_key) !== key) return json_({ok: false, error: 'auth'});
  var hex = /^[0-9a-f]{64}$/;
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var sh = sheet_();
    if (b.action === 'add_codes') {
      var now = new Date(), rows = (b.items || []).filter(function (it) { return hex.test(it.hash); })
        .map(function (it) { return [it.hash, 'new', '', now, '', String(it.label || '').slice(0, 40)]; });
      if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
      return json_({ok: true, added: rows.length});
    }
    if (b.action === 'revoke') {
      var data = sh.getDataRange().getValues(), n = 0;
      for (var i = 1; i < data.length; i++) if (data[i][0] === b.hash) { sh.getRange(i + 1, 2).setValue('revoked'); n++; }
      return json_({ok: true, revoked: n});
    }
    if (b.action === 'create_docs') {
      var out = [], t0 = Date.now();
      var keys = (b.keys || []).filter(function (k) { return hex.test(k); });
      for (var j = 0; j < keys.length && Date.now() - t0 < 240000; j++) {
        try { var r = createDoc_(keys[j]); out.push({key: keys[j], id: r.id, url: r.url, existed: r.existed}); }
        catch (x) { out.push({key: keys[j], error: String(x).slice(0, 200)}); break; }
      }
      return json_({ok: true, docs: out});
    }
    if (b.action === 'set_doc') return hex.test(b.key) ? json_(setDoc_(b.key, b.text || '')) : json_({ok: false, error: 'key'});
    if (b.action === 'share_doc') return hex.test(b.key) ? json_(shareDoc_(b.key, !!b.on)) : json_({ok: false, error: 'key'});
    if (b.action === 'private_note') return json_(privateNote_(b.kind, b.text || ''));
    if (b.action === 'note2') return json_(addNote_({section: b.section, title: b.title, request: b.request,
                                                     customer: b.customer, ts: b.ts, body: b.body}));
    if (b.action === 'migrate_notes') return json_(migrateNotes_());
    if (b.action === 'broadcast') return json_(broadcast_(String(b.text || '').slice(0, 1000)));
    if (b.action === 'status') return json_({ok: true, counts: counts_()});
    if (b.action === 'get_bale_token') return json_({ok: true, t: P.getProperty('BALE_TOKEN')});
    return json_({ok: false, error: 'action'});
  } finally { lock.releaseLock(); }
}
