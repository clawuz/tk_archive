"""
Sprint 2 — gerçek sahne tespiti + sahne başına keyframe çıkarımı.

Önceki yaklaşım (bu proje boyunca kullanılan) sabit aralıklarla
(saniyede 1 kare) örnekleme yapıyordu — bir sahnenin ortasını
kaçırabilir ya da aynı sahneden gereksiz çok kare çıkarabilirdi.
PySceneDetect'in ContentDetector'ı, kare-arası piksel farkına bakarak
gerçek kesme noktalarını (cut'ları) buluyor — FFmpeg binary'sine gerek
yok, OpenCV video okuma yeterli (bu makinede ffmpeg kurulu değil).

Her sahne için TEK bir temsili kare (sahnenin ortası — başlangıç/bitişte
genelde geçiş/blur oluyor) çıkarılır. Bu, hem VLM çağrı sayısını daha
isabetli tutar (sahne sayısı kadar, saniye sayısı kadar değil) hem de
"animasyonlu süper" sorununu kısmen çözer — sahnenin ortası genelde metin
kartının tam oturduğu, hareketsiz an.

Usage: uv run python sprint2/scene_detect.py <video-path> [--out-dir DIR]
"""

import sys
from pathlib import Path

import cv2
from scenedetect import ContentDetector, SceneManager, open_video


def detect_scenes(video_path, threshold=27.0):
    """
    Returns a list of (start_frame, end_frame, start_time_sec, end_time_sec)
    tuples. threshold is PySceneDetect's ContentDetector sensitivity —
    27.0 is the library's own documented default, a reasonable middle
    ground between over-splitting (too low) and missing real cuts (too high).
    """
    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()

    if not scene_list:
        # No cuts detected at all — PySceneDetect returns an empty list
        # instead of "one scene spanning the whole video" in that case.
        total_frames = int(video.duration.get_frames())
        return [(0, total_frames, 0.0, video.duration.get_seconds())]

    return [
        (start.frame_num, end.frame_num, start.seconds, end.seconds)
        for start, end in scene_list
    ]


def extract_scene_keyframes(video_path, scenes, out_dir):
    """
    One representative frame per scene (the midpoint), saved as JPEGs in
    out_dir. Returns a list of {index, start_sec, end_sec, path}.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    results = []
    for i, (start_frame, end_frame, start_sec, end_sec) in enumerate(scenes):
        mid_frame = (start_frame + end_frame) // 2
        cap.set(cv2.CAP_PROP_POS_FRAMES, mid_frame)
        ok, frame = cap.read()
        if not ok:
            continue
        path = out_dir / f"scene_{i:02d}.jpg"
        cv2.imwrite(str(path), frame)
        results.append({
            "index": i,
            "start_sec": round(start_sec, 2),
            "end_sec": round(end_sec, 2),
            "path": str(path),
        })
    cap.release()
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("video_path")
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()

    out_dir = args.out_dir or (Path(args.video_path).parent / "scenes")

    scenes = detect_scenes(args.video_path)
    print(f"{len(scenes)} sahne bulundu:")
    for i, (sf, ef, ss, es) in enumerate(scenes):
        print(f"  Sahne {i}: {ss:.1f}s - {es:.1f}s ({ef - sf} kare)")

    keyframes = extract_scene_keyframes(args.video_path, scenes, out_dir)
    print(f"\n{len(keyframes)} keyframe çıkarıldı -> {out_dir}")
    for kf in keyframes:
        print(f"  {kf['path']} ({kf['start_sec']}s-{kf['end_sec']}s)")
