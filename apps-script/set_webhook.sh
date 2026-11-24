#!/bin/bash
# استفاده: ./set_webhook.sh 'https://script.google.com/macros/s/XXXX/exec'   (یا --delete)
set -e
T=$(cat /home/ubuntu/antifilter/.secrets/bale_token)
API="https://tapi.bale.ai/bot$T"
if [ "$1" = "--delete" ]; then
  curl -s -m 20 "$API/deleteWebhook"; echo
else
  case "$1" in https://script.google.com/macros/s/*/exec) ;; *) echo "URL نامعتبر"; exit 1;; esac
  curl -s -m 20 -X POST "$API/setWebhook" --data-urlencode "url=$1"; echo
fi
curl -s -m 20 "$API/getWebhookInfo"; echo
