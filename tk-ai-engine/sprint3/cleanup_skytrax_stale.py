"""
SKYTRAX2026 temizliği (2026-10-06): iki tür bayat Firestore kaydını bulur/siler.
 A) Orphan: yol SKYTRAX2026 altında, dosya sunucuda artık YOK.
 B) Çift: aynı `path`'e birden çok kayıt — scanner'ın deterministik fileId'si
    (sha256("local:"+path)[:32]) olan kanonik kayıt kalır, diğerleri (eski
    klasörden yol-güncellenmiş kopyalar) silinir. Silinen kopyada AI sonucu
    varsa ve kanonik kayıtta yoksa, AI alanları kanonik kayda taşınır.
Silmeden önce her kaydın tam JSON yedeği backups/ altına yazılır.
Usage: uv run python sprint3/cleanup_skytrax_stale.py [--apply]
"""
import argparse, hashlib, json, os, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402

PREFIX = "/Volumes/TRIBAL/THY/ACCOUNT/2026/SKYTRAX2026/"

def main(apply):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    docs = list(db.collection("files").where("path", ">=", PREFIX).where("path", "<", PREFIX[:-1] + "0").stream())
    print(f"SKYTRAX2026 altında {len(docs)} kayıt")
    by_path = defaultdict(list)
    for d in docs:
        by_path[d.to_dict().get("path")].append(d)

    orphans, dups, noncanon_only, transfers = [], [], 0, []
    for path, group in by_path.items():
        if not os.path.exists(path):
            orphans.extend(group)
            continue
        if len(group) > 1:
            canon = hashlib.sha256(f"local:{path}".encode()).hexdigest()[:32]
            keep = [d for d in group if d.id == canon]
            if len(keep) != 1:
                noncanon_only += 1   # kanonik kayıt belirlenemedi -> dokunma
                continue
            others = [d for d in group if d.id != canon]
            dups.extend(others)
            donor = next((d for d in others if (d.to_dict().get("ai") or {}).get("status") == "completed"), None)
            if donor and (keep[0].to_dict().get("ai") or {}).get("status") != "completed":
                transfers.append((keep[0], donor))
    print(f"A) orphan (sunucuda yok): {len(orphans)}")
    print(f"   AI sonucu kanonik kayda taşınacak: {len(transfers)}")
    print(f"B) çift (kanonik olmayan): {len(dups)}  | kanonik belirlenemeyen grup: {noncanon_only}")
    # güvenlik: orphan ile aynı hash'e sahip mevcut bir kayıt var mı (taşınmış ama bulunamamış)?
    live_hashes = {d.to_dict().get("hash") for p, g in by_path.items() if os.path.exists(p) for d in g}
    maybe_moved = [d for d in orphans if d.to_dict().get("hash") in live_hashes]
    print(f"   orphan'lardan hash'i canlı bir kayıtla eşleşen: {len(maybe_moved)}")
    for d in (orphans[:3] + dups[:3]):
        x = d.to_dict(); print("   örnek:", d.id, x.get("name"), x.get("path")[len(PREFIX):])
    if not apply:
        return
    targets = orphans + dups
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bpath = Path(__file__).parent.parent / "backups" / f"skytrax_stale_{stamp}.json"
    bpath.write_text(json.dumps({d.id: d.to_dict() for d in targets}, default=str, ensure_ascii=False))
    print("yedek:", bpath, f"({len(targets)} kayıt)")
    FIELDS = ["ai", "tags", "searchTokens", "description", "descriptionSource", "tagSource", "taggedAt"]
    for keeper, donor in transfers:
        x = donor.to_dict(); k = keeper.to_dict()
        upd = {f: x[f] for f in FIELDS if f in x}
        upd["tags"] = sorted(set(k.get("tags") or []) | set(x.get("tags") or []))
        upd["needs_tagging"] = False
        keeper.reference.update(upd)
    print("AI taşındı:", len(transfers))
    batch, n = db.batch(), 0
    for d in targets:
        batch.delete(d.reference); n += 1
        if n % 400 == 0:
            batch.commit(); batch = db.batch()
    batch.commit()
    print("silindi:", n)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true")
    main(ap.parse_args().apply)
