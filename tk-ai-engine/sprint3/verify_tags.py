"""
Etiket kalitesi denetimi (2026-10-20) — sonuç: VLM, tam taksonomiyi "seç" diye
sorulduğunda Turkish Airlines bağlamında alakasız etiketleri (ucak-tasarimli
~%35, pilot ~%50 isabet) uyduruyor; ama TEK etiket için evet/hayır sorusunda
görsel kontrolümle 11/12 uyuştu. Bu script:
  1. Dosya adında/yolunda geçmeyen uçak MODEL etiketlerini (a350, b777…)
     kaldırır — pikselden model ayırt edilemiyor, bağlam yoksa uydurma.
  2. `ucak-tasarimli` ve `pilot` etiketlerini her dosyanın karelerinde evet/hayır
     ile doğrular; HİÇBİR karede doğrulanmazsa etiketi kaldırır.
Geri alınabilir: kaldırılanlar `ai.removedTags`'e, doğrulananlar `ai.verified`'a
yazılır (script yeniden başlatılabilir, doğrulananı atlar).
Sadece `tags`, `ai.tags`, `searchTokens`, `ai.verified`, `ai.removedTags` yazılır.

Usage: uv run python sprint3/verify_tags.py [--dry-run] [--limit N] [--tags ucak-tasarimli,pilot] [--skip-models]
"""
import argparse, base64, os, re, sys, tempfile, time
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens  # noqa: E402

MODEL_TAGS = ["a350", "a330", "a321", "a320", "a319", "a380", "b787", "b777", "b737", "b747", "b767", "a310", "a340"]
QUESTIONS = {
    "ucak-tasarimli": "Bu görselde dışarıdan görünen bir uçak (gövde, kanat, kuyruk veya motor) veya uçak maketi/çizimi var mı? Sadece Evet ya da Hayır yaz.",
    # 2026-10-22 denetimi: kabin-ici ~%50 → ~%73, kabin-memuru ~%20 → ~%40 isabet
    # (16'şar örnekte, kendi görsel kontrolümle). business-class denendi, fark yok → eklenmedi.
    "kabin-ici": "Bu görüntü bir uçağın İÇİNDE mi çekilmiş (kabin, yolcu koltukları, koridor, galley/mutfak bölümü)? Sadece Evet ya da Hayır yaz.",
    "kabin-memuru": "Bu görselde uçuş görevlisi/kabin memuru üniforması giyen (kırmızı ceket, kırmızı şapka ya da başlık, boyun atkısı) bir kişi görünüyor mu? Sadece Evet ya da Hayır yaz.",
    "pilot": "Bu görselde pilot üniforması (şapka, epolet) giyen bir pilot veya kokpitte uçak kullanan bir kişi görünüyor mu? Sadece Evet ya da Hayır yaz.",
}
_vlm = None


def vlm():
    global _vlm
    if _vlm is None:
        from vision import get_model, generate, apply_chat_template
        model, processor, config = get_model()
        _vlm = (model, processor, config, generate, apply_chat_template)
    return _vlm


def ask(path, question):
    model, processor, config, generate, apply_chat_template = vlm()
    prompt = apply_chat_template(processor, config, question, num_images=1)
    r = generate(model, processor, prompt, image=[path], max_tokens=6, temperature=0.0, verbose=False)
    return (r.text if hasattr(r, "text") else str(r)).strip().lower().startswith("evet")


def frames_of(x):
    fr = x.get("videoPreviewFrames") or []
    if fr:
        return [f["frameData"] for f in fr]
    u = (x.get("thumbnail") or {}).get("url") or ""
    return [u.split(",", 1)[1]] if u.startswith("data:") else []


def verified(x, tag):
    for b in frames_of(x):
        p = tempfile.mktemp(suffix=".img")
        open(p, "wb").write(base64.b64decode(b))
        try:
            if ask(p, QUESTIONS[tag]):
                return True
        finally:
            os.unlink(p)
    return False


def apply_removal(doc, x, tags_to_remove, verified_tags, dry):
    ai = x.get("ai") or {}
    new_ai_tags = [t for t in (ai.get("tags") or []) if t not in tags_to_remove]
    new_tags = [t for t in (x.get("tags") or []) if t not in tags_to_remove]
    upd = {
        "ai.tags": new_ai_tags,
        "tags": new_tags,
        "searchTokens": generate_search_tokens(x.get("name", ""), new_tags, ai_search_text({
            "description": ai.get("description"), "onScreenText": ai.get("onScreenText")})),
    }
    if tags_to_remove:
        upd["ai.removedTags"] = firestore.ArrayUnion(sorted(tags_to_remove))
    if verified_tags:
        upd["ai.verified"] = firestore.ArrayUnion(sorted(verified_tags))
    if not dry:
        doc.reference.update(upd)


def verify_doc(doc):
    """Worker kuyruğu için: dokümanın doğrulanmamış hedef etiketlerini kontrol eder,
    gerekeni kaldırır, needs_verify bayrağını düşürür. (kept, removed) döner."""
    x = doc.to_dict()
    ai = x.get("ai") or {}
    done = set(ai.get("verified") or [])
    todo = [t for t in QUESTIONS if t in (ai.get("tags") or []) and t not in done]
    remove, ok = set(), set()
    if frames_of(x):
        for t in todo:
            (ok if verified(x, t) else remove).add(t)
    apply_removal(doc, x, remove, ok | remove, False)
    doc.reference.update({"needs_verify": False})
    return sorted(ok), sorted(remove)


