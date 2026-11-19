"""
Seeds a doc into the ai_worker_dev_test Firestore collection so
worker.py has something to process. Writes ONLY to that dedicated test
collection — never touches `files` (production).

Seeds with ALL of a real video's preview frames' base64 data, copied
(read-only) from an actual `files` doc — matches production's real data
shape (`videoPreviewFrames[].frameData`) so the worker is tested against
realistic, multi-frame input (needed for OCR + video-summary, not just
single-frame tagging).

Usage: uv run python sprint3/seed_test_docs.py
"""

from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

TEST_COLLECTION = "ai_worker_dev_test"
SERVICE_ACCOUNT_PATH = (
    Path(__file__).parent.parent.parent
    / "tk_archive/functions/config/serviceAccountKey.json"
)

# Read-only reference to one real file's preview frames — copied into the
# test collection, production doc itself untouched.
SOURCE_FILE_ID = "000493dcdb1ea4d4dae53d9bc8efe473"


def main():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    source = db.collection("files").document(SOURCE_FILE_ID).get()
    if not source.exists:
        print(f"Source doc {SOURCE_FILE_ID} not found — nothing seeded.")
        return
    source_data = source.to_dict()
    frames = source_data.get("videoPreviewFrames") or []
    if not frames:
        print(f"Source doc {SOURCE_FILE_ID} has no videoPreviewFrames — nothing seeded.")
        return

    ref = db.collection(TEST_COLLECTION).document()
    ref.set({
        "name": f"{source_data.get('name', '?')} (copied frames, read-only test)",
        "sourceFileId": SOURCE_FILE_ID,
        "frameDataBase64List": [f["frameData"] for f in frames],
        "ai": {"status": "pending"},
        "seededAt": firestore.SERVER_TIMESTAMP,
    })
    print(f"Seeded {ref.id} — {len(frames)} kare, {SOURCE_FILE_ID} ({source_data.get('name')})")


if __name__ == "__main__":
    main()
