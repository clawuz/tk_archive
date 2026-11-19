"""
DENEY (kalıcı değil) — dosya başına 11 model çağrısını (5 kare etiketleme +
5 kare OCR + 1 video özeti) azaltmanın mümkün olup olmadığını test eder.
mlx_vlm.generate() zaten çoklu görsel kabul ediyor (summarize_video() bunu
kullanıyor) — aynı mantığı etiketleme ve OCR'a da uygulayıp TEK çağrıda
tüm kareleri birden analiz etmeyi dener.

RİSK NOTU: plan notlarında (Sprint 3 dönüm noktası) "çoklu kare + JSON
taksonomi" kombinasyonunun daha önce (2B/3B döneminde) dengesiz olduğu
belgelenmiş — taksonomi dışı etiket uydurma, hatta bir seferinde Çince'ye
kayma görülmüş. O zamandan beri VALID_TAGS filtresi eklendi (uydurma
etiketleri zaten siliyor) — bu deney, 7B + VALID_TAGS filtresiyle bu
riskin hâlâ geçerli olup olmadığını, gerçek dosyalarda bilinen-doğru
sonuçlarla karşılaştırarak ölçüyor. Sonuç iyiyse vision.py'ye taşınacak,
değilse sadece kare sayısını azaltma gibi daha güvenli bir yola gidilecek.

Usage: uv run python sprint3/experiment_batched_calls.py
"""

import base64
import json
import re
import sys
import tempfile
import time
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore
from mlx_vlm import generate
from mlx_vlm.prompt_utils import apply_chat_template

sys.path.insert(0, str(Path(__file__).parent))
from vision import TAXONOMY_PROMPT, VALID_TAGS, get_model, _build_prompt, _extract_json  # noqa: E402
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from process_real_batch import frame_list_for, context_for  # noqa: E402


def init_firestore():
    cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
    firebase_admin.initialize_app(cred, name="experiment")
    return firestore.client(firebase_admin.get_app("experiment"))


def decode_frames(frame_b64_list):
    paths = []
    for b64 in frame_b64_list:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(base64.b64decode(b64))
            paths.append(tmp.name)
    return paths


def tag_frames_batch(frame_paths, context=None):
    model, processor, config = get_model()
    prompt_text = _build_prompt(TAXONOMY_PROMPT, context)
    prompt_text += (
        "\n\nBu görseller AYNI videodan sırayla alınmış birden fazla karedir "
        "— hepsini birlikte değerlendir, herhangi bir karede gerçekten "
        "görünen tüm etiketleri BİRLEŞTİRİLMİŞ tek bir listede döndür."
    )
    prompt = apply_chat_template(processor, config, prompt_text, num_images=len(frame_paths))
    result = generate(model, processor, prompt, image=frame_paths, max_tokens=400, temperature=0.0, verbose=False)
    text = result.text if hasattr(result, "text") else str(result)
    parsed = _extract_json(text) or {}
    raw_tags = parsed.get("tags") if isinstance(parsed.get("tags"), list) else []
    tags = [t for t in raw_tags if t in VALID_TAGS]
    description = parsed.get("description") if isinstance(parsed.get("description"), str) else ""
    return tags, description, text


def read_text_batch(frame_paths):
    model, processor, config = get_model()
    prompt_text = (
        "Bu görseller AYNI videodan sırayla alınmış birden fazla karedir. "
        "Her birinde ekrana bindirilmiş bir yazı/metin var mı incele. "
        "Gördüğün FARKLI yazı kartlarının her birini, harfi harfine, ayrı "
        "bir satırda yaz (kareler arasında aynı yazı tekrar ediyorsa sadece "
        "bir kez yaz). Hiç yazı yoksa sadece \"yok\" yaz."
    )
    prompt = apply_chat_template(processor, config, prompt_text, num_images=len(frame_paths))
    result = generate(model, processor, prompt, image=frame_paths, max_tokens=300, temperature=0.0, verbose=False)
    text = (result.text if hasattr(result, "text") else str(result)).strip()
    lines = [l.strip("-* \t\"'") for l in text.split("\n") if l.strip()]
    lines = [l for l in lines if l and not re.fullmatch(r"yok\.?", l, re.IGNORECASE)]
    return lines, text


def main():
    db = init_firestore()

    test_ids = {
        "000d089b4a3b1d11fe3095403e6fd7a1": ("32_C9766.MP4", ["kabin-memuru", "kokpit"], []),
        "000493dcdb1ea4d4dae53d9bc8efe473": ("DJI_20240904010733_0085_D.MP4", ["istanbul", "bogazici", "pist"], []),
        "00088ccb45e8ffb7c4390a1c50d89c03": ("11_A0087.MP4", ["business-lounge", "check-in-alani"], []),
        "00439ee18cc98637f4a2e0274667b263": (
            "TK-Planet-Yeni-Kategoriler-Tanıtımı-Box-Set - 9x16 - EN.mp4",
            ["turkish-airlines", "ucak-tasarimli"],
            ["PLANET TURKISH AIRLINES", "Rewatch Your Favorites",
             "ENJOY NONSTOP SERIES ENTERTAINMENT", "IN OUR BOX SET CATEGORY"],
        ),
    }

    for fid, (name, old_tags, old_text) in test_ids.items():
        doc = db.collection("files").document(fid).get()
        data = doc.to_dict()
        frame_b64_list = frame_list_for(data)
        context = context_for(data)
        frame_paths = decode_frames(frame_b64_list)

        print(f"=== {name} (context: {context}) ===")
        print(f"Eski (per-frame union) tags: {old_tags}")
        print(f"Eski (per-frame) onScreenText: {old_text}")

        t0 = time.time()
        new_tags, new_desc, raw = tag_frames_batch(frame_paths, context=context)
        t1 = time.time()
        print(f"Yeni (batch, 1 çağrı) tags: {new_tags}  [{t1-t0:.1f}s]")
        print(f"  açıklama: {new_desc}")

        t0 = time.time()
        new_text, raw_text = read_text_batch(frame_paths)
        t1 = time.time()
        print(f"Yeni (batch, 1 çağrı) onScreenText: {new_text}  [{t1-t0:.1f}s]")
        print()

        for p in frame_paths:
            Path(p).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
