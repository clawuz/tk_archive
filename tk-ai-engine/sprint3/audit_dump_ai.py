"""Kalite denetimi için tüm AI sonuçlarını backups/audit_ai.jsonl'e döker (salt okunur)."""
import json, sys
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402

firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
db = firestore.client()
out = Path(__file__).parent.parent / "backups" / "audit_ai.jsonl"
n = 0
last = None
with out.open("w") as fh:
    while True:
        q = (db.collection("files").where("ai.status", "==", "completed")
             .select(["name", "path", "extension", "mimeType", "tags", "ai.tags", "ai.description", "ai.onScreenText", "enrichStatus", "scanLevel"])
             .order_by("__name__").limit(2000))
        if last is not None:
            q = q.start_after(last)
        docs = list(q.stream())
        if not docs:
            break
        for d in docs:
            x = d.to_dict(); x["id"] = d.id
            fh.write(json.dumps(x, ensure_ascii=False, default=str) + "\n")
        n += len(docs); last = docs[-1]
        print(n, flush=True)
print("bitti", n)
