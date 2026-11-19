"""
Hafif taramayla (scanLight.cjs) gelen kayıtlarda `hash` yok (null). Bu script
sunucudaki dosyaları okuyup sha256 hesaplar (scanner.cjs ile aynı biçim:
"sha256:<hex>") ve çift dosya raporu çıkarır. Salt-okunur dosya erişimi;
Firestore'a sadece `hash`, `hashedAt`, `needs_hash`, (bulunamazsa) `hashStatus` yazar.

Usage:
  uv run python sprint3/hash_files.py --flag      # hash'i null olanlara needs_hash=True koy
  uv run python sprint3/hash_files.py             # hash'le (yıl önceliği: enrichTier 1→4)
  uv run python sprint3/hash_files.py --report    # çift dosya raporu → backups/duplicates.json
"""
import argparse, hashlib, json, os, sys, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402

MOUNT = "/Volumes/TRIBAL"
THREADS = 4
CHUNK = 8 << 20


def init():
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    return firestore.client()


def flag(db):
    n, last = 0, None
    while True:
        q = db.collection("files").where("hash", "==", None).select(["needs_hash"]).order_by("__name__").limit(400)
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            break
        last = docs[-1]
        b = db.batch()
        c = 0
        for d in docs:
            if d.to_dict().get("needs_hash") is not True:
                b.update(d.reference, {"needs_hash": True}); c += 1
        if c:
            b.commit(); n += c
        print(f"  işaretlendi: {n}", flush=True)
    print("needs_hash işaretlenen toplam:", n)


def sha(path):
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        while True:
            b = f.read(CHUNK)
            if not b:
                break
            h.update(b); size += len(b)
    return "sha256:" + h.hexdigest(), size


def work(doc):
    x = doc.to_dict()
    p = x.get("path")
    try:
        if not os.path.exists(p):
            doc.reference.update({"needs_hash": False, "hashStatus": "missing"})
            return 0, "missing"
        h, size = sha(p)
        doc.reference.update({"hash": h, "hashedAt": int(time.time() * 1000), "needs_hash": False})
        return size, "ok"
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {x.get('name')}: {e}", flush=True)
        return 0, "err"


def run(db):
    done = total_bytes = missing = errs = 0
    t0 = time.time()
    pool = ThreadPoolExecutor(max_workers=THREADS)
    while True:
        if not os.path.isdir(MOUNT) or not os.listdir(MOUNT):
            print("sunucu bağlı değil, 60 sn bekleniyor...", flush=True); time.sleep(60); continue
        docs = []
        for tier in (1, 2, 3, 4):
            docs = list(db.collection("files").where("needs_hash", "==", True).where("enrichTier", "==", tier).limit(60).stream())
            if docs:
                break
        if not docs:
            docs = list(db.collection("files").where("needs_hash", "==", True).limit(60).stream())
        if not docs:
            break
        for size, st in pool.map(work, docs):
            done += 1; total_bytes += size
            missing += st == "missing"; errs += st == "err"
        el = time.time() - t0
        print(f"  {done} dosya | {total_bytes/1e9:.1f} GB | {total_bytes/1e6/el:.0f} MB/s | eksik {missing} | hata {errs}", flush=True)
    print(f"bitti: {done} dosya, {total_bytes/1e9:.1f} GB, eksik {missing}, hata {errs}")


def report(db):
    by_hash = defaultdict(list)
    n, last = 0, None
    while True:
        q = db.collection("files").select(["name", "path", "size", "hash", "source"]).order_by("__name__").limit(3000)
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            break
        last = docs[-1]
        for d in docs:
            x = d.to_dict(); n += 1
            if x.get("hash") and (x.get("size") or 0) > 0:
                by_hash[x["hash"]].append({"id": d.id, "name": x.get("name"), "path": x.get("path"), "size": x.get("size")})
    groups = {h: v for h, v in by_hash.items() if len(v) > 1}
    wasted = sum((len(v) - 1) * v[0]["size"] for v in groups.values())
    copies = sum(len(v) - 1 for v in groups.values())
    out = Path(__file__).parent.parent / "backups" / "duplicates.json"
    out.write_text(json.dumps(groups, ensure_ascii=False))
    print(f"kayıt {n} | hash'li {sum(len(v) for v in by_hash.values())} | çift grup {len(groups)} | fazla kopya {copies} | boşa giden {wasted/1e9:.1f} GB")
    top = sorted(groups.values(), key=lambda v: -(len(v) - 1) * v[0]["size"])[:10]
    for v in top:
        print(f"  {len(v)} kopya × {v[0]['size']/1e6:.0f} MB — {v[0]['name']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--flag", action="store_true")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    db = init()
    if a.flag:
        flag(db)
    elif a.report:
        report(db)
    else:
        run(db)
