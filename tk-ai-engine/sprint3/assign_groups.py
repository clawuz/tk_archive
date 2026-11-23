#!/usr/bin/env python
"""Konu grupları: `tag_groups` koleksiyonundaki kurallara göre her dosyaya
`groups: [...]` alanını yazar (arayüzdeki "Konu Grupları" filtresi bunu kullanır).

Kural alanları (tag_groups/{id}.rules, hepsi isteğe bağlı, herhangi biri tutarsa dosya gruba girer):
  pathContains   yol VEYA klasörden türeyen etiketlerde alt-dizgi. Yol önce normalize edilir: küçük harf, Türkçe harfler
                 ASCII'ye, boşluk/alt çizgi -> '-'  (ör. "IK İş Alım" -> "ik-is-alim")
  pathRegex      normalize yola regex
  tags           dosya etiketlerinden biri (normalize, tam eşleşme)
  textContains   AI'nın okuduğu ekran yazısı / açıklamada geçen ifadeler (normalize)
  includePaths   ELLE eklenen klasör/dosya yolu önekleri (ham yol, /Volumes/TRIBAL/...)
  includeFileIds ELLE eklenen dosya kimlikleri
  excludePath    bu alt-dizgilerden biri yolda varsa dosya gruptan çıkarılır
`parent` alanı olan grup (alt konu), dosya girerse üst grup da eklenir.
Kopya (isDuplicate) dosyalar da değerlendirilir; eşleşirse grup TEMSİLCİ dosyaya da yazılır
(kopya arayüzde gizli, içerik başka klasörde duran temsilciyle görünür).

Usage:
  python assign_groups.py --seed        # varsayılan grup tanımlarını yaz (var olan kuralları ezmez)
  python assign_groups.py --reseed      # tanımları varsayılana sıfırla
  python assign_groups.py [--dry-run] [--quiet]
"""
import re
import sys
import json
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

KEY = Path(__file__).resolve().parents[2] / "tk_archive/functions/config/serviceAccountKey.json"
TR = str.maketrans("çğıöşüâîûÇĞÖŞÜÂÎÛ", "cgiosuaiucgosuaiu")

DEFAULT_GROUPS = [
    {
        "id": "ik", "name": "İK ve İşveren Markası", "color": "#0e7490", "order": 0,
        "description": "Take-Off, işe alım/ilanlar ve işveren markası içerikleri",
        "rules": {},
    },
    {
        "id": "take-off", "parent": "ik", "name": "Take-Off", "color": "#0e7490", "order": 1,
        "description": "Take-Off Vocational / Cadet / Sr / 101 programları",
        "rules": {"pathContains": ["take-off", "take-of-", "takeoff", "cadet", "vocational"]},
    },
    {
        "id": "ise-alim-ilanlar", "parent": "ik", "name": "İşe Alım ve İlanlar", "color": "#0e7490", "order": 2,
        "description": "İK iş ilanları, işe alım filmleri/sonuçları, pilot ve kabin memuru ilanları",
        "rules": {"pathContains": [
            "tk-ik-", "ik-is-alim", "ise-alim", "pilot-ilan", "pilotlari-ilan", "kabin-memurlari-ilan",
            "kariyer", "is-ilani", "engelli-calisan"]},
    },
    {
        "id": "isveren-markasi", "parent": "ik", "name": "İşveren Markası ve Ödüller", "color": "#0e7490", "order": 3,
        "description": "Forbes en iyi işverenler, Kabin-Kokpit imaj/serisi, çalışan hikâyeleri, Rise as One / EVP",
        "rules": {
            "pathContains": ["en-iyi-isverenleri", "kabin-kokpit-yeni-imaj", "kabin-kokpit-serisi",
                             "calisan-mutlulugu", "isveren-marka", "employer-brand", "rise-as-one", "riseasone"],
            "pathRegex": [r"(^|[/-])evp([/.-]|$)"],
            "textContains": ["rise as one", "employee value", "birlikte yuksel"]},
    },
    {
        "id": "meslekler", "name": "Meslekler (Kabin / Kokpit / Dispeçer)", "color": "#7c3aed", "order": 10,
        "description": "Kabin memuru, pilot, kokpit ve dispeçer görüntüleri (AI etiketlerine göre; İK grubundan ayrı)",
        "rules": {"tags": ["kabin-memuru", "pilot", "kokpit", "dispecer"]},
    },
]


def norm(s):
    if not s:
        return ""
    s = s.replace("İ", "i").replace("I", "ı").lower().translate(TR)
    return re.sub(r"[\s_]+", "-", s)


