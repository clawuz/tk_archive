"""
Sprint 1 v2: category-by-category tagging instead of one giant taxonomy
prompt. The single-shot approach (tag_image.py) failed on both 2B and 7B
Qwen2-VL — the model dumped the entire ~90-tag vocabulary instead of
filtering to what's actually visible. A short list (~15 tags or fewer)
worked reliably in testing, so this splits the taxonomy into its natural
category groups (mirroring tk_archive/functions/tagNewFiles.js's
TAXONOMY_PROMPT sections) and makes one small call per group, merging the
results. The description comes from one extra, final call that also sees
which tags were selected, for a coherent summary instead of a generic one.

Usage: uv run python sprint1/tag_image_v2.py <path-to-image>
"""

import json
import re
import sys
import time

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

MODEL = "mlx-community/Qwen2-VL-2B-Instruct-4bit"

# Mirrors tk_archive/functions/tagNewFiles.js's TAXONOMY_PROMPT (lines
# 36-75) category-by-category, so it stays easy to keep both in sync by
# hand. Groups with a natural "only if X" caveat keep it inline, short.
CATEGORY_GROUPS = [
    {
        "name": "uçak modeli",
        "tags": ["a350", "a321", "a330", "b707", "b737", "b777", "b787", "dreamliner",
                 "c-47", "de-havilland", "fokker", "junkers", "curtiss-kingbird", "ucak-tasarimli"],
        "note": "SADECE görseldeki nesnenin kendisi gerçek bir uçaksa/uçak maketiyse etiketle. "
                "Kalem/anahtarlık gibi bir üründe uçak SİLUETİ varsa spesifik model DEĞİL, sadece ucak-tasarimli kullan.",
    },
    {
        "name": "kabin ve personel",
        "tags": ["kabin-memuru", "pilot", "yer-hizmetleri", "check-in-personeli"],
        "note": "",
    },
    {
        "name": "kabin sınıfı",
        "tags": ["business-class", "economy-class", "first-class"],
        "note": "",
    },
    {
        "name": "mekan ve havalimanı",
        "tags": ["business-lounge", "miles-and-smiles-lounge", "gate", "check-in-alani",
                 "kokpit", "kabin-ici", "pist", "terminal", "apron", "iga-ic-mekan", "iga-dis-mekan"],
        "note": "",
    },
    {
        "name": "ikram",
        "tags": ["do-and-co-ikram", "ucan-asci", "lounge-ikram"],
        "note": "",
    },
    {
        "name": "uçuş aşaması",
        "tags": ["kalkis", "inis", "seyir", "binis", "ucak-dis-govde"],
        "note": "",
    },
    {
        "name": "destinasyon ve miras",
        "tags": ["istanbul", "bogazici", "kapadokya", "gobeklitepe", "global-destinasyon"],
        "note": "",
    },
    {
        "name": "marka",
        "tags": ["turkish-airlines", "turkish-cargo", "ajet", "turkish-technic",
                 "miles-and-smiles", "tkpay", "youth-club", "do-and-co", "tgs"],
        "note": "SADECE logo/renk net görünüyorsa etiketle. Emin değilsen etiketleme.",
    },
    {
        "name": "tk store / merchandise",
        "tags": ["tk-store", "ucak-maketi", "oyuncak", "giyim"],
        "note": "SADECE stüdyo/e-ticaret tarzı ürün çekimiyse (izole arka plan) kullan.",
    },
    {
        "name": "sponsorluk ve ödül",
        "tags": ["milli-takim", "uefa", "euroleague", "skytrax", "apex", "guinness"],
        "note": "SADECE logo/grafik net okunuyorsa etiketle.",
    },
    {
        "name": "prodüksiyon içeriği",
        "tags": ["kurumsal-film", "reklam-filmi", "kurumsal-yayin"],
        "note": "Bir reklam/kurumsal film karesiyse (sahne, oyuncu, el, ofis gibi anlatı unsurları).",
    },
]


def extract_json(text):
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def ask_category(model, processor, config, image_path, group):
    tag_list = ", ".join(group["tags"])
    note = f" {group['note']}" if group["note"] else ""
    prompt_text = (
        f"THY arşiv görseli. Bu listeden SADECE görselde gerçekten görüneni seç. "
        f"Birden fazla benzer seçenek varsa (örn. birkaç uçak modeli) SADECE en olası TEK birini seç, "
        f"hepsini birden seçme. Emin değilsen boş liste döndür — boş liste, yanlış tahminden iyidir.\n"
        f"Liste: {tag_list}\n{note}\n"
        f'SADECE JSON döndür: {{"tags": [...]}}'
    )
    prompt = apply_chat_template(processor, config, prompt_text, num_images=1)
    result = generate(
        model, processor, prompt, image=[image_path],
        max_tokens=120, temperature=0.0, verbose=False,
    )
    text = result.text if hasattr(result, "text") else str(result)
    parsed = extract_json(text)
    if parsed is None or "tags" not in parsed or not isinstance(parsed["tags"], list):
        return [], text  # surface raw text for debugging, don't crash
    # Guard against the exact failure mode we're routing around: if the
    # model ignores "only what's visible" and returns the whole list back,
    # treat it as unreliable for this call rather than trusting it blind.
    if len(parsed["tags"]) == len(group["tags"]):
        return [], text
    valid = [t for t in parsed["tags"] if t in group["tags"]]
    return valid, text


def ask_description(model, processor, config, image_path, selected_tags):
    # Unlike the category calls, this is a single free-text field, not a
    # structured selection — asking for JSON here made the model drop the
    # JSON wrapper entirely and just answer in prose (observed directly),
    # so this takes the raw text as-is instead of trying to parse it.
    hint = f" Şu etiketler zaten seçildi: {', '.join(selected_tags)}." if selected_tags else ""
    prompt_text = (
        f"Bu bir Turkish Airlines dijital arşiv görseli.{hint} "
        f"Görselde ne olduğunu özetleyen, SADECE 1-2 cümlelik Türkçe bir açıklama yaz. "
        f"Başka hiçbir şey ekleme, sadece açıklama cümlesi."
    )
    prompt = apply_chat_template(processor, config, prompt_text, num_images=1)
    result = generate(
        model, processor, prompt, image=[image_path],
        max_tokens=150, temperature=0.0, verbose=False,
    )
    text = result.text if hasattr(result, "text") else str(result)
    return text.strip()


def tag_image(image_path):
    print(f"Loading {MODEL}...")
    model, processor = load(MODEL)
    config = load_config(MODEL)

    all_tags = []
    debug = []
    t0 = time.time()
    for group in CATEGORY_GROUPS:
        tags, raw = ask_category(model, processor, config, image_path, group)
        debug.append((group["name"], tags, raw[:80]))
        all_tags.extend(tags)
    description = ask_description(model, processor, config, image_path, all_tags)
    elapsed = time.time() - t0

    print(f"\n⏱  {elapsed:.1f}s for {len(CATEGORY_GROUPS)} category calls + 1 description call")
    print("\nPer-category results:")
    for name, tags, raw in debug:
        marker = "✓" if tags else " "
        print(f"  [{marker}] {name}: {tags or '(none)'}")

    return {"tags": all_tags, "description": description}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python sprint1/tag_image_v2.py <path-to-image>")
        sys.exit(1)

    output = tag_image(sys.argv[1])
    print("\n✅ Final result:")
    print(json.dumps(output, ensure_ascii=False, indent=2))
