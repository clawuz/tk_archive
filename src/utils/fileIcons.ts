import type { ComponentType } from 'react'
import { FilmIcon, ImageIcon, FileIcon, PackageIcon, FolderIcon } from '../components/icons'

// File type icon mapping with Tailwind color classes
export const FILE_TYPE_ICONS: Record<string, { Icon: ComponentType<any>; color: string; bg: string }> = {
  'video/mp4': { Icon: FilmIcon, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900' },
  'video/quicktime': { Icon: FilmIcon, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900' },
  'image/jpeg': { Icon: ImageIcon, color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900' },
  'image/png': { Icon: ImageIcon, color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900' },
  'application/pdf': { Icon: FileIcon, color: 'text-red-500', bg: 'bg-red-100 dark:bg-red-900' },
  'application/zip': { Icon: PackageIcon, color: 'text-yellow-500', bg: 'bg-yellow-100 dark:bg-yellow-900' },
};

export function getFileTypeIcon(mimeType: string) {
  return FILE_TYPE_ICONS[mimeType] || {
    Icon: FolderIcon,
    color: 'text-gray-500',
    bg: 'bg-gray-100 dark:bg-gray-800'
  };
}

// Short uppercase label for the corner badge on gallery cards — brief calls
// for "small, visually consistent status indicators" (VIDEO/IMAGE/PSD/4K),
// not the full mime type string.
export function getFileTypeBadge(mimeType?: string): string {
  if (!mimeType) return 'DOSYA'
  if (mimeType === 'image/vnd.adobe.photoshop') return 'PSD'
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType.startsWith('image/')) return 'GÖRSEL'
  if (mimeType.startsWith('audio/')) return 'SES'
  if (mimeType === 'application/pdf') return 'PDF'
  return 'DOSYA'
}
