"""
Sprint 3 POC: Mac AI Worker — polls Firestore for pending docs, tags them
locally, writes results back. This talks ONLY to a dedicated test
collection (`ai_worker_dev_test`), never `files` (the real production
collection tk_archive's app reads from) — this is deliberate: v2 is being
proven out without touching the running app or its data at all. Moving
this to write into `files.ai` is a separate, later decision.

No Storage/Drive download step: real `files` docs already carry a small
thumbnail or the first few video-preview frames as inline base64 (see
tk_archive/functions/tagNewFiles.js, which consumes the exact same
fields) — the worker decodes `frameDataBase64` (single frame, e.g. an
image's thumbnail) or `frameDataBase64List` (multiple frames, e.g. a
video's videoPreviewFrames) straight out of the Firestore doc, matching
how the real system already works, rather than re-fetching bytes from
Storage. Multi-frame docs get tags unioned across every frame, on-screen
text extracted per frame (sprint2/video_text.py), and a narrative
video-level summary (vision.py's summarize_video) instead of a single
frame's description.

Usage: uv run python sprint3/worker.py [--once]
  --once   process whatever's pending right now, then exit (for testing).
           Without it, the worker polls forever (Ctrl+C to stop).
"""

import argparse
import base64
import sys
import tempfile
import time
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "sprint2"))
from vision import MODEL, summarize_video, tag_image
from video_text import extract_video_supers

TEST_COLLECTION = "ai_worker_dev_test"
POLL_INTERVAL_SECONDS = 5

# Reuses the same service account key tk_archive's own Node scripts use
# for Admin SDK access this session — same project, same permissions.
SERVICE_ACCOUNT_PATH = (
    Path(__file__).parent.parent.parent
    / "tk_archive/functions/config/serviceAccountKey.json"
)


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred)
    return firestore.client()


def _decode_frames(frame_b64_list):
    tmp_paths = []
    for b64 in frame_b64_list:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(base64.b64decode(b64))
            tmp_paths.append(tmp.name)
    return tmp_paths


def analyze_frames(frame_b64_list, context=None):
    """
    Shared core: base64 frames -> {tags, description, onScreenText, model}
    (or raises). Used by both process_doc (test collection) and
    sprint3/process_real_batch.py (real files collection) so the two
    don't drift apart.

    context: optional folder path / existing folder-derived tags for the
    file these frames came from — passed through to tag_image/
    summarize_video so the model isn't guessing blind on location/subject
    when the answer is already sitting in the file's own path (see
    vision.py's _build_prompt for the motivating example).
    """
    if not frame_b64_list:
        raise ValueError("frameDataBase64 / frameDataBase64List missing")

    tmp_paths = []
    try:
        tmp_paths = _decode_frames(frame_b64_list)

        # Tags: union across every frame — a video shows different things
        # in different frames, so tagging only the first would miss most
        # of it. Dedup while preserving first-seen order.
        all_tags = []
        first_description = None
        for path in tmp_paths:
            result = tag_image(path, context=context)
            if first_description is None:
                first_description = result["description"]
            for tag in result["tags"]:
                if tag not in all_tags:
                    all_tags.append(tag)

        on_screen_text = extract_video_supers(tmp_paths)

        # A single frame doesn't have a "narrative" to summarize — only
        # call the multi-frame summary when there's actually more than one.
        video_summary = summarize_video(tmp_paths, context=context) if len(tmp_paths) > 1 else None
        description = video_summary or first_description

        return {
            "tags": all_tags,
            "description": description,
            "onScreenText": on_screen_text,
            "model": MODEL,
        }
    finally:
        for p in tmp_paths:
            Path(p).unlink(missing_ok=True)


def process_doc(db, doc):
    data = doc.to_dict()
    # Single-frame docs (an image, or a video with only one stored preview
    # frame) use frameDataBase64; multi-frame video docs use
    # frameDataBase64List — both mirror real `files` doc shapes
    # (thumbnail vs. videoPreviewFrames).
    frame_b64_list = data.get("frameDataBase64List") or (
        [data["frameDataBase64"]] if data.get("frameDataBase64") else []
    )
    print(f"\n→ Processing {doc.id} ({data.get('name', '?')}) — {len(frame_b64_list)} kare")

    doc.reference.update({"ai.status": "processing"})
    context = data.get("name")

    try:
        result = analyze_frames(frame_b64_list, context=context)
    except Exception as e:
        doc.reference.update({
            "ai.status": "failed",
            "ai.error": str(e),
            "ai.processedAt": firestore.SERVER_TIMESTAMP,
        })
        print(f"  ✗ failed: {e}")
        return

    doc.reference.update({
        "ai.status": "completed",
        "ai.tags": result["tags"],
        "ai.description": result["description"],
        "ai.onScreenText": result["onScreenText"],
        "ai.model": result["model"],
        "ai.processedAt": firestore.SERVER_TIMESTAMP,
    })
    print(f"  ✓ completed — {len(result['tags'])} tags: {result['tags']}")
    if result["onScreenText"]:
        print(f"    metin kartları: {result['onScreenText']}")


def run(once=False):
    db = init_firestore()
    print(f"Mac AI Worker started — watching '{TEST_COLLECTION}' (test collection, not production).")

    while True:
        pending = (
            db.collection(TEST_COLLECTION)
            .where("ai.status", "==", "pending")
            .limit(5)
            .stream()
        )
        found_any = False
        for doc in pending:
            found_any = True
            process_doc(db, doc)

        if once:
            if not found_any:
                print("Nothing pending.")
            break

        if not found_any:
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="process pending docs once, then exit")
    args = parser.parse_args()
    run(once=args.once)
