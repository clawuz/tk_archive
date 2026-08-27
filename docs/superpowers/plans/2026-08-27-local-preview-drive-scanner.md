# Local Archive Preview + Drive Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan the ~10,000 videos across the 5 configured TRIBAL SMB folders, generate a small local preview for each, upload the preview to the archive owner's personal Google Drive (mirroring the share's folder structure), and register each file in TK_Archive's existing Firestore `files` collection so it appears, tagged and playable, in the current DAM UI at tribal-tk-archive.web.app.

**Architecture:** A new standalone CLI script (`scannerLocalPreview.cjs`), sibling to `scanner.cjs`/`scannerDrive.cjs`, reusing their shared libraries (`lib/autoTags.cjs`, `lib/videoFrames.cjs`, `lib/searchTokens.cjs`) unchanged. It reads a list of root folders from `roots.json`, and for each video: generates a 480p H.264 preview locally via ffmpeg, uploads the preview to a personal Google Drive account (OAuth, mirrored folder structure), extracts 5 frames from the original for Claude Vision tagging, and writes a Firestore document matching the existing `DAMFile` schema. `streamingService.ts` gets a small generalization so any file with a `driveFileId` — not just `source: 'drive'` files — streams from Drive's embed viewer.

**Tech Stack:** Node.js (CommonJS, matching `scanner.cjs`/`scannerDrive.cjs`), `googleapis` (already a dependency) for Drive OAuth + upload, `firebase-admin` (already a dependency) for Firestore, `ffmpeg`/`ffprobe` (already installed, VideoToolbox-capable on this M2 Mac) for preview transcoding and frame extraction (via the existing `lib/videoFrames.cjs`).

## Global Constraints

- Node.js CommonJS (`.cjs`), matching `scanner.cjs`/`scannerDrive.cjs` — this codebase's `package.json` has `"type": "module"`, so any new script under the project root must keep the `.cjs` extension to opt out of ESM.
- Firebase project: `tk-archive-cd9d0` (per `functions/config/serviceAccountKey.json`, already present).
- Do not modify `scanner.cjs`'s existing behavior for the `TK-2026` archive (full video → GCS bucket `tk-archive-cd9d0-videos`) — this plan only adds new files plus one small generalization in `streamingService.ts`.
- Preview transcode: `ffmpeg -vf scale=-2:480 -c:v h264_videotoolbox -b:v 1500k -c:a aac -b:a 96k`, full duration, written as `<basename>_preview.mp4` next to the original.
- Roots (from `roots.json`, all under the `TRIBAL` SMB share mounted at `/Volumes/TRIBAL`):
  - `/Volumes/TRIBAL/THY/ACCOUNT/2026/TK_STOCK`
  - `/Volumes/TRIBAL/THY/ACCOUNT/2026/thy stok 2`
  - `/Volumes/TRIBAL/THY/ACCOUNT/2026/tk apron ham görseller`
  - `/Volumes/TRIBAL/2023/THY/YARATICI_EKIP/TurkishAirlines/VIDEO_WORKS`
  - `/Volumes/TRIBAL/THY/CREATIVE/2026/TurkishAirlines/VIDEO_WORKS`
- Drive destination: the archive owner's personal Google account (OAuth, not the existing read-only `archive-scanner` service account), mirroring each file's path relative to `/Volumes/TRIBAL` under a `TK Archive Previews/` root folder in that Drive.
- Firestore `files` collection schema: reuse `DAMFile` fields exactly as `scanner.cjs` populates them (see `scanner.cjs:137-173`), adding no new field — `driveFileId` (already optional on `DAMFile`) is set to the preview's Drive file ID.
- Concurrency: up to 3 files processed in parallel (transcode + upload + Firestore write per file, 3 workers).
- Resume/idempotency: a file is skipped entirely (no hashing, no ffmpeg, no network calls) if its Firestore document already exists with a truthy `driveFileId`.

---

## File Structure

