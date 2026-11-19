"""
Bir kerelik (2026-10-12): v2'nin yazdığı AI açıklaması + ekran yazıları
(`ai.description`, `ai.onScreenText`) artık `searchTokens`'a giriyor (yeni
sonuçları ai_write.py zaten böyle yazıyor). Bu script daha önce işlenmiş
(ai.status == completed) dosyaların `searchTokens`'ını yeniden hesaplar.
Sadece `searchTokens` yazılır; değişmeyen dosyalar atlanır (idempotent).

Usage: uv run python sprint3/backfill_ai_text_tokens.py [--dry-run]
"""
import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens  # noqa: E402

BATCH_SIZE = 40  # 400 x ~700 token/doc -> "Transaction too big"


def fetch_page(db, last, page_size=300):
    q = (
        db.collection("files")
        .where("ai.status", "==", "completed")
        .select(["name", "tags", "searchTokens", "ai.description", "ai.onScreenText"])
        .order_by("__name__")
        .limit(page_size)
    )
    if last is not None:
        q = q.start_after(last)
    return list(q.stream())


def commit_batch(db, items):
    batch = db.batch()
    for ref, tokens in items:
        batch.update(ref, {"searchTokens": tokens})
    for attempt in range(6):
        try:
            batch.commit()
            return
        except Exception as e:  # noqa: BLE001 — ağ kesintisi: bekle, tekrar dene
            print(f"  (yazma hatası, tekrar denenecek: {str(e)[:80]})", flush=True)
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("batch 6 denemede yazılamadı")


def run(dry_run):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    # Akış (stream) sorgusu uzun sürede ağ hatasında kütüphane hatasıyla düşüyordu;
    # sayfa sayfa (id sırasıyla) okunur, sayfa hatada tekrar denenir. Yazmalar
    # küçük batch'ler halinde 4 iş parçacığıyla paralel.
    last = None
    scanned = changed = 0
    max_tokens = 0
    pool = ThreadPoolExecutor(max_workers=4)
    futures = []
    while True:
        for attempt in range(6):
            try:
                docs = fetch_page(db, last)
                break
            except Exception as e:  # noqa: BLE001
                print(f"  (okuma hatası, tekrar denenecek: {str(e)[:80]})", flush=True)
                time.sleep(10 * (attempt + 1))
        else:
            raise RuntimeError("sayfa 6 denemede okunamadı")
        if not docs:
            break
        last = docs[-1]
        pending = []
        for doc in docs:
            scanned += 1
            d = doc.to_dict()
            tokens = generate_search_tokens(d.get("name", ""), d.get("tags") or [], ai_search_text(d.get("ai")))
            max_tokens = max(max_tokens, len(tokens))
            if set(tokens) == set(d.get("searchTokens") or []):
                continue
            changed += 1
            pending.append((doc.reference, tokens))
        if not dry_run:
            for i in range(0, len(pending), BATCH_SIZE):
                futures.append(pool.submit(commit_batch, db, pending[i:i + BATCH_SIZE]))
            # geri basınç: bekleyen yazma 12 batch'i aşmasın
            while sum(not f.done() for f in futures) > 12:
                time.sleep(0.5)
        print(f"  ...taranan {scanned}, değişen {changed}", flush=True)
    for f in futures:
        f.result()
    print(f"taranan: {scanned}, güncellenen: {changed}, en büyük token sayısı: {max_tokens}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    run(ap.parse_args().dry_run)