def norm_text(s):
    if not s:
        return ""
    return norm(s).replace("-", " ")


def compile_rules(r):
    return {
        "path": [norm(p) for p in r.get("pathContains", [])],
        "regex": [re.compile(x) for x in r.get("pathRegex", [])],
        "tags": {norm(t) for t in r.get("tags", [])},
        "text": [norm_text(t) for t in r.get("textContains", [])],
        "incPaths": r.get("includePaths", []),
        "incIds": set(r.get("includeFileIds", [])),
        "exclude": [norm(p) for p in r.get("excludePath", [])],
    }


def matches(c, fid, raw_path, npath, tags, text):
    if any(e in npath for e in c["exclude"]):
        return False
    if fid in c["incIds"] or any(raw_path.startswith(p) for p in c["incPaths"]):
        return True
    # Drive kaynaklı dosyalarda yol bir kimliktir; klasör adları klasörden türeyen etiketlerde durur
    if any(p in npath or any(p in t for t in tags) for p in c["path"]) or any(rx.search(npath) for rx in c["regex"]):
        return True
    if c["tags"] and tags & c["tags"]:
        return True
    if c["text"] and any(t in text for t in c["text"]):
        return True
    return False


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    quiet = "--quiet" in args
    log = (lambda *a: None) if quiet else print
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(str(KEY)))
    db = firestore.client()
    gcol = db.collection("tag_groups")

    if "--seed" in args or "--reseed" in args:
        for g in DEFAULT_GROUPS:
            ref = gcol.document(g["id"])
            if "--reseed" in args or not ref.get().exists:
                ref.set({k: v for k, v in g.items() if k != "id"} | {"groupId": g["id"]})
                log("grup yazıldı:", g["id"])
        return

    groups = {d.id: d.to_dict() for d in gcol.stream()}
    if not groups:
        print("tag_groups boş — önce --seed çalıştır")
        return
    compiled = {gid: compile_rules(g.get("rules") or {}) for gid, g in groups.items() if g.get("rules")}
    parent = {gid: g.get("parent") for gid, g in groups.items() if g.get("parent")}

    own, existing, is_dup, dup_of = {}, {}, {}, {}
    last = None
    total = 0
    while True:
        q = (db.collection("files")
             .select(["path", "tags", "isDuplicate", "duplicateOf", "groups", "ai.onScreenText", "ai.description"])
             .order_by("__name__").limit(3000))
        if last:
            q = q.start_after(last)
        snap = list(q.get())
        if not snap:
            break
        for d in snap:
            x = d.to_dict()
            total += 1
            p = x.get("path") or ""
            ai = x.get("ai") or {}
            ost = ai.get("onScreenText")
            ost = " ".join(ost) if isinstance(ost, list) else (ost or "")
            text = norm_text(ost + " " + (ai.get("description") or ""))
            tags = {norm(t) for t in (x.get("tags") or [])}
            np = norm(p)
            hit = {gid for gid, c in compiled.items() if matches(c, d.id, p, np, tags, text)}
            own[d.id] = hit
            existing[d.id] = sorted(x.get("groups") or [])
            is_dup[d.id] = bool(x.get("isDuplicate"))
            if x.get("duplicateOf"):
                dup_of[d.id] = x["duplicateOf"]
        last = snap[-1]
        log(f"  okundu {total}")

    # kopyanın eşleşmesi temsilciye de yazılır
    final = {fid: set(h) for fid, h in own.items()}
    for fid, rep in dup_of.items():
        if rep in final and own.get(fid):
            final[rep] |= own[fid]
    # alt grup -> üst grup
    for fid, h in final.items():
        for gid in list(h):
            if gid in parent:
                h.add(parent[gid])

    counts = {gid: 0 for gid in groups}
    changed = []
    for fid, h in final.items():
        new = sorted(h)
        if not is_dup[fid]:
            for gid in new:
                counts[gid] = counts.get(gid, 0) + 1
        if new != existing[fid]:
            changed.append((fid, new))
    log(f"toplam {total} kayıt, güncellenecek {len(changed)}")
    log("grup başına (kopyasız) dosya:", {k: v for k, v in counts.items()})
    if dry:
        return

    batch = db.batch()
    n = 0
    for fid, new in changed:
        ref = db.collection("files").document(fid)
        batch.update(ref, {"groups": new} if new else {"groups": firestore.DELETE_FIELD})
        n += 1
        if n % 400 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()
    for gid, c in counts.items():
        gcol.document(gid).update({"fileCount": c, "countedAt": firestore.SERVER_TIMESTAMP})
    log("bitti:", n, "dosya güncellendi")


if __name__ == "__main__":
    main()
