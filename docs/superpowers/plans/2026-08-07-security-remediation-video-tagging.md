# TK Archive DAM - Security Remediation & Video Preview Auto-Tagging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical security vulnerabilities in production, redesign local file serving architecture, and add intelligent video preview with automatic tag generation using Google Cloud Vision.

**Architecture:** 
- **Security Phase:** Rotate exposed credentials, restore Firestore rules, remove auth bypasses, secure download endpoint
- **Architecture Phase:** Replace Cloud Function-based local file serving with path links (like Google Drive), fix React hook violations, implement breadcrumb handler
- **Feature Phase:** Extract 10 frames from videos at strategic points (10%, 30%, 50%, 70%, 90% - avoiding intro/outro black), analyze frames with Google Cloud Vision API for automatic object/scene detection, generate tags, store preview frames + tags in Firestore

**Tech Stack:** 
- Google Cloud Vision API ($3.31 for 5,520 images, one-time)
- Firebase Cloud Functions (secured)
- React + Vite (TypeScript)
- Firestore (properly authenticated)

## Global Constraints

- Production is LIVE with known vulnerabilities (S1-S5) — security fixes are incident response, not normal development
- Code is already on `main` branch and deployed to tk-archive-dam.web.app
- Local file access is from scanner machine only, not Cloud Functions (architectural constraint)
- Video preview frames: 10 frames per video, extracted at %10, %30, %50, %70, %90 timestamps to avoid black intro/outro
- All new components must be Turkish-language (existing UI is Turkish)
- No new dependencies beyond Google Cloud libraries (Vision API client)
- Tests must pass: `npm run build` (0 errors), `npm run preview` (no console errors)

---

## PHASE 1: CRITICAL SECURITY FIXES

### Task 1: Rotate Exposed Service Account Key (INCIDENT RESPONSE)

**Files:**
- `functions/config/serviceAccountKey.json` — DELETE from repo
- `.gitignore` — ADD `functions/config/`
- `.firebase/rc` — UPDATE project reference

**Interfaces:**
- Consumes: Nothing (GCP project access required)
- Produces: Rotated service account with new key, repo cleaned of leaked key

**⚠️ DO FIRST - MANUAL ACTION REQUIRED:**
1. Go to Google Cloud Console: https://console.cloud.google.com
2. Select project: `tk-archive-dam`
3. Navigate: IAM & Admin → Service Accounts → `firebase-adminsdk-fbsvc@tk-archive-dam.iam.gserviceaccount.com`
4. Keys tab → Delete existing key (the one in `serviceAccountKey.json`)
5. Create new key → Download JSON
6. Save new key to: `functions/config/serviceAccountKey.json` (TEMPORARY, will delete)
7. Run `firebase deploy --only functions` to verify new key works

**Code Steps:**

- [ ] **Step 1: Add functions/config to .gitignore**

Edit `.gitignore`:
```
# Sensitive configuration
functions/config/
functions/.env*
.env*
```

- [ ] **Step 2: Remove leaked key from git history**

```bash
# Remove from current working tree
rm functions/config/serviceAccountKey.json

# Purge from git history (destructive - do once)
git filter-branch --tree-filter 'rm -f functions/config/serviceAccountKey.json' HEAD

# Force push to main (with caution)
git push origin main --force
```

- [ ] **Step 3: Verify deployment works with new key**

```bash
firebase deploy --only functions
# Expected: "✔ functions[download, startScan, getScanStatus, scanResults, startScanScheduled] deployed successfully"
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "security(incident): purge leaked key, add functions/config to .gitignore"
```

---

### Task 2: Restore Firestore Security Rules

**Files:**
- `firestore.rules` — RESTORE authenticated access

**Interfaces:**
- Consumes: Nothing
- Produces: Firestore rules requiring authentication for read/write

**Security Impact:** Current rules allow `write: if true` on entire catalog. Must restore to authenticated-only access.

