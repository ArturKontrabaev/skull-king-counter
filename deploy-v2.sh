#!/usr/bin/env bash
# Деплой Skull King Counter V2 на https://kontrabaeva.art/skullv2/ (reg.ru, статика).
# Отдельная версия с новым UX и ОТДЕЛЬНЫМИ данными в облаке (current_v2/crew_v2).
# Креды из nastya/.deploy.env (не в гите). /skull (v1) не трогает.
set -euo pipefail
cd "$(dirname "$0")"

ENV=/artur/nastya/.deploy.env
[ -f "$ENV" ] || { echo "Нет $ENV с FTP-доступами"; exit 1; }
# shellcheck disable=SC1090
source "$ENV"
command -v lftp >/dev/null || { echo "Нужен lftp"; exit 1; }

TMP=$(mktemp -d)
cp v2/index.html v2/app.js v2/scoring.js v2/style.css v2/manifest.json "$TMP"/
cp -r v2/icons "$TMP"/

V=$(date +%s)
sed -i "s#\(scoring\.js\|app\.js\|style\.css\)\"#\1?v=$V\"#g" "$TMP/index.html"
echo "  v2 версия ассетов: v=$V"

echo "→ Заливаю skullv2/ на $FTP_HOST ..."
lftp -u "$FTP_USER,$FTP_PASS" "$FTP_HOST" -e "
  set ftp:ssl-allow no; set net:timeout 20; set net:max-retries 3;
  mirror -R --delete --parallel=4 $TMP/ ${FTP_PATH}skullv2/;
  bye"
rm -rf "$TMP"
echo "✓ Готово: https://kontrabaeva.art/skullv2/"
