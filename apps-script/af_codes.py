#!/usr/bin/env python3
"""ضد فیلتر — ابزار مدیر کدهای عضویت بله (فاز ۳).
  af_codes.py init                      ثبت یک‌باره‌ی کلید مدیر در Apps Script
  af_codes.py new N [label]             ساخت N کد + رمز ۶ رقمی (خروجی: CODE PIN)؛ به گوگل فقط HMAC می‌رود
  af_codes.py put CODE PIN TEXT|-       رمز کردن متن (یا stdin با -) با کد+رمز و گذاشتن در صفحه‌ی حساب
  af_codes.py sync_token                توکن بله را از Script Properties به .secrets/bale_token می‌آورد (بدون چاپ)
  af_codes.py status
  af_codes.py revoke CODE
کلید مدیر از ~/antifilter/.secrets/admin_key خوانده می‌شود و هرگز چاپ نمی‌شود.
"""
import base64, hashlib, hmac, json, os, secrets, sys
from pathlib import Path
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = Path('/home/ubuntu/antifilter')
URL = (BASE / 'apps-script/webapp_url.txt').read_text().strip()
KEY = (BASE / '.secrets/admin_key').read_text().strip()
ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'  # بدون 0/O/1/I/L
ITER = 150000
FA = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')


def norm(c):
    c = c.translate(FA).upper().replace('-', '').replace(' ', '')
    c = c if c.startswith('HRM') else 'HRM' + c
    if len(c) != 9:
        sys.exit('کد نامعتبر')
    return c


def norm_pin(p):
    p = p.translate(FA).strip()
    if not (len(p) == 6 and p.isdigit()):
        sys.exit('رمز باید ۶ رقم باشد')
    return p


def h(s):
    return hmac.new(KEY.encode(), s.encode(), hashlib.sha256).hexdigest()


def encrypt(text, code, pin):
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac('sha256', f'{code}:{pin}'.encode(), salt, ITER, 32)
    ct = AESGCM(key).encrypt(iv, text.encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return json.dumps({'v': 1, 'n': ITER, 's': b(salt), 'i': b(iv), 'c': b(ct)}, separators=(',', ':'))


def call(payload):
    payload['admin_key'] = KEY
    r = requests.post(URL, data=json.dumps(payload), headers={'Content-Type': 'application/json'},
                      timeout=60, allow_redirects=True)
    try:
        return r.json()
    except ValueError:
        return {'ok': False, 'http': r.status_code, 'body': r.text[:200]}


def put(code, pin, text):
    code, pin = norm(code), norm_pin(pin)
    blob = encrypt(text, code, pin) if text else ''
    return call({'action': 'put_blob', 'hash': h(code), 'verifier': h(f'{code}:{pin}'), 'blob': blob})


def main(a):
    if a[:1] == ['init']:
        print(json.dumps(call({'action': 'init'}), ensure_ascii=False))
    elif a[:1] == ['new'] and len(a) >= 2:
        n, label = int(a[1]), (a[2] if len(a) > 2 else '')
        pairs = []
        for _ in range(n):
            raw = ''.join(secrets.choice(ALPHA) for _ in range(6))
            pairs.append((f'HRM-{raw[:4]}-{raw[4:]}', f'{secrets.randbelow(10**6):06d}'))
        res = call({'action': 'add_codes', 'items': [{'hash': h(norm(c)), 'label': label} for c, _ in pairs]})
        print(json.dumps(res, ensure_ascii=False))
        if res.get('ok'):
            for c, p in pairs:
                r = put(c, p, '')
                print(c, p, '' if r.get('ok') else f'(pin not saved: {r})')
    elif a[:1] == ['put'] and len(a) == 4:
        text = sys.stdin.read() if a[3] == '-' else a[3]
        print(json.dumps(put(a[1], a[2], text), ensure_ascii=False))
    elif a[:1] == ['sync_token']:
        # توکن بله را از Script Properties می‌گیرد و بدون چاپ در .secrets ذخیره می‌کند
        r = call({'action': 'get_bale_token'})
        t = r.get('t') or ''
        if not (r.get('ok') and ':' in t):
            sys.exit('no token: ' + str({k: v for k, v in r.items() if k != 't'}))
        f = BASE / '.secrets/bale_token'
        f.write_text(t + '\n'); f.chmod(0o600)
        print('saved, len', len(t))
    elif a[:1] == ['status']:
        print(json.dumps(call({'action': 'status'}), ensure_ascii=False))
    elif a[:1] == ['revoke'] and len(a) == 2:
        print(json.dumps(call({'action': 'revoke', 'hash': h(norm(a[1]))}), ensure_ascii=False))
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
