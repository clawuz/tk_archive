"""
Sprint 4 — güven skoru + Claude Vision fallback.

Qwen2.5-VL'in kendi self-reported bir güven skoru yok (ve daha önce
gördük ki model kendi hatalarını fark etmiyor — yanlış etiketleri de
"emin" gibi üretiyor). Bu yüzden dışarıdan bir güven sinyali kullanıyoruz:
self-consistency — aynı görseli iki farklı sıcaklıkta (temperature=0.0 ve
0.3) etiketleyip sonuçları karşılaştırıyoruz. Aynı etiket kümesi
çıkıyorsa model kararlı/güvenilir demektir; farklı çıkıyorsa belirsizdir
— bu durumda mevcut `functions/tagNewFiles.js` callable'ı (Claude Vision)
çağrılır, gerçek üretim dokümanını (fileId üzerinden) günceller.

ÖNEMLİ: call_claude_fallback() gerçek `files/{fileId}` dokümanını YAZAR
— bu fonksiyon sadece gerçek bir production fileId'si olan dosyalar için
anlamlıdır (tagNewFiles.js'in kendisi fileId'den okuyor, rastgele görsel
kabul etmiyor). Bu yüzden bugüne kadarki "v2 üretime dokunmasın"
prensibiyle çelişir — CANLI olarak tetiklenmeden önce kullanıcı onayı
gerekir. Kod burada hazır, ama sprint3/worker.py'ye henüz otomatik
bağlanmadı (bkz. plan notları).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "sprint3"))
from vision import tag_image  # noqa: E402

CONSISTENCY_TEMPERATURE = 0.3


def check_confidence(image_path):
    """
    Returns (is_confident: bool, primary_result: dict, alt_tags: list).
    primary_result is the temperature=0 (deterministic) result — used
    as-is when confident. alt_tags is the second sample's tags, useful
    for logging/debugging even when confident.
    """
    from vision import get_model  # local import: only load the model when actually needed

    primary = tag_image(image_path)

    model, processor, config = get_model()
    from vision import _extract_json, TAXONOMY_PROMPT, VALID_TAGS  # noqa: E402
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    prompt = apply_chat_template(processor, config, TAXONOMY_PROMPT, num_images=1)
    result = generate(
        model, processor, prompt, image=[image_path],
        max_tokens=400, temperature=CONSISTENCY_TEMPERATURE, verbose=False,
    )
    text = result.text if hasattr(result, "text") else str(result)
    parsed = _extract_json(text) or {}
    alt_tags = [t for t in (parsed.get("tags") or []) if t in VALID_TAGS]

    is_confident = set(primary["tags"]) == set(alt_tags)
    return is_confident, primary, alt_tags


def call_claude_fallback(file_id, get_id_token_fn):
    """
    Calls the real functions/tagNewFiles.js callable (mode: single) for
    a real production fileId. get_id_token_fn is injected rather than
    hardcoded here, since obtaining a valid Firebase Auth ID token for a
    server-side caller needs a one-time custom-token exchange (see
    sprint4/firebase_auth.py) — kept separate so this module has no
    direct network/auth dependency of its own.

    WRITES to the real files/{file_id} document. Do not call this
    against production data without explicit confirmation first.
    """
    import requests

    id_token = get_id_token_fn()
    url = "https://us-central1-tk-archive-cd9d0.cloudfunctions.net/tagNewFiles"
    resp = requests.post(
        url,
        json={"data": {"mode": "single", "fileId": file_id}},
        headers={"Authorization": f"Bearer {id_token}", "Content-Type": "application/json"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json().get("result", {})
