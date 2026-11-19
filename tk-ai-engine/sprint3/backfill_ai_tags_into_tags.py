"""
Bir kerelik: daha önce v2 ile işlenmiş (ai.status == completed) tüm dosyaların
`ai.tags` etiketlerini `tags` alanına ekler ve `searchTokens`'ı yeniden
hesaplar — böylece eski sonuçlar da aramada çıkar (yeni sonuçları ai_worker
zaten böyle yazıyor, bkz. ai_write.py). Sonra `tags` koleksiyonunu (filtre
listesi / otomatik tamamlama, usageCount) mevcut dosya etiketlerinden yeniden
sayar — backfillTags.cjs ile aynı mantık, ama `select` ile sadece `tags`
alanını çekiyor (o script her dokümanı base64 karelerle birlikte indiriyor).

Sadece EKLEME: mevcut etiketler silinmez. Tekrar çalıştırmak güvenli
(idempotent): birleşim değişmeyen dosyalar atlanır.

Usage: uv run python sprint3/backfill_ai_tags_into_tags.py [--dry-run]
"""

import argparse
import sys
from collections import Counter
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens, merge_tags  # noqa: E402

BATCH_SIZE = 400


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="backfill-ai-tags")
    return firestore.client(firebase_admin.get_app("backfill-ai-tags"))


def merge_phase(db, dry_run):
    print("1/2 ai.tags → tags + searchTokens birleştiriliyor...", flush=True)
    query = (
        db.collection("files")
        .where("ai.status", "==", "completed")
        .select(["name", "tags", "tagSource", "ai.tags", "ai.description", "ai.onScreenText"])
    )
    batch = db.batch()
    pending = scanned = changed = tags_added = 0
    for doc in query.stream():
        scanned += 1
        data = doc.to_dict()
        existing = data.get("tags") or []
        ai_tags = (data.get("ai") or {}).get("tags") or []
        merged = merge_tags(existing, ai_tags)
        tags_changed = len(merged) != len(existing)
        # Daha önce Claude etiketlediyse (tagSource zaten dolu) dokunma;
        # boşsa v2 işlemiştir → arayüzdeki "AI ile etiketlendi" rozeti için.
        needs_source = not data.get("tagSource")
        if not tags_changed and not needs_source:
            continue
        changed += 1
        tags_added += len(merged) - len(existing)
        if not dry_run:
            update = {}
            if tags_changed:
                update["tags"] = merged
                update["searchTokens"] = generate_search_tokens(
                    data.get("name", ""), merged, ai_search_text(data.get("ai"))
                )
            if needs_source:
                update["tagSource"] = "local-vision"
            batch.update(doc.reference, update)
            pending += 1
            if pending >= BATCH_SIZE:
                batch.commit()
                batch = db.batch()
                pending = 0
                print(f"  ...{changed} dosya güncellendi", flush=True)
    if pending and not dry_run:
        batch.commit()
    print(f"  taranan: {scanned}, güncellenen dosya: {changed}, eklenen etiket: {tags_added}", flush=True)


def registry_phase(db, dry_run):
    print("2/2 tags koleksiyonu (usageCount) yeniden sayılıyor...", flush=True)
    counts = Counter()
    total = 0
    # Sayfa sayfa (id sırasıyla): uzun tek akış sorgusu ağ/deadline hatasında
    # kütüphane hatasıyla düşüyordu (2026-10-22).
    last = None
    while True:
        q = db.collection("files").select(["tags"]).order_by("__name__").limit(2000)
        if last is not None:
            q = q.start_after(last)
        page = list(q.stream())
        if not page:
            break
        last = page[-1]
        for doc in page:
            total += 1
            for t in doc.to_dict().get("tags") or []:
                if t and "/" not in t:
                    counts[t] += 1
    print(f"  {total} dosya, {len(counts)} benzersiz etiket", flush=True)
    if dry_run:
        return
    items = list(counts.items())
    for i in range(0, len(items), BATCH_SIZE):
        batch = db.batch()
        for tag, n in items[i:i + BATCH_SIZE]:
            batch.set(
                db.collection("tags").document(tag),
                {"tagId": tag, "displayName": tag, "usageCount": n},
                merge=True,
            )
        batch.commit()
    print("  tags koleksiyonu güncellendi", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--registry-only", action="store_true", help="ai.tags birleştirmeyi atla, sadece usageCount yeniden say")
    args = parser.parse_args()
    parser_db = init_firestore()
    if not args.registry_only:
        merge_phase(parser_db, args.dry_run)
    registry_phase(parser_db, args.dry_run)
