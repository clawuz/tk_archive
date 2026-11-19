"""
2026-10-02: THY SKYTRAX PROJELER 2026'daki fotoğraf/video dosyaları
sunucuda "skytraxlast/..." klasöründen "THY SKYTRAX PROJELER 2026/..."
altındaki temalı alt klasörlere (ABBEY ROAD, FOTOS, london eye, vb.)
taşınmış — Firestore'daki `path` alanları hâlâ eski (artık boş) konumu
gösteriyor. Bu script dosya adına göre yeni konumu bulup, isim çakışması
olan dosyalarda (aynı isim birden fazla yerde) scanner.cjs'in kaydettiği
`hash` (sha256) ile içerik bazlı kesin eşleştirme yapıp `path` alanını
günceller. SADECE `path` güncellenir — hash/tags/ai.* gibi diğer hiçbir
alana dokunulmaz.

Usage: uv run python sprint3/reconcile_skytrax_paths.py [--dry-run]
"""

import argparse
import hashlib
import sys
from collections import defaultdict
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402

OLD_PREFIX = "/Volumes/TRIBAL/THY/ACCOUNT/2026/SKYTRAX2026/skytraxlast/"
NEW_ROOT = Path("/Volumes/TRIBAL/THY/ACCOUNT/2026/SKYTRAX2026/THY SKYTRAX PROJELER 2026")


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="reconcile_skytrax")
    return firestore.client(firebase_admin.get_app("reconcile_skytrax"))


def build_filename_index():
    index = defaultdict(list)
    for p in NEW_ROOT.rglob("*"):
        if p.is_file() and not p.name.startswith("."):
            index[p.name].append(p)
    return index


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def run(dry_run):
    db = init_firestore()
    print("Yeni klasör ağacı indeksleniyor...")
    index = build_filename_index()
    print(f"{sum(len(v) for v in index.values())} dosya, {len(index)} benzersiz ad bulundu.\n")

    docs = list(
        db.collection("files")
        .where("path", ">=", OLD_PREFIX)
        .where("path", "<", OLD_PREFIX[:-1] + "0")
        .stream()
    )
    print(f"{len(docs)} Firestore kaydı eski konumu gösteriyor.\n")

    updated, not_found, ambiguous, hash_mismatch = 0, 0, 0, 0
    not_found_list = []
    ambiguous_list = []

    for doc in docs:
        data = doc.to_dict()
        old_path = data.get("path") or ""
        name = Path(old_path).name
        candidates = index.get(name) or []

        if not candidates:
            not_found += 1
            not_found_list.append(name)
            continue

        if len(candidates) == 1:
            new_path = candidates[0]
        else:
            # İsim çakışması — içerik hash'i ile kesin eşleştir.
            stored_hash = data.get("hash")
            match = None
            for cand in candidates:
                try:
                    if file_hash(cand) == stored_hash:
                        match = cand
                        break
                except OSError:
                    continue
            if match is None:
                ambiguous += 1
                ambiguous_list.append(name)
                continue
            new_path = match

        print(f"  {'[dry-run] ' if dry_run else ''}{name}: ...{old_path[len(OLD_PREFIX)-20:]} -> {new_path}")
        if not dry_run:
            doc.reference.update({"path": str(new_path)})
        updated += 1

    print(f"\nBitti — güncellenen: {updated}, bulunamayan: {not_found}, hash uyuşmayan: {ambiguous}")
    if not_found_list:
        print(f"\nBulunamayanlar (ilk 20): {not_found_list[:20]}")
    if ambiguous_list:
        print(f"\nHash uyuşmayanlar (ilk 20): {ambiguous_list[:20]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
