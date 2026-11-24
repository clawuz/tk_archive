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
    {
        "id": "telif-pdf", "name": "Telif PDF", "color": "#b45309", "order": 20,
        "description": "Telif.pdf (23/02/2026) listesindeki projelerin telif/lisans bilgisi işlenen dosyalar",
        "rules": {"tags": ["telif-dokumani-2026"]},
    },
]


def _d(day, month):
    # "23 Nisan" / "23-nisan" / "23nisan" — ay KLASÖRLERİ ("10-EKIM") ve 2023-nisan gibi yıl/ay yazımlarıyla karışmasın
    return rf"(?<![0-9])0?{day}-?{month}(?![a-z])"


# (id, ad, [alt-dizgi], [regex])  — takvim sırasıyla
SPECIAL_DAYS = [
    ("yilbasi", "Yılbaşı", ["yeni-yil", "yilbasi", "new-year"], []),
    ("14-subat", "14 Şubat Sevgililer Günü", ["sevgililer-gunu", "valentine"], [_d(14, "subat")]),
    ("8-mart", "8 Mart Dünya Kadınlar Günü", ["kadinlar-gunu", "dunya-kadinlar"], [_d(8, "mart")]),
    ("22-mart", "22 Mart Dünya Su Günü", ["dunya-su-gunu"], [_d(22, "mart")]),
    ("30-mart", "30 Mart Sıfır Atık Günü", ["sifir-atik"], []),
    ("23-nisan", "23 Nisan Ulusal Egemenlik ve Çocuk Bayramı", ["ulusal-egemenlik", "23nisan"], [_d(23, "nisan")]),
    ("1-mayis", "1 Mayıs Emek ve Dayanışma Günü", ["emek-ve-dayanisma", "isci-bayrami"], [_d(1, "mayis")]),
    ("anneler-gunu", "Anneler Günü", ["anneler-gunu", "mothers-day"], []),
    ("19-mayis", "19 Mayıs Gençlik ve Spor Bayramı", ["genclik-ve-spor-bayrami"], [_d(19, "mayis")]),
    ("24-mayis", "24 Mayıs Uçak Teknisyenleri Günü", ["ucak-teknisyenleri"], []),
    ("25-mayis", "25 Mayıs Afrika Günü", ["afrika-gunu"], [_d(25, "mayis")]),
    ("babalar-gunu", "Babalar Günü", ["babalar-gunu", "fathers-day"], []),
    ("kedi-gunu", "Dünya Kedi Günü", ["kedi-gunu"], []),
    ("19-agustos", "19 Ağustos Dünya Fotoğrafçılık Günü", ["fotografcilik-gunu"], [_d(19, "agustos")]),
    ("30-agustos", "30 Ağustos Zafer Bayramı", ["30agustos", "zafer-bayrami"], [_d(30, "agustos")]),
    ("27-eylul", "27 Eylül Dünya Turizm Günü", ["dunya-turizm-gunu"], [_d(27, "eylul")]),
    ("kahve-gunu", "Dünya Kahve Günü", ["dunya-kahve-gunu"], []),
    ("20-ekim", "20 Ekim Hava Trafik Kontrolörleri Günü", ["hava-trafik-kontrol"], []),
    ("29-ekim", "29 Ekim Cumhuriyet Bayramı", ["cumhuriyet-bayrami", "29ekim"], [_d(29, "ekim")]),
    ("10-kasim", "10 Kasım Atatürk'ü Anma Günü", ["10kasim", "ataturku-anma"], [_d(10, "kasim")]),
    ("merhaba-gunu", "21 Kasım Dünya Merhaba Günü", ["merhaba-gunu"], []),
    ("24-kasim", "24 Kasım Öğretmenler Günü", ["ogretmenler-gunu"], [_d(24, "kasim")]),
    ("cay-gunu", "15 Aralık Dünya Çay Günü", ["cay-gunu"], []),
    ("ramazan-bayrami", "Ramazan Bayramı", ["seker-bayrami"], [r"(?<![a-z])ramazan(?![a-z])"]),
    ("kurban-bayrami", "Kurban Bayramı", ["kurban-bayram"], []),
]
for _i, (_id, _name, _contains, _rx) in enumerate(SPECIAL_DAYS):
    DEFAULT_GROUPS.append({
        "id": _id, "parent": "ozel-gunler", "name": _name, "color": "#be185d", "order": 31 + _i,
        "description": "", "rules": {"pathContains": _contains, "pathRegex": _rx},
    })
DEFAULT_GROUPS.append({
    "id": "ozel-gunler", "name": "Özel Günler", "color": "#be185d", "order": 30, "collapsed": True,
    "description": "Resmi/ulusal günler, dini bayramlar, dünya günleri ve diğer özel gün içerikleri", "rules": {},
})


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
    if any(p in npath or any(p in t for t in tags) for p in c["path"]) or any(rx.search(npath) or any(rx.search(t) for t in tags) for rx in c["regex"]):
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
