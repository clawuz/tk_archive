"""
2026-10-12: SKYTRAX2026 videolarında plaket üstünde "AWARDS 2026" yazıyor ama
VLM yılı yanlış okumuş (2013/2016/2018). Sadece SKYTRAX2026 yolundaki
dosyaların ai.description + ai.onScreenText alanlarında düzeltir,
searchTokens'ı yeniden hesaplar. Orijinaller backups/ altına yazılır.
Usage: uv run python sprint3/fix_skytrax_year.py [--apply]
"""
import argparse, json, re, sys
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens  # noqa: E402

P = "/Volumes/TRIBAL/THY/ACCOUNT/2026/SKYTRAX2026/"
WRONG = r"20(?:13|16|18)"


def fix(text):
    t = re.sub(WRONG + r"'(?:teki|deki)", "2026'daki", text)
    t = re.sub(WRONG + r"'ta\b", "2026'da", t)
    return re.sub(r"(?<!\d)" + WRONG + r"(?!\d)", "2026", t)


def main(apply):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    q = db.collection("files").where("path", ">=", P).where("path", "<", P[:-1] + "0")
    backup, n = {}, 0
    for d in q.select(["name", "tags", "ai.description", "ai.onScreenText"]).stream():
        x = d.to_dict(); a = x.get("ai") or {}
        desc = a.get("description") or ""
        ocr = a.get("onScreenText") or []
        new_desc = fix(desc)
        new_ocr = [fix(t) for t in ocr]
        if new_desc == desc and new_ocr == ocr:
            continue
        n += 1
        print(f"- {x['name']}")
        if new_desc != desc:
            print("    açıklama:", re.sub(r"\s+", " ", new_desc)[:160])
        if new_ocr != ocr:
            print("    ekran yazısı:", new_ocr)
        backup[d.id] = {"ai.description": desc, "ai.onScreenText": ocr}
        if apply:
            d.reference.update({
                "ai.description": new_desc,
                "ai.onScreenText": new_ocr,
                "searchTokens": generate_search_tokens(
                    x.get("name", ""), x.get("tags") or [],
                    ai_search_text({"description": new_desc, "onScreenText": new_ocr}),
                ),
            })
    print(f"\n{n} dosya {'güncellendi' if apply else 'güncellenecek (dry-run)'}")
    if apply and backup:
        out = Path(__file__).parent.parent / "backups" / "skytrax_year_fix.json"
        out.write_text(json.dumps(backup, ensure_ascii=False, indent=1))
        print("yedek:", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true")
    main(ap.parse_args().apply)
