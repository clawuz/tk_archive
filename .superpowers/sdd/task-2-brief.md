# Task 2: Video Preview Player for FileDetail

## Overview
Build a video preview component that plays local filesystem videos using HTML5 video element and embeds Google Drive videos in an iframe. Detect video files and handle large files gracefully.

## Files to Create/Modify

- **Create:** `src/components/dam/VideoPreview.jsx` — video player component
- **Create:** `src/services/streamingService.ts` — video format detection and URL resolution
- **Modify:** `src/components/dam/FileDetail.jsx:1-20` — add import
- **Modify:** `src/components/dam/FileDetail.jsx:40-60` — add preview component

## Interfaces

**Consumes:**
- `DAMFile` type with: `path`, `source`, `mimeType`, `size`, `driveFileId`, `name`

**Produces:**
- `VideoPreview` React component: `<VideoPreview file={file} />`
- `canStream(file: DAMFile)` → `boolean` — checks if file is streamable video
- `getStreamUrl(file: DAMFile)` → `string | null` — returns appropriate stream URL
- `getFileSize(bytes: number)` → `string` — formats bytes for display
- `isFileTooLarge(bytes: number)` → `boolean` — checks size limit (2GB)

## Acceptance Criteria

- [ ] Detects video files: MP4, MOV, MKV (via mimeType)
- [ ] Local filesystem videos: HTML5 `<video>` player with controls
- [ ] Google Drive videos: iframe with Google Drive preview
- [ ] Large files (>2GB): shows warning message instead of player
- [ ] Dark mode support
- [ ] Build runs with no TypeScript errors
- [ ] Component renders without console errors
- [ ] Non-video files: component renders nothing (silent fail)

## Implementation Steps

### Step 1: Write streaming service

**Create `src/services/streamingService.ts`:**

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

**Verify:** `npm run build` — expect no TypeScript errors
**Commit:** `git add src/services/streamingService.ts && git commit -m "feat: video streaming service with format detection"`

### Step 2: Write VideoPreview component

**Create `src/components/dam/VideoPreview.jsx`:**

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

**Verify:** `npm run build` — expect no errors
**Commit:** `git add src/components/dam/VideoPreview.jsx && git commit -m "feat: video preview component with Google Drive embed support"`

### Step 3: Integrate VideoPreview into FileDetail

**Modify `src/components/dam/FileDetail.jsx`:**
1. Add import at top: `import VideoPreview from './VideoPreview';`
2. Find the section that displays file metadata (look for file name, created date, etc.)
3. Add before metadata section (after file name header):
   ```jsx
   <VideoPreview file={selectedFile} />
   ```

**Verify:** `npm run build && npm run preview`
- Expected: Select a video file → preview player displays above metadata
- Non-video files → no player shown
- Large videos → warning message instead of player

**Commit:** `git add src/components/dam/FileDetail.jsx && git commit -m "feat: integrate video preview into file detail panel"`

## Testing Checklist

- [ ] All 2 files created, 1 file modified without conflicts
- [ ] `npm run build` runs with 0 TypeScript errors
- [ ] `npm run preview` opens without errors
- [ ] Select MP4 file → HTML5 video player with controls
- [ ] Select MOV file → HTML5 video player
- [ ] Select Google Drive video → iframe embeds preview
- [ ] Select file >2GB → shows warning instead of player
- [ ] Select PDF → no preview shown (silent)
- [ ] Dark mode: black background, white text, no color overflow

## Notes

- The 2GB size limit is chosen for browser memory safety; the Global Constraints specify 5GB file size support, but browser-based video streaming above 2GB requires pagination via Range requests (deferred to later optimization).
- Local video URLs use `/api/stream` endpoint which will be implemented in Task 3 (or can use blob URLs if files are pre-downloaded).
- Google Drive iframe uses official preview endpoint from Google Drive API.
- Component silently returns `null` for non-video files (no error message needed).
- HTML5 video element uses `controlsList="nodownload"` to discourage direct downloads via browser controls.
