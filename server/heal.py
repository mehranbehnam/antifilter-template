#!/usr/bin/env python3
"""ضد فیلتر — بررسی و ترمیم امن بخش‌های ضد فیلتر (برای دکمه‌ی «🛠 رفع کلی مشکل» ربات ادمین).
فقط کارهای بی‌خطر و تکرارپذیر؛ هیچ حذف، هیچ پیام به مشتری، هیچ سرویس روت. --dry-run = فقط گزارش.
خروجی: هر مورد یک خط فارسی (✅ / 🔧 / ⚠️).
"""
import json, os, stat, subprocess, sys, time
from pathlib import Path
import requests

DRY = '--dry-run' in sys.argv
BASE = Path('/home/ubuntu/antifilter')
SEC = BASE / '.secrets'
AS = BASE / 'apps-script'
SYNC_MAX = 30          # حداکثر صفحه‌ی تازه در هر اجرا (محدودیت زمان ۲۴۰ ثانیه)
out = []


def say(s):
    out.append(s)


def tok(name):
    try:
        return (SEC / name).read_text().strip()
    except OSError:
        return ''


def bale(token, method, **params):
    r = requests.post(f'https://tapi.bale.ai/bot{token}/{method}', json=params or None, timeout=20)
    return r.json()


def check_secrets():
    bad = []
    for f in ('admin_key', 'bale_token', 'bale_admin_token'):
        p = SEC / f
        if not p.exists():
            say(f'⚠️ فایل محرمانه‌ی {f} پیدا نشد'); continue
        if stat.S_IMODE(p.stat().st_mode) != 0o600:
            bad.append(p)
    if bad and not DRY:
        for p in bad:
            p.chmod(0o600)
        say(f'🔧 دسترسی {len(bad)} فایل محرمانه به ۶۰۰ برگشت')
    elif bad:
        say(f'⚠️ دسترسی {len(bad)} فایل محرمانه باز است (dry-run: درست نشد)')
    else:
        say('✅ فایل‌های محرمانه سالم')


def check_apps_script():
    try:
        r = subprocess.run([str(AS / 'af_docs.py'), 'status'], capture_output=True, text=True, timeout=60)
        j = json.loads(r.stdout.strip().splitlines()[-1])
        if j.get('ok'):
            c = j['counts']
            say(f"✅ Apps Script گوگل جواب می‌دهد (بله‌ی وصل: {c.get('linked')}، صفحه‌ها: {c.get('docs')})")
            return True
        say(f'⚠️ Apps Script جواب نادرست داد: {str(j)[:80]}')
    except Exception as e:
        say(f'⚠️ Apps Script در دسترس نیست: {type(e).__name__}')
    return False


def check_bale_customer_bot():
    t = tok('bale_token')
    want = (AS / 'webapp_url.txt').read_text().strip()
    try:
        if not bale(t, 'getMe').get('ok'):
            say('⚠️ توکن بازوی مشتری بله (agenthermes) کار نمی‌کند — شاید revoke شده'); return
        w = bale(t, 'getWebhookInfo').get('result', {})
    except Exception as e:
        say(f'⚠️ API بله از سرور در دسترس نیست: {type(e).__name__}'); return
    if w.get('url') != want:
        if DRY:
            say('⚠️ webhook بازوی مشتری بله اشتباه است (dry-run: درست نشد)')
        else:
            ok = bale(t, 'setWebhook', url=want).get('ok')
            say('🔧 webhook بازوی مشتری بله دوباره ثبت شد' if ok else '⚠️ ثبت دوباره‌ی webhook بله ناموفق بود')
    else:
        say('✅ بازوی مشتری بله (agenthermes) و webhook سالم')
    if w.get('last_error_message') and time.time() - w.get('last_error_date', 0) < 3600:
        say(f"⚠️ خطای اخیر webhook بله: {w['last_error_message'][:80]}")
    if w.get('pending_update_count', 0) > 50:
        say(f"⚠️ {w['pending_update_count']} پیام بله در صف مانده")


def check_bale_admin_bot():
    try:
        r = bale(tok('bale_admin_token'), 'getMe')
        say('✅ توکن بازوی ادمین بله (دفترچه) معتبر' if r.get('ok') else '⚠️ توکن دفترچه کار نمی‌کند — شاید revoke شده')
    except Exception as e:
        say(f'⚠️ بررسی دفترچه ناموفق: {type(e).__name__}')


