"""
Daha önce v2 ile işlenmiş (ai.model == vision.py'deki yerel model)
gerçek dosyaların TÜMÜNÜ, context-farkında fix ile yeniden işler.
11_A0087.MP4 bug'ının (klasör bağlamı yok sayılıyordu) sadece o dosyaya
özgü olmadığını, aynı partideki diğer dosyaları da etkileyebileceğini
doğrulamak/düzeltmek için.

Usage: uv run python sprint3/reprocess_batch.py [--dry-run]
"""

import argparse
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from vision import MODEL  # noqa: E402
from worker import SERVICE_ACCOUNT_PATH, analyze_frames  # noqa: E402
from process_real_batch import frame_list_for, context_for  # noqa: E402
from ai_write import write_completed  # noqa: E402


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="reprocess-batch")
    return firestore.client(firebase_admin.get_app("reprocess-batch"))


def run(dry_run):
    db = init_firestore()
    docs = list(db.collection("files").where("ai.model", "==", MODEL).stream())
    print(f"{len(docs)} daha önce v2 ile işlenmiş dosya bulundu.\n")

    changed, unchanged, failed = 0, 0, 0
    for doc in docs:
        data = doc.to_dict()
        name = data.get("name", "?")
        old_ai = data.get("ai") or {}
        frame_b64_list = frame_list_for(data)
        context = context_for(data)

        if not frame_b64_list:
            print(f"  ⏭  {doc.id} ({name}) — görsel veri yok")
            continue

        try:
            result = analyze_frames(frame_b64_list, context=context)
        except Exception as e:
            print(f"  ✗ {doc.id} ({name}) — hata: {e}")
            failed += 1
            continue

        desc_changed = result["description"] != old_ai.get("description")
        tags_changed = set(result["tags"]) != set(old_ai.get("tags") or [])
        marker = "~" if (desc_changed or tags_changed) else " "
        print(f"  {marker} {doc.id} ({name}) [context: {context}]")
        if desc_changed:
            changed += 1
        else:
            unchanged += 1

        if not dry_run:
            write_completed(db, doc.reference, data, result)

    print(f"\nBitti — açıklama değişen: {changed}, değişmeyen: {unchanged}, hata: {failed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