**New files:**
- `roots.json` — JSON config listing the 5 SMB root folders to scan. Editing this file (not code) is how new folders get added later.
- `lib/driveOAuth.cjs` — loads OAuth client credentials + stored token, returns an authenticated `google.auth.OAuth2` client. Shared by the one-time authorization script and the main scanner.
- `authorizeDrivePreviews.cjs` — one-time interactive CLI: prints a consent URL, runs a local loopback server to catch the OAuth redirect, exchanges the code for a token, saves it to `functions/config/drivePreviewToken.json`. Run once by the archive owner, logged into their own Google account.
- `lib/drivePreviewUpload.cjs` — given an authenticated Drive client: creates (or reuses) a nested folder path under `TK Archive Previews/`, and uploads a preview file into it, returning the new file's Drive ID.
- `scannerLocalPreview.cjs` — main script: walks `roots.json`, transcodes previews, extracts frames, auto-tags, uploads to Drive, writes Firestore docs. Entry point for `npm run scan:local-preview`.
- `LOCAL_PREVIEW_SCANNER_SETUP.md` — setup + usage doc, sibling to `SCANNER_SETUP.md`/`GOOGLE_DRIVE_SETUP.md`.

**Modified files:**
- `src/services/streamingService.ts` — `getStreamUrl` generalized to check `file.driveFileId` directly instead of gating it behind `file.source === 'drive'`.
- `package.json` — new `scan:local-preview` and `authorize:drive-previews` scripts.
- `.gitignore` — add `functions/config/drivePreviewToken.json` and `functions/config/driveOAuthClient.json` (credentials, must never be committed — mirrors the existing exclusion pattern for `serviceAccountKey.json`).

**Not modified:** `scanner.cjs`, `scannerDrive.cjs`, `lib/autoTags.cjs`, `lib/videoFrames.cjs`, `lib/searchTokens.cjs`.

---

## Task 1: Roots config file

**Files:**
- Create: `roots.json`

**Interfaces:**
- Produces: a JSON file with shape `{ "roots": string[] }`, consumed by `scannerLocalPreview.cjs` in Task 5.

- [ ] **Step 1: Create the config file**

```json
{
  "roots": [
    "/Volumes/TRIBAL/THY/ACCOUNT/2026/TK_STOCK",
    "/Volumes/TRIBAL/THY/ACCOUNT/2026/thy stok 2",
    "/Volumes/TRIBAL/THY/ACCOUNT/2026/tk apron ham görseller",
    "/Volumes/TRIBAL/2023/THY/YARATICI_EKIP/TurkishAirlines/VIDEO_WORKS",
    "/Volumes/TRIBAL/THY/CREATIVE/2026/TurkishAirlines/VIDEO_WORKS"
  ]
}
```

- [ ] **Step 2: Verify it parses and every root exists**

Run:
```bash
node -e "
const roots = require('./roots.json').roots;
const fs = require('fs');
for (const r of roots) {
  console.log(fs.existsSync(r) ? 'OK  ' : 'MISSING ', r);
}
"
```
Expected: `OK` printed for all 5 lines (requires the `TRIBAL` share to be mounted at `/Volumes/TRIBAL` — confirmed already mounted during design).

- [ ] **Step 3: Commit**

```bash
git add roots.json
git commit -m "feat: add configurable roots list for the local preview scanner"
```

---

## Task 2: Google Drive OAuth (personal account)

**Files:**
- Create: `lib/driveOAuth.cjs`
- Create: `authorizeDrivePreviews.cjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `getDriveClient(): Promise<OAuth2Client>` from `lib/driveOAuth.cjs`, consumed by Task 3 and Task 5.
- Depends on two files the archive owner must create themselves before Step 3 below: `functions/config/driveOAuthClient.json` (an OAuth 2.0 **Desktop app** client downloaded from Google Cloud Console — APIs & Services > Credentials, project `tk-archive-cd9d0`, scope needed: `https://www.googleapis.com/auth/drive.file`) and, after running the authorize script, `functions/config/drivePreviewToken.json` (created by the script itself, not by hand).

### Step 1: Exclude the new credential files from git

- [ ] Modify `.gitignore` — add these two lines (matching how `serviceAccountKey.json` is already excluded):

