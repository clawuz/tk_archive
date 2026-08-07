import { DAMFile } from '../types/dam'

const ALLOWED_BASE_PATHS = [
  '/Users/okilavuz/Desktop/Omer/TK-2026',
  '/Volumes',
]

export function validatePath(filePath: string): boolean {
  // For browser: just do basic validation
  // Actual validation happens server-side in Cloud Function
  return ALLOWED_BASE_PATHS.some(basePath => filePath.startsWith(basePath))
}

export function resolvePath(file: DAMFile): string | null {
  if (file.source === 'drive') {
    return `https://drive.google.com/file/d/${file.driveFileId}/view`
  }

  if (file.source === 'local') {
    if (!validatePath(file.path)) {
      console.error(`Path validation failed: ${file.path}`)
      return null
    }
    return `/api/download?fileId=${file.fileId}&path=${encodeURIComponent(file.path)}`
  }

  return null
}

export function getParentDirectory(filePath: string): string | null {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return '/' + parts.slice(0, -1).join('/')
}
