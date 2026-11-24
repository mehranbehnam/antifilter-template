// ضد فیلتر — فاز ۳، مرحله‌ی ۲: پیوند حساب بله با کد عضویت (بدون کانفیگ)
// Script Properties: BALE_TOKEN و ADMIN_CHAT (دستی)، SHEET_ID (setup می‌سازد)، ADMIN_KEY (سرور با init یک‌باره می‌فرستد)
// کد خام هیچ‌جا ذخیره نمی‌شود؛ فقط HMAC-SHA256(کد نرمال‌شده، ADMIN_KEY).

var TXT_START = 'سلام 👋\nبه دستیار هرمس خوش آمدید.\nاگر کد عضویت دارید، همین‌جا بفرستید (مثل HRM-XXXX-XX).';
var TXT_OK = '✅ حساب شما ثبت شد.\nهر وقت پیام تازه‌ای برایتان داشتیم، همین‌جا خبرتان می‌کنیم.';
var TXT_BAD = '❌ این کد معتبر نیست یا قبلاً استفاده شده. لطفاً دوباره بررسی کنید.';
var TXT_WAIT = '⏳ تعداد تلاش‌ها زیاد بود. لطفاً یک ساعت دیگر دوباره امتحان کنید.';

var P = PropertiesService.getScriptProperties();

// ---------- اجرا یک بار از ویرایشگر (Run → setup) برای ساخت Sheet و گرفتن اجازه ----------
function setup() {
  var id = P.getProperty('SHEET_ID');
  if (!id) {
    var ss = SpreadsheetApp.create('Hermes Data');
    var sh = ss.getSheets()[0];
    sh.setName('codes');
    sh.appendRow(['hash', 'status', 'chat_id', 'created', 'linked_at', 'label']);
    sh.getRange('A:C').setNumberFormat('@'); // متن خام، نه عدد
    P.setProperty('SHEET_ID', ss.getId());
    id = ss.getId();
  }
  UrlFetchApp.fetch('https://tapi.bale.ai', {muteHttpExceptions: true}); // اجازه‌ی اتصال خارجی
  var missing = ['BALE_TOKEN', 'ADMIN_CHAT'].filter(function (k) { return !P.getProperty(k); });
  Logger.log('SHEET_ID ok. Missing properties: ' + (missing.length ? missing.join(', ') : 'none'));
}

function sheet_() {
  return SpreadsheetApp.openById(P.getProperty('SHEET_ID')).getSheetByName('codes');
}

function hmac_(s) {
  var sig = Utilities.computeHmacSha256Signature(s, P.getProperty('ADMIN_KEY'));
  return sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// HRM-7K3Q-92 / hrm 7k3q92 / ۷K3Q92 → HRM7K3Q92
function normCode_(t) {
  t = String(t).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); })
               .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
               .toUpperCase().replace(/[\s\-_.]/g, '');
  if (/^[A-Z0-9]{6}$/.test(t)) t = 'HRM' + t;
  return /^HRM[A-Z0-9]{6}$/.test(t) ? t : null;
}

function send_(chat, text) {
  UrlFetchApp.fetch('https://tapi.bale.ai/bot' + P.getProperty('BALE_TOKEN') + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({chat_id: chat, text: text}), muteHttpExceptions: true
  });
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

// ---------- پیام‌های بله ----------
function handleUpdate_(u) {
  var cache = CacheService.getScriptCache();
  if (u.update_id !== undefined) {
    if (cache.get('u' + u.update_id)) return; // تکراری
    cache.put('u' + u.update_id, '1', 3600);
  }
  var m = u.message;
  if (!m || !m.text || !m.chat) return;
  var chat = String(m.chat.id), text = String(m.text).trim();
  var isAdmin = chat === String(P.getProperty('ADMIN_CHAT'));

  if (/^\/start/.test(text)) return send_(chat, TXT_START);
  if (isAdmin && /^\/status/.test(text)) return send_(chat, statusText_());

  var code = normCode_(text);
  if (!code) return send_(chat, TXT_START);

  var tries = Number(cache.get('t' + chat) || 0);
  if (tries >= 5) return send_(chat, TXT_WAIT);

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
  cache.put('t' + chat, String(tries + 1), 3600);
  send_(chat, TXT_BAD);
}

function counts_() {
  var data = sheet_().getDataRange().getValues(), c = {new: 0, linked: 0, revoked: 0};
  for (var i = 1; i < data.length; i++) if (c[data[i][1]] !== undefined) c[data[i][1]]++;
  return c;
}

function statusText_() {
  var c = counts_();
  return '📊 وضعیت\nحساب‌های وصل‌شده: ' + c.linked + '\nکدهای آزاد: ' + c.new + '\nکدهای باطل: ' + c.revoked;
}

// ---------- API مدیر (فقط سرور ما، با ADMIN_KEY) ----------
function admin_(b) {
  var key = P.getProperty('ADMIN_KEY');
  // راه‌اندازی یک‌باره: اولین درخواست init کلید را ثبت می‌کند؛ بعد از آن دیگر قابل تغییر نیست
  // (برای عوض کردن، صاحب ADMIN_KEY را در Script Properties پاک می‌کند و init دوباره).
  if (!key && b.action === 'init' && /^[0-9a-f]{48}$/.test(String(b.admin_key))) {
    P.setProperty('ADMIN_KEY', String(b.admin_key));
    return json_({ok: true, init: true});
  }
  if (!key || String(b.admin_key) !== key) return json_({ok: false, error: 'auth'});
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    if (b.action === 'add_codes') {
      var now = new Date(), rows = (b.items || []).filter(function (it) {
        return /^[0-9a-f]{64}$/.test(it.hash);
      }).map(function (it) { return [it.hash, 'new', '', now, '', String(it.label || '').slice(0, 40)]; });
      if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
      return json_({ok: true, added: rows.length});
    }
    if (b.action === 'revoke') {
      var data = sh.getDataRange().getValues(), n = 0;
      for (var i = 1; i < data.length; i++) if (data[i][0] === b.hash) { sh.getRange(i + 1, 2).setValue('revoked'); n++; }
      return json_({ok: true, revoked: n});
    }
    if (b.action === 'status') return json_({ok: true, counts: counts_()});
    return json_({ok: false, error: 'action'});
  } finally { lock.releaseLock(); }
}
