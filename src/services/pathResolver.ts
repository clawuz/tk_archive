import { DAMFile } from '../types/dam'

const ALLOWED_BASE_PATHS = [
  '/Volumes',
]

// The share's stored paths are macOS mount points (/Volumes/TRIBAL/...),
// which only resolve on a machine that already has the volume mounted at
// that exact name. smb:// works from any machine on the network regardless
// of local mount state, so that's what's shown/copied instead.
const SMB_HOST = 'smb://10.146.160.43'

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
    return file.path.replace('/Volumes', SMB_HOST)
  }

  return null
}

// Direct download (not the /view page) — only meaningful for Drive-hosted
// files. Local/TRIBAL originals have no browser-reachable download URL: the
// share isn't internet-facing, so the UI falls back to showing/copying the
// path instead (see FileDownload.jsx).
export function resolveDownloadUrl(file: DAMFile): string | null {
  if (file.source === 'drive' && file.driveFileId) {
    return `https://drive.google.com/uc?export=download&id=${file.driveFileId}`
  }
  return null
}

export function getParentDirectory(filePath: string): string | null {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return '/' + parts.slice(0, -1).join('/')
}
