#!/usr/bin/env python3
"""ضد فیلتر — اطلاعات مسیرهای اضطراری برای دکمه‌های ربات ادمین (اجرا با sudo -u ubuntu).
  af_routes.py mtproto            لینک پراکسی تلگرام (MTProto Fake-TLS روی آراگورن)
  af_routes.py dns                تنظیمات تونل DNS حساب آزمایشی صاحب (hrmtest)
  af_routes.py dns-list           فهرست حساب‌های تونل DNS
  af_routes.py dns-new NAME       ساخت حساب تونل DNS (NAME: حروف کوچک لاتین/عدد، ۳ تا ۱۶)
  af_routes.py dns-show NAME      تنظیمات یک حساب
  af_routes.py dns-del NAME       حذف حساب و قطع اتصال‌هایش
  af_routes.py dns-list --json    فهرست به‌صورت JSON: name, status (active|paused), created, conns, last_seen
  af_routes.py dns-pause NAME     توقف موقت (رمز قفل و اتصال‌ها قطع می‌شود؛ حساب می‌ماند)
  af_routes.py dns-resume NAME    ادامه (باز شدن قفل رمز)
خروجی متن فارسی آماده‌ی نمایش است. هیچ چیزی برای مشتری فرستاده نمی‌شود.
"""
import json, re, secrets, string, subprocess, sys, time
from pathlib import Path

BASE = Path('/home/ubuntu/antifilter')
SEC = BASE / '.secrets'
USERS = SEC / 'dnstt_users.json'
IP, NS = '203.0.113.30', 't.example.com'
PREFIX = 'af'          # نام کاربری لینوکس = af<NAME>


CACHE = SEC / 'routes_cache.json'   # مقادیر ثابت (رمز MTProto، کلید عمومی) تا دکمه‌ها بدون SSH جواب بدهند


def aragorn(cmd, inp=None):
    # اوراکل و آراگورن در یک شبکه‌اند: اول IP خصوصی (پایدار)، بعد IP عمومی؛ هر کدام دو بار
    err = ''
    for host in ('10.0.0.30', '10.0.0.30', IP, IP):
        try:
            r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', '-o', f'HostName={host}',
                                'aragorn', cmd], input=inp, capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired:
            err = 'timeout'; continue
        if r.returncode != 255:          # 255 = خطای اتصال SSH؛ بقیه یعنی فرمان اجرا شد
            if r.returncode:
                sys.exit('⚠️ خطا روی آراگورن: ' + (r.stderr or r.stdout).strip()[:150])
            return r.stdout.strip()
        err = r.stderr.strip()[:150]
    sys.exit('⚠️ خطا در ارتباط با آراگورن: ' + err)


def cached(key, cmd, pattern):
    try:
        c = json.loads(CACHE.read_text())
    except (OSError, ValueError):
        c = {}
    if re.fullmatch(pattern, c.get(key, '')):
        return c[key]
    v = aragorn(cmd)
    if re.fullmatch(pattern, v):
        c[key] = v
        CACHE.write_text(json.dumps(c)); CACHE.chmod(0o600)
    return v


def users():
    try:
        return json.loads(USERS.read_text())
    except (OSError, ValueError):
        return {}


def save(u):
    USERS.write_text(json.dumps(u, ensure_ascii=False, indent=1))
    USERS.chmod(0o600)


def pubkey():
    k = cached('dnstt_pub', 'sudo -n cat /etc/dnstt/server.pub', r'[0-9a-f]{64}')
    if not re.fullmatch(r'[0-9a-f]{64}', k):
        sys.exit('⚠️ کلید عمومی تونل DNS خوانده نشد')
    return k


def dns_text(title, user, pw, pk):
    return (f'🧭 {title}\n'
            'اپ اندروید: HTTP Custom یا HTTP Injector (گزینه‌ی SlowDNS)\n\n'
            f'SSH:\n{IP}:22@{user}:{pw}\n\n'
            'SlowDNS / DNSTT:\n'
            'DNS: 8.8.8.8  (اگر نشد 1.1.1.1 یا DNS اپراتور)\n'
            f'Name Server: {NS}\n'
            f'Public Key: {pk}\n\n'
            'کند است (مناسب پیام‌رسان)، برای قطعی‌های سنگین.')


def mtproto():
    s = cached('mtg_secret', 'sudo -n sed -n \'s/^secret = "\\(.*\\)"/\\1/p\' /etc/mtg.toml', r'ee[0-9a-f]{30,}')
    if not s.startswith('ee'):
        sys.exit('⚠️ رمز پراکسی تلگرام خوانده نشد')
    print('📡 پراکسی تلگرام (MTProto، Fake-TLS، آراگورن)\n'
          f'https://t.me/proxy?server={IP}&port=443&secret={s}\n\n'
          f'tg://proxy?server={IP}&port=443&secret={s}\n\n'
          'لینک را در تلگرام لمس کنید → Connect proxy.')


def name_ok(n):
    if not re.fullmatch(r'[a-z][a-z0-9]{2,15}', n or ''):
        sys.exit('⚠️ نام باید با حرف کوچک لاتین شروع شود و فقط حرف کوچک/عدد باشد (۳ تا ۱۶)')
    return n


