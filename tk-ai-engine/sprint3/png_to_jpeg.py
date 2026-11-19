"""
PNG küçük resmi JPEG'e çevirir (Firestore'da inline durdukları için doküman boyutu = arama hızı).
- Gerçekten saydam pikseli olan PNG'ler (logo vb.) olduğu gibi bırakılır: JPEG alfayı korumaz.
- JPEG, PNG'nin %80'inden küçük çıkmazsa da dokunulmaz.

CLI (enrich.cjs kullanır):  python png_to_jpeg.py <dosya.png>   → stdout'a JPEG base64 (çevrilmediyse boş)
Toplu (mevcut kayıtlar):    python png_to_jpeg.py --migrate [--dry-run] [--limit N]
"""
import argparse, base64, io, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

QUALITY = 72
MIN_GAIN = 0.8  # JPEG, PNG'nin en fazla bu oranı kadar olmalı


def convert(png_bytes):
    """-> jpeg bytes ya da None (saydam / kazanç yok / okunamadı)."""
    try:
        im = Image.open(io.BytesIO(png_bytes))
        im.load()
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            rgba = im.convert("RGBA")
            if rgba.getchannel("A").getextrema()[0] < 250:
                return None  # gerçek saydamlık var
            im = rgba.convert("RGB")
        else:
            im = im.convert("RGB")
        out = io.BytesIO()
        im.save(out, "JPEG", quality=QUALITY, optimize=True)
        jpg = out.getvalue()
        return jpg if len(jpg) <= len(png_bytes) * MIN_GAIN else None
    except Exception:  # noqa: BLE001
        return None


def migrate(dry_run, limit):
    import firebase_admin
    from firebase_admin import credentials, firestore
    sys.path.insert(0, str(Path(__file__).parent))
    from worker import SERVICE_ACCOUNT_PATH
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    col = db.collection("files")
    stats = dict(okundu=0, png=0, cevrildi=0, saydam_ya_da_kazanc_yok=0, png_kb=0, jpg_kb=0, hata=0)
    last = None
    pool = ThreadPoolExecutor(6)
    t0 = time.time()
    while True:
        q = col.order_by("__name__").select(["thumbnail"]).limit(300)
        if last is not None:
            q = q.start_after(last)
        for attempt in range(5):
            try:
                docs = list(q.stream())
                break
            except Exception as e:  # noqa: BLE001
                print("  okuma hatası, yeniden:", str(e)[:80], flush=True)
                time.sleep(3 * (attempt + 1))
        else:
            raise SystemExit("okuma 5 denemede başarısız")
        if not docs:
            break
        last = docs[-1]
        stats["okundu"] += len(docs)
        todo = []
        for d in docs:
            url = ((d.to_dict() or {}).get("thumbnail") or {}).get("url") or ""
            if url.startswith("data:image/png;base64,"):
                todo.append((d.reference, base64.b64decode(url.split(",", 1)[1])))
        stats["png"] += len(todo)
        results = list(pool.map(lambda x: convert(x[1]), todo))
        batch = db.batch()
        n = 0
        for (ref, png), jpg in zip(todo, results):
            if jpg is None:
                stats["saydam_ya_da_kazanc_yok"] += 1
                continue
            stats["cevrildi"] += 1
            stats["png_kb"] += len(png) // 1000
            stats["jpg_kb"] += len(jpg) // 1000
            if not dry_run:
                batch.update(ref, {"thumbnail.url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()})
                n += 1
        if n:
            for attempt in range(5):
                try:
                    batch.commit()
                    break
                except Exception as e:  # noqa: BLE001
                    stats["hata"] += 1
                    print("  yazma hatası:", str(e)[:80], flush=True)
                    time.sleep(3 * (attempt + 1))
        if stats["okundu"] % 3000 < 300:
            print(f"  {stats} | {time.time()-t0:.0f} sn", flush=True)
        if limit and stats["okundu"] >= limit:
            break
    print("BİTTİ", stats, f"| {time.time()-t0:.0f} sn", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?")
    ap.add_argument("--migrate", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if a.migrate:
        migrate(a.dry_run, a.limit)
    elif a.path:
        jpg = convert(Path(a.path).read_bytes())
        sys.stdout.write(base64.b64encode(jpg).decode() if jpg else "")
    else:
        ap.error("dosya yolu ya da --migrate")
