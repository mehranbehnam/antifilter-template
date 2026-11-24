var TXT_START = 'سلام 👋\nبه دستیار هرمس خوش آمدید.\nاگر کد عضویت دارید، همین‌جا بفرستید (مثل HRM-XXXX-XX).';
var TXT_OK = '✅ حساب شما ثبت شد.\nهر وقت پیام تازه‌ای برایتان داشتیم، همین‌جا خبرتان می‌کنیم.';
var TXT_BAD = '❌ این کد معتبر نیست یا قبلاً استفاده شده. لطفاً دوباره بررسی کنید.';
var TXT_WAIT = '⏳ تعداد تلاش‌ها زیاد بود. لطفاً یک ساعت دیگر دوباره امتحان کنید.';

var P = PropertiesService.getScriptProperties();

function setup() {
  var id = P.getProperty('SHEET_ID');
  if (!id) {
    var ss = SpreadsheetApp.create('Hermes Data');
    var sh = ss.getSheets()[0];
    sh.setName('codes');
    sh.appendRow(['hash', 'status', 'chat_id', 'created', 'linked_at', 'label']);
    sh.getRange('A:C').setNumberFormat('@');
    P.setProperty('SHEET_ID', ss.getId());
  }
  blobs_();
  UrlFetchApp.fetch('https://tapi.bale.ai', {muteHttpExceptions: true});
  var missing = ['BALE_TOKEN', 'ADMIN_CHAT'].filter(function (k) { return !P.getProperty(k); });
  Logger.log('SHEET_ID ok. Missing properties: ' + (missing.length ? missing.join(', ') : 'none'));
}

function ss_() { return SpreadsheetApp.openById(P.getProperty('SHEET_ID')); }
function sheet_() { return ss_().getSheetByName('codes'); }