**Code Steps:**

- [ ] **Step 1: Review current rules**

Read `firestore.rules` and identify sections with `allow read, write: if true`

- [ ] **Step 2: Restore proper authentication rules**

Replace problematic rules in `firestore.rules`:

```javascript
// BEFORE (UNSAFE):
match /files/{fileId} {
  allow read, write: if true;
}

// AFTER (SAFE):
match /files/{fileId} {
  allow read: if isAuthenticated() && isAllowedDomain();
  allow write: if false; // Only backend (scanner) writes
}

match /changes/{changeId} {
  allow read: if isAuthenticated() && isAllowedDomain();
  allow write: if false;
}

match /tags/{tagId} {
  allow read: if isAuthenticated() && isAllowedDomain();
  allow write: if false;
}

// Helper functions
function isAuthenticated() {
  return request.auth != null;
}

function isAllowedDomain() {
  return isAuthenticated() && 
    request.auth.token.email != null &&
    (request.auth.token.email.endsWith('@tribalistanbul.com') || 
     request.auth.token.email.endsWith('@example.com')); // adjust domain
}
```

- [ ] **Step 3: Deploy updated rules**

```bash
firebase deploy --only firestore:rules
# Expected: "✔ firestore rules uploaded successfully"
```

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "security: restore authenticated-only firestore rules, fix world-writable catalog"
```

---

### Task 3: Remove Client-Side Auth Bypass (testMode URL param)

**Files:**
- `src/auth/AuthProvider.jsx` — REMOVE testMode logic

**Interfaces:**
- Consumes: Auth context
- Produces: Auth that requires real Firebase credentials

**Security Impact:** `?testMode=true` currently grants admin session to anyone. Remove completely.

**Code Steps:**

- [ ] **Step 1: Locate testMode bypass**

Find and review the testMode check in `src/auth/AuthProvider.jsx`:
```jsx
const params = new URLSearchParams(window.location.search)
if (params.get('testMode') === 'true') {
  setUser({ uid: 'test-user', email: 'test@tribalistanbul.com' })
  // ...
  return
}
```

- [ ] **Step 2: Remove testMode bypass**

Delete the entire testMode block:

```jsx
// REMOVE THIS ENTIRE BLOCK:
// const params = new URLSearchParams(window.location.search)
// if (params.get('testMode') === 'true') { ... }

// Keep normal Firebase auth flow
const unsubscribe = auth.onAuthStateChanged(async (user) => {
  // ... normal auth handling
})
```

- [ ] **Step 3: Verify build**

```bash
npm run build
# Expected: 0 TypeScript errors
```

- [ ] **Step 4: Commit**

```bash
git add src/auth/AuthProvider.jsx
git commit -m "security: remove client-side testMode bypass"
```

---

### Task 4: Remove Server-Side Auth Bypass in Cloud Functions

**Files:**
- `functions/startScan.js` — REMOVE testMode fallback
- `functions/getScanStatus.js` — REMOVE testMode fallback

**Interfaces:**
- Consumes: Cloud Functions context
- Produces: Functions requiring authenticated user

**Security Impact:** `data.testMode` in request body bypasses auth guard in both functions. Remove.

**Code Steps:**

- [ ] **Step 1: Fix startScan.js**

Find and replace:
```javascript
// BEFORE (UNSAFE):
const userId = context?.auth?.uid || (data?.testMode ? 'test-user' : null);
if (!userId) { throw new HttpsError('unauthenticated', 'Must be authenticated'); }

// AFTER (SAFE):
if (!context.auth) {
  throw new HttpsError('unauthenticated', 'Must be authenticated');
}
const userId = context.auth.uid;
```

- [ ] **Step 2: Fix getScanStatus.js**

Same change:
```javascript
// BEFORE (UNSAFE):
const userId = context?.auth?.uid || (data?.testMode ? 'test-user' : null);

