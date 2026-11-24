#!/bin/bash
# ضد فیلتر — هوک «رفع کلی مشکل» (فراخوانی از hermesvpn-heal.py با sudo -u ubuntu)
exec /usr/bin/python3 /home/ubuntu/antifilter/heal.py "$@"
