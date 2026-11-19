#!/bin/bash
# enrich.cjs sonsuza dek çalışır; çökerse (ağ/SMB kesintisi) 15 sn sonra yeniden başlatır.
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$HOME/.local/bin:$PATH"
caffeinate -i -w $$ &
while true; do
    echo "=== [$(date)] enrich.cjs başlatılıyor ==="
    node enrich.cjs
    echo "=== [$(date)] enrich.cjs bitti (exit code: $?) — 15 sn sonra yeniden başlatılıyor ==="
    sleep 15
done
