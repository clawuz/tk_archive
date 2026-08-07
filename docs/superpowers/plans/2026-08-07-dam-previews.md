# TK Archive DAM - Video Preview, Thumbnails, Downloads, Folder Navigation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add professional file previews, smart thumbnail handling, streaming video playback, and folder navigation to enable users to browse and download archive files efficiently.

**Architecture:** 
- Thumbnail system with lazy loading and smart fallbacks (cached images, generated previews, file-type icons)
- Embedded video player for local filesystem files (HTML5 MP4/MOV streaming)
- Progressive loading for large files (100MB+) using Range requests
- Download manager with proper file paths and CORS handling
- Folder breadcrumb navigator for local filesystem exploration
- All components integrated into FileDetail panel

**Tech Stack:** 
- React video player (HTML5 video element)
- Intersection Observer API for lazy loading
- Fetch Range requests for streaming
- Local file system access via Node.js paths
- Firestore file metadata (thumbnail URLs, video codecs)

## Global Constraints

- Vite React with TypeScript
- Tailwind CSS for styling
- Firebase Firestore for metadata
- Local filesystem + Google Drive sources
- File size limit: 5GB (browser memory safe)
- Video formats: MP4, MOV, MKV (HLS requires transcoding - deferred)
- Thumbnail sources: Firestore stored URL, fallback to file-type icon
- Dark mode support required
- Production URL: tk-archive-dam.web.app

---

## File Structure

**New Components:**
- `src/components/dam/ThumbnailCard.jsx` — Image display with loading states
- `src/components/dam/VideoPreview.jsx` — Video player for file detail
- `src/components/dam/FolderBrowser.jsx` — Breadcrumb navigator
- `src/components/dam/FileDownload.jsx` — Download button with progress

**Modified Components:**
- `src/components/dam/FileDetail.jsx` — Integrate preview components

**New Services:**
- `src/services/thumbnailService.ts` — Thumbnail generation/fallback logic
- `src/services/streamingService.ts` — Range request handler
- `src/services/pathResolver.ts` — Local path validation & traversal

**New Utils:**
- `src/utils/fileIcons.ts` — File-type icon mapping
- `src/utils/videoFormats.ts` — Video codec/format detection

**New Cloud Functions:**
- `functions/download.js` — Secure file download endpoint

---

## Task 1: Thumbnail Display System with Lazy Loading

**Files:**
- Create: `src/components/dam/ThumbnailCard.jsx`
- Create: `src/services/thumbnailService.ts`
- Create: `src/utils/fileIcons.ts`
- Modify: `src/components/dam/FileGallery.jsx:50-80` (replace hard-coded thumbnail)

**Interfaces:**
- Consumes: `DAMFile` type with `thumbnail.url`, `extension`, `mimeType`
- Produces: `<ThumbnailCard file={file} onError={fallback} />`

**Acceptance Criteria:**
- Thumbnail loads lazily (Intersection Observer)
- Shows loading skeleton while image loads
- Falls back to file-type icon if no thumbnail
- Error state shows gray placeholder
- Supports light/dark mode

### Step 1: Write thumbnail fallback utility

- [ ] Create `src/utils/fileIcons.ts`

```typescript
// File type icon mapping with Tailwind color classes
export const FILE_TYPE_ICONS = {
  'video/mp4': { icon: '🎬', color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900' },
  'video/quicktime': { icon: '🎬', color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900' },
  'image/jpeg': { icon: '🖼️', color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900' },
  'image/png': { icon: '🖼️', color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900' },
  'application/pdf': { icon: '📄', color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900' },
  'application/zip': { icon: '📦', color: 'text-yellow-500', bg: 'bg-yellow-100 dark:bg-yellow-900' },
};

export function getFileTypeIcon(mimeType: string) {
  return FILE_TYPE_ICONS[mimeType] || {
    icon: '📁',
    color: 'text-gray-500',
    bg: 'bg-gray-100 dark:bg-gray-800'
  };
}
```

- [ ] Run: `npm run build && npm run preview` — verify no TypeScript errors

- [ ] Commit
```bash
git add src/utils/fileIcons.ts
git commit -m "feat: add file type icon mapping for fallback thumbnails"
```

### Step 2: Write thumbnail service with caching

- [ ] Create `src/services/thumbnailService.ts`

