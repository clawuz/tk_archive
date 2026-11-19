"""
Sprint 4 — mints a real Firebase Auth ID token for the worker to call
authenticated callables (tagNewFiles) with. The worker only has an Admin
SDK service account, not a real user session, so this does a one-time
custom-token -> ID-token exchange: Admin SDK creates a custom token for a
synthetic worker UID, then Identity Toolkit's signInWithCustomToken REST
endpoint exchanges it for a real ID token, the same way a real user's
sign-in would produce one.

WORKER_UID doesn't need a users/{uid} Firestore doc to exist — tagNewFiles
only checks `context.auth` is present (see functions/tagNewFiles.js:200),
not domain/role, so this identity only works for THIS specific callable.
"""

from pathlib import Path

import firebase_admin
import requests
from firebase_admin import credentials, auth as fb_auth

SERVICE_ACCOUNT_PATH = (
    Path(__file__).parent.parent.parent
    / "tk_archive/functions/config/serviceAccountKey.json"
)
# Same key already confirmed working for Identity Toolkit REST calls
# earlier in this project (see plan notes on the firebase.ts API key fix).
WEB_API_KEY = "AIzaSyBDT0iZjCvWgcj5eDoFunQAimTk8tV-PQo"
WORKER_UID = "tk-ai-worker"

_app = None


def _get_app():
    global _app
    if _app is None:
        cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
        _app = firebase_admin.initialize_app(cred, name="sprint4-auth")
    return _app


def get_worker_id_token():
    app = _get_app()
    custom_token = fb_auth.create_custom_token(WORKER_UID, app=app).decode("utf-8")

    resp = requests.post(
        f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={WEB_API_KEY}",
        json={"token": custom_token, "returnSecureToken": True},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["idToken"]


if __name__ == "__main__":
    token = get_worker_id_token()
    print(f"✅ ID token obtained ({len(token)} chars) — auth plumbing works.")
    print("Not calling tagNewFiles with it — that's a separate, explicit step.")