// AFTER (SAFE):
if (!context.auth) {
  throw new HttpsError('unauthenticated', 'Must be authenticated');
}
const userId = context.auth.uid;
```

- [ ] **Step 3: Remove testMode from client calls**

Find `src/components/dam/DAMDashboard.jsx` or wherever `startScan` is called:
```javascript
// REMOVE testMode from function calls:
// await startScan({ archiveRoot, testMode: true }) // ← REMOVE testMode
await startScan({ archiveRoot }); // ← Correct
```

- [ ] **Step 4: Deploy and verify**

```bash
firebase deploy --only functions
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add functions/startScan.js functions/getScanStatus.js src/components/dam/DAMDashboard.jsx
git commit -m "security: remove server-side testMode auth bypass from callables"
```

---

### Task 5: Secure Download Endpoint

**Files:**
- `functions/download.js` — ADD authentication, FIX path validation

**Interfaces:**
- Consumes: Authenticated Firebase user, file path
- Produces: Secure file stream with validated path

**Security Issues Fixed:**
- S5a: No authentication → now requires Firebase ID token
- S5b: Prefix matching allows `/Volumes-evil` → now uses `fs.realpathSync()` for symlink resolution
- S5c: Missing path-boundary check → now validates path is under allowed base

**Code Steps:**

- [ ] **Step 1: Add authentication to download function**

Replace function signature in `functions/download.js`:

```javascript
// BEFORE (UNSAFE - no auth):
exports.download = functions.https.onRequest((req, res) => {

// AFTER (SAFE - requires auth):
exports.download = functions.https.onRequest(async (req, res) => {
  // Verify Firebase ID token
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(403).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.split(' ')[1];
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  // User authenticated, continue with download
  // ... rest of function
});
```

- [ ] **Step 2: Fix path validation with symlink resolution**

Replace the `validatePath` function:

```javascript
// BEFORE (UNSAFE - prefix match + no symlink check):
function validatePath(filePath) {
  const normalized = path.normalize(filePath);
  return ALLOWED_PATHS.some(basePath => normalized.startsWith(basePath));
}

// AFTER (SAFE - real path + boundary check):
function validatePath(filePath) {
  try {
    const realPath = fs.realpathSync(filePath); // Resolves symlinks
    
    return ALLOWED_PATHS.some(basePath => {
      const realBase = fs.realpathSync(basePath);
      // Check if realPath is exactly under basePath (not just prefix match)
      return realPath === realBase || 
             realPath.startsWith(realBase + path.sep);
    });
  } catch (err) {
    // File doesn't exist or symlink broken
    return false;
  }
}
```

- [ ] **Step 3: Narrow the /Volumes allowlist**

In `ALLOWED_PATHS`, replace `/Volumes` with specific mounted paths:

```javascript
// BEFORE (TOO BROAD):
const ALLOWED_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes'
];

// AFTER (SPECIFIC):
const ALLOWED_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes/ArchiveStorage'  // Only this specific volume
];
```

- [ ] **Step 4: Update client to send auth header**

In `src/services/pathResolver.ts`, update download URL to include token:

```typescript
// Will need to fetch token from Firebase and add to request header
// This is handled by the FileDownload component in next task
```

- [ ] **Step 5: Deploy and test**

```bash
firebase deploy --only functions:download
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add functions/download.js src/services/pathResolver.ts
git commit -m "security: secure download endpoint with auth, fix symlink traversal, narrow volume allowlist"
```

---

## PHASE 2: ARCHITECTURAL FIXES

### Task 6: Redesign Local File Serving (Path Links Only)

**Files:**
- `src/services/pathResolver.ts` — UPDATE (local files return path, not API URL)
- `src/components/dam/FileDownload.jsx` — REDESIGN (show path for local, link for Drive)
- `functions/download.js` — KEEP (for future use, but not called for local files)
- `functions/download.js` — Can DELETE `/api` rewrite from firebase.json since no streaming needed

**Interfaces:**
- Consumes: `DAMFile` with path and source
- Produces: User-friendly path display + copy button for local files

**Architecture Decision:** Local files are in a folder on the scanner machine. Instead of Cloud Functions streaming (impossible - no filesystem access), just show the path. User can:
- Copy path → open in Finder/Terminal
- Click "Open in Finder" → direct folder navigation

**Code Steps:**

- [ ] **Step 1: Update pathResolver for local files**

Edit `src/services/pathResolver.ts`:

```typescript
export function resolvePath(file: DAMFile): string | null {
  if (file.source === 'drive') {
    return `https://drive.google.com/file/d/${file.driveFileId}/view`;
  }

  if (file.source === 'local') {
    // Return raw path (no API call)
    if (!validatePath(file.path)) {
      return null;
    }
    return file.path; // Just the path
  }

  return null;
}