```typescript
import { DAMFile } from '../types/dam';

interface ThumbnailResult {
  url: string | null;
  source: 'firestore' | 'fallback' | 'placeholder';
  cached: boolean;
}

// Simple in-memory cache (clear on page reload)
const thumbnailCache = new Map<string, ThumbnailResult>();
const CACHE_SIZE_LIMIT = 100;

export async function resolveThumbnail(file: DAMFile): Promise<ThumbnailResult> {
  const cacheKey = file.fileId;

  // Check cache first
  if (thumbnailCache.has(cacheKey)) {
    return { ...thumbnailCache.get(cacheKey)!, cached: true };
  }

  let result: ThumbnailResult;

  // Priority 1: Firestore stored thumbnail
  if (file.thumbnail?.url) {
    result = {
      url: file.thumbnail.url,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 2: Google Drive native thumbnails
  else if (file.source === 'drive' && file.driveFileId) {
    result = {
      url: `https://drive.google.com/thumbnail?id=${file.driveFileId}&sz=w200`,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 3: Fallback to placeholder
  else {
    result = {
      url: null,
      source: 'placeholder',
      cached: false
    };
  }

  // Store in cache (with size limit)
  if (thumbnailCache.size >= CACHE_SIZE_LIMIT) {
    const firstKey = thumbnailCache.keys().next().value;
    thumbnailCache.delete(firstKey);
  }
  thumbnailCache.set(cacheKey, result);

  return result;
}

export function clearThumbnailCache() {
  thumbnailCache.clear();
}
```

- [ ] Run: `npm run build` — verify TypeScript

- [ ] Commit
```bash
git add src/services/thumbnailService.ts
git commit -m "feat: thumbnail resolution service with fallback priority"
```

### Step 3: Write ThumbnailCard component with lazy loading

- [ ] Create `src/components/dam/ThumbnailCard.jsx`

```jsx
import { useState, useEffect, useRef } from 'react';
import { resolveThumbnail } from '../../services/thumbnailService';
import { getFileTypeIcon } from '../../utils/fileIcons';

