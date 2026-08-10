import { DAMFile } from '../types/dam';

const SUPPORTED_VIDEO_FORMATS = ['video/mp4', 'video/quicktime', 'video/x-matroska'];

// Public Cloud Storage bucket the scanners (scanner.cjs, scannerDrive.cjs)
// upload every video to, keyed by `{fileId}.{extension}` — a fixed
// convention, so the playback URL is computed here rather than read from a
// stored Firestore field. Works identically for local- and Drive-sourced
// files once the scanner has uploaded them, and identically in dev and
// production (it's a public GCS URL, not a local dev-server route).
const VIDEO_BUCKET = 'tk-archive-cd9d0-videos';

export function canStream(file: DAMFile): boolean {
  return SUPPORTED_VIDEO_FORMATS.includes(file.mimeType);
}

export function getStreamUrl(file: DAMFile): string | null {
  if (!canStream(file)) return null;
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
