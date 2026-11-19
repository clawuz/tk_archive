"""
Sprint 1 POC: a single image -> local MLX-VLM -> taxonomy-constrained
{tags, description} JSON. No Firestore/Firebase involved yet — this only
proves the local model can follow the same taxonomy tk_archive's Claude
Vision path already uses (see tk_archive/functions/tagNewFiles.js).

Usage: uv run python sprint1/tag_image.py <path-to-image>
"""

import json
import re
import sys

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

MODEL = "mlx-community/Qwen2-VL-2B-Instruct-4bit"

# Trimmed from tk_archive/functions/tagNewFiles.js's TAXONOMY_PROMPT
# (lines 36-75) — same category lists, verbose caveats shortened, ends
# with an explicit JSON-only instruction since local models don't have
# Claude's output_config.format schema enforcement. Keep this in sync
# with the original by hand for now (see the v2 plan's note on this).
TAXONOMY_PROMPT = """Bu bir Turkish Airlines (THY) dijital arşiv görselidir. Görseli incele ve aşağıdaki kategorilerden GÖRSELDE GERÇEKTEN GÖRÜNEN olanları etiketle. Emin olmadığın (logo/yazı net görünmeyen) marka, sponsor veya ödülleri ETİKETLEME.

UÇAK MODELLERİ: a350, a321, a330, b707, b737, b777, b787, dreamliner, c-47, de-havilland, fokker, junkers, curtiss-kingbird, ucak-tasarimli
KABİN & PERSONEL: kabin-memuru, pilot, yer-hizmetleri, check-in-personeli
KABİN SINIFI: business-class, economy-class, first-class
MEKAN & HAVALİMANI: business-lounge, miles-and-smiles-lounge, gate, check-in-alani, kokpit, kabin-ici, pist, terminal, apron, iga-ic-mekan, iga-dis-mekan
İKRAM: do-and-co-ikram, ucan-asci, lounge-ikram
UÇUŞ AŞAMALARI: kalkis, inis, seyir, binis, ucak-dis-govde
DESTİNASYON & MİRAS: istanbul, bogazici, kapadokya, gobeklitepe, global-destinasyon
MARKALAR (sadece logo/renk net görünüyorsa): turkish-airlines, turkish-cargo, ajet, turkish-technic, miles-and-smiles, tkpay, youth-club, do-and-co, tgs
TK STORE / MERCHANDISE (sadece stüdyo/e-ticaret tarzı ürün çekimiyse): tk-store, ucak-maketi, oyuncak, giyim
SPONSORLUK & ÖDÜL (sadece logo/grafik net okunuyorsa): milli-takim, uefa, euroleague, skytrax, apex, guinness
PRODÜKSİYON İÇERİĞİ: kurumsal-film, reklam-filmi, kurumsal-yayin

En fazla 12 etiket seç, sadece görselde gerçekten olanları. Ayrıca görselde ne olduğunu özetleyen 1-2 cümlelik Türkçe bir açıklama yaz.

SADECE şu formatta, başka hiçbir şey eklemeden cevap ver:
{"tags": ["etiket1", "etiket2"], "description": "..."}"""


def extract_json(text):
    # Local models sometimes wrap JSON in ```json fences or add stray
    # text before/after despite the instruction — pull out the first
    # {...} block rather than assuming the whole response is clean JSON.
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def tag_image(image_path):
    print(f"Loading {MODEL} (first run downloads the model, may take a while)...")
    model, processor = load(MODEL)
    config = load_config(MODEL)

    prompt = apply_chat_template(processor, config, TAXONOMY_PROMPT, num_images=1)

    result = generate(
        model,
        processor,
        prompt,
        image=[image_path],
        max_tokens=500,
        temperature=0.0,
        verbose=False,
    )

    raw_text = result.text if hasattr(result, "text") else str(result)
    parsed = extract_json(raw_text)

    if parsed is None or "tags" not in parsed or "description" not in parsed:
        print("\n⚠️  Could not parse valid {tags, description} JSON. Raw output:")
        print(raw_text)
        return None

    return parsed


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python sprint1/tag_image.py <path-to-image>")
        sys.exit(1)

    output = tag_image(sys.argv[1])
    if output:
        print("\n✅ Result:")
        print(json.dumps(output, ensure_ascii=False, indent=2))
