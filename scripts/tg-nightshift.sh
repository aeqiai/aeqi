#!/usr/bin/env bash
# Send a Telegram update to the Luca-Eich channel (private chat 7822194320).
# Usage: tg-nightshift.sh "message text"
set -euo pipefail
TOKEN="8461143135:AAHFgFLMaCAw0Cql9xjt6jmNtFHgNfqydJg"
CHAT_ID="7822194320"
MSG="${1:-(empty update)}"
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MSG}" \
  --data-urlencode "parse_mode=Markdown" \
  --data-urlencode "disable_web_page_preview=true" > /dev/null
