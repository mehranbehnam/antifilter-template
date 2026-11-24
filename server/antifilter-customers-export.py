#!/usr/bin/env python3
"""Every 30 min (owner 2026-11-20, for the «ضد فیلتر» Google-Docs pages): one x-ui client name per line →
/home/ubuntu/antifilter/data/customers.txt (owner ubuntu, 640). Names only, nothing else."""
import os, pwd, sqlite3
DST = "/home/ubuntu/antifilter/data/customers.txt"
c = sqlite3.connect("file:/etc/x-ui/x-ui.db?mode=ro", uri=True)
names = sorted({r[0].strip() for r in c.execute("SELECT email FROM clients") if r[0] and r[0].strip()})
c.close()
os.makedirs(os.path.dirname(DST), exist_ok=True)
tmp = DST + ".tmp"
with open(tmp, "w") as f:
    f.write("\n".join(names) + "\n")
u = pwd.getpwnam("ubuntu")
os.chown(tmp, u.pw_uid, u.pw_gid); os.chmod(tmp, 0o640)
os.replace(tmp, DST)
