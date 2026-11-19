"""
Aynı içerikli (aynı hash) dosyalardan arayüzde sadece BİR temsilci görünsün
(2026-10-30, kullanıcı: "arayüzde aynı dosyaların çıkmasını engelleyelim,
sunucudan silmeyelim"). Hiçbir dosya silinmez/taşınmaz; sadece Firestore alanları:

  kopya kayıt:      isDuplicate: true, duplicateOf: <temsilci id>
  temsilci kayıt:   duplicateCount, duplicateIds (≤50), duplicateSearchText
                    + searchTokens, kopyaların adı/klasör etiketlerini de içerir
                    (aksi halde "ucl" gibi bir proje adı aranınca, o projedeki
                    kopya gizlendiği için dosya hiç çıkmazdı)

Temsilci seçimi: AI etiketli > oynatılabilir (videoUploaded false değil) > eski/tam
taranmış kayıt (hash'i hafif taramadan gelmeyen) > kısa yol > id.
Idempotent: tekrar çalıştırılabilir, değişen grupları günceller, artık kopya olmayanları temizler.

Usage: uv run python sprint3/mark_duplicates.py [--dry-run] [--clear]
Yeni tarama/hash sonrası tekrar çalıştırılmalı.
"""
import argparse, sys, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens  # noqa: E402

FIELDS = ["name", "path", "size", "hash", "source", "tags", "scanLevel", "videoUploaded",
          "ai.status", "ai.description", "ai.onScreenText", "isDuplicate", "duplicateOf", "duplicateCount"]


def load_all(db):
    docs, last = [], None
    while True:
        q = db.collection("files").select(FIELDS).order_by("__name__").limit(3000)
        if last is not None:
            q = q.start_after(last)
        page = list(q.stream())
        if not page:
            break
        last = page[-1]
        docs.extend(page)
        print(f"  okundu: {len(docs)}", flush=True)
    return docs


def score(d):
    x = d.to_dict()
    return (
        0 if (x.get("ai") or {}).get("status") == "completed" else 1,
        0 if x.get("videoUploaded") is not False else 1,
        1 if x.get("scanLevel") == "light" else 0,
        len(x.get("path") or ""),
        d.id,
    )


def commit(db, ops):
    b = db.batch()
    for ref, upd in ops:
        b.update(ref, upd)
    for attempt in range(6):
        try:
            b.commit(); return
        except Exception as e:  # noqa: BLE001
            print(f"  (yazma hatası, tekrar: {str(e)[:70]})", flush=True); time.sleep(10 * (attempt + 1))
    raise RuntimeError("batch yazılamadı")


def run(dry, clear):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    docs = load_all(db)
    by_hash = defaultdict(list)
    for d in docs:
        x = d.to_dict()
        if not clear and x.get("source") == "local" and x.get("hash") and (x.get("size") or 0) > 0:
            by_hash[x["hash"]].append(d)
    groups = {h: sorted(v, key=score) for h, v in by_hash.items() if len(v) > 1}

    want_dup, want_canon = {}, {}
    for h, v in groups.items():
        canon, copies = v[0], v[1:]
        for c in copies:
            want_dup[c.id] = canon.id
        tags = sorted({t for c in copies for t in (c.to_dict().get("tags") or [])})
        names = " ".join(c.to_dict().get("name", "") for c in copies)
        want_canon[canon.id] = (canon, copies, tags, names)

    ops_dup, ops_canon, ops_clear = [], [], []
    for d in docs:
        x = d.to_dict()
        if d.id in want_dup:
            if x.get("isDuplicate") is not True or x.get("duplicateOf") != want_dup[d.id]:
                ops_dup.append((d.reference, {"isDuplicate": True, "duplicateOf": want_dup[d.id],
                                              "duplicateCount": firestore.DELETE_FIELD}))
        elif d.id in want_canon:
            canon, copies, tags, names = want_canon[d.id]
            ai = x.get("ai") or {}
            text = (names + " " + ai_search_text({"description": ai.get("description"), "onScreenText": ai.get("onScreenText")})).strip()
            upd = {
                "isDuplicate": firestore.DELETE_FIELD, "duplicateOf": firestore.DELETE_FIELD,
                "duplicateCount": len(copies), "duplicateIds": [c.id for c in copies[:50]],
                "duplicateSearchText": (" ".join(tags) + " " + names)[:4000],
                "searchTokens": generate_search_tokens(x.get("name", ""), sorted(set((x.get("tags") or []) + tags)), text),
            }
            ops_canon.append((d.reference, upd))
        elif x.get("isDuplicate") is True or x.get("duplicateCount"):
            ops_clear.append((d.reference, {
                "isDuplicate": firestore.DELETE_FIELD, "duplicateOf": firestore.DELETE_FIELD,
                "duplicateCount": firestore.DELETE_FIELD, "duplicateIds": firestore.DELETE_FIELD,
                "duplicateSearchText": firestore.DELETE_FIELD,
                "searchTokens": generate_search_tokens(x.get("name", ""), x.get("tags") or [], ai_search_text(
                    {"description": (x.get("ai") or {}).get("description"), "onScreenText": (x.get("ai") or {}).get("onScreenText")})),
            }))
    print(f"çift grup {len(groups)} | gizlenecek kopya {len(want_dup)} | temsilci {len(want_canon)}")
    print(f"yazılacak: kopya {len(ops_dup)}, temsilci {len(ops_canon)}, temizlenecek {len(ops_clear)}")
    if dry:
        return
    pool = ThreadPoolExecutor(max_workers=4)
    futs = []
    for ops, size in ((ops_dup, 200), (ops_canon, 40), (ops_clear, 40)):
        for i in range(0, len(ops), size):
            futs.append(pool.submit(commit, db, ops[i:i + size]))
            while sum(not f.done() for f in futs) > 12:
                time.sleep(0.5)
    for i, f in enumerate(futs):
        f.result()
    print("bitti")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--clear", action="store_true", help="tüm kopya işaretlerini kaldır")
    a = ap.parse_args()
    run(a.dry_run, a.clear)
