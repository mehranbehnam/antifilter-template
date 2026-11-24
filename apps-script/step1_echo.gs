// ضد فیلتر — فاز ۳، مرحله‌ی ۱: تست تکرار پیام ربات بله از راه Google Apps Script
// بدون هیچ داده‌ی مشتری. توکن فقط در Script Properties (کلید BALE_TOKEN)، نه در کد.
function doPost(e) {
  try {
    var u = JSON.parse(e.postData.contents);
    var m = u.message;
    if (m && m.text) {
      var props = PropertiesService.getScriptProperties();
      var token = props.getProperty('BALE_TOKEN');
      UrlFetchApp.fetch('https://tapi.bale.ai/bot' + token + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          chat_id: m.chat.id,
          text: 'تست دستیار هرمس ✅\nپیام شما رسید: ' + String(m.text).slice(0, 200)
        }),
        muteHttpExceptions: true
      });
      // برای عیب‌یابی و پیدا کردن chat_id مدیر (خود صاحب)
      props.setProperty('LAST', new Date().toISOString() + ' chat=' + m.chat.id);
    }
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('ok');
}
