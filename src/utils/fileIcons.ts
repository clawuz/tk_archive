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
