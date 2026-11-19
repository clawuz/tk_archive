"""
Shared local-vision tagging logic, used by both standalone test scripts
and the Firestore worker.

Model history (see plan notes, 2026-09-04): Qwen2-VL-2B and even the
newer-generation Qwen2.5-VL-3B could not reliably follow "only tag what's
actually visible" against the full ~90-tag taxonomy in one shot — both
dumped large chunks of the vocabulary regardless of image content, no
matter how the prompt was restructured (category splitting, stricter
wording, etc.). Qwen2.5-VL-7B-Instruct-4bit does NOT have this problem —
a single full-taxonomy request reliably returns a small, plausible tag
set. So this module is back to the simple single-shot design (matching
tk_archive/functions/tagNewFiles.js's own approach) rather than the
category-decomposition workaround an earlier version of this file used.
"""

import json
import re

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

MODEL = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"

# Mirrors tk_archive/functions/tagNewFiles.js's TAXONOMY_PROMPT (lines
# 36-75) — keep both in sync by hand until the taxonomy is extracted to a
# shared file both the Cloud Function and this engine can read.
TAXONOMY_PROMPT = """Bu bir Turkish Airlines (THY) dijital arşiv görselidir. Görseli incele ve aşağıdaki kategorilerden GÖRSELDE GERÇEKTEN GÖRÜNEN olanları etiketle. Emin olmadığın (logo/yazı net görünmeyen) marka, sponsor veya ödülleri ETİKETLEME — yanlış etiket, etiketsiz bırakmaktan daha kötüdür.

UÇAK MODELLERİ — SADECE görseldeki nesnenin kendisi gerçek bir uçak, uçak maketi veya uçak fotoğrafıysa etiketle. Kalem, anahtarlık, bere gibi ürünlerde uçak siluetine benzeyen bir TASARIM ÖĞESİ varsa bu bir uçak modeli DEĞİLDİR — spesifik model etiketi (a350, b787 vb.) EKLEME, sadece genel "ucak-tasarimli" etiketini kullanabilirsin. Görsel GERÇEK bir uçaksa ama dış hat görünümünden spesifik modeli ayırt etmek zorsa (a330 vs a350 vs b777 gibi modeller pikselden ayırt edilmesi güç olabilir), dosya bağlamında (klasör adı/dosya adı) geçen bir model kodunu (ör. dosya adı "A350_..." ile başlıyorsa) kullan — bu durumda sadece genel "ucak-tasarimli" ile yetinme, context'teki spesifik modeli etiketle. Ama context'teki model, görselde AÇIKÇA farklı bir şeyi (ör. başka bir uçak tipi net yazıyla görünüyorsa) gösteriyorsa context'e körü körüne güvenme:
a350, a321, a330, b707, b737, b777, b787 (Dreamliner ise "dreamliner" de ekle), c-47, de-havilland, fokker, junkers, curtiss-kingbird, ucak-tasarimli

KABİN & PERSONEL:
kabin-memuru, pilot, yer-hizmetleri, check-in-personeli

KABİN SINIFI:
business-class, economy-class, first-class

MEKAN & HAVALİMANI:
business-lounge, miles-and-smiles-lounge, gate, check-in-alani, kokpit, kabin-ici, pist, terminal, apron, iga-ic-mekan, iga-dis-mekan

İKRAM:
do-and-co-ikram, ucan-asci, lounge-ikram

UÇUŞ AŞAMALARI:
kalkis, inis, seyir, binis, ucak-dis-govde

DESTİNASYON & MİRAS:
istanbul, bogazici, kapadokya, gobeklitepe, global-destinasyon

KAMPANYA / TEKLİF — görsel/video belirli bir THY kampanyasını/teklifini tanıtıyorsa:
stopover

MARKALAR (SADECE logo/renk net görünüyorsa):
turkish-airlines, turkish-cargo, ajet, turkish-technic, miles-and-smiles, tkpay, youth-club, do-and-co, tgs

TK STORE / MERCHANDISE — SADECE görsel gerçekten bir ürünün stüdyo/e-ticaret tarzı çekimiyse (izole arka plan, ürün paketin önünde/tek başına) kullan:
tk-store, ucak-maketi, oyuncak, giyim

SPONSORLUK & ÖDÜL — isimli marka/logo etiketleri (milli-takim, uefa, euroleague, skytrax, apex, guinness) SADECE logo/grafik net okunuyorsa kullanılsın. "odul" ise daha genel bir etiket — görselde bir ödül töreni, kupa, plaket, sertifika veya ödül sahnesi (podyum, takdim anı vb.) görülüyorsa, spesifik bir logo net okunmasa bile kullanılabilir:
milli-takim, uefa, euroleague, skytrax, apex, guinness, odul

PRODÜKSİYON İÇERİĞİ — bir reklam filmi, kurumsal film veya yayının kare/kapak görseliyse:
kurumsal-film, reklam-filmi, kurumsal-yayin

Sadece yukarıdaki listelerde YAZILI OLAN etiketleri kullan — listede olmayan yeni bir etiket UYDURMA. Görselde bu listeden hiçbir şey gerçekten yoksa, boş bir liste döndür — bu, listede olmayan bir etiket uydurmaktan iyidir.

En fazla 12 etiket seç, sadece görselde gerçekten olanları. Ayrıca görselde ne olduğunu özetleyen 1-2 cümlelik Türkçe bir açıklama yaz.

SADECE şu formatta cevap ver, başka hiçbir şey ekleme: {"tags": ["..."], "description": "..."}"""

