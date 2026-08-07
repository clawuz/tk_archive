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
    const firstKey = thumbnailCache.keys().next().value as string;
    if (firstKey) thumbnailCache.delete(firstKey);
  }
  thumbnailCache.set(cacheKey, result);

  return result;
}

export function clearThumbnailCache() {
  thumbnailCache.clear();
}
