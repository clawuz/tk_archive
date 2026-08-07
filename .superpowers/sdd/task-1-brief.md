# Task 1: Thumbnail Display System with Lazy Loading

## Overview
Build a lazy-loaded thumbnail system for the DAM file gallery that shows cached images, falls back to Google Drive thumbnails, and displays file-type icons when no image is available.

## Files to Create/Modify

- **Create:** `src/utils/fileIcons.ts` — file-type icon mapping
- **Create:** `src/services/thumbnailService.ts` — thumbnail resolution with caching
- **Create:** `src/components/dam/ThumbnailCard.jsx` — lazy-loaded thumbnail card component
- **Modify:** `src/components/dam/FileGallery.jsx:50-80` — replace hard-coded thumbnail with ThumbnailCard

## Interfaces

**Consumes:**
- `DAMFile` type with properties: `fileId`, `thumbnail.url`, `extension`, `mimeType`, `source`, `driveFileId`, `name`, `sizeFormatted`

**Produces:**
- `ThumbnailCard` React component: `<ThumbnailCard file={file} onSelect={callback} className="" />`
- `resolveThumbnail(file: DAMFile)` → `Promise<{ url: string | null, source: 'firestore' | 'fallback' | 'placeholder', cached: boolean }>`
- `getFileTypeIcon(mimeType: string)` → `{ icon: string, color: string, bg: string }`

## Acceptance Criteria

- [ ] Thumbnail images load lazily using Intersection Observer (100px rootMargin)
- [ ] Shows animated loading skeleton while image loads
- [ ] Falls back to file-type emoji icon if no thumbnail URL available
- [ ] Gray placeholder for error state
- [ ] Full dark mode support (Tailwind dark: classes)
- [ ] Build runs with no TypeScript errors (`npm run build`)
- [ ] Component integrates into FileGallery without breaking existing functionality

## Implementation Steps

### Step 1: Write file type icon mapping utility

**Create `src/utils/fileIcons.ts`:**

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

**Verify:** `npm run build` — expect no TypeScript errors
**Commit:** `git add src/utils/fileIcons.ts && git commit -m "feat: add file type icon mapping for fallback thumbnails"`

### Step 2: Write thumbnail service with caching

**Create `src/services/thumbnailService.ts`:**

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

**Verify:** `npm run build` — expect no TypeScript errors
**Commit:** `git add src/services/thumbnailService.ts && git commit -m "feat: thumbnail resolution service with fallback priority"`

### Step 3: Write ThumbnailCard component

**Create `src/components/dam/ThumbnailCard.jsx`:**

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

**Verify:** `npm run build` — expect no errors
**Commit:** `git add src/components/dam/ThumbnailCard.jsx && git commit -m "feat: lazy-loaded thumbnail card with file-type fallback"`

### Step 4: Integrate ThumbnailCard into FileGallery

**Read current FileGallery to understand structure:**
- Run: `grep -n "className.*grid\|className.*flex" src/components/dam/FileGallery.jsx | head -20`

**Modify `src/components/dam/FileGallery.jsx`:**
1. Add import at top: `import ThumbnailCard from './ThumbnailCard';`
2. Find the section that renders file cards (look for `.map()` over files)
3. Replace the hard-coded thumbnail/card with `<ThumbnailCard file={file} onSelect={handleSelectFile} />`

**Verify:** `npm run build && npm run preview`
- Expected: File gallery displays thumbnails with lazy loading
- Files without thumbnails show file-type emoji icons
- Hover over cards shows file info
- Dark mode works correctly

**Commit:** `git add src/components/dam/FileGallery.jsx && git commit -m "feat: integrate lazy-loaded thumbnails into file gallery"`

## Testing Checklist

- [ ] All 4 files created/modified without conflicts
- [ ] `npm run build` runs with 0 TypeScript errors
- [ ] `npm run preview` shows gallery with thumbnail cards
- [ ] Scroll through gallery — thumbnails load as they become visible
- [ ] Hover card — file info overlay appears
- [ ] Dark mode toggle — all styling adapts correctly
- [ ] Click card — `onSelect` callback fires (if integrated with FileDetail)

## Notes

- The thumbnail cache is in-memory only and clears on page reload. This is sufficient since file thumbnails rarely change mid-session.
- Google Drive thumbnails use the official Google Drive thumbnail API with `sz=w200` (200px max dimension).
- The fileIcon fallback uses emoji for clarity and to avoid adding more image assets.
- Intersection Observer uses 100px rootMargin to start loading images slightly before they enter the viewport for smoother UX.
