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

  // DEBUG: Log file info for first few videos
  if (file.mimeType?.includes('video')) {
    console.log(`[Thumbnail] ${file.name}: hasFrames=${!!file.videoPreviewFrames?.length}, thumbnail=${!!file.thumbnail?.url}, source=${file.source}`);
  }

  // Priority 1: Video preview frame (first frame as thumbnail)
  if (file.videoPreviewFrames?.length > 0) {
    const frameData = file.videoPreviewFrames[0].frameData;
    const dataUrl = `data:image/jpeg;base64,${frameData}`;
    console.log(`[Thumbnail] Using video frame for ${file.name}, dataUrl length: ${dataUrl.length}`);
    result = {
      url: dataUrl,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 2: Firestore stored thumbnail
  else if (file.thumbnail?.url) {
    result = {
      url: file.thumbnail.url,
      source: 'firestore',
      cached: false
    };
  }
  // Priority 3: Google Drive native thumbnails
  else if (file.source === 'drive' && file.driveFileId) {
    result = {
      url: `https://drive.google.com/thumbnail?id=${file.driveFileId}&sz=w200`,
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
