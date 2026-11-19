#!/bin/bash
# hash_files.py kuyruk bitince çıkar; ağ/SMB kesintisinde çökerse 30 sn sonra devam eder.
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
caffeinate -i -w $$ &
while true; do
    echo "=== [$(date)] hash_files.py başlatılıyor ==="
    .venv/bin/python sprint3/hash_files.py
    code=$?
    echo "=== [$(date)] hash_files.py bitti (exit code: $code) ==="
    [ $code -eq 0 ] && break
    sleep 30
done
