# ضد فیلتر — الگوی مسیرهای اضطراری و ربات بله

نسخه‌ی الگوی پروژه‌ی «ضد فیلتر»: بدون رمز، توکن، کلید، اطلاعات مشتری یا آدرس واقعی (آی‌پی‌ها `203.0.113.x`، دامنه‌ها `example.com`).

## بخش‌ها
| مسیر | چیست |
|---|---|
| `server/af_routes.py` | ساخت/توقف/حذف حساب‌های تونل DNS برای مشتری، لینک پراکسی تلگرام (MTProto Fake-TLS) |
| `server/heal.py`, `heal.sh` | بررسی و رفع خودکار مشکل مسیرهای اضطراری |
| `server/antifilter-customers-export.py` + تایمر | خروجی فهرست مشتری‌ها برای دفترچه |
| `apps-script/step*.gs` | ربات بله روی Google Apps Script (وب‌هوک، صفحه‌ی خصوصی هر مشتری، دفترچه‌ی خصوصی در Google Docs) |
| `apps-script/af_docs.py`, `af_codes.py` | نوشتن یادداشت در دفترچه و کدهای فعال‌سازی از سمت سرور |

## نیازها
- سرور دوم برای تونل DNS: `dnstt-server` (www.bamsoftware.com/software/dnstt)، `badvpn-udpgw`، کاربرهای SSH در گروه `aftunnel` با خروجی محدود.
- رکوردهای DNS: یک A برای `ns-t.example.com` و یک NS برای `t.example.com` به آن.
- پراکسی MTProto (mtg) با Fake-TLS.
- یک پروژه‌ی Google Apps Script با فایل‌های `step*.gs`؛ آدرس Web App را در `apps-script/webapp_url.txt` بگذارید (در گیت نمی‌رود).
- فایل‌های محرمانه در `.secrets/` (۶۰۰): توکن ربات بله، کلید ادمین، رمزهای حساب‌های تونل — هیچ‌کدام در ریپو نیست.

`NOTES-operations.md` یادداشت‌های عملیاتی پروژه است (قوانین، معماری، تصمیم‌ها).
