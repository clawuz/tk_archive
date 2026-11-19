"""
Açıklamalarda (ai.description) dosya yolunda/adında/ekran yazısında geçmeyen yıllar
(2026-10-23 denetimi: SKYTRAX'ta plaket 2026 yazarken model 2016 demişti; genelde
modelin kendi 'bilgisinden' uydurduğu yıllar). Her yıl için karelere "bu yıl
görselde yazıyor mu?" diye sorulur; görünmüyorsa yıl açıklamadan silinir.
Ekran yazısından (ai.onScreenText) gelen yıllara dokunulmaz — onlar okunmuş metin.
Orijinaller backups/year_fix.json'a yazılır. Worker durdurulup çalıştırılmalı (GPU belleği).

Usage: uv run python sprint3/fix_unsupported_years.py [--dry-run]
"""
import argparse, json, re, sys
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens  # noqa: E402
import verify_tags as vt  # noqa: E402

Y = re.compile(r"(?<!\d)(19[89]\d|20[0-4]\d)(?!\d)")


def ctx_years(name, path):
    ys = set(Y.findall((path or "") + " " + name))
    for m in re.findall(r"(?<!\d)(2[0-9])[01]\d[0-3]\d(?!\d)", name + " " + (path or "")):
        ys.add("20" + m)
    return ys


def strip_year(text, year):
    t = re.sub(r"\s*(?<!\d)" + year + r"(?!\d)(?:'[A-Za-zçğıöşüÇĞİÖŞÜ]+)?", "", text)
    t = re.sub(r"\s{2,}", " ", t)
    return re.sub(r"\s+([,.;:])", r"\1", t).strip()


def main(dry):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    rows = [json.loads(l) for l in open(Path(__file__).parent.parent / "backups" / "audit_ai.jsonl")]
    cands = []
    for r in rows:
        ai = r.get("ai") or {}
        desc = ai.get("description") or ""
        ocr = " ".join(ai.get("onScreenText") or [])
        bad = set(Y.findall(desc)) - ctx_years(r["name"], r.get("path")) - set(Y.findall(ocr))
        if bad:
            cands.append((r["id"], sorted(bad)))
    print(f"aday: {len(cands)} dosya", flush=True)
    backup, stripped, kept = {}, 0, 0
    for n, (id_, years) in enumerate(cands, 1):
        doc = db.collection("files").document(id_).get()
        x = doc.to_dict()
        ai = x.get("ai") or {}
        desc = ai.get("description") or ""
        new = desc
        removed = []
        for y in years:
            q = f"Bu görselde '{y}' yılı ya da sayısı yazıyor mu? Sadece Evet ya da Hayır yaz."
            vt.QUESTIONS["_y"] = q
            if vt.verified(x, "_y"):
                kept += 1
            else:
                new = strip_year(new, y)
                removed.append(y)
        if removed:
            stripped += 1
            backup[id_] = {"name": x["name"], "ai.description": desc}
            print(f"  [{n}/{len(cands)}] {x['name'][:45]} yıl silindi {removed}", flush=True)
            if not dry:
                tags = x.get("tags") or []
                doc.reference.update({
                    "ai.description": new,
                    "searchTokens": generate_search_tokens(x.get("name", ""), tags, ai_search_text(
                        {"description": new, "onScreenText": ai.get("onScreenText")})),
                })
    if backup and not dry:
        Path(__file__).parent.parent.joinpath("backups", "year_fix.json").write_text(json.dumps(backup, ensure_ascii=False, indent=1))
    print(f"bitti — yıl silinen dosya: {stripped} | görselde yazdığı için korunan yıl: {kept}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true")
    main(ap.parse_args().dry_run)
