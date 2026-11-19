"""
Sprint 2 — video "süper" (ekrana bindirilmiş metin/title card) okuma.

Qwen2.5-VL-7B ile tek geçişte (temperature=0, çoklu-örnekleme gerekmeden)
güvenilir sonuç veriyor (bkz. plan notları, 2026-09-04) — Qwen2-VL-2B'nin
ihtiyaç duyduğu çoklu-örnekleme + ağır gürültü filtreleme artık gerekli
değil. Asıl okuma mantığı sprint3/vision.py'de (read_frame_text) — bu
dosya sadece bir videonun kareleri üzerinde gezip sonuçları birleştiriyor.

Usage: uv run python sprint2/video_text.py <frames-dir>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "sprint3"))
from vision import read_frame_text  # noqa: E402


def _similar(a, b):
    # Cheap near-duplicate check for consecutive frames of the same title
    # card — exact match, or one is a prefix/substring of the other
    # (common when a card is still animating in/out at the sampled frame).
    a, b = a.lower(), b.lower()
    return a == b or a in b or b in a


def extract_video_supers(frame_paths):
    """
    frame_paths: ordered list of image paths, sampled across a video's
    duration. Returns a deduplicated, ordered list of distinct on-screen
    texts.
    """
    raw = [read_frame_text(p) for p in frame_paths]

    distinct = []
    for text in raw:
        if not text:
            continue
        if distinct and _similar(distinct[-1], text):
            if len(text) > len(distinct[-1]):
                distinct[-1] = text
            continue
        distinct.append(text)

    return distinct


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python sprint2/video_text.py <frames-dir>")
        sys.exit(1)

    frames_dir = Path(sys.argv[1])
    frame_paths = sorted(frames_dir.glob("*.jpg"))
    print(f"{len(frame_paths)} kare okunuyor...")

    supers = extract_video_supers([str(p) for p in frame_paths])
    print(f"\n✅ {len(supers)} farklı metin kartı bulundu:")
    for s in supers:
        print(f"  - {s}")
