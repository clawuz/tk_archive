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

export function canStream(file: DAMFile): boolean {
  return SUPPORTED_VIDEO_FORMATS.includes(file.mimeType);
}

export function getStreamUrl(file: DAMFile): string | null {
  if (!canStream(file)) return null;

  if (file.source === 'drive') {
    if (!file.driveFileId) return null;
    return `https://drive.google.com/file/d/${file.driveFileId}/preview`;
  }

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
