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
