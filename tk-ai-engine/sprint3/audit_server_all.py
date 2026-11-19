"""
Tüm sunucuyu (/Volumes/TRIBAL) klasör klasör sayar ve Firestore'daki yollarla karşılaştırır.
Salt okunur. Argüman olarak birim öneki verilirse (örn. THY 2023/THY) yalnızca onlar. Çıktı: logs/audit_server_all.log (canlı) + backups/audit_all.json.
Birim: /Volumes/TRIBAL/<müşteri>; THY altında <bölüm>/<yıl>; 2023 altında da bir seviye daha.
"""
import json, os, re, sys, time
from collections import defaultdict
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402

BASE = "/Volumes/TRIBAL"
JUNK = re.compile(r"(_preview\.\w+$|\.pek$|\.cfa$|\.xmp$|\.ims$|\.cpk$|\.mpgindex$|\.xpr$|^thumbs\.db$|^desktop\.ini$)", re.I)
SEQ = re.compile(r"[._-]?\d{3,}\.(tga|png|jpe?g|tiff?|exr|dpx|bmp)$", re.I)
VID = {"mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "mts", "m2ts", "wmv", "flv", "mxf", "m4v"}
IMG = {"jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "heic", "tga", "svg", "arw", "cr2", "nef", "dng"}
DES = {"psd", "psb", "ai", "eps", "indd"}


def units():
    out = []
    for e in sorted(os.scandir(BASE), key=lambda e: e.name):
        if e.name.startswith(".") or not e.is_dir():
            continue
        if e.name in ("THY", "2023"):
            for c in sorted(os.scandir(e.path), key=lambda c: c.name):
                if c.name.startswith(".") or not c.is_dir():
                    continue
                if e.name == "THY":
                    for y in sorted(os.scandir(c.path), key=lambda y: y.name):
                        if not y.name.startswith(".") and y.is_dir():
                            out.append((f"{e.name}/{c.name}/{y.name}", y.path))
                else:
                    out.append((f"{e.name}/{c.name}", c.path))
        else:
            out.append((e.name, e.path))
    return out


def walk(root):
    files = []
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.name.startswith("."):
                        continue
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        elif e.is_file(follow_symlinks=False):
                            files.append((e.path, e.stat().st_size))
                    except OSError:
                        pass
        except OSError:
            pass
    return files


def main():
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    indexed = set()
    last = None
    while True:
        q = db.collection("files").where("source", "==", "local").select([]).order_by("__name__").limit(5000)
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            break
        last = docs[-1]
    # path'e ihtiyaç var: select(['path'])
    last = None
    while True:
        q = db.collection("files").where("source", "==", "local").select(["path"]).order_by("__name__").limit(5000)
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            break
        last = docs[-1]
        indexed.update(d.to_dict().get("path") for d in docs)
    print(f"Firestore'da {len(indexed)} yerel yol", flush=True)
    result = {}
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, root in units():
        if only and not any(name == o or name.startswith(o + "/") for o in only):
            continue
        t = time.time()
        files = walk(root)
        seqc = defaultdict(int)
        for p, _ in files:
            if SEQ.search(os.path.basename(p)):
                seqc[os.path.dirname(p)] += 1
        seqdirs = {d for d, c in seqc.items() if c >= 20}
        stat = dict(disk=len(files), bytes=sum(s for _, s in files), indexed=0, junk=0, seq=0, video=0, image=0, design=0, other=0, missing=0, missing_bytes=0)
        for p, s in files:
            b = os.path.basename(p)
            if p in indexed:
                stat["indexed"] += 1; continue
            if JUNK.search(b): stat["junk"] += 1; continue
            if os.path.dirname(p) in seqdirs and SEQ.search(b): stat["seq"] += 1; continue
            ext = b.rsplit(".", 1)[-1].lower() if "." in b else ""
            stat["missing"] += 1; stat["missing_bytes"] += s
            stat["video" if ext in VID else "image" if ext in IMG else "design" if ext in DES else "other"] += 1
        result[name] = stat
        print(f"{name:45s} diskte {stat['disk']:7d} {stat['bytes']/1e9:8.1f} GB | sistemde {stat['indexed']:6d} | EKSİK {stat['missing']:7d} ({stat['missing_bytes']/1e9:7.1f} GB: v{stat['video']} g{stat['image']} t{stat['design']} d{stat['other']}) | yardımcı {stat['junk']} dizi {stat['seq']} | {time.time()-t:.0f} sn", flush=True)
    Path(__file__).parent.parent.joinpath("backups", "audit_all.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    tot = sum(s["missing"] for s in result.values()); tb = sum(s["missing_bytes"] for s in result.values())
    print(f"\nTOPLAM eksik: {tot} dosya, {tb/1e12:.2f} TB", flush=True)
    print("bitti", flush=True)


if __name__ == "__main__":
    main()
