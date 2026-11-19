"""
v2 sürekli etiketleme worker'ı — eski process_real_batch.py'nin (tek seferlik
snapshot, bitince çıkan) yerini aldı.

İki kuyruğu sırayla izler, hiçbir zaman çıkmaz:
  1. ÖNCELİKLİ: `tag_requested == true` — web arayüzündeki "Otomatik Etiketle"
     butonu bunu yazar (FileDetail.jsx → damService.requestAutoTag). Her dosya
     işlendikten sonra bu kuyruk tekrar kontrol edilir, yani bir istek en
     fazla BİR dosya süresi (foto ~15 sn, video ~80 sn) bekler — binlerce
     dosyalık backlog'un arkasında günlerce beklemez.
  2. BACKLOG: `needs_tagging == true` — scanner'ın yeni taranan dosyalara
     koyduğu bayrak. Claude'u çağıran eski `onFileNeedsTagging` Cloud
     Function'ı devre dışı bırakıldığı için (kredi bitmişti) yeni taranan her
     şey artık buraya düşüyor.

Her dosya işlenir işlenmez `needs_tagging` false'a çekilir (checkpoint) —
çökme/yeniden başlatma iş kaybettirmez. Başarısız veya görseli olmayan
dosyalar da bayrağı kaybeder (ai.status failed/skipped olarak işaretlenir):
Claude trigger'ının aynı gerekçesiyle, kalıcı bozuk bir dosya sonsuza dek
yeniden denenmesin; arayüzdeki buton tekrar deneme yolu.

Usage: uv run python sprint3/ai_worker.py [--once] [--max-docs N]
  --once       iş kalmayınca çık (test için); varsayılan: sonsuza dek bekle
  --max-docs   en fazla N dosya işle sonra çık (test için)
"""

import argparse
import sys
import time
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH, analyze_frames  # noqa: E402
from process_real_batch import context_for, frame_list_for  # noqa: E402
from ai_write import write_completed  # noqa: E402

IDLE_SLEEP_SECONDS = 30

# Panelin "worker çevrimdışı mı?" göstergesi için kalp atışı: tek doküman,
# her dosya sonrası + boştayken 30 sn'de bir güncellenir (günde ~3k yazma).
# firestore.rules: ai_worker_status — istemci sadece okuyabilir.
STATUS_REF = ("ai_worker_status", "main")
_started_at = time.time()
_processed_since_start = 0


def beat(db, state, current=None):
    """Heartbeat; hata worker'ı düşürmesin (ağ kesintisinde zaten asıl sorgular patlar)."""
    try:
        db.collection(STATUS_REF[0]).document(STATUS_REF[1]).set({
            "lastSeen": firestore.SERVER_TIMESTAMP,
            "state": state,
            "current": current,
            "processedSinceStart": _processed_since_start,
            "startedAt": int(_started_at * 1000),
        })
    except Exception as e:  # noqa: BLE001
        print(f"  (heartbeat yazılamadı: {e})", flush=True)


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="ai-worker")
    return firestore.client(firebase_admin.get_app("ai-worker"))


def next_priority(db):
    return list(db.collection("files").where("tag_requested", "==", True).limit(10).stream())


def next_backlog(db):
    # Yıl önceliği: enrich.cjs'in atadığı enrichTier (1=2026 … 4=2023) — yeni
    # klasörler önce etiketlenir. İki eşitlik sorgusu (bileşik indeks gerekmez).
    for tier in (1, 2, 3, 4):
        docs = list(
            db.collection("files")
            .where("needs_tagging", "==", True)
            .where("enrichTier", "==", tier)
            .limit(1)
            .stream()
        )
        if docs:
            return docs
    return list(db.collection("files").where("needs_tagging", "==", True).limit(1).stream())


def next_verify(db):
    return list(db.collection("files").where("needs_verify", "==", True).limit(1).stream())


def next_recheck(db):
    return list(db.collection("files").where("needs_recheck", "==", True).limit(1).stream())


def finish_without_result(ref, status, **extra):
    ref.update({
        "needs_tagging": False,
        "tag_requested": firestore.DELETE_FIELD,
        "ai.status": status,
        "ai.processedAt": firestore.SERVER_TIMESTAMP,
        **{f"ai.{k}": v for k, v in extra.items()},
    })


def process(db, doc, queue):
    global _processed_since_start
    data = doc.to_dict()
    name = data.get("name", "?")
    beat(db, "processing", name)
    frames = frame_list_for(data)

    if not frames:
        finish_without_result(doc.reference, "skipped", reason="no_visual_data")
        print(f"  ⏭  {doc.id} ({name}) — görsel veri yok [{queue}]", flush=True)
        return "skipped"

    try:
        result = analyze_frames(frames, context=context_for(data))
    except Exception as e:  # noqa: BLE001 — tek dosya hatası worker'ı düşürmesin
        finish_without_result(doc.reference, "failed", error=str(e))
        print(f"  ✗ {doc.id} ({name}) — hata: {e} [{queue}]", flush=True)
        return "failed"

    write_completed(db, doc.reference, data, result)
    _processed_since_start += 1
    print(f"  ✓ {doc.id} ({name}) — {len(result['tags'])} etiket: {result['tags']} [{queue}]", flush=True)
    if result["onScreenText"]:
        print(f"      metin: {result['onScreenText']}", flush=True)
    return "ok"


def run(once, max_docs):
    db = init_firestore()
    print("AI worker başladı — öncelikli (tag_requested) + backlog (needs_tagging) kuyrukları izleniyor.", flush=True)
    beat(db, "idle")
    done = 0
    while True:
        if max_docs is not None and done >= max_docs:
            print(f"--max-docs {max_docs} doldu, çıkılıyor.", flush=True)
            return

        priority = next_priority(db)
        if priority:
            for doc in priority:
                process(db, doc, "öncelikli")
                done += 1
            continue

        backlog = next_backlog(db)
        if backlog:
            process(db, backlog[0], "backlog")
            done += 1
            continue

        # 3. kuyruk: etiket doğrulama (ucak-tasarimli, pilot) — sadece iş yokken.
        verify = next_verify(db)
        if verify:
            from verify_tags import verify_doc
            vdoc = verify[0]
            beat(db, "verifying", vdoc.get("name"))
            try:
                ok, removed = verify_doc(vdoc)
                print(f"  ⚖ {vdoc.id} ({vdoc.get('name')}) — korunan {ok} kaldırılan {removed}", flush=True)
            except Exception as e:  # noqa: BLE001
                vdoc.reference.update({"needs_verify": False})
                print(f"  ✗ doğrulama hatası {vdoc.id}: {e}", flush=True)
            done += 1
            continue

        # 4. kuyruk: kaldırılan etiketlerin ikinci kontrolü (verify_tags.recheck_doc).
        recheck = next_recheck(db)
        if recheck:
            from verify_tags import recheck_doc
            rdoc = recheck[0]
            beat(db, "rechecking", rdoc.get("name"))
            try:
                restored = recheck_doc(rdoc)
                print(f"  ↺ {rdoc.id} ({rdoc.get('name')}) — geri konan {restored}", flush=True)
            except Exception as e:  # noqa: BLE001
                rdoc.reference.update({"needs_recheck": False})
                print(f"  ✗ ikinci kontrol hatası {rdoc.id}: {e}", flush=True)
            done += 1
            continue

        if once:
            print("Kuyruk boş, çıkılıyor (--once).", flush=True)
            return
        beat(db, "idle")
        time.sleep(IDLE_SLEEP_SECONDS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--max-docs", type=int, default=None)
    args = parser.parse_args()
    run(once=args.once, max_docs=args.max_docs)