# Flat validation set, kept in sync BY HAND with every tag listed in
# TAXONOMY_PROMPT above — the model still occasionally drifts outside the
# vocabulary despite the prompt's explicit instruction not to (e.g. a
# spice-market frame with no visible THY branding got tagged "market",
# "spices", "experience" — none of which are real taxonomy tags; a
# different frame produced "kabine-ici", a misspelling of "kabin-ici").
# tag_image() filters against this set so no invented/misspelled tag ever
# reaches Firestore, rather than trying to prompt-engineer the model into
# never drifting.
VALID_TAGS = frozenset([
    "a350", "a321", "a330", "b707", "b737", "b777", "b787", "dreamliner",
    "c-47", "de-havilland", "fokker", "junkers", "curtiss-kingbird", "ucak-tasarimli",
    "kabin-memuru", "pilot", "yer-hizmetleri", "check-in-personeli",
    "business-class", "economy-class", "first-class",
    "business-lounge", "miles-and-smiles-lounge", "gate", "check-in-alani",
    "kokpit", "kabin-ici", "pist", "terminal", "apron", "iga-ic-mekan", "iga-dis-mekan",
    "do-and-co-ikram", "ucan-asci", "lounge-ikram",
    "kalkis", "inis", "seyir", "binis", "ucak-dis-govde",
    "istanbul", "bogazici", "kapadokya", "gobeklitepe", "global-destinasyon",
    "stopover",
    "turkish-airlines", "turkish-cargo", "ajet", "turkish-technic",
    "miles-and-smiles", "tkpay", "youth-club", "do-and-co", "tgs",
    "tk-store", "ucak-maketi", "oyuncak", "giyim",
    "milli-takim", "uefa", "euroleague", "skytrax", "apex", "guinness", "odul",
    "kurumsal-film", "reklam-filmi", "kurumsal-yayin",
])

OCR_PROMPT = (
    'Bu görselde ekrana bindirilmiş herhangi bir yazı/metin var mı? '
    'Varsa, gördüğün yazıyı harfi harfine, tam olarak yaz. '
    'Yoksa "yok" yaz.'
)

_model = None
_processor = None
_config = None


def get_model():
    # Loaded once per process, not per file — the worker keeps this warm
    # across the whole poll loop instead of reloading per document.
    global _model, _processor, _config
    if _model is None:
        _model, _processor = load(MODEL)
        _config = load_config(MODEL)
    return _model, _processor, _config


def _extract_json(text):
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return _salvage_json(text)


