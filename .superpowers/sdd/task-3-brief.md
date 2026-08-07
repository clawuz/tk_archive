# Task 3: File Download Handler with Path Resolution

## Overview
Implement secure file downloads with path validation, progress tracking, and support for both local filesystem and Google Drive sources. Create a Cloud Function endpoint for server-side file access validation.

## Files to Create/Modify

- **Create:** `src/services/pathResolver.ts` — path validation and resolution
- **Create:** `src/components/dam/FileDownload.jsx` — download UI component with progress
- **Modify:** `src/components/dam/FileDetail.jsx:1-20` — add import
- **Modify:** `src/components/dam/FileDetail.jsx:100-120` — add download button
- **Create:** `functions/download.js` — Cloud Function for secure downloads

## Interfaces

**Consumes:**
- `DAMFile` type with: `path`, `source`, `driveFileId`, `fileId`, `name`, `mimeType`, `size`

**Produces:**
- `FileDownload` React component: `<FileDownload file={file} />`
- `validatePath(filePath: string)` → `boolean` — client-side validation
- `resolvePath(file: DAMFile)` → `string | null` — returns download URL
- `getParentDirectory(filePath: string)` → `string | null` — for folder nav (Task 4)
- Cloud Function `/api/download?fileId=X&path=Y` → file download

## Acceptance Criteria

- [ ] Local files: download directly via Cloud Function
- [ ] Google Drive files: redirect to Google Drive view link
- [ ] Progress bar shows upload progress (0-100%)
- [ ] Proper MIME type in response headers
- [ ] Secure path traversal prevention (both client + server)
- [ ] Error handling for missing/inaccessible files
- [ ] Build runs with no TypeScript errors
- [ ] Component integrates with FileDetail
- [ ] Cloud Function deploys without errors

## Implementation Steps

### Step 1: Write path resolver service

**Create `src/services/pathResolver.ts`:**

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

**Verify:** `npm run build` — expect no errors
**Commit:** `git add src/services/pathResolver.ts && git commit -m "feat: path resolver with security validation for file downloads"`

### Step 2: Write FileDownload component

**Create `src/components/dam/FileDownload.jsx`:**

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

**Verify:** `npm run build` — expect no errors
**Commit:** `git add src/components/dam/FileDownload.jsx && git commit -m "feat: file download component with progress tracking"`

### Step 3: Integrate FileDownload into FileDetail

**Modify `src/components/dam/FileDetail.jsx`:**
1. Add import at top: `import FileDownload from './FileDownload';`
2. Find the metadata section (file size, date, etc.)
3. Add download button within metadata area:
   ```jsx
   <FileDownload file={selectedFile} />
   ```

**Verify:** `npm run build && npm run preview`
- Expected: Select file → download button appears
- Click download → file downloads with progress
- Google Drive file → "Open in Google Drive" button

**Commit:** `git add src/components/dam/FileDetail.jsx && git commit -m "feat: add download button to file detail panel"`

### Step 4: Create Cloud Function for secure downloads

**Create `functions/download.js`:**

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

**Deploy:** `firebase deploy --only functions`
**Verify:** Function deploys without errors
**Commit:** `git add functions/download.js && git commit -m "feat: Cloud Function for secure file downloads"`

## Testing Checklist

- [ ] All 3 files created, 1 file modified without conflicts
- [ ] `npm run build` runs with 0 TypeScript errors
- [ ] `npm run preview` shows download button in file detail
- [ ] Click download for local file → file downloads with progress bar
- [ ] Click download for Google Drive file → opens in new tab
- [ ] Large file download → progress bar shows 0-100%
- [ ] Missing file → error message displays
- [ ] Path validation prevents directory traversal attempts
- [ ] Dark mode: error text visible, progress bar colors correct

## Notes

- The ALLOWED_BASE_PATHS list defines which directories can be downloaded from. Only paths starting with these bases are allowed.
- Path normalization prevents `../` attacks.
- Server-side validation is mandatory; client-side validation is defense-in-depth only.
- Progress tracking uses ReadableStream.getReader() for fine-grained byte tracking.
- Google Drive files skip the download flow and just open the view link in a new tab.
- The Cloud Function uses Node.js fs streams for efficient memory usage even on large files.

## Future Improvements (not in scope)

- Range request support for resumable downloads
- Bandwidth throttling for large files
- Download history tracking
- Expiring download links