export default function ThumbnailCard({ file, onSelect, className = '' }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const imageRef = useRef(null);

  // Setup Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(imageRef.current);
        }
      },
      { rootMargin: '100px' }
    );

    if (imageRef.current) {
      observer.observe(imageRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Load thumbnail when visible
  useEffect(() => {
    if (!isVisible) return;

    (async () => {
      try {
        setLoading(true);
        const result = await resolveThumbnail(file);
        setThumbnail(result);
        if (!result.url) {
          setError(true);
        }
      } catch (err) {
        console.error('Thumbnail load error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [isVisible, file]);

  const fileIcon = getFileTypeIcon(file.mimeType);

  return (
    <div
      ref={imageRef}
      onClick={() => onSelect?.(file)}
      className={`relative bg-white dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer transition hover:shadow-lg ${className}`}
    >
      {/* Thumbnail or Fallback */}
      {loading ? (
        // Loading skeleton
        <div className="w-full h-48 bg-gradient-to-r from-slate-200 to-slate-100 dark:from-slate-700 dark:to-slate-600 animate-pulse" />
      ) : thumbnail?.url && !error ? (
        <img
          src={thumbnail.url}
          alt={file.name}
          className="w-full h-48 object-cover"
          onError={() => setError(true)}
        />
      ) : (
        // File-type icon fallback
        <div className={`w-full h-48 flex items-center justify-center ${fileIcon.bg}`}>
          <span className="text-5xl">{fileIcon.icon}</span>
        </div>
      )}

      {/* File info overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition p-3 flex flex-col justify-end">
        <p className="text-white font-semibold text-sm truncate">{file.name}</p>
        <p className="text-white/80 text-xs">
          {file.sizeFormatted} • {file.source === 'local' ? '📂 Yerel' : '☁️ Drive'}
        </p>
      </div>
    </div>
  );
}
```

- [ ] Run: `npm run build` — check for errors

- [ ] Commit
```bash
git add src/components/dam/ThumbnailCard.jsx
git commit -m "feat: lazy-loaded thumbnail card with file-type fallback"
```

### Step 4: Integrate ThumbnailCard into FileGallery

- [ ] Modify `src/components/dam/FileGallery.jsx:1-20` (add import)

```jsx
import ThumbnailCard from './ThumbnailCard';
```

- [ ] Modify `src/components/dam/FileGallery.jsx:80-100` (replace file card rendering)

Find this section and replace with ThumbnailCard component

- [ ] Run: `npm run build && npm run preview`

Expected: File gallery shows thumbnails with smooth lazy loading, fallback icons when thumbnails missing

- [ ] Commit
```bash
git add src/components/dam/FileGallery.jsx
git commit -m "feat: integrate lazy-loaded thumbnails into file gallery"
```

---

## Task 2: Video Preview Player for FileDetail

**Files:**
- Create: `src/components/dam/VideoPreview.jsx`
- Create: `src/services/streamingService.ts`
- Modify: `src/components/dam/FileDetail.jsx:40-60` (add preview)

**Interfaces:**
- Consumes: `DAMFile` with `path`, `source`, `mimeType`, `size`
- Produces: `<VideoPreview file={file} />`
- Uses: `streamingService.canStream(file)`, `streamingService.getStreamUrl(file)`

**Acceptance Criteria:**
- Detects video files (MP4, MOV, MKV)
- Shows player for local filesystem videos
- Google Drive videos open in Google Drive viewer (link)
- Respects dark mode
- Handles missing/inaccessible files gracefully

### Step 1: Write streaming service

- [ ] Create `src/services/streamingService.ts`

```typescript
import { DAMFile } from '../types/dam';

const SUPPORTED_VIDEO_FORMATS = ['video/mp4', 'video/quicktime', 'video/x-matroska'];

export function canStream(file: DAMFile): boolean {
  return SUPPORTED_VIDEO_FORMATS.includes(file.mimeType);
}

export function getStreamUrl(file: DAMFile): string | null {
  if (!canStream(file)) return null;

  if (file.source === 'local') {
    // Local files: serve via API endpoint
    return `/api/stream?fileId=${file.fileId}&path=${encodeURIComponent(file.path)}`;
  } else if (file.source === 'drive') {
    // Google Drive: open in Google Drive viewer
    return `https://drive.google.com/file/d/${file.driveFileId}/preview`;
  }

  return null;
}

export function getFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function isFileTooLarge(bytes: number): boolean {
  return bytes > 2 * 1024 * 1024 * 1024;
}
```

- [ ] Run: `npm run build`

- [ ] Commit
```bash
git add src/services/streamingService.ts
git commit -m "feat: video streaming service with format detection"
```

### Step 2: Write VideoPreview component

- [ ] Create `src/components/dam/VideoPreview.jsx`

```jsx
import { useState, useEffect } from 'react';
import { canStream, getStreamUrl, getFileSize, isFileTooLarge } from '../../services/streamingService';

export default function VideoPreview({ file }) {
  const [canPreview, setCanPreview] = useState(false);
  const [streamUrl, setStreamUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!file) return;

    try {
      if (!canStream(file)) {
        setCanPreview(false);
        return;
      }

      if (isFileTooLarge(file.size)) {
        setError(`File too large (${getFileSize(file.size)}). Download to play locally.`);
        setCanPreview(false);
        return;
      }

      const url = getStreamUrl(file);
      setStreamUrl(url);
      setCanPreview(true);
      setError(null);
    } catch (err) {
      setError('Unable to preview this video');
      console.error('VideoPreview error:', err);
    }
  }, [file]);

  if (!canPreview) return null;

  return (
    <div className="bg-black rounded-lg overflow-hidden mb-4">
      {error ? (
        <div className="h-96 flex items-center justify-center bg-slate-900 text-white">
          <div className="text-center">
            <p className="text-lg mb-2">⚠️ {error}</p>
            <p className="text-sm text-slate-400">Size: {getFileSize(file.size)}</p>
          </div>
        </div>
      ) : file.source === 'drive' ? (
        // Google Drive embedded preview
        <iframe
          src={streamUrl}
          title={file.name}
          className="w-full h-96"
          allowFullScreen
        />
      ) : (
        // Local file video player (HTML5)
        <video
          src={streamUrl}
          controls
          className="w-full h-96 bg-black"
          controlsList="nodownload"
        />
      )}

      {/* Video info */}
      <div className="bg-slate-900 text-white p-3 text-sm">
        <p className="font-mono text-xs text-slate-400">{file.mimeType}</p>
        <p className="text-slate-300">Size: {getFileSize(file.size)}</p>
      </div>
    </div>
  );
}
```

- [ ] Run: `npm run build`

- [ ] Commit
```bash
git add src/components/dam/VideoPreview.jsx
git commit -m "feat: video preview component with Google Drive embed support"
```

### Step 3: Integrate VideoPreview into FileDetail

- [ ] Modify `src/components/dam/FileDetail.jsx:1-20` (add import)

```jsx
import VideoPreview from './VideoPreview';
```

- [ ] Modify `src/components/dam/FileDetail.jsx:40-60` (add preview section before metadata)

```jsx
<VideoPreview file={selectedFile} />
```

- [ ] Run: `npm run build && npm run preview`

Expected: Select a video file → preview player displays above metadata

- [ ] Commit
```bash
git add src/components/dam/FileDetail.jsx
git commit -m "feat: integrate video preview into file detail panel"
```

---

## Task 3: File Download Handler with Path Resolution

**Files:**
- Create: `src/services/pathResolver.ts`
- Create: `src/components/dam/FileDownload.jsx`
- Modify: `src/components/dam/FileDetail.jsx:80-100` (add download button)
- Create: `functions/download.js` (Cloud Function)

**Interfaces:**
- Consumes: `DAMFile` with `path`, `source`, `driveFileId`, `name`
- Produces: `<FileDownload file={file} />`

**Acceptance Criteria:**
- Local files: download directly from filesystem
- Google Drive files: redirect to Google Drive
- Progress indication for large files
- Proper MIME types in response headers
- Secure path traversal prevention

### Step 1: Write path resolver service

- [ ] Create `src/services/pathResolver.ts`

```typescript
import { DAMFile } from '../types/dam';

const ALLOWED_BASE_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes',
];

export function validatePath(filePath: string): boolean {
  // For browser: just do basic validation
  // Actual validation happens server-side in Cloud Function
  return ALLOWED_BASE_PATHS.some(basePath => filePath.startsWith(basePath));
}

export function resolvePath(file: DAMFile): string | null {
  if (file.source === 'drive') {
    return `https://drive.google.com/file/d/${file.driveFileId}/view`;
  }

  if (file.source === 'local') {
    if (!validatePath(file.path)) {
      console.error(`Path validation failed: ${file.path}`);
      return null;
    }
    return `/api/download?fileId=${file.fileId}&path=${encodeURIComponent(file.path)}`;
  }

  return null;
}

export function getParentDirectory(filePath: string): string | null {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) return null;
  return '/' + parts.slice(0, -1).join('/');
}
```

- [ ] Run: `npm run build`

- [ ] Commit
```bash
git add src/services/pathResolver.ts
git commit -m "feat: path resolver with security validation for file downloads"
```

### Step 2: Write FileDownload component

- [ ] Create `src/components/dam/FileDownload.jsx`

```jsx
import { useState } from 'react';
import { resolvePath } from '../../services/pathResolver';

export default function FileDownload({ file }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setError(null);
      setProgress(0);

      const downloadUrl = resolvePath(file);
      if (!downloadUrl) {
        setError('Cannot download this file');
        return;
      }

      if (file.source === 'drive') {
        window.open(downloadUrl, '_blank');
        setDownloading(false);
        return;
      }

      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = parseInt(contentLength, 10);

      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        if (total) {
          setProgress(Math.round((receivedLength / total) * 100));
        }
      }

      const blob = new Blob(chunks, { type: file.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setDownloading(false);
      setProgress(0);
    } catch (err) {
      setError(err.message);
      setDownloading(false);
      console.error('Download error:', err);
    }
  };

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
      >
        {downloading ? (
          <>
            <span className="animate-spin">⟳</span>
            {progress}%
          </>
        ) : file.source === 'drive' ? (
          <>
            <span>☁️</span> Open in Google Drive
          </>
        ) : (
          <>
            <span>⬇️</span> Download
          </>
        )}
      </button>

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm mt-2">{error}</p>
      )}

      {downloading && (
        <div className="mt-2 bg-slate-200 dark:bg-slate-700 rounded h-2 overflow-hidden">
          <div
            className="bg-blue-600 h-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] Run: `npm run build`

- [ ] Commit
```bash
git add src/components/dam/FileDownload.jsx
git commit -m "feat: file download component with progress tracking"
```

### Step 3: Integrate FileDownload into FileDetail

- [ ] Modify `src/components/dam/FileDetail.jsx:1-20` (add import)

```jsx
import FileDownload from './FileDownload';
```

- [ ] Modify `src/components/dam/FileDetail.jsx:100-120` (add download button in metadata section)

```jsx
<FileDownload file={selectedFile} />
```

- [ ] Run: `npm run build && npm run preview`

Expected: Select file → download button appears and functions

- [ ] Commit
```bash
git add src/components/dam/FileDetail.jsx
git commit -m "feat: add download button to file detail panel"
```

### Step 4: Create Cloud Function for secure downloads

- [ ] Create `functions/download.js`

```javascript
const functions = require('firebase-functions');
const fs = require('fs');
const path = require('path');

const ALLOWED_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes'
];

function validatePath(filePath) {
  const normalized = path.normalize(filePath);
  return ALLOWED_PATHS.some(basePath => normalized.startsWith(basePath));
}

exports.download = functions.https.onRequest((req, res) => {
  try {
    const { fileId, path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    if (!validatePath(decodeURIComponent(filePath))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const decodedPath = decodeURIComponent(filePath);

    if (!fs.existsSync(decodedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(decodedPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(decodedPath)}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    const stream = fs.createReadStream(decodedPath);
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] Run: `firebase deploy --only functions`

- [ ] Commit
```bash
git add functions/download.js
git commit -m "feat: Cloud Function for secure file downloads"
```

---

## Task 4: Folder Browser and Navigation

**Files:**
- Create: `src/components/dam/FolderBrowser.jsx`
- Modify: `src/components/dam/FileDetail.jsx:20-40` (add breadcrumb)

**Interfaces:**
- Consumes: `DAMFile` with `path`, `source`
- Produces: `<FolderBrowser file={file} onNavigate={callback} />`

**Acceptance Criteria:**
- Shows breadcrumb trail for current path
- Click folder name to navigate
- Back button for parent directory
- Only works for local filesystem

### Step 1: Write FolderBrowser component

- [ ] Create `src/components/dam/FolderBrowser.jsx`

```jsx
import { useMemo } from 'react';
import { getParentDirectory } from '../../services/pathResolver';

export default function FolderBrowser({ file, onNavigate }) {
  if (file?.source !== 'local') return null;

  const filePath = file?.path || '';

  const breadcrumbs = useMemo(() => {
    const parts = filePath.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      path: '/' + parts.slice(0, index + 1).join('/')
    }));
  }, [filePath]);

  const handleNavigateToParent = () => {
    const parent = getParentDirectory(filePath);
    if (parent) {
      onNavigate?.(parent);
    }
  };

  const handleNavigateTo = (path) => {
    onNavigate?.(path);
  };

  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-1 flex-wrap">
      <button
        onClick={handleNavigateToParent}
        className="hover:text-slate-900 dark:hover:text-slate-200 transition"
        title="Parent directory"
      >
        ↑
      </button>

      {breadcrumbs.map((crumb, index) => (
        <div key={index} className="flex items-center gap-1">
          <span>/</span>
          <button
            onClick={() => handleNavigateTo(crumb.path)}
            className="hover:text-slate-900 dark:hover:text-slate-200 hover:underline transition"
          >
            {crumb.label}
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] Run: `npm run build`

- [ ] Commit
```bash
git add src/components/dam/FolderBrowser.jsx
git commit -m "feat: folder breadcrumb navigation component"
```

### Step 2: Integrate FolderBrowser into FileDetail

- [ ] Modify `src/components/dam/FileDetail.jsx:1-20` (add import)

```jsx
import FolderBrowser from './FolderBrowser';
```

- [ ] Modify `src/components/dam/FileDetail.jsx:30-45` (add breadcrumb section after file name)

```jsx
<FolderBrowser file={selectedFile} onNavigate={handleFolderNavigate} />
```

- [ ] Run: `npm run build && npm run preview`

Expected: File detail shows breadcrumb navigation for local files

- [ ] Commit
```bash
git add src/components/dam/FileDetail.jsx
git commit -m "feat: integrate folder breadcrumb navigation into file detail"
```

---

## Task 5: TypeScript Types Update and Final Deploy

**Files:**
- Modify: `src/types/dam.ts` (add preview fields)
- Deploy all changes

### Step 1: Update DAMFile type

- [ ] Modify `src/types/dam.ts:14-80` (add preview fields if missing)

Add to DAMFile interface:
```typescript
  // Preview fields
  driveFileId?: string | null
  driveFolderId?: string | null
  streamable?: boolean
  previewUrl?: string
```

- [ ] Run: `npm run build`

Expected: No TypeScript errors

- [ ] Commit
```bash
git add src/types/dam.ts
git commit -m "chore: update DAMFile type with preview and drive fields"
```

### Step 2: Final build and deploy

- [ ] Run: `npm run build`

Expected: No build errors

- [ ] Run: `firebase deploy`

Expected: Hosting + Functions deployed successfully

- [ ] Run: `npm run preview`

Expected: All new components render without errors

- [ ] Final Commit
```bash
git add .
git commit -m "feat: complete video preview, thumbnails, downloads, folder navigation

- Thumbnail display with lazy loading and file-type fallbacks
- Video preview player for local files (HTML5) and Google Drive
- File download handler with progress tracking
- Secure path validation and Cloud Function endpoint
- Folder breadcrumb navigation for local filesystem
- All components integrated into FileDetail panel"
```

---

## Execution Status

Ready to start Task 1. Using superpowers:subagent-driven-development for implementation.
