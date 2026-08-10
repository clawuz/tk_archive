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

  // Priority 1: Video preview frame (first frame as thumbnail)
  if (file.videoPreviewFrames?.length > 0) {
    result = {
      url: `data:image/jpeg;base64,${file.videoPreviewFrames[0].frameData}`,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 2: Google Drive's stable public thumbnail endpoint — checked
  // before the stored Firestore thumbnail because that stored URL (Drive
  // API's `thumbnailLink`) is signed and expires after a few hours, while
  // this one is keyed only by file ID and never expires.
  else if (file.source === 'drive' && file.driveFileId) {
    result = {
      url: `https://drive.google.com/thumbnail?id=${file.driveFileId}&sz=w200`,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 3: Firestore stored thumbnail (local files: a Cloud Storage
  // URL, not signed/expiring)
  else if (file.thumbnail?.url) {
    result = {
      url: file.thumbnail.url,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 4: Fallback to placeholder
  else {
    result = {
      url: null,
      source: 'placeholder',
      cached: false
    };
  }

  // Store in cache (with size limit)
  if (thumbnailCache.size >= CACHE_SIZE_LIMIT) {
    const firstKey = thumbnailCache.keys().next().value as string;
    if (firstKey) thumbnailCache.delete(firstKey);
  }
  thumbnailCache.set(cacheKey, result);

  return result;
}

export function clearThumbnailCache() {
  thumbnailCache.clear();
}
