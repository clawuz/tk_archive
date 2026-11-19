"""
Sprint 6 hibrit POC: embedding ön-filtreleme (SigLIP) + VLM son karar
(Qwen2-VL). Sprint 1'in bulgusu buydu: VLM küçük listede (~10-15 etiket)
güvenilir. Bu script önce SigLIP ile en olası N etiketi bulur, sonra
SADECE bu kısa listeyi VLM'e sorup nihai {tags, description} üretir.

Eşik altında kalan (hiçbir şey gerçekten uymuyor) kareler için VLM'e hiç
sormadan boş sonuç döner — hem hız hem doğruluk kazancı.

Usage: uv run python sprint6/hybrid_tag.py <path-to-image>
"""

import json
import re
import sys

import mlx.core as mx
import mlx_embeddings
from PIL import Image

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

EMBED_MODEL = "mlx-community/siglip-large-patch16-384"
VLM_MODEL = "mlx-community/Qwen2-VL-2B-Instruct-4bit"
TOP_K = 12
SCORE_THRESHOLD = 0.02  # frame_0/frame_2 testinde "hiçbir şey uymuyor" hep bu eşiğin altındaydı

TAG_DESCRIPTIONS = {
    "a350": "an Airbus A350 airplane", "a321": "an Airbus A321 airplane",
    "a330": "an Airbus A330 airplane", "b737": "a Boeing 737 airplane",
    "b777": "a Boeing 777 airplane", "b787": "a Boeing 787 Dreamliner airplane",
    "dreamliner": "a Boeing 787 Dreamliner airplane",
    "c-47": "a vintage C-47 propeller airplane",
    "de-havilland": "a vintage De Havilland propeller airplane",
    "fokker": "a vintage Fokker propeller airplane",
    "junkers": "a vintage Junkers propeller airplane",
    "curtiss-kingbird": "a vintage Curtiss Kingbird twin-boom propeller airplane",
    "ucak-tasarimli": "an airplane-shaped design on a product",
    "kabin-memuru": "a flight attendant in uniform", "pilot": "an airline pilot in the cockpit",
    "yer-hizmetleri": "airport ground crew staff",
    "check-in-personeli": "an airline check-in desk staff member",
    "business-class": "an airplane business class cabin seat",
    "economy-class": "an airplane economy class cabin seat",
    "first-class": "an airplane first class cabin suite",
    "business-lounge": "an airport business lounge interior",
    "gate": "an airport departure gate", "kokpit": "an airplane cockpit with instruments",
    "kabin-ici": "the interior of an airplane cabin", "pist": "an airport runway",
    "terminal": "an airport terminal building",
    "istanbul": "the city of Istanbul skyline or landmarks",
    "kalkis": "an airplane taking off", "inis": "an airplane landing",
    "seyir": "an airplane flying in the sky", "binis": "passengers boarding an airplane",
    "turkish-airlines": "the Turkish Airlines logo or livery",
    "tk-store": "a studio product photo of merchandise", "oyuncak": "a toy airplane model",
    "kurumsal-film": "a cinematic corporate film scene with actors",
    "reklam-filmi": "a commercial advertisement film scene",
}

_embed_model = None
_embed_processor = None
_text_embed_cache = None


def get_embed_model():
    global _embed_model, _embed_processor
    if _embed_model is None:
        _embed_model, _embed_processor = mlx_embeddings.load(EMBED_MODEL)
    return _embed_model, _embed_processor


def get_text_embeddings():
    global _text_embed_cache
    if _text_embed_cache is None:
        model, processor = get_embed_model()
        tags = list(TAG_DESCRIPTIONS.keys())
        phrases = [f"a photo of {TAG_DESCRIPTIONS[t]}" for t in tags]
        text_inputs = processor(text=phrases, padding="max_length", return_tensors="mlx")
        text_embed = model.get_text_features(input_ids=text_inputs["input_ids"])
        text_embed = text_embed / mx.linalg.norm(text_embed, axis=-1, keepdims=True)
        _text_embed_cache = (tags, text_embed)
    return _text_embed_cache


def shortlist_tags(image_path):
    model, processor = get_embed_model()
    tags, text_embed = get_text_embeddings()

    img = Image.open(image_path).convert("RGB").resize((224, 224))
    img_inputs = processor(images=[img], return_tensors="mlx")
    img_embed = model.get_image_features(pixel_values=img_inputs["pixel_values"])
    img_embed = img_embed / mx.linalg.norm(img_embed, axis=-1, keepdims=True)

    sims = (img_embed @ text_embed.T)[0]
    scored = sorted([(tags[i], float(sims[i])) for i in range(len(tags))], key=lambda x: -x[1])
    return [(t, s) for t, s in scored[:TOP_K] if s >= SCORE_THRESHOLD]


def _extract_json(text):
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def vlm_final_decision(image_path, shortlist):
    if not shortlist:
        return {"tags": [], "description": None, "reason": "shortlist boş — hiçbir taksonomi eşleşmesi yeterli skora ulaşmadı"}

    vlm_model, vlm_processor = load(VLM_MODEL)
    config = load_config(VLM_MODEL)

    tag_list = ", ".join(t for t, _ in shortlist)
    prompt_text = (
        f"THY arşiv görseli. Bu KISA listeden SADECE görselde gerçekten görüneni seç "
        f"(embedding ile önceden filtrelendi, hepsi aday ama hepsi doğru olmayabilir). "
        f"Emin değilsen boş liste döndür.\nListe: {tag_list}\n"
        f'SADECE JSON döndür: {{"tags": [...]}}'
    )
    prompt = apply_chat_template(vlm_processor, config, prompt_text, num_images=1)
    result = generate(vlm_model, vlm_processor, prompt, image=[image_path], max_tokens=150, temperature=0.0, verbose=False)
    text = result.text if hasattr(result, "text") else str(result)
    parsed = _extract_json(text) or {"tags": []}
    final_tags = [t for t in parsed.get("tags", []) if t in dict(shortlist)]

    desc_prompt = apply_chat_template(
        vlm_processor, config,
        "Bu bir Turkish Airlines dijital arşiv görseli. Görselde ne olduğunu özetleyen SADECE 1-2 cümlelik Türkçe bir açıklama yaz.",
        num_images=1,
    )
    desc_result = generate(vlm_model, vlm_processor, desc_prompt, image=[image_path], max_tokens=150, temperature=0.0, verbose=False)
    description = (desc_result.text if hasattr(desc_result, "text") else str(desc_result)).strip()

    return {"tags": final_tags, "description": description}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python sprint6/hybrid_tag.py <path-to-image>")
        sys.exit(1)

    path = sys.argv[1]
    shortlist = shortlist_tags(path)
    print(f"Shortlist ({len(shortlist)} tags): {[(t, round(s,3)) for t,s in shortlist]}")

    final = vlm_final_decision(path, shortlist)
    print("\n✅ Final:")
    print(json.dumps(final, ensure_ascii=False, indent=2))
