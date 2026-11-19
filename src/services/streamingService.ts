import { DAMFile } from '../types/dam';

const SUPPORTED_VIDEO_FORMATS = ['video/mp4', 'video/quicktime', 'video/x-matroska'];

// Public Cloud Storage bucket scanner.cjs uploads local videos to, keyed by
// `{fileId}.{extension}` — a fixed convention, so the playback URL is
// computed here rather than read from a stored Firestore field. Only local
// files land in this bucket: Drive-sourced videos play straight from
// Google's own embeddable viewer instead (no download/re-upload — Drive
// already serves them reliably, and duplicating the bytes would just cost
// bandwidth and storage for no benefit).
const VIDEO_BUCKET = 'tk-archive-cd9d0-videos';

// Same bucket videos use, under a previews/ prefix — scanner.cjs uploads a
// 1600px render here for local raster images (image/*), keyed by
// `{fileId}.png`, same deterministic-URL convention as video. The small
// (240px) thumbnail stored inline in Firestore stays the grid tile's
// source — this is only for the full-screen lightbox, which looked
// blurry/cropped stretching that small thumbnail up to fill the screen.
// Not every image has one yet (only scanned/backfilled after this was
// added) — callers must fall back to file.thumbnailUrl on load error.
export function getImagePreviewUrl(file: DAMFile): string | null {
  if (file.source !== 'local' || !file.mimeType?.startsWith('image/')) return null;
  return `https://storage.googleapis.com/${VIDEO_BUCKET}/previews/${file.fileId}.png`;
}

export function canStream(file: DAMFile): boolean {
  // Files with a Drive-hosted preview (either true Drive-sourced files, or
  // local files whose preview scannerLocalPreview.cjs uploaded to Drive)
  // are always a standard playable video once transcoded — isVideoFile
  // (lib/videoFrames.cjs) accepts more source extensions than the local
  // GCS-streaming path below supports, but the Drive-hosted preview itself
  // is always H.264 mp4. Guard on mimeType still starting with 'video/' so
  // non-video Drive files (images, PDFs) that also carry a driveFileId
  // aren't treated as streamable video.
  if (file.driveFileId && file.mimeType?.startsWith('video/')) return true;
  return SUPPORTED_VIDEO_FORMATS.includes(file.mimeType);
}

export function getStreamUrl(file: DAMFile): string | null {
  if (!canStream(file)) return null;

  // Any file with a driveFileId streams from Drive's embed viewer — this
  // covers both true Drive-sourced files (source: 'drive') and local files
  // whose small preview was uploaded to Drive by scannerLocalPreview.cjs
  // (source: 'local', driveFileId set to the preview's Drive file ID).
  //
  // A direct-download URL (drive.usercontent.google.com/download) was
  // tried here instead, to avoid Drive's /preview iframe chrome — curl
  // showed clean video/mp4 bytes with open CORS and range support, but in
  // an actual <video> element in the app it failed to play across the
  // board. Whatever real browsers hit that curl didn't (session/referrer
  // gating, a redirect curl silently followed differently, etc.), it
  // wasn't reliable — reverted to the iframe, which does work.
  if (file.driveFileId) {
    return `https://drive.google.com/file/d/${file.driveFileId}/preview`;
  }

  // A Drive-sourced file missing its driveFileId is an inconsistent state
  // (scannerDrive.cjs always sets one), but should still report "no preview
  // available" rather than falling through to a GCS URL that was never
  // populated for Drive files and would 404.
  if (file.source === 'drive') return null;

  if (!file.extension) return null;
  return `https://storage.googleapis.com/${VIDEO_BUCKET}/${file.fileId}.${file.extension.toLowerCase()}`;
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
