"""
Bir etiketi tüm dosyalardan kaldırır, searchTokens'ı yeniden hesaplar ve
`tags` kayıt defterinden siler. Sadece `tags` + `searchTokens` yazılır.
Usage: uv run python sprint3/remove_tag.py <etiket> [<etiket>...]
"""
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore
sys.path.insert(0, str(Path(__file__).parent))
from worker import SERVICE_ACCOUNT_PATH  # noqa: E402
from ai_write import ai_search_text, generate_search_tokens  # noqa: E402


def main(tags):
    firebase_admin.initialize_app(credentials.Certificate(str(SERVICE_ACCOUNT_PATH)))
    db = firestore.client()
    pool = ThreadPoolExecutor(max_workers=4)
    for tag in tags:
        total = 0
        while True:
            docs = list(
                db.collection("files").where("tags", "array_contains", tag)
                .select(["name", "tags", "ai.description", "ai.onScreenText"]).limit(400).stream()
            )
            if not docs:
                break
            futures = []
            for i in range(0, len(docs), 40):
                batch = db.batch()
                for d in docs[i:i + 40]:
                    x = d.to_dict()
                    new_tags = [t for t in (x.get("tags") or []) if t != tag]
                    batch.update(d.reference, {
                        "tags": new_tags,
                        "searchTokens": generate_search_tokens(x.get("name", ""), new_tags, ai_search_text(x.get("ai"))),
                    })
                futures.append(pool.submit(batch.commit))
            for f in futures:
                f.result()
            total += len(docs)
            print(f"  {tag}: {total} dosyadan kaldırıldı", flush=True)
        db.collection("tags").document(tag).delete()
        print(f"{tag}: toplam {total} dosya, kayıt defterinden silindi", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
