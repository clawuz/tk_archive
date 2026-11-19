/**
 * TK Archive DAM — Type Definitions
 * Firestore document types for file management
 */

export type FileSource = 'local' | 'drive'
export type ChangeType = 'new' | 'deleted' | 'modified' | 'moved'
export type LicenseType = 'RF' | 'RM' | 'commercial' | 'custom'
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed'
export type MediaCategory = 'video' | 'image' | 'design' | 'document' | 'other'

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
  searchTokens?: string[] // prefixes of name/tags/AI text words — see lib/searchTokens.cjs
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
  // Light-scanned local videos are NOT in the GCS bucket until someone asks
  // (enrich.cjs uploads when upload_requested is set). undefined = legacy
  // doc, uploaded by the full scanner.
  videoUploaded?: boolean
  upload_requested?: boolean
  uploadError?: string
  previewUrl?: string
  videoPreviewFrames?: Array<{
    timestamp: number
    frameData: string
    frameNumber: number
  }>

  // Auto-tagging — done by the local v2 vision worker on the Mac
  // (tk-ai-engine/sprint3/ai_worker.py), not a Cloud Function: the Claude
  // API credit ran out and local tagging is free.
  needs_tagging?: boolean // Backlog flag: set by the scanner on new files, cleared by the worker
  tag_requested?: boolean // Priority flag: set by the "Otomatik Etiketle" button, cleared by the worker when done
  tagSource?: string // 'claude-vision' | 'local-vision' | other sources
  taggedAt?: number // timestamp when tags were auto-generated
  taggedBy?: string // userId who triggered tagging

  // Result of the local vision worker (tk-ai-engine/sprint3/ai_worker.py)
  ai?: {
    status: 'completed' | 'failed' | 'skipped' | string
    tags?: string[]
    description?: string
    onScreenText?: string[]
    model?: string
  }

  // 1-2 sentence description of visual content, generated alongside tags
  description?: string
  descriptionSource?: string

  // Duplicates (tk-ai-engine/sprint3/mark_duplicates.py): files with identical
  // content (same hash) are NOT deleted — only one representative is shown in
  // the UI. Copies carry isDuplicate/duplicateOf; the representative carries
  // duplicateCount/duplicateIds and the copies' names/folder tags in
  // duplicateSearchText so searching a project the copy lives in still finds it.
  isDuplicate?: boolean
  duplicateOf?: string
  duplicateCount?: number
  duplicateIds?: string[]
  duplicateSearchText?: string

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
  type?: MediaCategory[] // broad type: video, image, design, document, other — see getMediaCategory()
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