// Remove getDownloadUrl - no longer needed for local
// Keep validatePath and getParentDirectory for breadcrumbs
```

- [ ] **Step 2: Redesign FileDownload component**

Edit `src/components/dam/FileDownload.jsx` to show path instead of download:

```jsx
import { useState } from 'react';
import { resolvePath } from '../../services/pathResolver';

export default function FileDownload({ file }) {
  const [copied, setCopied] = useState(false);

  const handleCopyPath = () => {
    if (file.source === 'local') {
      navigator.clipboard.writeText(file.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenInFinder = () => {
    if (file.source === 'local') {
      // This opens the folder in Finder (macOS) or Explorer (Windows)
      // Or user can use the copied path
      alert('Yolu kopyalayıp Finder/Explorer\'da aç.\nPath copied, open in Finder/Explorer.');
    }
  };

  if (file.source === 'drive') {
    return (
      <a
        href={`https://drive.google.com/file/d/${file.driveFileId}/view`}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
      >
        <span>☁️</span> Google Drive'da Aç
      </a>
    );
  }

  // Local file - show path
  return (
    <div className="space-y-3">
      <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-lg">
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Dosya Konumu:</p>
        <p className="text-sm font-mono text-slate-900 dark:text-slate-100 break-all">
          {file.path}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleCopyPath}
          className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
        >
          <span>📋</span> {copied ? 'Kopyalandı!' : 'Yolu Kopyala'}
        </button>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">
        💡 Dosyayı açmak için yolu kopyalayıp Finder/Explorer'da kullanın.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Remove /api rewrite from firebase.json**

Edit `firebase.json`:

```json
// REMOVE this section:
// {
//   "source": "/api/**",
//   "function": "api"
// }

// If /api rewrite is gone, the file should still deploy
```

- [ ] **Step 4: Test and verify**

```bash
npm run build
npm run preview
# Navigate to a local file → should show path display instead of download button
# Navigate to Google Drive file → should show "Open in Google Drive"
```

- [ ] **Step 5: Commit**

```bash
git add src/services/pathResolver.ts src/components/dam/FileDownload.jsx firebase.json
git commit -m "architecture: redesign local file serving as path display, keep Drive links"
```

---

### Task 7: Fix FolderBrowser Hook Violation (React Rules of Hooks)

**Files:**
- `src/components/dam/FolderBrowser.jsx` — MOVE useMemo above early return

**Interfaces:**
- Consumes: DAMFile with path
- Produces: Breadcrumb component (works correctly without crashes)

**Bug:** Component has early return before useMemo, causing hook count to change when file source changes (Drive → Local). Mounted component crashes with "more hooks than during previous render".

**Code Steps:**

- [ ] **Step 1: Review current code**

Current FolderBrowser.jsx has:
```jsx
export default function FolderBrowser({ file, onNavigate }) {
  if (file?.source !== 'local') return null;  // ← EARLY RETURN
  
  const filePath = file?.path || '';
  const breadcrumbs = useMemo(() => { ... }, [filePath]); // ← HOOK AFTER RETURN
```

- [ ] **Step 2: Move useMemo above early return**

```jsx
export default function FolderBrowser({ file, onNavigate }) {
  const filePath = file?.path || '';
  const breadcrumbs = useMemo(() => {
    if (file?.source !== 'local') return [];
    
    const parts = filePath.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      path: '/' + parts.slice(0, index + 1).join('/')
    }));
  }, [filePath, file?.source]); // Update dependencies

  // Now early return is safe - comes after all hooks
  if (file?.source !== 'local') return null;

  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-1 flex-wrap">
      {/* breadcrumbs render */}
    </div>
  );
}
```

- [ ] **Step 3: Test**

```bash
npm run build
npm run preview
# Navigate: File Detail → Local file → Google Drive file → Local file
# Expected: No crash, breadcrumb appears/disappears correctly
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dam/FolderBrowser.jsx
git commit -m "fix: move useMemo above early return to fix react hooks violation"
```

---

### Task 8: Implement Breadcrumb Navigation Handler

**Files:**
- `src/components/dam/FileDetail.jsx` — ADD handleFolderNavigate implementation

**Interfaces:**
- Consumes: Clicked folder path
- Produces: FileGallery filtered/searched for files in that folder

**Current State:** Breadcrumb component passes `onNavigate` callback but FileDetail has empty `console.log` implementation. Implement actual navigation.

**Code Steps:**

- [ ] **Step 1: Remove console.log stub**

In FileDetail.jsx, find and remove:
```javascript
console.log('Navigate to folder:', path)
```

- [ ] **Step 2: Implement handleFolderNavigate**

```typescript
const handleFolderNavigate = async (folderPath: string) => {
  try {
    setLoading(true);
    // Search for files with path starting with folderPath
    const result = await damService.searchFiles({
      sources: ['local'],
      query: folderPath,
      limit: 100,
    });
    
    // Filter to files in this folder and subfolders
    const filesInFolder = result.files.filter(f => 
      f.path.startsWith(folderPath + '/')
    );
    
    // Update gallery to show filtered files
    setFiles(filesInFolder);
  } catch (err) {
    console.error('Navigation failed:', err);
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 3: Wire breadcrumb to handler**

```jsx
<FolderBrowser file={selectedFile} onNavigate={handleFolderNavigate} />
```

- [ ] **Step 4: Test**

```bash
npm run preview
# Local file → click breadcrumb folder → gallery filters to that folder
```

- [ ] **Step 5: Commit**

```bash
git add src/components/dam/FileDetail.jsx
git commit -m "feat: implement breadcrumb folder navigation"
```

---

## PHASE 3: NEW FEATURE - 10-FRAME VIDEO PREVIEW + AUTO TAGGING

### Task 9: Extract 10 Strategic Frames from Videos

**Files:**
- `scanner.cjs` — UPDATE video detection + frame extraction

**Interfaces:**
- Consumes: Video file path
- Produces: 10 JPEG frame files (timestamps: %10, %30, %50, %70, %90)

**Dependencies:** FFmpeg (must be installed: `brew install ffmpeg` on macOS, `apt-get install ffmpeg` on Linux)

**Code Steps:**

- [ ] **Step 1: Add FFmpeg frame extraction to scanner**

In `scanner.cjs`, add function:

```javascript
async function extractVideoFrames(videoPath, scanId) {
  if (!isVideoFile(videoPath)) return null;

  try {
    // Get video duration
    const duration = await getVideoDuration(videoPath);
    
    // Calculate frame timestamps (10%, 30%, 50%, 70%, 90%)
    const timestamps = [
      duration * 0.10,
      duration * 0.30,
      duration * 0.50,
      duration * 0.70,
      duration * 0.90
    ];

    const frames = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const frameFile = `/tmp/frame-${scanId}-${i}.jpg`;
      
      // Use FFmpeg to extract frame
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -i "${videoPath}" -ss ${timestamp} -vframes 1 -q:v 2 "${frameFile}" -y`,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Read frame file as base64
      const frameData = fs.readFileSync(frameFile, 'base64');
      frames.push({
        timestamp: Math.round(timestamp),
        frameData: frameData,
        frameNumber: i + 1
      });

      // Clean up temp file
      fs.unlinkSync(frameFile);
    }

    return frames;
  } catch (err) {
    console.error(`Frame extraction failed for ${videoPath}:`, err);
    return null;
  }
}

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1:noquotes=1 "${videoPath}"`,
      (err, stdout) => {
        if (err) reject(err);
        else resolve(parseFloat(stdout));
      }
    );
  });
}

function isVideoFile(path) {
  const ext = path.split('.').pop().toLowerCase();
  return ['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext);
}
```

- [ ] **Step 2: Call frame extraction in main scan loop**

In the file processing loop:

```javascript
const fileDoc = {
  // ... existing fields
  videoPreviewFrames: isVideoFile(filePath) ? await extractVideoFrames(filePath, scanId) : null,
  // ... rest of fields
};
```

- [ ] **Step 3: Test frame extraction**

```bash
# Rescan a folder with videos
npm run scan

# Verify frames were extracted (check Firestore documents)
# Each video should have videoPreviewFrames array with 5 frame objects
```

- [ ] **Step 4: Commit**

```bash
git add scanner.cjs
git commit -m "feat: extract 10 strategic frames from video files during scan"
```

---

### Task 10: Add YOLO Local Tagging with Incremental Updates

**Files:**
- `src/services/yoloService.ts` — CREATE YOLO tagging service
- `functions/tagNewFiles.js` — CREATE Cloud Function (incremental trigger)
- `src/components/dam/VideoPreviewGallery.jsx` — ADD "Auto-Tag" button
- `src/types/dam.ts` — ADD `needs_tagging` field to DAMFile
- `.gitignore` — ADD yolo model cache

**Interfaces:**
- Consumes: Frame base64 data (videos) + image files (from Firestore), file ID
- Produces: Tag array from local YOLO model, updates Firestore tags + sets needs_tagging: false

**Cost:** $0 (local YOLO, all files including video frames + images)

**Architecture:** 
- Initial (1 time): Tag all 8000 files (4000 video + 4000 image) via batch script
- Ongoing: Incremental only - when new files added (10 video + 50 image), only tag needs_tagging: true files
- Scanner marks files with needs_tagging: true by default
- User clicks "Auto-Tag New Files" OR scheduled daily job processes incremental batch

**Setup Steps:**

- [ ] **Step 1: Add YOLO to package.json**

```bash
npm install --save yolov8
# or use ultralytics: pip install ultralytics (if using Python subprocess)
```

- [ ] **Step 2: Create YOLO tagging service**

Create `src/services/yoloService.ts`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const vision = require('@google-cloud/vision');

const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: './config/vision-service-account.json'
});

const db = admin.firestore();

exports.tagVideo = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { fileId } = data;
  if (!fileId) {
    throw new functions.https.HttpsError('invalid-argument', 'fileId required');
  }

  try {
    // Get file from Firestore
    const fileDoc = await db.collection('files').doc(fileId).get();
    if (!fileDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'File not found');
    }

    const file = fileDoc.data();
    if (!file.videoPreviewFrames || file.videoPreviewFrames.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'No preview frames to tag');
    }

    // Run Vision API on frames
    const allTags = new Set();

    for (const frame of file.videoPreviewFrames) {
      const request = {
        image: {
          content: frame.frameData // base64
        }
      };

      const [result] = await visionClient.labelDetection(request);
      const labels = result.labelAnnotations || [];

      labels.forEach(label => {
        if (label.score > 0.5) {
          const tag = label.description.toLowerCase().replace(/\s+/g, '-');
          allTags.add(tag);
        }
      });
    }

    // Update Firestore with new tags
    const newTags = Array.from(allTags);
    const existingTags = file.tags || [];
    
    // Merge tags (don't duplicate)
    const allUniqueTags = Array.from(new Set([...existingTags, ...newTags]));

    await db.collection('files').doc(fileId).update({
      tags: allUniqueTags,
      autoGeneratedTags: true,
      tagSource: 'google-vision',
      tagGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      tagGeneratedBy: context.auth.uid
    });

    return {
      success: true,
      message: `Tagged with ${newTags.length} new tags`,
      tags: newTags
    };
  } catch (err) {
    console.error('Tagging failed:', err);
    throw new functions.https.HttpsError('internal', err.message);
  }
});
```

- [ ] **Step 4: Add tagging to component**

In `src/components/dam/VideoPreviewGallery.jsx`, add button:

```jsx
const [tagging, setTagging] = useState(false);

const handleRetagVideo = async () => {
  try {
    setTagging(true);
    const tagVideo = firebase.functions().httpsCallable('tagVideo');
    const result = await tagVideo({ fileId: file.fileId });
    console.log('Tagging result:', result);
    // Refresh file to show new tags
    // Trigger parent component refresh
  } catch (err) {
    console.error('Tagging failed:', err);
  } finally {
    setTagging(false);
  }
};

// Add button in JSX:
{file.videoPreviewFrames && (
  <button
    onClick={handleRetagVideo}
    disabled={tagging}
    className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
  >
    {tagging ? 'Tag'leme yapılıyor...' : '✨ Otomatik Tag'le'}
  </button>
)}
```

- [ ] **Step 5: Deploy function**

```bash
firebase deploy --only functions:tagVideo
```

- [ ] **Step 6: Test manual tagging**

```bash
# Open video in preview
# Click "Otomatik Tag'le" button
# Check Firestore: tags should be updated with Vision API results
```

- [ ] **Step 7: Commit**

```bash
git add functions/tagVideo.js src/components/dam/VideoPreviewGallery.jsx functions/package.json .env.example
git commit -m "feat: add manual google cloud vision tagging via cloud function"
```

---

### Task 11: Display Video Frames + Tags in FileDetail

**Files:**
- `src/components/dam/FileDetail.jsx` — ADD frame gallery + tags display
- `src/components/dam/VideoPreviewGallery.jsx` — CREATE new component

**Interfaces:**
- Consumes: `videoPreviewFrames` array, `autoGeneratedTags` boolean
- Produces: Visual gallery of 10 frames with timestamps + tag chips

**Code Steps:**

- [ ] **Step 1: Create VideoPreviewGallery component**

Create `src/components/dam/VideoPreviewGallery.jsx`:

```jsx
export default function VideoPreviewGallery({ file }) {
  if (!file?.videoPreviewFrames || file.videoPreviewFrames.length === 0) {
    return null;
  }

  const formatTimestamp = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
        🎬 Video Sekansları
      </h3>

      {/* Frames grid */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {file.videoPreviewFrames.map((frame) => (
          <div key={frame.frameNumber} className="relative group">
            <img
              src={`data:image/jpeg;base64,${frame.frameData}`}
              alt={`Frame ${formatTimestamp(frame.timestamp)}`}
              className="w-full aspect-video object-cover rounded border border-slate-200 dark:border-slate-700"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1 rounded-b text-center">
              {formatTimestamp(frame.timestamp)}
            </div>
          </div>
        ))}
      </div>

      {/* Auto-generated tags */}
      {file.autoGeneratedTags && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 rounded">
          <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
            ✨ Otomatik Etiketler (Google Vision)
          </p>
          <div className="flex flex-wrap gap-2">
            {file.tags?.filter(t => t.includes('-')).map((tag) => (
              <span
                key={tag}
                className="inline-block bg-blue-100 dark:bg-blue-800 text-blue-900 dark:text-blue-100 px-2 py-1 rounded text-xs"
              >
                #{tag.replace('-', ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add component to FileDetail**

In `src/components/dam/FileDetail.jsx`:

```jsx
import VideoPreviewGallery from './VideoPreviewGallery';

// In render (after VideoPreview, before metadata):
<VideoPreviewGallery file={selectedFile} />
```

- [ ] **Step 3: Test**

```bash
npm run preview
# Select a video file → should display 5 frame gallery + tags
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dam/FileDetail.jsx src/components/dam/VideoPreviewGallery.jsx
git commit -m "feat: display video preview frames and auto-generated tags in file detail"
```

---

## PHASE 4: CODE QUALITY & FINALIZATION

### Task 12: TypeScript Configuration + Code Quality

**Files:**
- `tsconfig.json` — CREATE
- `src/components/dam/FileDetail.jsx` — REMOVE console.log

**Code Steps:**

- [ ] **Step 1: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,

    /* Strict checking */
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2: Add TypeScript to package.json**

```bash
npm install --save-dev typescript
```

- [ ] **Step 3: Add typecheck script**

In `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "npm run typecheck && vite build",
    ...
  }
}
```

- [ ] **Step 4: Run typecheck and fix errors**

```bash
npm run typecheck
# Fix any type errors reported
```

- [ ] **Step 5: Remove leftover console.log**

In FileDetail.jsx, find and remove any `console.log` statements.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json package.json src/
git commit -m "chore: add typescript configuration and type checking"
```

---

### Task 13: Final Verification & Deployment

**Files:**
- All files (integrated)

**Final Checklist:**

- [ ] **Step 1: Run full test suite**

```bash
npm run build
# Expected: 0 TypeScript errors, build succeeds

npm run preview
# Expected: No console errors
# Test: local file shows path, Drive file shows link, video frames display, tags show
```

- [ ] **Step 2: Run scanner to verify vision tagging**

```bash
npm run scan

# Verify in Firestore:
# - videoPreviewFrames array present for video files
# - autoGeneratedTags = true
# - tags array contains auto-generated labels
```

- [ ] **Step 3: Verify Firestore rules are locked down**

Test unauthenticated access:
```bash
curl -X GET "https://firestore.googleapis.com/v1/projects/tk-archive-dam/databases/(default)/documents/files" \
  -H "Content-Type: application/json"
# Expected: 403 Forbidden
```

- [ ] **Step 4: Deploy to production**

```bash
firebase deploy
# Expected: Hosting ✔, Functions ✔, Rules ✔
```

- [ ] **Step 5: Smoke test production**

Visit https://tk-archive-dam.web.app:
- Login with valid credentials
- Browse files
- Local file → see path display
- Video file → see 10 frame gallery + tags
- Google Drive file → see embed + Drive link

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete security remediation, architecture redesign, and video preview auto-tagging

SECURITY FIXES:
- Rotate and purge exposed service account key
- Restore authenticated-only Firestore rules
- Remove 4 auth bypasses (URL param, request body, client-side)
- Secure download endpoint with auth + symlink resolution

ARCHITECTURE:
- Redesign local file serving as path display (not Cloud Functions)
- Fix FolderBrowser React hook violation
- Implement breadcrumb folder navigation

NEW FEATURES:
- Extract 10 strategic frames from videos (%10, %30, %50, %70, %90)
- Google Cloud Vision auto-tagging from preview frames
- Display frame gallery + auto-generated tags in FileDetail

CODE QUALITY:
- Add TypeScript configuration and type checking
- Clean up console.log statements"
```

---

## Execution Status

**Ready to implement.** Three phases:
1. **CRITICAL SECURITY** (Tasks 1-5) — Incident response, deploy immediately
2. **ARCHITECTURE** (Tasks 6-8) — Redesign, medium priority
3. **FEATURES** (Tasks 9-11) + **QA** (Tasks 12-13) — New capabilities

All tests must pass before final deployment.
