"""
v2 etiketleme sonucunu gerçek `files/{fileId}` dokümanına yazan tek yer —
ai_worker.py, reprocess_one.py ve reprocess_batch.py hepsi bunu kullanır,
böylece yazma mantığı birbirinden ayrışmaz.

v2 başlangıçta sonucu sadece `ai.*` alanına yazıyordu; ama arama yalnızca
`name` + `tags` (ve onlardan türetilen `searchTokens`) üzerinden çalışıyor,
yani v2 etiketleri aramada hiç çıkmıyordu (2026-10-06, kullanıcı isteği).
Artık `ai.tags` ayrıca `tags`'e EKLENİYOR (mevcut etiketler silinmez/
değişmez, Claude'un eski tagOneFile'ındaki gibi birleşim) ve `searchTokens`
yeniden hesaplanıyor — damService.ts'in addTagsToFile'ı ile aynı iş, aynı
token algoritması (lib/searchTokens.cjs'in Python portu).
"""

import re

from firebase_admin import firestore

_WORD_SPLIT = re.compile(r"[^a-z0-9çğıöşüâîû]+", re.IGNORECASE)


def _words_from(text):
    return [w for w in _WORD_SPLIT.split((text or "").lower()) if len(w) >= 2]


MAX_AI_WORDS = 300
MAX_AI_WORD_LEN = 24


def ai_search_text(ai):
    """AI açıklaması + ekran yazıları (lib/searchTokens.cjs aiSearchText ile aynı)."""
    if not ai:
        return ""
    parts = [ai.get("description")] + list(ai.get("onScreenText") or [])
    return " ".join(p for p in parts if isinstance(p, str))


def generate_search_tokens(name, tags, extra_text=""):
    """lib/searchTokens.cjs'in birebir portu: ad + etiketler (+ AI metni) — her kelimenin her öneki."""
    words = dict.fromkeys(_words_from(name))
    for t in tags or []:
        for w in _words_from(t.replace("-", " ")):
            words[w] = None
    ai_words = 0
    for w in _words_from(extra_text):
        if len(w) > MAX_AI_WORD_LEN or w in words:
            continue
        words[w] = None
        ai_words += 1
        if ai_words >= MAX_AI_WORDS:
            break
    tokens = {}
    for w in words:
        for i in range(2, len(w) + 1):
            tokens[w[:i]] = None
    return list(tokens)


# lib/autoTags.cjs TAG_BLOCKLIST ile aynı: kişi adı klasörleri etiket olmaz.
BLOCKED_TAGS = frozenset({"mert-agbulak", "mert-ağbulak"})


def merge_tags(existing, new):
    merged = dict.fromkeys([*(existing or []), *(new or [])])
    return [t for t in merged if t not in BLOCKED_TAGS]


# Doğrulama kuyruğu (verify_tags.py, 2026-10-20): VLM bu etiketleri tam
# taksonomiden "seçerken" Turkish Airlines bağlamında uyduruyor; tek etiket
# evet/hayır sorusu çok daha isabetli. ai_worker bu bayrağı boştayken işler.
VERIFY_TAGS = ("ucak-tasarimli", "pilot", "kabin-ici", "kabin-memuru")


def build_completed_update(data, result):
    """Returns (update_dict, newly_added_tags) for a successful analysis."""
    existing = data.get("tags") or []
    merged = merge_tags(existing, result["tags"])
    existing_set = set(existing)
    added = [t for t in merged if t not in existing_set]
    update = {
        "ai": {
            "status": "completed",
            "tags": result["tags"],
            "description": result["description"],
            "onScreenText": result["onScreenText"],
            "model": result["model"],
            "processedAt": firestore.SERVER_TIMESTAMP,
        },
        "tags": merged,
        "searchTokens": generate_search_tokens(
            data.get("name", ""),
            merged,
            ai_search_text({"description": result["description"], "onScreenText": result["onScreenText"]}),
        ),
        "needs_tagging": False,
        "tag_requested": firestore.DELETE_FIELD,
        "needs_verify": any(t in VERIFY_TAGS for t in result["tags"]),
        "tagSource": "local-vision",
        "taggedAt": firestore.SERVER_TIMESTAMP,
    }
    return update, added


def bump_tag_registry(db, added_tags):
    """`tags` koleksiyonu (filtre listesi/otomatik tamamlama) — damService.bumpTagUsage ile aynı."""
    if not added_tags:
        return
    batch = db.batch()
    for t in added_tags:
        ref = db.collection("tags").document(t)
        batch.set(
            ref,
            {"tagId": t, "displayName": t, "usageCount": firestore.Increment(1)},
            merge=True,
        )
    batch.commit()


def write_completed(db, ref, data, result):
    update, added = build_completed_update(data, result)
    ref.update(update)
    bump_tag_registry(db, added)
    return added