# Audit 2026-10-20: 2.913 dosya (%5,7, hep görsel/tasarım) "tamamlandı" ama
# etiketsiz ve açıklamasız kaydedilmişti. Neden: model açıklama metninin
# içine kaçışsız çift tırnak koyuyor ("... ve "Kariyerinizde yükseliş" metni
# ...") ya da etiket listesinde döngüye girip JSON'u kesiyor → json.loads
# patlıyor → {} → sessizce boş sonuç. Geçerli JSON çıkmazsa alanları regex
# ile kurtarıyoruz.
_TAGS_FIELD = re.compile(r'"tags"\s*:\s*\[(.*?)(?:\]|$)', re.DOTALL)
_DESC_FIELD = re.compile(r'"description"\s*:\s*"(.*?)"?\s*\}?\s*$', re.DOTALL)


def _salvage_json(text):
    tags_m = _TAGS_FIELD.search(text)
    desc_m = _DESC_FIELD.search(text)
    if not tags_m and not desc_m:
        return None
    raw = re.findall(r'"([^"\n]+)"', tags_m.group(1)) if tags_m else []
    # Aynı etiketin ≥4 kez tekrarı = üretim döngüsü; o listeye güvenilmez.
    tags = [] if any(raw.count(t) >= 4 for t in set(raw)) else list(dict.fromkeys(raw))
    description = desc_m.group(1).strip().rstrip('"').strip() if desc_m else ""
    # Etiket listesi döngüsünde kesilen çıktıda "description" alanı yoktur.
    if tags_m and desc_m and desc_m.start() < tags_m.start():
        description = ""
    return {"tags": tags, "description": description}


def _build_prompt(base_prompt, context):
    # Real example that motivated this (2026-09-16): 11_A0087.MP4 sits in
    # a folder literally named "lounge dış hatlar" (international lounge)
    # — free signal the scanner already captures as folder-derived tags
    # (lib/autoTags.cjs) — but the vision-only prompt had no way to see
    # it, and called the room a generic "konferans odası" instead of an
    # airport business lounge. Claude's own pipeline already does this
    # for the filename (see functions/tagNewFiles.js's tagOneFile) — this
    # mirrors that, extended to the folder path/existing tags too.
    if not context:
        return base_prompt
    return (
        f"{base_prompt}\n\nDosyanın bulunduğu klasör: \"{context}\"\n"
        f"Bu, dosyayı tarayan sistemin ZATEN BİLDİĞİ, güvenilir bir bilgi — "
        f"görseli yorumlarken bunu esas al. Özellikle MEKAN/LOKASYON belirsizse "
        f"(ör. görsel bir toplantı/oturma alanı gibi görünüyor ama klasör adı "
        f"\"lounge\" ya da belirli bir lokasyon/kampanya adı içeriyorsa), klasör "
        f"adındaki bilgiyi görsel izlenimin ÖNÜNE koy — sırf odadaki masa/koltuk "
        f"düzeni jenerik bir \"toplantı/konferans odası\"na benziyor diye klasör "
        f"bağlamıyla çelişen bir yorum YAPMA. Buna karşın, görselde GERÇEKTEN "
        f"GÖRÜNMEYEN bir nesneyi veya markayı sırf klasör adında geçiyor diye "
        f"etiketleme — bağlam sadece MEKAN/KONU yorumuna rehberlik etsin, "
        f"halüsinasyon kaynağı olmasın."
    )


def tag_image(image_path, context=None):
    """Returns {tags, description, model} for one local image file path.

    context: optional string (folder path / existing folder-derived tags)
    to help disambiguate what the model is looking at — see _build_prompt.
    """
    model, processor, config = get_model()
    prompt_text = _build_prompt(TAXONOMY_PROMPT, context)
    prompt = apply_chat_template(processor, config, prompt_text, num_images=1)
    result = generate(model, processor, prompt, image=[image_path], max_tokens=400, temperature=0.0, verbose=False)
    text = result.text if hasattr(result, "text") else str(result)
    parsed = _extract_json(text) or {}

    raw_tags = parsed.get("tags") if isinstance(parsed.get("tags"), list) else []
    tags = [t for t in raw_tags if t in VALID_TAGS]
    description = parsed.get("description") if isinstance(parsed.get("description"), str) else ""

    return {"tags": tags, "description": description, "model": MODEL}


