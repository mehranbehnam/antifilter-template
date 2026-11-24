#!/usr/bin/env python3
"""ضد فیلتر — صفحه‌های شخصی Google Docs مشتری‌ها (فاز ۳، مرحله‌ی ۴). هیچ چیزی برای مشتری فرستاده نمی‌شود.
  af_docs.py sync FILE [MAX]     برای هر ایمیل/نام اکانت در FILE (یک خط هر کدام) که هنوز صفحه ندارد، صفحه می‌سازد
  af_docs.py count               تعداد صفحه‌های ساخته‌شده
  af_docs.py url NAME            لینک صفحه‌ی یک مشتری
  af_docs.py set NAME TEXT|-     نوشتن متن در صفحه‌ی مشتری (- = stdin)
  af_docs.py share NAME on|off   باز/بستن اشتراک صفحه
  af_docs.py note KIND TEXT|-    افزودن به «دفترچه‌ی خصوصی» (KIND = "بخش > عنوان > مشتری")
  af_docs.py note --json -       یادداشت ساخت‌یافته از stdin: {"section","title","request","customer","ts","body"}
  af_docs.py migrate-notes       یک‌بار: بخش‌بندی یادداشت‌های قدیمی (با بکاپ)
  af_docs.py broadcast TEXT      اطلاعیه به همه‌ی حساب‌های وصل‌شده‌ی بله (فقط متن تأییدشده‌ی صاحب)
  af_docs.py status
به گوگل فقط HMAC نام اکانت می‌رود، نه خود نام. نگاشت نام→صفحه فقط روی این سرور است (data/docs.db).
"""
import hashlib, hmac, json, sqlite3, sys, time
from pathlib import Path
import requests

BASE = Path('/home/ubuntu/antifilter')
URL = (BASE / 'apps-script/webapp_url.txt').read_text().strip()
KEY = (BASE / '.secrets/admin_key').read_text().strip()
DBF = BASE / 'data/docs.db'
BATCH = 25


def db():
    DBF.parent.mkdir(mode=0o750, exist_ok=True)
    c = sqlite3.connect(DBF)
    c.execute('CREATE TABLE IF NOT EXISTS docs(name TEXT PRIMARY KEY, key TEXT, doc_id TEXT, url TEXT, created INTEGER, status TEXT)')
    return c


def k(name):
    return hmac.new(KEY.encode(), ('cust:' + name.strip().lower()).encode(), hashlib.sha256).hexdigest()


def call(payload, timeout=320):
    payload['admin_key'] = KEY
    r = requests.post(URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'}, timeout=timeout)
    try:
        return r.json()
    except ValueError:
        return {'ok': False, 'http': r.status_code, 'body': r.text[:200]}


def arg_text(v):
    return sys.stdin.read() if v == '-' else v


def need(c, name):
    row = c.execute('SELECT key, url FROM docs WHERE name=?', (name.strip().lower(),)).fetchone()
    if not row:
        sys.exit('این مشتری صفحه ندارد')
    return row


def sync(path, mx):
    c = db()
    names = []
    for line in Path(path).read_text().splitlines():
        n = line.strip().lower()
        if n and n not in names and not c.execute('SELECT 1 FROM docs WHERE name=?', (n,)).fetchone():
            names.append(n)
    names = names[:mx]
    made = 0
    for i in range(0, len(names), BATCH):
        part = names[i:i + BATCH]
        bykey = {k(n): n for n in part}
        res = call({'action': 'create_docs', 'keys': list(bykey)})
        if not res.get('ok'):
            print('error', res); break
        for d in res.get('docs', []):
            if 'error' in d:
                print('stopped:', d['error']); c.commit(); print('created', made); return
            c.execute('INSERT OR REPLACE INTO docs VALUES(?,?,?,?,?,?)',
                      (bykey[d['key']], d['key'], d['id'], d['url'], int(time.time()), 'active'))
            made += 1
        c.commit()
        if len(res.get('docs', [])) < len(part):
            print('partial batch (time limit) — run again'); break
    print('pending', len(names), 'created', made)


def main(a):
    if a[:1] == ['sync'] and len(a) >= 2:
        sync(a[1], int(a[2]) if len(a) > 2 else 200)
    elif a[:1] == ['count']:
        print(db().execute('SELECT status, count(*) FROM docs GROUP BY status').fetchall())
    elif a[:1] == ['url'] and len(a) == 2:
        print(need(db(), a[1])[1])
    elif a[:1] == ['set'] and len(a) == 3:
        print(json.dumps(call({'action': 'set_doc', 'key': need(db(), a[1])[0], 'text': arg_text(a[2])}), ensure_ascii=False))
    elif a[:1] == ['share'] and len(a) == 3 and a[2] in ('on', 'off'):
        c = db(); key = need(c, a[1])[0]
        r = call({'action': 'share_doc', 'key': key, 'on': a[2] == 'on'})
        if r.get('ok'):
            c.execute('UPDATE docs SET status=? WHERE key=?', ('active' if a[2] == 'on' else 'revoked', key)); c.commit()
        print(json.dumps(r, ensure_ascii=False))
    elif a[:2] == ['note', '--json'] and len(a) == 3:
        n = json.loads(arg_text(a[2]))
        payload = {'action': 'note2'}
        for f in ('section', 'title', 'request', 'customer', 'ts', 'body'):
            payload[f] = n.get(f, '' if f != 'ts' else 0)
        print(json.dumps(call(payload), ensure_ascii=False))
    elif a[:1] == ['migrate-notes']:
        print(json.dumps(call({'action': 'migrate_notes'}), ensure_ascii=False))
    elif a[:1] == ['note'] and len(a) == 3:
        print(json.dumps(call({'action': 'private_note', 'kind': a[1], 'text': arg_text(a[2])}), ensure_ascii=False))
    elif a[:1] == ['broadcast'] and len(a) == 2:
        print(json.dumps(call({'action': 'broadcast', 'text': a[1]}), ensure_ascii=False))
    elif a[:1] == ['status']:
        print(json.dumps(call({'action': 'status'}), ensure_ascii=False))
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
