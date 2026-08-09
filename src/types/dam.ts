/**
 * TK Archive DAM — Type Definitions
 * Firestore document types for file management
 */

export type FileSource = 'local' | 'drive'
export type ChangeType = 'new' | 'deleted' | 'modified' | 'moved'
export type LicenseType = 'RF' | 'RM' | 'commercial' | 'custom'
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed'

/**
 * File metadata document
 */
export interface DAMFile {
  fileId: string
  name: string
  source: FileSource

  // Path information
  path: string // local: /Users/..., drive: fileId
  driveFileId?: string | null
  driveFolderId?: string | null

  // File properties
  size: number // bytes
  type: string // mime type: video/mp4, image/jpeg, etc
  extension: string // mov, jpg, psd, etc
  mimeType: string

  // Dates (milliseconds)
  createdAt: number
  modifiedAt: number
  uploadedAt: number

  // Hash for incremental scanning
  hash: string // sha256:abc123

  // Organization
  tags: string[]
  category?: string // video, image, design, document, etc

  // Rights & Compliance
  copyright: {
    owner: string
    year: number
    productionCompany?: string // Prodüksiyon şirketi (varsa)
    department?: string // İlgili birim — THY içindeki kaynak departman
    contactPerson?: string // İlgili kişi — dosyayı sağlayan/talep eden kişi
  }
  license: {
    type: LicenseType
    name: string
    expirationDate?: number // milliseconds
    restrictions?: string[] // commercial_use, resale, etc
  }
  usage?: {
    usage_rights: string
    creative_brief_id?: string
    campaign?: string
  }

  // Preview/thumbnail
  thumbnail?: {
    url: string // GCS URL
    generated: boolean
    generatedAt: number
  }

  // Preview fields (Tasks 1-4)
  streamable?: boolean
  previewUrl?: string
  videoPreviewFrames?: Array<{
    timestamp: number
    frameData: string
    frameNumber: number
  }>

  // Auto-tagging (Claude Vision)
  needs_tagging?: boolean // Flag for the tagNewFiles Cloud Function
  tagSource?: string // 'claude-vision' | 'yolo-local' | other sources
  taggedAt?: number // timestamp when tags were auto-generated
  taggedBy?: string // userId who triggered tagging

  // 1-2 sentence description of visual content, generated alongside tags
  description?: string
  descriptionSource?: string

  // Scan tracking
  scanId: string
  lastScanAt: number

  // Usage stats
  stats?: {
    views: number
    downloads: number
    lastAccessedAt?: number
  }

  // Status
  status: 'active' | 'archived' | 'deleted'
  isDeleted: boolean
}

/**
 * Scan history document
 */
export interface DAMScan {
  scanId: string
  source: FileSource

  // Archive configuration
  archivePath: string
  driveFolderId?: string | null

  // Scan metadata
  status: ScanStatus
  startedAt: number
  completedAt?: number
  duration?: number

  // Results
  results?: {
    totalFiles: number
    totalSizeBytes: number
    totalSizeGB: number

    // Incremental changes
    newFiles: number
    deletedFiles: number
    modifiedFiles: number
    unchangedFiles: number

    // File type breakdown
    fileTypes: Record<string, { count: number; sizeGB: number }>
  }

  // Error tracking
  errors: string[]
  warnings?: string[]

  // User & trigger
  userId: string
  triggerType: 'manual' | 'scheduled' | 'api'

  // Comparison with previous
  previousScanId?: string
  comparisonStats?: {
    fileDuplicates: number
    wastedSpaceGB: number
  }
}

/**
 * File change document (incremental sync)
 */
export interface DAMChange {
  changeId: string
  scanId: string
  fileId: string

  changeType: ChangeType
  fileName: string
  filePath: string
  fileSize: number

  // Timestamps
  detectedAt: number
  previousScanId: string

  // For deleted/moved files
  previousPath?: string
  wasLastSeen?: number

  // Metadata
  tags?: string[]
  category?: string
}

/**
 * Managed tag document
 */
export interface DAMTag {
  tagId: string
  name: string
  displayName: string
  description?: string
  color?: string // hex color
  category?: string // project, client, type, etc
  createdAt: number
  usageCount: number
}

/**
 * Search filter options
 */
export interface DAMSearchFilters {
  query?: string // full-text search
  sources?: FileSource[] // local, drive
  tags?: string[]
  type?: string[] // mime types
  dateRange?: {
    from: number
    to: number
  }
  licenseType?: LicenseType[]
  sortBy?: 'name' | 'date' | 'size' | 'views'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/**
 * DAM file with computed properties for UI
 */
export interface DAMFileUI extends DAMFile {
  sizeFormatted: string // "4.2 GB"
  dateFormatted: string // "Aug 4, 2026"
  thumbnailUrl: string
  sourceLabel: string // "Local" or "Google Drive"
  isExpired: boolean // license expiration
}

/**
 * Gallery view state
 */
export interface DAMGalleryState {
  files: DAMFileUI[]
  total: number
  loading: boolean
  error?: string
  filters: DAMSearchFilters
}

/**
 * File detail state
 */
export interface DAMDetailState {
  file: DAMFileUI | null
  loading: boolean
  error?: string
  showPreview: boolean
  showLightbox: boolean
}