def check_docs(as_ok):
    cust = BASE / 'data/customers.txt'
    if not cust.exists():
        say('⚠️ فهرست مشتری‌ها (customers.txt) نیست'); return
    age_h = (time.time() - cust.stat().st_mtime) / 3600
    if age_h > 2:
        say(f'⚠️ فهرست مشتری‌ها {age_h:.0f} ساعت است به‌روز نشده (timer روت antifilter-customers)')
    import sqlite3
    have = set()
    dbf = BASE / 'data/docs.db'
    if dbf.exists():
        have = {r[0] for r in sqlite3.connect(dbf).execute('SELECT name FROM docs')}
    names = {l.strip().lower() for l in cust.read_text().splitlines() if l.strip()}
    missing = names - have
    if not missing:
        say(f'✅ همه‌ی {len(names)} مشتری صفحه‌ی شخصی دارند (هیچ‌کدام فرستاده نشده)'); return
    if DRY or not as_ok:
        say(f'⚠️ {len(missing)} مشتری هنوز صفحه ندارند' + (' (dry-run)' if DRY else ''))
        return
    r = subprocess.run([str(AS / 'af_docs.py'), 'sync', str(cust), str(SYNC_MAX)],
                       capture_output=True, text=True, timeout=200)
    made = r.stdout.split('created')[-1].strip() if 'created' in r.stdout else '0'
    left = max(0, len(missing) - int(made or 0))
    say(f'🔧 برای {made} مشتری تازه صفحه ساخته شد (فرستاده نشد)' + (f'؛ {left} مانده برای اجرای بعد' if left else ''))


def check_public_doc():
    try:
        import sqlite3
        row = sqlite3.connect(BASE / 'data/docs.db').execute(
            "SELECT doc_id FROM docs WHERE name='zz-test-antifilter'").fetchone()
        if not row:
            return
        r = requests.get(f'https://docs.google.com/document/d/{row[0]}/export?format=txt', timeout=20)
        say('✅ صفحه‌های Google Docs از بیرون خوانده می‌شوند' if r.ok and 'یادداشت' in r.text
            else f'⚠️ صفحه‌ی آزمایشی Google Docs باز نشد ({r.status_code})')
    except Exception as e:
        say(f'⚠️ بررسی Google Docs ناموفق: {type(e).__name__}')


def check_mtproto():
    import socket
    for _ in range(3):
        try:
            socket.create_connection(('203.0.113.30', 443), timeout=6).close()
            say('✅ پراکسی تلگرام (MTProto) روی آراگورن:443 باز است'); return
        except OSError:
            time.sleep(2)
    if DRY:
        say('⚠️ پراکسی تلگرام روی آراگورن جواب نمی‌دهد (dry-run: ری‌استارت نشد)'); return
    r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'HostName=10.0.0.30', 'aragorn',
                        'sudo -n systemctl restart mtg && sleep 2 && systemctl is-active mtg'],
                       capture_output=True, text=True, timeout=40)
    say('🔧 سرویس پراکسی تلگرام روی آراگورن ری‌استارت شد' if r.stdout.strip() == 'active'
        else '⚠️ پراکسی تلگرام روی آراگورن خاموش است و ری‌استارت نشد')


def check_dnstt():
    fix = '' if DRY else ('for u in dnstt udpgw; do systemctl is-active -q $u || { sudo -n systemctl restart $u; sleep 2; echo restarted; }; done; ')
    try:
        r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'HostName=10.0.0.30', 'aragorn',
                            fix + 'systemctl is-active udpgw >/dev/null && systemctl is-active dnstt || echo inactive'], capture_output=True, text=True, timeout=40)
        st = r.stdout.split()
    except Exception as e:
        say(f'⚠️ بررسی تونل DNS ناموفق: {type(e).__name__}'); return
    if 'restarted' in st and st[-1] == 'active':
        say('🔧 سرویس تونل DNS روی آراگورن ری‌استارت شد')
    elif st and st[-1] == 'active':
        say('✅ سرویس تونل DNS (dnstt + udpgw) روی آراگورن روشن است')
    else:
        say('⚠️ سرویس تونل DNS روی آراگورن خاموش است' + (' (dry-run)' if DRY else ''))
    try:
        # تفویض را از سرور اصلی Cloudflare می‌پرسیم (پاسخ در بخش AUTHORITY می‌آید)
        out = subprocess.run(['dig', '+norec', '+time=4', '+tries=1', 'NS', 't.example.com',
                              '@graham.ns.cloudflare.com'], capture_output=True, text=True, timeout=15).stdout
        say('✅ زیردامنه‌ی تونل DNS به آراگورن سپرده شده' if 'ns-t.example.com' in out
            else '⚠️ رکورد NS زیردامنه‌ی تونل (t.example.com) در Cloudflare نیست')
    except Exception:
        pass


def main():
    if DRY:
        say('ℹ️ حالت بررسی (dry-run): هیچ تغییری داده نمی‌شود')
    check_secrets()
    as_ok = check_apps_script()
    check_bale_customer_bot()
    check_bale_admin_bot()
    check_docs(as_ok)
    check_public_doc()
    check_mtproto()
    check_dnstt()
    print('\n'.join(out))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('\n'.join(out + [f'⚠️ خطای غیرمنتظره در بررسی ضد فیلتر: {type(e).__name__}: {str(e)[:100]}']))
