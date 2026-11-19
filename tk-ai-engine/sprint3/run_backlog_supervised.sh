#!/bin/bash
# process_real_batch.py'yi çalıştırır, herhangi bir sebeple (ağ kopması,
# geçici Firestore hatası, vb.) çökerse birkaç saniye bekleyip otomatik
# yeniden başlatır. Script needs_tagging bazlı, per-dosya checkpoint
# yaptığı için (her dosya işlenir işlenmez needs_tagging=false yazılıyor)
# bir çökme sonrası yeniden başlamak asla iş kaybına/tekrarına yol açmaz.
#
# 20.634+ dosyalık backlog'un günler süren, gözetimsiz koşusu için —
# 2026-09-18'de bir ağ kopması işi sessizce durdurmuştu, bu script o
# senaryoyu otomatik kurtarmak için eklendi.
cd "$(dirname "$0")/.."

while true; do
    echo "=== [$(date)] process_real_batch.py başlatılıyor ==="
    uv run python sprint3/process_real_batch.py --limit 21000
    exit_code=$?
    echo "=== [$(date)] process_real_batch.py bitti (exit code: $exit_code) ==="

    remaining=$(uv run python -c "
import firebase_admin
from firebase_admin import credentials, firestore
import sys
sys.path.insert(0, 'sprint3')
from worker import SERVICE_ACCOUNT_PATH
cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
firebase_admin.initialize_app(cred, name='supervisor_check')
db = firestore.client(firebase_admin.get_app('supervisor_check'))
print(db.collection('files').where('needs_tagging', '==', True).count().get()[0][0].value)
" 2>/dev/null | tail -1)

    if [ "$remaining" = "0" ]; then
        echo "=== [$(date)] Backlog tamamlandı, needs_tagging=true kalmadı. Supervisor duruyor. ==="
        break
    fi

    echo "=== [$(date)] Kalan: ${remaining:-bilinmiyor} — 15 saniye sonra yeniden başlatılıyor ==="
    sleep 15
done
