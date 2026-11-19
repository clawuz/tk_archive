"""
Gerçek `files` dokümanlarından görsel veri ve klasör bağlamı çıkaran
yardımcılar (frame_list_for, context_for). Eskiden bu dosya toplu işleme
script'iydi (`--limit`, tek seferlik snapshot); sürekli çalışan ai_worker.py
onun yerini aldı, yazma mantığı da ai_write.py'de tek yerde. Dosya adı
geçmişe uyumluluk için aynı kaldı (worker/reprocess_* buradan import eder).
"""

import re
from pathlib import Path


def frame_list_for(file_data):
    """Gerçek files/{fileId} dokümanından frameDataBase64List çıkarır."""
    frames = file_data.get("videoPreviewFrames") or []
    if frames:
        return [f["frameData"] for f in frames]
    thumb_url = (file_data.get("thumbnail") or {}).get("url") or ""
    if thumb_url.startswith("data:"):
        return [thumb_url.split(",", 1)[1]]
    return []


# Klasör adı yapısal bir kova/tekrar-eden-gövde parçasıysa (üretim akışının
# bir aşamasını gösterir ama İÇERİK hakkında hiçbir şey söylemez), bağlam
# olarak KULLANIŞSIZDIR — gerçek örneklerde (2026-09-16, reprocess_batch.py
# ilk çalıştırması) 20 dosyanın çoğunda en yakın klasör tam olarak buydu:
# "Footage", "(Footage)", "Assets"/"ASSETS", "Export", "CLIP", "RENDER",
# "Vids", "Mov's", "THY_TRANSCODE" — hiçbiri konum/kampanya/konu bilgisi
# taşımıyor. Gerçek sinyal (proje/kampanya adı) genelde bir-iki seviye
# yukarıda oturuyor (ör. ".../TK - Destinasyon Gana/.../ASSETS/dosya.mp4").
# Bu yüzden context_for() en yakın klasörden başlayıp yukarı doğru, ilk
# "bilgilendirici" (bu listede olmayan en az bir kelime içeren) klasörü
# arıyor.
_GENERIC_FOLDER_WORDS = frozenset([
    "footage", "asset", "assets", "export", "exports", "clip", "clips",
    "mov", "movs", "render", "renders", "vid", "vids", "video", "videos",
    "media", "raw", "wip", "review", "approved", "archive", "backup",
    "transcode", "proxy", "proxies", "delivery", "deliverables", "final",
    "finals", "source", "sources", "master", "masters", "malzeme",
    "malzemeler", "materials", "misc", "temp", "workspace",
    "volumes", "tribal", "thy", "creative", "account", "turkishairlines",
    "turkish", "airlines", "videoworks", "yaratici", "ekip", "stock", "tk",
])


def _is_informative_segment(segment):
    words = [w for w in re.split(r"[^0-9A-Za-zçğıöşüÇĞİÖŞÜ]+", segment.lower()) if w]
    if not words:
        return False
    return any(w not in _GENERIC_FOLDER_WORDS and not w.isdigit() for w in words)


def context_for(file_data):
    """
    Dosyanın GERÇEK klasör yolunu (path), en yakından başlayıp yukarı
    doğru tarayarak ilk bilgilendirici (jenerik üretim-kovası olmayan)
    klasör adını çıkarır — vision.py'ye "bu görseli/videoyu nerede/ne
    bağlamda bulduk" bilgisini taşır. scanner'ın `tags` alanına yazdığı
    slugified etiketler ("lounge-dış-hatlar") jenerik terimlerle karışık
    geldiği için ("thy", "account", "tk-stock") ilk denemede yeterince
    güçlü sinyal vermedi — gerçek klasör adı çok daha net (ilk fallback
    olarak hâlâ kullanılıyor, path hiç yoksa).

    Gerçek örnek (2026-09-16): 11_A0087.MP4, "lounge dış hatlar" klasöründeydi;
    bu context olmadan model onu jenerik bir "konferans odası" sanmıştı.

    Dosya adı HER ZAMAN eklenir, sadece klasör bilgisi yokken son çare
    olarak değil — gerçek örnek (2026-09-17): "A350_SH180_001.mov" bilgili
    bir kampanya klasöründeydi ("260326_TK-2026-Timisoara_Hat_Acilisi"), o
    klasör adı seçildiği için dosyanın kendi adındaki "A350" hiç modele
    iletilmedi — model uçak tipini sadece pikselden tahmin etmek zorunda
    kaldı ve güvenli tarafta kalıp genel "ucak-tasarimli" dedi, spesifik
    "a350" değil. Uçak dış hat şekilleri (a330 vs a350 vs b777) VLM için
    pikselden ayırt etmesi zor/güvenilmez olabiliyor ama dosya adında
    genelde zaten yazıyor — bu ücretsiz sinyal asla atlanmamalı.
    """
    parts = []
    path = file_data.get("path") or ""
    if path:
        for segment in reversed(Path(path).parts[:-1]):
            if _is_informative_segment(segment):
                parts.append(segment.strip())
                break

    name = file_data.get("name") or ""
    if name:
        parts.append(f"dosya adı: {name}")

    if parts:
        return " | ".join(parts)

    folder_tags = [t for t in (file_data.get("tags") or []) if not t.isdigit()]
    if folder_tags:
        return ", ".join(folder_tags)
    return None
