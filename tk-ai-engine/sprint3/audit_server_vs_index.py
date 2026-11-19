"""
Sunucudaki Turkish Airlines klasörlerini tarar, Firestore'daki `files`
yollarıyla karşılaştırır: hangi dosyalar sunucuda var ama sistemde YOK.
Salt okunur (Firestore'a yazmaz). Çıktı: backups/audit_missing.json + özet.
Usage: uv run python sprint3/audit_server_vs_index.py
"""
import json, os, subprocess, sys, time
from collections import defaultdict
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402

BASE = "/Volumes/TRIBAL"
ROOTS = [
    "THY/CREATIVE/2024/TurkishAirlines",
    "THY/CREATIVE/2025/TurkishAirlines",
    "THY/CREATIVE/2026/TurkishAirlines",
    "2023/THY/YARATICI_EKIP/TurkishAirlines",
    "THY/CREATIVE/2023/Turkish-Airlines",
]


def walk(root):
    out = []
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.name.startswith("."):
                        continue
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        elif e.is_file(follow_symlinks=False):
                            out.append((e.path, e.stat().st_size))
                    except OSError:
                        pass
        except OSError as ex:
            print(f"  (okunamadı: {d}: {ex})", flush=True)
    return out


def main():
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    print("Firestore yolları çekiliyor...", flush=True)
    indexed = set()
    for d in db.collection("files").where("source", "==", "local").select(["path"]).stream():
        indexed.add(d.to_dict().get("path"))
    print(f"  {len(indexed)} kayıtlı yol", flush=True)

    result = {}
    for rel in ROOTS:
        root = f"{BASE}/{rel}"
        if not os.path.isdir(root):
            print(f"[yok] {rel}", flush=True)
            continue
        t = time.time()
        files = walk(root)
        by_sub = defaultdict(lambda: {"disk": 0, "indexed": 0, "missing": [], "missing_bytes": 0})
        for path, size in files:
            sub = path[len(root) + 1:].split("/")[0] if "/" in path[len(root) + 1:] else "(kök)"
            b = by_sub[sub]
            b["disk"] += 1
            if path in indexed:
                b["indexed"] += 1
            else:
                b["missing"].append(path)
                b["missing_bytes"] += size
        tot = sum(b["disk"] for b in by_sub.values())
        miss = sum(len(b["missing"]) for b in by_sub.values())
        print(f"[{rel}] disk {tot}, sistemde yok {miss}  ({time.time()-t:.0f} sn)", flush=True)
        result[rel] = {k: v for k, v in by_sub.items()}
    out = Path(__file__).parent.parent / "backups" / "audit_missing.json"
    out.write_text(json.dumps(result, ensure_ascii=False))
    print("yazıldı:", out, flush=True)


if __name__ == "__main__":
    main()
