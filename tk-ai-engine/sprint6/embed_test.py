"""
Sprint 6 (öne çekildi) — Embedding tabanlı taksonomi ön-filtreleme POC.

Sprint 1'in bulgusu: VLM, ~90 etiketlik tam taksonomiden seçim yaparken
güvenilmiyor, ama ~10-15 etiketlik küçük bir listede güvenilir. Bu script,
SigLIP (görsel+metin aynı embedding uzayında) kullanarak görüntüye en
yakın etiketleri ÖNCEDEN filtreler — sonra sadece bu kısa listeyi VLM'e
sormak yeterli olmalı (bir sonraki adım, henüz bu script'te değil).

Firestore'a hiç dokunmuyor — tamamen yerel, tek seferlik bir deney.

Usage: uv run python sprint6/embed_test.py <path-to-image>
"""

import sys

import mlx.core as mx
import mlx_embeddings
from PIL import Image

EMBED_MODEL = "mlx-community/siglip-large-patch16-384"

# Aynı taksonomi (tk_archive/functions/tagNewFiles.js + sprint3/vision.py
# ile senkron) — ama burada her etiket, SigLIP'in daha iyi anlayacağı kısa
# bir İngilizce/Türkçe karma açıklayıcı ifadeye çevrildi (salt slug değil).
TAG_DESCRIPTIONS = {
    "a350": "an Airbus A350 airplane",
    "a321": "an Airbus A321 airplane",
    "a330": "an Airbus A330 airplane",
    "b737": "a Boeing 737 airplane",
    "b777": "a Boeing 777 airplane",
    "b787": "a Boeing 787 Dreamliner airplane",
    "dreamliner": "a Boeing 787 Dreamliner airplane",
    "c-47": "a vintage C-47 propeller airplane",
    "de-havilland": "a vintage De Havilland propeller airplane",
    "fokker": "a vintage Fokker propeller airplane",
    "junkers": "a vintage Junkers propeller airplane",
    "curtiss-kingbird": "a vintage Curtiss Kingbird twin-boom propeller airplane",
    "ucak-tasarimli": "an airplane-shaped design on a product",
    "kabin-memuru": "a flight attendant in uniform",
    "pilot": "an airline pilot in the cockpit",
    "yer-hizmetleri": "airport ground crew staff",
    "check-in-personeli": "an airline check-in desk staff member",
    "business-class": "an airplane business class cabin seat",
    "economy-class": "an airplane economy class cabin seat",
    "first-class": "an airplane first class cabin suite",
    "business-lounge": "an airport business lounge interior",
    "gate": "an airport departure gate",
    "kokpit": "an airplane cockpit with instruments",
    "kabin-ici": "the interior of an airplane cabin",
    "pist": "an airport runway",
    "terminal": "an airport terminal building",
    "istanbul": "the city of Istanbul skyline or landmarks",
    "kalkis": "an airplane taking off",
    "inis": "an airplane landing",
    "seyir": "an airplane flying in the sky",
    "binis": "passengers boarding an airplane",
    "turkish-airlines": "the Turkish Airlines logo or livery",
    "tk-store": "a studio product photo of merchandise",
    "oyuncak": "a toy airplane model",
    "kurumsal-film": "a cinematic corporate film scene with actors",
    "reklam-filmi": "a commercial advertisement film scene",
}


def load_image(path):
    img = Image.open(path).convert("RGB").resize((224, 224))
    return img


def main():
    if len(sys.argv) != 2:
        print("Usage: uv run python sprint6/embed_test.py <path-to-image>")
        sys.exit(1)
    image_path = sys.argv[1]

    print(f"Loading {EMBED_MODEL}...")
    model, processor = mlx_embeddings.load(EMBED_MODEL)

    # Image embedding
    img = load_image(image_path)
    img_inputs = processor(images=[img], return_tensors="mlx")
    img_embed = model.get_image_features(pixel_values=img_inputs["pixel_values"])
    img_embed = img_embed / mx.linalg.norm(img_embed, axis=-1, keepdims=True)

    # Text embeddings — batched, one forward pass for all tags
    tags = list(TAG_DESCRIPTIONS.keys())
    phrases = [f"a photo of {TAG_DESCRIPTIONS[t]}" for t in tags]
    text_inputs = processor(text=phrases, padding="max_length", return_tensors="mlx")
    text_embed = model.get_text_features(input_ids=text_inputs["input_ids"])
    text_embed = text_embed / mx.linalg.norm(text_embed, axis=-1, keepdims=True)

    # Cosine similarity (already normalized, so just a dot product)
    sims = (img_embed @ text_embed.T)[0]
    sims = [(tags[i], float(sims[i])) for i in range(len(tags))]
    sims.sort(key=lambda x: -x[1])

    print(f"\nTop 15 candidate tags for {image_path}:")
    for tag, score in sims[:15]:
        print(f"  {score:.3f}  {tag}  ({TAG_DESCRIPTIONS[tag]})")


if __name__ == "__main__":
    main()