# 7B çoğunlukla düz metni doğrudan yazıyor, ama gerçek verideki geniş
# çeşitlilikte bazen hâlâ iki şekilde sızıntı yapıyor: (1) tam "yok"
# yerine bütün bir cümle ("Bu görselde ekrana bindirilmiş bir yazı veya
# metin yok.") — eski dar `fullmatch` bunu yakalamıyordu; (2) yanıtı
# doğrudan yazmak yerine bir önsözle sarmalıyor ("Evet, ekranda yazı var.
# İşte harfi harfine yazısı: ..."). İlk 20 gerçek dosyalık partide
# ikisi de görüldü (2026-09-16) — bu yüzden hem cümle-bazlı "yok"
# tespiti hem önsöz temizleme geri eklendi.
#
# Tam backlog koşusunda (2026-09-17) önsözün İLK 371 dosyada en az 3 farklı
# "Evet, ..." ile başlayan ifadeyle geldiği görüldü; "Evet, <100 karaktere
# kadar>:" regex'ine geçildi, ama birkaç yüz dosya sonra "Evet," ile HİÇ
# başlamayan yeni varyasyonlar da çıktı: "İşte görseldeki yazı metni:...",
# "Bu görselde ekrana bindirilmiş yazı metni var ve tam olarak:...". Tek
# tek ifadeleri kovalamak (whack-a-mole) azalan getiri — bunun yerine
# önsözün SIKLIKLA başladığı birkaç kelimeyi ("evet", "işte", "bu
# görselde", "görselde", "yanıt") bir arada tanıyıp, hepsinde ortak olan
# yapıyı (kısa bir açıklama cümlesi + ":" + gerçek içerik) hedefliyoruz.
# Gerçek ekran metinlerinin (başlık kartı, slogan, ürün etiketi) bu
# kelimelerden biriyle başlayıp 150 karakter içinde ":" ile bitmesi
# pratikte imkansız — yanlış pozitif riski düşük kalıyor.
_NO_TEXT_SENTENCE = re.compile(
    r"\byok\b|\byoktur\b|\bbulunmamaktad[iı]r\b|\bbulunmuyor\b|\bbulunamad[iı]\b",
    re.IGNORECASE,
)
_PREAMBLE_PREFIX = re.compile(
    r"^(evet|i\̇?şte|bu\s+g[öo]rselde|g[öo]rselde|yan[ıi]t)\b[^:\n]{0,150}:\s*",
    re.IGNORECASE,
)
_CODE_FENCE = re.compile(r"^```\s*\n?|\n?```$")


def read_frame_text(image_path):
    """Returns the on-screen text in one frame, or None if there isn't any."""
    model, processor, config = get_model()
    prompt = apply_chat_template(processor, config, OCR_PROMPT, num_images=1)
    result = generate(model, processor, prompt, image=[image_path], max_tokens=100, temperature=0.0, verbose=False)
    text = (result.text if hasattr(result, "text") else str(result)).strip()

    text = _PREAMBLE_PREFIX.sub("", text).strip()
    text = _CODE_FENCE.sub("", text).strip()
    stripped = text.strip('"\'.').strip()

    if len(stripped) <= 5:
        return None
    if _NO_TEXT_SENTENCE.search(stripped) and len(stripped) < 120:
        return None
    return text.strip('"\'')