def main(a):
    cmd = a[0] if a else ''
    if cmd == 'mtproto':
        mtproto()
    elif cmd == 'dns':
        print(dns_text('تونل DNS — حساب آزمایشی صاحب', 'hrmtest', (SEC / 'dnstt_hrmtest_pw').read_text().strip(), pubkey()))
    elif cmd == 'dns-list' and a[1:] == ['--json']:
        u = users(); live = {}
        if u:
            try:   # یک تماس SSH برای همه: تعداد اتصال و آخرین ورود
                q = ' '.join(v['user'] for v in u.values())
                outp = aragorn('for x in ' + q + '; do c=$(pgrep -c -u $x sshd 2>/dev/null || true); '
                               'l=$(sudo -n journalctl -u ssh --since "-30 days" --no-pager -o short-unix 2>/dev/null '
                               '| grep "Accepted password for $x " | tail -1 | cut -d" " -f1); echo "$x ${c:-0} ${l:-0}"; done')
                for line in outp.splitlines():
                    x, c, l = (line.split() + ['0', '0'])[:3]
                    live[x] = (int(c or 0), int(float(l or 0)))
            except SystemExit:
                live = {}
        rows = []
        for n in sorted(u):
            v = u[n]; r = {'name': n, 'status': v.get('status', 'active'), 'created': v.get('created', 0)}
            if v['user'] in live:
                r['conns'] = live[v['user']][0]
                if live[v['user']][1]:
                    r['last_seen'] = live[v['user']][1]
            rows.append(r)
        print(json.dumps(rows, ensure_ascii=False))
    elif cmd == 'dns-list':
        u = users()
        print('🧭 حساب‌های تونل DNS:\n' + ('\n'.join(f"• {n}" + (' ⏸' if u[n].get('status') == 'paused' else '') for n in sorted(u))
                                          if u else '— هیچ حسابی ساخته نشده (جز آزمایشی صاحب)'))
    elif cmd in ('dns-pause', 'dns-resume') and len(a) == 2:
        n = name_ok(a[1]); u = users()
        if n not in u:
            sys.exit('⚠️ چنین حسابی نیست')
        lu = u[n]['user']; pause = cmd == 'dns-pause'
        if pause:   # قفل رمز + قطع اتصال‌های فعلی؛ فقط کاربران گروه aftunnel
            aragorn(f'[ "$(id -gn {lu} 2>/dev/null)" = aftunnel ] || exit 3; sudo -n usermod -L {lu}; sudo -n pkill -u {lu}; true')
        else:
            aragorn(f'[ "$(id -gn {lu} 2>/dev/null)" = aftunnel ] || exit 3; sudo -n usermod -U {lu}')
        u[n]['status'] = 'paused' if pause else 'active'; save(u)
        print(f'⏸ حساب تونل DNS «{n}» متوقف شد (اتصال‌ها قطع شد؛ حساب و رمز می‌ماند).' if pause
              else f'▶️ حساب تونل DNS «{n}» دوباره فعال شد.')
    elif cmd == 'dns-new' and len(a) == 2:
        n = name_ok(a[1]); u = users()
        if n in u:
            sys.exit(f'⚠️ حساب {n} از قبل هست (dns-show {n})')
        pw = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(14))
        lu = PREFIX + n
        if aragorn(f'id -u {lu} >/dev/null 2>&1 && echo EXISTS || true') == 'EXISTS':
            sys.exit(f'⚠️ کاربر {lu} روی آراگورن از قبل هست؛ نام دیگری انتخاب کنید')
        aragorn(f'sudo -n useradd -M -d /nonexistent -s /bin/false -g aftunnel {lu}')
        aragorn('sudo -n chpasswd', inp=f'{lu}:{pw}\n')
        u[n] = {'user': lu, 'pw': pw, 'status': 'active', 'created': int(time.time())}; save(u)
        print(dns_text(f'تونل DNS — حساب {n} ساخته شد', lu, pw, pubkey()))
    elif cmd == 'dns-show' and len(a) == 2:
        u = users().get(name_ok(a[1]))
        if not u:
            sys.exit('⚠️ چنین حسابی نیست')
        print(dns_text(f'تونل DNS — حساب {a[1]}', u['user'], u['pw'], pubkey()))
    elif cmd == 'dns-del' and len(a) == 2:
        n = name_ok(a[1]); u = users()
        if n not in u:
            sys.exit('⚠️ چنین حسابی نیست')
        lu = u[n]['user']
        # فقط کاربرانی که گروه اصلی‌شان aftunnel است (ساخته‌ی همین ابزار) حذف می‌شوند
        aragorn(f'[ "$(id -gn {lu} 2>/dev/null)" = aftunnel ] && {{ sudo -n pkill -u {lu}; sudo -n userdel {lu}; }}; true')
        del u[n]; save(u)
        print(f'🗑 حساب تونل DNS «{n}» حذف و اتصال‌هایش قطع شد.')
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