```
functions/config/driveOAuthClient.json
functions/config/drivePreviewToken.json
```

- [ ] Run: `git check-ignore functions/config/driveOAuthClient.json functions/config/drivePreviewToken.json`
Expected: both paths printed back (confirms they're ignored).

- [ ] **Commit**
```bash
git add .gitignore
git commit -m "chore: ignore Drive OAuth client/token files for local preview scanner"
```

### Step 2: Write the shared OAuth client loader

- [ ] Create `lib/driveOAuth.cjs`

```javascript
// Shared by authorizeDrivePreviews.cjs (one-time consent) and
// scannerLocalPreview.cjs (actual uploads). Uses drive.file scope — the
// narrowest scope that can create folders/files in the user's Drive — so
// this never requests broad read/write access to the account's existing
// files.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CLIENT_PATH = path.join(__dirname, '..', 'functions/config/driveOAuthClient.json');
const TOKEN_PATH = path.join(__dirname, '..', 'functions/config/drivePreviewToken.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function loadClientCredentials() {
  if (!fs.existsSync(CLIENT_PATH)) {
    throw new Error(
      `Drive OAuth client not found at ${CLIENT_PATH}\n` +
      'Create a Desktop app OAuth client in Google Cloud Console ' +
      '(project tk-archive-cd9d0 > APIs & Services > Credentials) and save the ' +
      'downloaded JSON there.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8'));
  return raw.installed || raw.web;
}

function createOAuth2Client() {
  const { client_id, client_secret, redirect_uris } = loadClientCredentials();
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

// Used only by authorizeDrivePreviews.cjs
function getAuthUrl(oAuth2Client) {
  return oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
}

async function saveToken(oAuth2Client, code) {
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

// Used by scannerLocalPreview.cjs for actual uploads.
async function getDriveClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `Drive token not found at ${TOKEN_PATH}\n` +
      'Run `node authorizeDrivePreviews.cjs` once first (one-time browser consent).'
    );
  }
  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  return oAuth2Client;
}

module.exports = { createOAuth2Client, getAuthUrl, saveToken, getDriveClient, SCOPES };
```

- [ ] Run: `node -e "require('./lib/driveOAuth.cjs')"`
Expected: no output, no error (module loads cleanly — credentials aren't read at require-time).

- [ ] **Commit**
```bash
git add lib/driveOAuth.cjs
git commit -m "feat: shared OAuth client loader for personal-Drive preview uploads"
```

### Step 3: Write the one-time interactive authorization script

- [ ] Create `authorizeDrivePreviews.cjs`

```javascript
#!/usr/bin/env node

// One-time setup: run this once, logged into the Google account whose
// Drive should receive the preview files. Opens a browser for consent,
// catches the redirect on a local loopback server, and saves the resulting
// refresh token to functions/config/drivePreviewToken.json.

const http = require('http');
const { URL } = require('url');
const { createOAuth2Client, getAuthUrl, saveToken } = require('./lib/driveOAuth.cjs');

async function main() {
  const oAuth2Client = createOAuth2Client();
  const redirectUri = new URL(oAuth2Client.redirectUri);
  const port = Number(redirectUri.port) || 80;

  const authUrl = getAuthUrl(oAuth2Client);
  console.log('\nOpen this URL in your browser and approve access:\n');
  console.log(authUrl, '\n');
  console.log(`Waiting for redirect on ${oAuth2Client.redirectUri} ...`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('No code in redirect.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorized. You can close this tab and return to the terminal.');
      server.close();
      resolve(code);
    });
    server.on('error', reject);
    server.listen(port);
  });

  await saveToken(oAuth2Client, code);
  console.log('\n✅ Saved functions/config/drivePreviewToken.json — future scans will use this token.\n');
}

main().catch((err) => {
  console.error('❌ Authorization failed:', err.message);
  process.exit(1);
});
```

- [ ] Run: `node authorizeDrivePreviews.cjs`

Expected (requires `functions/config/driveOAuthClient.json` to already exist — created by the archive owner in Google Cloud Console beforehand, redirect URI in that OAuth client must be `http://localhost:<port>` matching the one in the downloaded JSON): a URL is printed, opening it in a browser and approving access redirects back to the local server, and the terminal prints `✅ Saved functions/config/drivePreviewToken.json`.

- [ ] Run: `ls functions/config/drivePreviewToken.json`
Expected: file exists (this file is gitignored — do not commit it).

- [ ] **Commit**
```bash
git add authorizeDrivePreviews.cjs
git commit -m "feat: one-time interactive Drive OAuth authorization script"
```

---

## Task 3: Drive folder-mirroring upload helper

**Files:**
- Create: `lib/drivePreviewUpload.cjs`

**Interfaces:**
- Consumes: `OAuth2Client` from `lib/driveOAuth.cjs` (Task 2).
- Produces: `uploadPreview(driveClient, { shareRelativeDir, fileName, localFilePath, description }): Promise<string>` — returns the uploaded file's Drive file ID. Consumed by `scannerLocalPreview.cjs` (Task 5).

- [ ] **Step 1: Write the folder-mirroring + upload helper**

```javascript
// Mirrors a file's path (relative to the TRIBAL share root) into a
// "TK Archive Previews/..." folder tree in the target Drive, creating
// folders on demand, then uploads the preview file into the deepest one.
// Folder lookups are cached in-process so a batch run doesn't re-query
// Drive for the same folder path once per file in it.

const fs = require('fs');
const { google } = require('googleapis');

const ROOT_FOLDER_NAME = 'TK Archive Previews';
const folderIdCache = new Map(); // key: parentId + '/' + name

async function findOrCreateFolder(drive, parentId, name) {
  const cacheKey = `${parentId}/${name}`;
  if (folderIdCache.has(cacheKey)) return folderIdCache.get(cacheKey);

  const escapedName = name.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const list = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive' });

  let folderId;
  if (list.data.files.length > 0) {
    folderId = list.data.files[0].id;
  } else {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    folderId = created.data.id;
  }

  folderIdCache.set(cacheKey, folderId);
  return folderId;
}

async function ensureFolderPath(drive, segments) {
  let parentId = 'root';
  for (const segment of segments) {
    parentId = await findOrCreateFolder(drive, parentId, segment);
  }
  return parentId;
}

// shareRelativeDir: e.g. "THY/ACCOUNT/2026/TK_STOCK" (no leading/trailing slash)
async function uploadPreview(oAuth2Client, { shareRelativeDir, fileName, localFilePath, description }) {
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  const segments = [ROOT_FOLDER_NAME, ...shareRelativeDir.split('/').filter(Boolean)];
  const parentId = await ensureFolderPath(drive, segments);

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [parentId], description },
    media: { mimeType: 'video/mp4', body: fs.createReadStream(localFilePath) },
    fields: 'id',
  });

  return created.data.id;
}

module.exports = { uploadPreview };
```

- [ ] Run a smoke test against the real Drive account (requires Task 2 complete):

```bash
node -e "
const { getDriveClient } = require('./lib/driveOAuth.cjs');
const { uploadPreview } = require('./lib/drivePreviewUpload.cjs');
const fs = require('fs');
(async () => {
  fs.writeFileSync('/tmp/smoke-test.mp4', 'not a real video, just bytes for the smoke test');
  const client = await getDriveClient();
  const id = await uploadPreview(client, {
    shareRelativeDir: 'SMOKE_TEST',
    fileName: 'smoke-test.mp4',
    localFilePath: '/tmp/smoke-test.mp4',
    description: '/tmp/smoke-test.mp4',
  });
  console.log('Uploaded file ID:', id);
})().catch(e => { console.error(e); process.exit(1); });
"
```
Expected: prints an uploaded file ID with no error. Manually verify in the Drive account: a `TK Archive Previews/SMOKE_TEST/smoke-test.mp4` file exists.

- [ ] Delete the smoke-test file/folder from Drive by hand afterward (it's not part of the real archive).

- [ ] **Commit**
```bash
git add lib/drivePreviewUpload.cjs
git commit -m "feat: Drive folder-mirroring upload helper for preview files"
```

---

## Task 4: Preview generation + parallel worker pool

**Files:**
- Create: `lib/previewTranscode.cjs`

**Interfaces:**
- Produces:
  - `previewPathFor(originalPath: string): string` — deterministic sidecar path.
  - `generatePreviewIfNeeded(originalPath: string): Promise<string>` — returns the (possibly pre-existing) preview path, generating it via ffmpeg if missing.
  - `runWithConcurrency(items: any[], limit: number, worker: (item) => Promise<void>): Promise<void>` — generic bounded-parallelism runner, consumed by `scannerLocalPreview.cjs` (Task 5).

- [ ] **Step 1: Write the transcode + concurrency helper**

```javascript
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFilePromise = promisify(execFile);
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';

function previewPathFor(originalPath) {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);
  return path.join(dir, `${base}_preview.mp4`);
}

async function generatePreviewIfNeeded(originalPath) {
  const outPath = previewPathFor(originalPath);
  if (fs.existsSync(outPath)) return outPath;

  const args = [
    '-y',
    '-i', originalPath,
    '-vf', 'scale=-2:480',
    '-c:v', 'h264_videotoolbox',
    '-b:v', '1500k',
    '-c:a', 'aac',
    '-b:a', '96k',
    outPath,
  ];
  await execFilePromise(FFMPEG_BIN, args, { maxBuffer: 1024 * 1024 * 10 });
  return outPath;
}

// Runs `worker` over `items` with at most `limit` in flight at once.
async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, next);
  await Promise.all(workers);
}

module.exports = { previewPathFor, generatePreviewIfNeeded, runWithConcurrency };
```

- [ ] Run a smoke test with a tiny real video (creates a short synthetic clip with ffmpeg itself, so this doesn't depend on the SMB share being mounted):

```bash
mkdir -p /tmp/preview-smoke && \
/opt/homebrew/bin/ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=10 /tmp/preview-smoke/sample.mp4 && \
node -e "
const { generatePreviewIfNeeded, previewPathFor } = require('./lib/previewTranscode.cjs');
(async () => {
  const out = await generatePreviewIfNeeded('/tmp/preview-smoke/sample.mp4');
  console.log('Preview at:', out);
  console.log('Matches previewPathFor:', out === previewPathFor('/tmp/preview-smoke/sample.mp4'));
  const fs = require('fs');
  console.log('Exists on disk:', fs.existsSync(out));
})();
"
```
Expected: `Preview at: /tmp/preview-smoke/sample_preview.mp4`, `Matches previewPathFor: true`, `Exists on disk: true`.

- [ ] Run the concurrency helper smoke test:

```bash
node -e "
const { runWithConcurrency } = require('./lib/previewTranscode.cjs');
(async () => {
  const results = [];
  await runWithConcurrency([1,2,3,4,5], 2, async (n) => {
    results.push(n);
  });
  console.log('Processed all:', results.sort((a,b)=>a-b).join(',') === '1,2,3,4,5');
})();
"
```
Expected: `Processed all: true`.

- [ ] Clean up: `rm -rf /tmp/preview-smoke /tmp/smoke-test.mp4`

- [ ] **Commit**
```bash
git add lib/previewTranscode.cjs
git commit -m "feat: ffmpeg preview transcoding + bounded-concurrency worker pool"
```

---

## Task 5: Main scanner script

**Files:**
- Create: `scannerLocalPreview.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `roots.json` (Task 1), `getDriveClient` (Task 2), `uploadPreview` (Task 3), `generatePreviewIfNeeded`/`previewPathFor`/`runWithConcurrency` (Task 4), `extractAutoTags` (`lib/autoTags.cjs`), `isVideoFile`/`extractVideoFrames` (`lib/videoFrames.cjs`), `generateSearchTokens` (`lib/searchTokens.cjs`).
- Produces: Firestore documents in `files` matching the `DAMFile` shape used by `scanner.cjs`, plus a `preview_log.csv` file in the working directory.

- [ ] **Step 1: Write the main script**

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const { extractAutoTags } = require('./lib/autoTags.cjs');
const { isVideoFile, extractVideoFrames } = require('./lib/videoFrames.cjs');
const { generateSearchTokens } = require('./lib/searchTokens.cjs');
const { getDriveClient } = require('./lib/driveOAuth.cjs');
const { uploadPreview } = require('./lib/drivePreviewUpload.cjs');
const { generatePreviewIfNeeded, runWithConcurrency } = require('./lib/previewTranscode.cjs');

const SHARE_ROOT = '/Volumes/TRIBAL';
const CONCURRENCY = 3;
const LOG_PATH = path.join(__dirname, 'preview_log.csv');

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'functions/config/serviceAccountKey.json'), 'utf8')
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'tk-archive-cd9d0' });
const db = admin.firestore();

function loadRoots() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'roots.json'), 'utf8'));
  return config.roots;
}

function walkVideos(dirPath, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`\n⚠️  Cannot read directory ${dirPath}: ${err.message}`);
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkVideos(fullPath, acc);
    } else if (entry.isFile() && isVideoFile(fullPath) && !/_preview\.mp4$/i.test(entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function fileIdFor(fullPath) {
  return crypto.createHash('sha256').update(`local:${fullPath}`).digest('hex').slice(0, 32);
}

function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

function getMimeType(ext) {
  const map = { mp4: 'video/mp4', mov: 'video/quicktime' };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

const logRows = ['path,outcome,timestamp,error'];
function logResult(filePath, outcome, error = '') {
  const safePath = filePath.replace(/"/g, '""');
  const safeError = (error || '').replace(/"/g, '""').replace(/\n/g, ' ');
  logRows.push(`"${safePath}","${outcome}","${new Date().toISOString()}","${safeError}"`);
}

async function processFile(fullPath, driveClient, scanId) {
  const fileId = fileIdFor(fullPath);

  try {
    const existingSnap = await db.collection('files').doc(fileId).get();
    if (existingSnap.exists && existingSnap.data().driveFileId) {
      logResult(fullPath, 'skipped-already-done');
      return;
    }

    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase().slice(1);
    const shareRelativePath = path.relative(SHARE_ROOT, fullPath);
    const shareRelativeDir = path.dirname(shareRelativePath);

    const previewPath = await generatePreviewIfNeeded(fullPath);

    const [hash, frames] = await Promise.all([
      calculateHash(fullPath),
      extractVideoFrames(fullPath, fileId),
    ]);

    const previewFileName = path.basename(previewPath);
    const driveFileId = await uploadPreview(driveClient, {
      shareRelativeDir,
      fileName: previewFileName,
      localFilePath: previewPath,
      description: fullPath,
    });

    const autoTags = extractAutoTags(shareRelativePath.split(path.sep));

    const fileDoc = {
      fileId,
      name: path.basename(fullPath),
      path: fullPath,
      source: 'local',
      extension: ext,
      mimeType: getMimeType(ext),
      type: getMimeType(ext),
      size: stat.size,
      hash,
      tags: autoTags,
      searchTokens: generateSearchTokens(path.basename(fullPath), autoTags),
      videoPreviewFrames: frames || null,
      thumbnail: null,
      driveFileId,
      needs_tagging: !!frames,
      createdAt: stat.birthtime.getTime(),
      modifiedAt: stat.mtime.getTime(),
      uploadedAt: Date.now(),
      scanId,
      lastScanAt: Date.now(),
      copyright: { owner: 'TK', year: new Date().getFullYear() },
      license: { type: 'commercial', name: 'Commercial Use' },
      status: 'active',
      isDeleted: false,
    };

    // Preserve prior curation on re-runs, same rationale as scanner.cjs.
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      const PRESERVE_FIELDS = ['tags', 'needs_tagging', 'tagSource', 'taggedAt', 'description', 'descriptionSource', 'copyright', 'license', 'usage'];
      for (const field of PRESERVE_FIELDS) {
        if (existing[field] !== undefined) fileDoc[field] = existing[field];
      }
      fileDoc.searchTokens = generateSearchTokens(fileDoc.name, fileDoc.tags);
    }

    await db.collection('files').doc(fileId).set(fileDoc);
    logResult(fullPath, 'processed');
    process.stdout.write('.');
  } catch (err) {
    logResult(fullPath, 'failed', err.message);
    process.stderr.write('x');
  }
}

async function run() {
  const roots = loadRoots();
  const driveClient = await getDriveClient();

  const scanRef = db.collection('scans').doc();
  const scanId = scanRef.id;
  await scanRef.set({
    scanId,
    source: 'local',
    archivePath: roots.join(', '),
    status: 'running',
    startedAt: admin.firestore.Timestamp.now(),
    userId: 'scanner-local-preview-cli',
    triggerType: 'manual',
    errors: [],
  });

  let allFiles = [];
  for (const root of roots) {
    console.log(`\n📂 Scanning: ${root}`);
    allFiles = allFiles.concat(walkVideos(root));
  }
  console.log(`\n📁 Found ${allFiles.length} video files across ${roots.length} roots\n`);

  await runWithConcurrency(allFiles, CONCURRENCY, (f) => processFile(f, driveClient, scanId));

  fs.writeFileSync(LOG_PATH, logRows.join('\n'));
  console.log(`\n\n📝 Log written to ${LOG_PATH}`);

  await scanRef.update({
    status: 'completed',
    completedAt: admin.firestore.Timestamp.now(),
    results: { totalFiles: allFiles.length },
  });

  console.log(`✨ Done. ${allFiles.length} files considered.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Scan failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Modify `package.json`, in `"scripts"`:
```json
    "scan:local-preview": "node scannerLocalPreview.cjs",
```

- [ ] Run: `node -e "require('./scannerLocalPreview.cjs')" 2>&1 | head -5`
Expected: the script starts running (it has no module guard, so requiring it executes `run()`) — confirms no syntax errors. Interrupt with Ctrl+C once you see `📂 Scanning:` lines, this is just a syntax/wiring smoke check, not a full run.

- [ ] **Step 3: End-to-end smoke test against a small local fixture (not the real SMB share)**

```bash
mkdir -p /tmp/local-preview-e2e/2099/SmokeTestFolder && \
/opt/homebrew/bin/ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=10 /tmp/local-preview-e2e/2099/SmokeTestFolder/clip.mp4 && \
mkdir -p /Volumes/TRIBAL/_e2e_smoke_test_do_not_keep && \
cp -r /tmp/local-preview-e2e/2099 /Volumes/TRIBAL/_e2e_smoke_test_do_not_keep/ && \
cat > /tmp/roots-e2e.json <<'EOF'
{ "roots": ["/Volumes/TRIBAL/_e2e_smoke_test_do_not_keep"] }
EOF
cp roots.json /tmp/roots.json.bak && cp /tmp/roots-e2e.json roots.json && \
node scannerLocalPreview.cjs; \
cp /tmp/roots.json.bak roots.json
```
Expected:
- Console shows `Found 1 video files`, one `.` printed, `Done. 1 files considered.`
- `/Volumes/TRIBAL/_e2e_smoke_test_do_not_keep/2099/SmokeTestFolder/clip_preview.mp4` exists on disk
- `preview_log.csv` has one `processed` row for `clip.mp4`
- In the Google Drive account: `TK Archive Previews/_e2e_smoke_test_do_not_keep/2099/SmokeTestFolder/clip_preview.mp4` exists
- In Firestore (Firebase Console > `files` collection): a document exists with `name: "clip.mp4"`, `source: "local"`, `driveFileId` set to a non-empty string

- [ ] **Step 4: Re-run to verify idempotency**

```bash
cp roots.json /tmp/roots.json.bak2 && cp /tmp/roots-e2e.json roots.json && \
node scannerLocalPreview.cjs; \
cp /tmp/roots.json.bak2 roots.json
```
Expected: `preview_log.csv` now shows `skipped-already-done` for `clip.mp4` — no second ffmpeg run, no second Drive upload (verify no duplicate `clip_preview.mp4` was created in the Drive folder).

- [ ] **Step 5: Clean up smoke-test artifacts**

```bash
rm -rf /Volumes/TRIBAL/_e2e_smoke_test_do_not_keep /tmp/local-preview-e2e /tmp/roots-e2e.json /tmp/roots.json.bak /tmp/roots.json.bak2
```
Also manually delete the `TK Archive Previews/_e2e_smoke_test_do_not_keep` folder from the Drive account, and delete the smoke-test Firestore document (Firebase Console, `files` collection, the doc with `name: "clip.mp4"`).

- [ ] **Commit**
```bash
git add scannerLocalPreview.cjs package.json
git commit -m "feat: main local-preview scanner script wiring transcode, Drive upload, and Firestore write"
```

---

## Task 6: Playback support for Drive-hosted previews of local files

**Files:**
- Modify: `src/services/streamingService.ts:18-28`

**Interfaces:**
- Consumes: `DAMFile.driveFileId` (already exists on the type — see `src/types/dam.ts:21`).
- No signature change to `getStreamUrl` — same input/output shape, only its internal branching changes.

- [ ] **Step 1: Generalize `getStreamUrl`**

Modify `src/services/streamingService.ts`:

```typescript
export function getStreamUrl(file: DAMFile): string | null {
  if (!canStream(file)) return null;

  // Any file with a driveFileId streams from Drive's embed viewer — this
  // covers both true Drive-sourced files (source: 'drive') and local files
  // whose small preview was uploaded to Drive by scannerLocalPreview.cjs
  // (source: 'local', driveFileId set to the preview's Drive file ID).
  if (file.driveFileId) {
    return `https://drive.google.com/file/d/${file.driveFileId}/preview`;
  }

  if (!file.extension) return null;
  return `https://storage.googleapis.com/${VIDEO_BUCKET}/${file.fileId}.${file.extension.toLowerCase()}`;
}
```

- [ ] Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 2: Manual verification in the running app**

```bash
npm run dev
```
Open the app, search for the smoke-test file if it's still present (or wait until Task 5's real archive run has written at least one file), select it in the gallery, and confirm the video preview panel loads the Drive embed (not a broken player) — the embedded player should look identical to how existing Drive-sourced videos already render, since it's the same iframe URL pattern.

- [ ] **Commit**
```bash
git add src/services/streamingService.ts
git commit -m "feat: stream local files with Drive-hosted previews from Drive's embed viewer"
```

---

## Task 7: Setup documentation

**Files:**
- Create: `LOCAL_PREVIEW_SCANNER_SETUP.md`

- [ ] **Step 1: Write the setup doc**

```markdown
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
```

- [ ] **Commit**
```bash
git add LOCAL_PREVIEW_SCANNER_SETUP.md
git commit -m "docs: setup and usage guide for the local preview scanner"
```

---

## Task 8: First real batch run

This is an operational task, not a code change — no commit at the end.

- [ ] **Step 1:** Confirm `/Volumes/TRIBAL` is mounted and all 5 roots in `roots.json` are reachable (reuse the check from Task 1, Step 2).

- [ ] **Step 2:** Start the batch run in the background, since this will take an estimated 2.5–3 days of continuous runtime:

```bash
nohup npm run scan:local-preview > scan_local_preview.log 2>&1 &
```

- [ ] **Step 3:** Periodically check progress:

```bash
tail -50 scan_local_preview.log
wc -l preview_log.csv
```

- [ ] **Step 4:** After completion, review `preview_log.csv` for any `failed` rows and investigate them individually (corrupt file, permissions, network drop — the log's error column has the reason).

- [ ] **Step 5:** Spot-check the result in the running app (`tribal-tk-archive.web.app`): search for a handful of filenames from the scanned folders, confirm they appear, confirm their previews play, confirm folder-derived tags look reasonable.

---

## Execution Status

Ready to start Task 1. Using superpowers:subagent-driven-development for implementation.
