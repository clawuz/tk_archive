"""
DENEY #2 (kalıcı değil) — deney #1 (çoklu-kare TEK çağrı) 4 dosyanın
1'inde tamamen boş sonuç üretti (plan notlarındaki "çoklu kare + JSON
taksonomi dengesiz" uyarısını doğruladı) — üretime alınmadı.

Bu deney daha güvenli bir konsolidasyonu test ediyor: KARE-İÇİ birleştirme
(cross-frame değil) — her kare hâlâ AYRI AYRI, tek görsel olarak
işleniyor (mevcut, kanıtlanmış mimari korunuyor), ama o tek karedeki iki
farklı soru (etiketleme + ekran metni) artık iki ayrı çağrı yerine TEK
çağrıda soruluyor. Dosya başına çağrı sayısı: 5 etiket + 5 OCR + 1 özet
= 11  →  5 kombine + 1 özet = 6 (~%45 azalma).

Karşılaştırma, 20 dosyalık partide zaten doğrulanmış (context-fix +
tekrar-önleme sonrası) gerçek Firestore sonuçlarına karşı yapılıyor.

Usage: uv run python sprint3/experiment_combined_frame_call.py
"""

import json
import re
import sys
import time
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore
from mlx_vlm import generate
from mlx_vlm.prompt_utils import apply_chat_template

sys.path.insert(0, str(Path(__file__).parent))
from vision import (  # noqa: E402
    TAXONOMY_PROMPT, VALID_TAGS, get_model, _build_prompt, _extract_json,
    _NO_TEXT_SENTENCE,
)
from worker import SERVICE_ACCOUNT_PATH, _decode_frames  # noqa: E402
from process_real_batch import frame_list_for, context_for  # noqa: E402
from video_text_dedupe_helper import dedupe_texts  # noqa: E402


COMBINED_PROMPT = TAXONOMY_PROMPT.replace(
    'SADECE şu formatta cevap ver, başka hiçbir şey ekleme: {"tags": ["..."], "description": "..."}',
    'Ayrıca, bu görselde ekrana bindirilmiş herhangi bir yazı/metin var mı '
    'incele — varsa harfi harfine, tam olarak yaz; yoksa null bırak.\n\n'
    'SADECE şu formatta cevap ver, başka hiçbir şey ekleme: '
    '{"tags": ["..."], "description": "...", "on_screen_text": "..." veya null}'
)


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="experiment2")
    return firestore.client(firebase_admin.get_app("experiment2"))


def analyze_frame_combined(image_path, context=None):
    model, processor, config = get_model()
    prompt_text = _build_prompt(COMBINED_PROMPT, context)
    prompt = apply_chat_template(processor, config, prompt_text, num_images=1)
    result = generate(model, processor, prompt, image=[image_path], max_tokens=400, temperature=0.0, verbose=False)
    text = result.text if hasattr(result, "text") else str(result)
    parsed = _extract_json(text) or {}

    raw_tags = parsed.get("tags") if isinstance(parsed.get("tags"), list) else []
    tags = [t for t in raw_tags if t in VALID_TAGS]
    description = parsed.get("description") if isinstance(parsed.get("description"), str) else ""

    ost = parsed.get("on_screen_text")
    on_screen_text = None
    if isinstance(ost, str):
        stripped = ost.strip('"\'. ').strip()
        if len(stripped) > 5 and not (_NO_TEXT_SENTENCE.search(stripped) and len(stripped) < 120):
            on_screen_text = ost.strip()

    return {"tags": tags, "description": description, "on_screen_text": on_screen_text}


def main():
    db = init_firestore()
    test_ids = {
        "000d089b4a3b1d11fe3095403e6fd7a1": "32_C9766.MP4",
        "000493dcdb1ea4d4dae53d9bc8efe473": "DJI_20240904010733_0085_D.MP4",
        "00088ccb45e8ffb7c4390a1c50d89c03": "11_A0087.MP4",
        "00238bc95ba1205b970d05dd93d293c5": "17_YGZ0036.MP4",
        "00439ee18cc98637f4a2e0274667b263": "TK-Planet-Yeni-Kategoriler-Tanıtımı-Box-Set - 9x16 - EN.mp4",
    }
    # TK-Planet dry-run'dan bilinen doğru sonuç (Firestore'a yazılmamıştı)
    extra_ground_truth = {
        "00439ee18cc98637f4a2e0274667b263": (
            ["turkish-airlines", "ucak-tasarimli"],
            ["PLANET TURKISH AIRLINES", "Rewatch Your Favorites",
             "ENJOY NONSTOP SERIES ENTERTAINMENT", "IN OUR BOX SET CATEGORY"],
        )
    }

    for fid, name in test_ids.items():
        doc = db.collection("files").document(fid).get()
        data = doc.to_dict()
        ai = data.get("ai") or {}
        if fid in extra_ground_truth:
            old_tags, old_text = extra_ground_truth[fid]
        else:
            old_tags = ai.get("tags") or []
            old_text = ai.get("onScreenText") or []

        frame_b64_list = frame_list_for(data)
        context = context_for(data)
        frame_paths = _decode_frames(frame_b64_list)

        print(f"=== {name} (context: {context}) ===")
        print(f"Firestore (eski, doğrulanmış) tags: {old_tags}")
        print(f"Firestore (eski, doğrulanmış) onScreenText: {old_text}")

        t0 = time.time()
        all_tags, raw_texts = [], []
        for p in frame_paths:
            r = analyze_frame_combined(p, context=context)
            for t in r["tags"]:
                if t not in all_tags:
                    all_tags.append(t)
            raw_texts.append(r["on_screen_text"])
        elapsed = time.time() - t0

        distinct_text = dedupe_texts(raw_texts)
        print(f"Yeni (kombine, kare-başı 1 çağrı) tags: {all_tags}  [{elapsed:.1f}s, {len(frame_paths)} kare]")
        print(f"Yeni (kombine) onScreenText: {distinct_text}")
        print()

        for p in frame_paths:
            Path(p).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