function blobs_() {
  var ss = ss_(), sh = ss.getSheetByName('blobs');
  if (!sh) {
    sh = ss.insertSheet('blobs');
    sh.appendRow(['hash', 'verifier', 'blob', 'updated']);
    sh.getRange('A:C').setNumberFormat('@');
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

function normPin_(t) {
  t = digits_(t).replace(/\s/g, '');
  return /^[0-9]{6}$/.test(t) ? t : null;
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
  var looksLike = /^[A-Z0-9]{5,12}$/.test(loose_(text)); // مثل MRM-XERZ-BM: غلط تایپی
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

function codeStatus_(h) {
  var data = sheet_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (data[i][0] === h) return data[i][1];
  return null;
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

// ---------- صفحه‌ی حساب ----------
function doGet() {
  return HtmlService.createHtmlOutput(PAGE)
    .setTitle('حساب هرمس')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// از صفحه با google.script.run صدا زده می‌شود. فقط نسخه‌ی رمزشده برمی‌گردد؛ رمزگشایی در گوشی مشتری.
function getBlob(code, pin) {
  code = normCode_(code); pin = normPin_(pin);
  if (!code || !pin) return {ok: false, e: 'bad'};
  var h = hmac_(code), cache = CacheService.getScriptCache(), k = 'p' + h.slice(0, 40);
  var tries = Number(cache.get(k) || 0);
  if (tries >= 5) return {ok: false, e: 'wait'};
  var data = blobs_().getDataRange().getValues(), row = null;
  for (var i = 1; i < data.length; i++) if (data[i][0] === h) { row = data[i]; break; }
  if (!row || row[1] !== hmac_(code + ':' + pin) || codeStatus_(h) === 'revoked') {
    cache.put(k, String(tries + 1), 3600);
    return {ok: false, e: 'bad'};
  }
  if (!row[2]) return {ok: false, e: 'empty'};
  return {ok: true, b: String(row[2])};
}

var PAGE = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--mut:#667085;--line:#d5d9e0;--acc:#2f6fed;--err:#c62828;--ok:#1b7f3b}
@media (prefers-color-scheme: dark){:root{--bg:#12151b;--card:#1b2029;--fg:#e8ebf0;--mut:#9aa3b2;--line:#323a47;--acc:#6b9bff;--err:#ff7b7b;--ok:#5fd38a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:Tahoma,"Segoe UI",sans-serif;line-height:1.8}
.w{max-width:440px;margin:32px auto;padding:0 16px}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 16px;color:var(--mut);font-size:14px}
label{display:block;font-size:13px;color:var(--mut);margin:10px 0 4px}
input,textarea{width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
input{direction:ltr;text-align:center;letter-spacing:2px}
textarea{direction:ltr;text-align:left;font-family:monospace;font-size:13px;min-height:140px;margin-top:8px}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:10px;background:var(--acc);color:#fff;font:inherit;font-size:16px;cursor:pointer}
button:disabled{opacity:.6}
.m{margin-top:14px;font-size:14px;min-height:1.5em}
.err{color:var(--err)}.ok{color:var(--ok)}
#out{display:none;margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="w"><div class="c">
<h1>حساب هرمس</h1>
<p>کد عضویت و رمز شخصی خود را وارد کنید.</p>
<label for="code">کد عضویت</label><input id="code" autocomplete="off" placeholder="HRM-XXXX-XX">
<label for="pin">رمز شخصی</label><input id="pin" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••••">
<button id="go">نمایش</button>
<div class="m" id="msg"></div>
<div id="out"><b>پیام شما</b><textarea id="txt" readonly></textarea><button id="cp">کپی</button></div>
</div></div>
<script>
var $ = function (id) { return document.getElementById(id); };
function fa2en(s) { return String(s).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); }
function normCode(t) { t = fa2en(t).toUpperCase().replace(/[\\s\\-_.]/g, ''); if (/^[A-Z0-9]{6}$/.test(t)) t = 'HRM' + t; return /^HRM[A-Z0-9]{6}$/.test(t) ? t : null; }
function normPin(t) { t = fa2en(t).replace(/\\s/g, ''); return /^[0-9]{6}$/.test(t) ? t : null; }
function b64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
function say(t, cls) { $('msg').textContent = t; $('msg').className = 'm ' + (cls || ''); }
async function dec(blob, code, pin) {
  var o = JSON.parse(blob), enc = new TextEncoder();
  var base = await crypto.subtle.importKey('raw', enc.encode(code + ':' + pin), 'PBKDF2', false, ['deriveKey']);
  var key = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(o.s), iterations: o.n, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
  var pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(o.i)}, key, b64(o.c));
  return new TextDecoder().decode(pt);
}
$('go').onclick = function () {
  var code = normCode($('code').value), pin = normPin($('pin').value);
  $('out').style.display = 'none';
  if (!code || !pin) return say('کد یا رمز نادرست است.', 'err');
  $('go').disabled = true; say('در حال بررسی…');
  google.script.run.withFailureHandler(function () { $('go').disabled = false; say('خطا در ارتباط. دوباره امتحان کنید.', 'err'); })
    .withSuccessHandler(async function (r) {
      $('go').disabled = false;
      if (!r.ok) return say(r.e === 'wait' ? 'تعداد تلاش‌ها زیاد بود. یک ساعت دیگر امتحان کنید.' : r.e === 'empty' ? 'هنوز پیامی برای شما ثبت نشده است.' : 'کد یا رمز نادرست است.', r.e === 'empty' ? '' : 'err');
      try { $('txt').value = await dec(r.b, code, pin); $('out').style.display = 'block'; say('✅', 'ok'); }
      catch (x) { say('خطا در باز کردن پیام.', 'err'); }
    }).getBlob(code, pin);
};
$('cp').onclick = function () {
  $('txt').select();
  var done = false;
  try { done = document.execCommand('copy'); } catch (x) {}
  if (!done && navigator.clipboard) navigator.clipboard.writeText($('txt').value).then(function () { say('کپی شد ✅', 'ok'); });
  else say(done ? 'کپی شد ✅' : 'متن را انتخاب و کپی کنید.', done ? 'ok' : '');
};
</script></body></html>`;

// ---------- API مدیر (فقط سرور ما، با ADMIN_KEY) ----------
function admin_(b) {
  var key = P.getProperty('ADMIN_KEY');
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
    if (b.action === 'put_blob') {
      if (!/^[0-9a-f]{64}$/.test(b.hash) || !/^[0-9a-f]{64}$/.test(b.verifier)) return json_({ok: false, error: 'hash'});
      var blob = String(b.blob || '');
      if (blob.length > 45000) return json_({ok: false, error: 'size'});
      var bs = blobs_(), bd = bs.getDataRange().getValues(), r = [b.hash, b.verifier, blob, new Date()];
      for (var j = 1; j < bd.length; j++) if (bd[j][0] === b.hash) { bs.getRange(j + 1, 1, 1, 4).setValues([r]); return json_({ok: true, updated: 1}); }
      bs.appendRow(r);
      return json_({ok: true, added: 1});
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
