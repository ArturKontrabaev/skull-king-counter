#!/usr/bin/env bash
# Деплой Skull King Counter на https://kontrabaeva.art/skull/ (reg.ru, статика).
# Креды FTP берутся из Настиного .deploy.env (вне этого репо, НЕ в гите).
# Заливает только файлы приложения (без доков/тестов/гита) в подпапку skull/,
# НЕ трогая основной сайт Насти.
set -euo pipefail
cd "$(dirname "$0")"

ENV=/artur/nastya/.deploy.env
[ -f "$ENV" ] || { echo "Нет $ENV с FTP-доступами"; exit 1; }
# shellcheck disable=SC1090
source "$ENV"
command -v lftp >/dev/null || { echo "Нужен lftp"; exit 1; }

TMP=$(mktemp -d)
cp index.html app.js scoring.js style.css manifest.json "$TMP"/
cp -r icons "$TMP"/

# cache-busting: подставить версию (epoch) в ссылки на скрипты/стили, чтобы устройства
# всегда тянули свежий код, а не закэшированный старый
V=$(date +%s)
sed -i "s#\(scoring\.js\|app\.js\|style\.css\)\"#\1?v=$V\"#g" "$TMP/index.html"
echo "  версия ассетов: v=$V"

echo "→ Заливаю skull/ на $FTP_HOST ..."
lftp -u "$FTP_USER,$FTP_PASS" "$FTP_HOST" -e "
  set ftp:ssl-allow no; set net:timeout 20; set net:max-retries 3;
  mirror -R --delete --parallel=4 $TMP/ ${FTP_PATH}skull/;
  bye"
rm -rf "$TMP"
echo "✓ Готово: https://kontrabaeva.art/skull/"
