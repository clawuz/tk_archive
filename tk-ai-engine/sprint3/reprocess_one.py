"""
Tek bir gerçek dosyayı (fileId ile) context-farkında fix'i doğrulamak için
yeniden işler. process_real_batch.py'nin needs_tagging sorgusuna bağlı
değil — zaten işlenmiş ama düzeltilmesi istenen dosyalar için.

Usage: uv run python sprint3/reprocess_one.py <fileId> [--dry-run]
"""

import argparse
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH, analyze_frames  # noqa: E402
from process_real_batch import frame_list_for, context_for  # noqa: E402
from ai_write import write_completed  # noqa: E402


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="reprocess-one")
    return firestore.client(firebase_admin.get_app("reprocess-one"))


def run(file_id, dry_run):
    db = init_firestore()
    doc_ref = db.collection("files").document(file_id)
    doc = doc_ref.get()
    if not doc.exists:
        print(f"✗ {file_id} bulunamadı")
        return

    data = doc.to_dict()
    name = data.get("name", "?")
    frame_b64_list = frame_list_for(data)
    context = context_for(data)

    print(f"Dosya: {name}")
    print(f"Context: {context}")
    print(f"Eski ai.description: {(data.get('ai') or {}).get('description')}")
    print(f"Eski ai.tags: {(data.get('ai') or {}).get('tags')}")
    print()

    if not frame_b64_list:
        print("✗ görsel veri yok")
        return

    result = analyze_frames(frame_b64_list, context=context)
    print(f"Yeni description: {result['description']}")
    print(f"Yeni tags: {result['tags']}")
    if result["onScreenText"]:
        print(f"Yeni onScreenText: {result['onScreenText']}")

    if not dry_run:
        write_completed(db, doc_ref, data, result)
        print("\n✓ Firestore güncellendi.")
    else:
        print("\n(dry-run — yazılmadı)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file_id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.file_id, args.dry_run)
