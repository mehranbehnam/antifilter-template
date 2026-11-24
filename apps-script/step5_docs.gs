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
  doc.getBody().setText(DOC_EMPTY);
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
  doc.getBody().setText(String(text));
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

function privateNote_(kind, text) {
  var body = DocumentApp.openById(P.getProperty('PRIVATE_DOC')).getBody();
  body.appendParagraph(Utilities.formatDate(new Date(), 'Asia/Tehran', 'yyyy-MM-dd HH:mm') + ' — ' + String(kind || 'note'))
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendParagraph(String(text).slice(0, 20000));
  return {ok: true};
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
    if (b.action === 'broadcast') return json_(broadcast_(String(b.text || '').slice(0, 1000)));
    if (b.action === 'status') return json_({ok: true, counts: counts_()});
    if (b.action === 'get_bale_token') return json_({ok: true, t: P.getProperty('BALE_TOKEN')});
    return json_({ok: false, error: 'action'});
  } finally { lock.releaseLock(); }
}