# İkinci geçiş (2026-10-22): ilk doğrulama küçük/kısmen görünen uçakları (gökyüzünde
# üç küçük uçak, hangarda kuyruk) kaçırıp etiketi yanlışlıkla kaldırıyordu
# (örneklerde ~%15-20). Kaldırılanlara daha kapsayıcı bir soru sorulur; "evet" ise
# etiket geri konur.
RECHECK_QUESTIONS = {
    "ucak-tasarimli": "Bu görselde DIŞARIDAN görünen bir uçak var mı? Uçağın gövdesi, kanadı, kuyruğu veya motoru; küçük, uzakta ya da kısmen görünse de, ayrıca uçak maketi veya uçak çizimi/karikatürü sayılır. Uçağın İÇİ (kabin, koltuk, yolcu, kabin görevlisi, uçak penceresinden görünen manzara) sayılmaz, bunlar için Hayır yaz. Sadece Evet ya da Hayır yaz.",
}


def recheck_doc(doc):
    """Kaldırılmış etiketleri kapsayıcı soruyla yeniden kontrol eder; geri konanları döner."""
    x = doc.to_dict()
    ai = x.get("ai") or {}
    removed = set(ai.get("removedTags") or [])
    done = set(ai.get("rechecked") or [])
    restore = set()
    if frames_of(x):
        for tag, q in RECHECK_QUESTIONS.items():
            if tag in removed and tag not in done and tag not in (ai.get("tags") or []):
                for b in frames_of(x):
                    p = tempfile.mktemp(suffix=".img")
                    open(p, "wb").write(base64.b64decode(b))
                    try:
                        if ask(p, q):
                            restore.add(tag)
                            break
                    finally:
                        os.unlink(p)
    upd = {"needs_recheck": False, "ai.rechecked": firestore.ArrayUnion(sorted(set(RECHECK_QUESTIONS) & removed))}
    if restore:
        new_ai = list(dict.fromkeys([*(ai.get("tags") or []), *sorted(restore)]))
        new_tags = list(dict.fromkeys([*(x.get("tags") or []), *sorted(restore)]))
        upd.update({
            "ai.tags": new_ai,
            "tags": new_tags,
            "ai.removedTags": firestore.ArrayRemove(sorted(restore)),
            "ai.restoredTags": firestore.ArrayUnion(sorted(restore)),
            "searchTokens": generate_search_tokens(x.get("name", ""), new_tags, ai_search_text({
                "description": ai.get("description"), "onScreenText": ai.get("onScreenText")})),
        })
    doc.reference.update(upd)
    return sorted(restore)


def run(dry, limit, tags, skip_models):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    stats = {"model_removed": 0}
    if not skip_models:
        for m in MODEL_TAGS:
            for doc in db.collection("files").where("ai.tags", "array_contains", m).select(
                    ["name", "path", "tags", "ai.tags", "ai.description", "ai.onScreenText"]).stream():
                x = doc.to_dict()
                ctx = re.sub(r"[^a-z0-9]", "", (x.get("name", "") + (x.get("path") or "")).lower())
                if m in ctx:
                    continue
                stats["model_removed"] += 1
                apply_removal(doc, x, {m}, set(), dry)
        print(f"model etiketi kaldırıldı (ad/yolda desteklenmeyen): {stats['model_removed']}", flush=True)

    for tag in tags:
        kept = removed = skipped = n = 0
        t0 = time.time()
        last = None
        while True:
            q = (db.collection("files").where("ai.tags", "array_contains", tag)
                 .select(["name", "tags", "ai.tags", "ai.description", "ai.onScreenText", "ai.verified",
                          "videoPreviewFrames", "thumbnail"])
                 .order_by("__name__").limit(100))
            if last is not None:
                q = q.start_after(last)
            docs = list(q.stream())
            if not docs:
                break
            last = docs[-1]
            for doc in docs:
                x = doc.to_dict()
                if tag in ((x.get("ai") or {}).get("verified") or []):
                    skipped += 1
                    continue
                if limit and n >= limit:
                    break
                n += 1
                if not frames_of(x):
                    skipped += 1
                    continue
                ok = verified(x, tag)
                kept += ok
                removed += (not ok)
                apply_removal(doc, x, set() if ok else {tag}, {tag}, dry)
                if n % 50 == 0:
                    rate = (time.time() - t0) / n
                    print(f"  {tag}: {n} işlendi (korunan {kept}, kaldırılan {removed}, atlanan {skipped}) {rate:.1f} sn/dosya", flush=True)
            if limit and n >= limit:
                break
        print(f"{tag}: işlenen {n} | korunan {kept} | kaldırılan {removed} | atlanan {skipped}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tags", default="ucak-tasarimli,pilot")
    ap.add_argument("--skip-models", action="store_true")
    a = ap.parse_args()
    run(a.dry_run, a.limit, [t for t in a.tags.split(",") if t], a.skip_models)
