# Local Preview Scanner Setup

Generates small previews for large local/SMB video archives and registers
them in TK_Archive, without uploading the original multi-GB files anywhere.

## One-time setup

### 1. Google Drive OAuth client

1. Google Cloud Console → project `tk-archive-cd9d0` → APIs & Services → Credentials
2. Create OAuth client ID → Application type: **Desktop app**
3. Download the JSON, save as `functions/config/driveOAuthClient.json`

### 2. Authorize your personal Google account

```bash
node authorizeDrivePreviews.cjs
```

Opens a URL — open it in your browser, log in with the Google account whose
Drive storage should hold the previews, and approve access. This creates
`functions/config/drivePreviewToken.json` (reused by every future scan —
you only do this once, unless the token is revoked).

### 3. Confirm the SMB share is mounted

The scanner reads local paths, not `smb://` URLs. Make sure `TRIBAL` is
mounted (Finder → Go → Connect to Server, or it may already be mounted at
`/Volumes/TRIBAL`).

## Adding or changing scanned folders

Edit `roots.json` — add or remove absolute paths under `/Volumes/TRIBAL/...`.
No code changes needed.

## Running a scan

```bash
npm run scan:local-preview
```

Safe to re-run — already-processed files (preview generated, uploaded to
Drive, and registered in Firestore) are skipped. Run again after new files
are added to any configured root to pick up just the new ones.

Output: console progress (`.` per processed file, `x` per failure), and a
`preview_log.csv` in the project root listing every file's outcome.

## Where previews end up

- **Locally:** next to the original, as `<name>_preview.mp4`.
- **In Drive:** under `TK Archive Previews/`, mirroring the file's path
  relative to the `TRIBAL` share root.
- **In TK_Archive:** same as any other scanned file — search, tags, and
  the video preview player all work identically to existing entries.
