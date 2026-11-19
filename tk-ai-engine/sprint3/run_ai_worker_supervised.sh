#!/bin/bash
# ai_worker.py sonsuza dek çalışmak üzere tasarlandı; ağ/DNS kesintisi gibi
# bir sebeple çökerse birkaç saniye sonra yeniden başlatır. İş kaybı olmaz —
# her dosya bitince needs_tagging false'a çekilir (checkpoint). Eski
# run_backlog_supervised.sh'ın aksine kuyruk boşalınca DURMAZ: yeni taranan
# dosyaları ve web arayüzünden gelen "Otomatik Etiketle" isteklerini
# beklemeye devam eder.
cd "$(dirname "$0")/.."

# launchd altında çalışırken (bkz. launchd/com.tribal.tk-ai-worker.plist) log
# dosyasını launchd değil biz açarız: launchd Desktop'a yazamaz.
if [ -n "$AI_WORKER_LOG" ]; then
    exec >> "$AI_WORKER_LOG" 2>&1
fi

# Uyku engelleyici bu betiğin ömrü boyunca (launchd altında caffeinate'i ana
# program yapamayız: macOS izni ana programa bakar, Tam Disk Erişimi /bin/bash'te).
caffeinate -i -w $$ &

while true; do
    echo "=== [$(date)] ai_worker.py başlatılıyor ==="
    # uv run launchd altında takılıyor (alt süreci başlatamıyor) — venv'in python'u doğrudan.
    .venv/bin/python sprint3/ai_worker.py
    echo "=== [$(date)] ai_worker.py bitti (exit code: $?) — 15 sn sonra yeniden başlatılıyor ==="
    sleep 15
done