def summarize_video(frame_paths, context=None):
    """
    Free-text narrative summary from several frames spanning a video —
    NOT structured/taxonomy-constrained. Multi-frame + strict-taxonomy-JSON
    together was unreliable in testing (invented tags outside the
    vocabulary, one run degenerated into Chinese mid-sentence) — this
    stays plain natural-language output, which tested cleanly (see plan
    notes, 2026-09-04).

    context: optional folder path / existing tags — see tag_image's
    _build_prompt for why (same folder-context blind spot applies here).
    """
    model, processor, config = get_model()
    prompt_text = (
        "Bu görseller, bir Turkish Airlines tanıtım videosundan sırayla alınmış karelerdir. "
        "Bu videonun genel olarak neyi anlattığını, hangi kampanyayı/teklifi tanıttığını, "
        "kimi hedeflediğini 3-4 cümlelik Türkçe bir özetle anlat."
    )
    prompt_text = _build_prompt(prompt_text, context)
    prompt = apply_chat_template(processor, config, prompt_text, num_images=len(frame_paths))
    # Gerçek üretim verisinde (2026-09-16, 20 dosyalık parti) 5/20 dosyada
    # model neredeyse aynı cümleyi 2-3 kez art arda üretti (ör. "Bu videoda,
    # Turkish Airlines'in havalimanı işlemlerini... hakkında bilgi
    # vermektedir." tam tekrarı) — greedy decoding (temperature=0) + tekrar
    # cezası yokken, kısa/az çeşitlilikli sahnelerde modelin söyleyecek yeni
    # bir şeyi kalmayınca aynı cümleye "kilitlenmesi". repetition_penalty +
    # repetition_context_size, mlx-lm'in tekrar-önleme mekanizması — az önce
    # üretilen token pencersindeki tekrarları cezalandırıp modeli farklı bir
    # devama zorluyor. tag_image/read_frame_text'e eklenmedi: onların çıktısı
    # zaten kısa (JSON/tek satır), bu dejenere-tekrar deseni sadece uzun
    # serbest-metin özet çağrısında görüldü.
    result = generate(
        model, processor, prompt, image=frame_paths, max_tokens=400,
        temperature=0.0, repetition_penalty=1.3, repetition_context_size=20,
        verbose=False,
    )
    text = result.text if hasattr(result, "text") else str(result)
    return _dedupe_sentences(text.strip())


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_SIG_WORD = re.compile(r"[0-9a-zçğıöşüâîû]+", re.IGNORECASE)


def _sentence_signature(sentence):
    return set(w.lower() for w in _SIG_WORD.findall(sentence) if len(w) >= 4)


def _dedupe_sentences(text, max_sentences=5, jaccard_threshold=0.5):
    # repetition_penalty (üstte) tam-tekrarı büyük ölçüde azaltıyor ama
    # garanti etmiyor. İlk denemede context_size'ı 64'e çıkarmak tam-tekrarı
    # engelledi ama model bunun yerine PARAFRAZLI bir döngüye girdi (gerçek
    # örnek: Cappadocia balonu videosunda "eşsiz manzaralarını... vurguluyor"
    # cümlesi neredeyse aynı anlamla 3 farklı ifadeyle tekrarlandı, hiçbiri
    # birebir aynı string değildi — max_tokens'a kadar sürüp cümle ortasında
    # kesildi). Bu yüzden context_size 20'ye geri alındı ve kesin bir
    # güvenlik ağı eklendi: her cümle, ÖNCEKİ tutulan cümlelerle anlamlı
    # kelime kümesi (4+ harfli kelimeler) bazında Jaccard benzerliği
    # hesaplanarak karşılaştırılıyor — eşik üzerindeyse (aynı ya da neredeyse
    # aynı anlam) atılıyor, birebir string eşleşmesi aranmıyor. Ayrıca en
    # fazla `max_sentences` cümle tutuluyor (prompt zaten "3-4 cümle"
    # istiyor) — modelin döngüye girip max_tokens'ta cümle ortasında
    # kesilmesi ihtimaline karşı son, olası yarım cümleyi de temizliyor.
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    kept, kept_sigs = [], []
    for s in sentences:
        sig = _sentence_signature(s)
        if any(sig and ks and len(sig & ks) / len(sig | ks) >= jaccard_threshold for ks in kept_sigs):
            continue
        kept.append(s)
        kept_sigs.append(sig)
        if len(kept) >= max_sentences:
            break
    return " ".join(kept)
