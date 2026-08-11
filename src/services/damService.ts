/**
 * DAM Service — Firestore operations for file management
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  increment,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  DAMFile,
  DAMScan,
  DAMChange,
  DAMTag,
  DAMSearchFilters,
  DAMFileUI,
} from '../types/dam'

// Collection references
const FILES_COLLECTION = 'files'
const SCANS_COLLECTION = 'scans'
const CHANGES_COLLECTION = 'changes'
const TAGS_COLLECTION = 'tags'

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Format date for display
 */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Convert DAMFile to DAMFileUI with computed properties
 */
function enrichFile(file: DAMFile): DAMFileUI {
  const modifiedAt = convertTimestamp(file.modifiedAt)
  const enriched: DAMFileUI = {
    ...file,
    modifiedAt,
    sizeFormatted: formatFileSize(file.size),
    dateFormatted: formatDate(modifiedAt),
    // Drive's stored thumbnail.url (the Drive API's `thumbnailLink`) is a
    // signed URL that Google expires after a few hours — it goes stale long
    // before we'd ever re-scan. `drive.google.com/thumbnail?id=...` is a
    // second, undocumented-but-stable Google endpoint keyed only by the file
    // ID, so it never expires; prefer it for every Drive file. Local files
    // still use the stored thumbnail (a Cloud Storage URL, not signed).
    thumbnailUrl:
      file.source === 'drive' && file.driveFileId
        ? `https://drive.google.com/thumbnail?id=${file.driveFileId}&sz=w400`
        : file.thumbnail?.url || '/placeholder-thumbnail.jpg',
    sourceLabel: file.source === 'local' ? 'Yerel' : 'Google Drive',
    isExpired: file.license?.expirationDate
      ? convertTimestamp(file.license.expirationDate) < Date.now()
      : false,
  }

  // Explicitly preserve videoPreviewFrames
  if (file.videoPreviewFrames) {
    enriched.videoPreviewFrames = file.videoPreviewFrames
  }

  return enriched
}

// ============================================================================
// FILES OPERATIONS
// ============================================================================

/**
 * Fetch one page of files matching `filters`, ordered by filters.sortBy.
 *
 * Cursor-based (startAfterDoc/batchSize), so it scales to an archive of
 * thousands of files instead of pulling everything into memory at once.
 * `tags` is a real Firestore query constraint; `sources`, `query` (text),
 * `licenseType`, and `dateRange` are post-filtered on each fetched batch
 * (Firestore can't express substring search or this filter combination
 * without a composite index per pairing) — so a batch can come back with
 * fewer matching files than `batchSize`. Callers that need a full page of
 * *filtered* results should keep fetching batches (using `lastDoc` as the
 * next cursor) until they have enough or `rawCount < batchSize` (no more
 * raw documents left).
 */
export async function searchFiles(
  filters: DAMSearchFilters,
  startAfterDoc: QueryDocumentSnapshot<DocumentData> | null = null,
  batchSize: number = 100
): Promise<{
  files: DAMFileUI[]
  lastDoc: QueryDocumentSnapshot<DocumentData> | null
  rawCount: number
}> {
  const queryConstraints = []

  if (filters.tags && filters.tags.length > 0) {
    queryConstraints.push(where('tags', 'array-contains-any', filters.tags))
  }

  // Note: sources/query/licenseType/dateRange are post-filtered below (not
  // query constraints) so they combine freely without a composite index for
  // every field/filter pairing.

  const sortField = filters.sortBy || 'modifiedAt'
  const sortDirection = filters.sortOrder === 'asc' ? 'asc' : 'desc'
  queryConstraints.push(orderBy(sortField, sortDirection))

  if (startAfterDoc) {
    queryConstraints.push(startAfter(startAfterDoc))
  }

  queryConstraints.push(limit(batchSize))

  try {
    const snapshot = await getDocs(
      query(collection(db, FILES_COLLECTION), ...queryConstraints)
    )
    const rawCount = snapshot.docs.length
    const lastDoc = snapshot.docs[rawCount - 1] || null

    let files = snapshot.docs.map((doc) => {
      const data = doc.data() as DAMFile
      // Convert Timestamp objects to milliseconds
      if (data.modifiedAt && typeof data.modifiedAt === 'object' && 'toMillis' in data.modifiedAt) {
        data.modifiedAt = (data.modifiedAt as any).toMillis()
      }
      if (data.createdAt && typeof data.createdAt === 'object' && 'toMillis' in data.createdAt) {
        data.createdAt = (data.createdAt as any).toMillis()
      }
      if (data.uploadedAt && typeof data.uploadedAt === 'object' && 'toMillis' in data.uploadedAt) {
        data.uploadedAt = (data.uploadedAt as any).toMillis()
      }
      // Default source to 'drive' for Google Drive files without source field
      if (!data.source) {
        data.source = 'drive'
      }

      return enrichFile(data)
    })

    // Post-query filtering (for complex filters)
    if (filters.sources && filters.sources.length > 0) {
      files = files.filter((f) => filters.sources!.includes(f.source))
    }

    if (filters.query) {
      const q = filters.query.toLowerCase()
      files = files.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.tags.some((t) => t.toLowerCase().includes(q))
      )
    }

    if (filters.licenseType && filters.licenseType.length > 0) {
      files = files.filter((f) => filters.licenseType!.includes(f.license?.type))
    }

    if (filters.dateRange) {
      const { from, to } = filters.dateRange
      files = files.filter((f) => f.modifiedAt >= from && f.modifiedAt <= to)
    }

    return {
      files,
      lastDoc,
      rawCount,
    }
  } catch (error) {
    console.error('Error searching files:', error)
    throw error
  }
}

/**
 * True archive-wide file counts (total/local/drive) — independent of
 * pagination and of any active filter. Uses Firestore's count aggregate
 * (getCountFromServer), which counts matching documents server-side
 * without downloading them, so this stays cheap even as the archive grows
 * into the thousands.
 */
export async function getFileCounts(): Promise<{ total: number; local: number; drive: number }> {
  const filesRef = collection(db, FILES_COLLECTION)
  const [totalSnap, localSnap, driveSnap] = await Promise.all([
    getCountFromServer(filesRef),
    getCountFromServer(query(filesRef, where('source', '==', 'local'))),
    getCountFromServer(query(filesRef, where('source', '==', 'drive'))),
  ])
  return {
    total: totalSnap.data().count,
    local: localSnap.data().count,
    drive: driveSnap.data().count,
  }
}

/**
 * Get single file by ID
 */
export async function getFile(fileId: string): Promise<DAMFileUI | null> {
  try {
    const docRef = doc(db, FILES_COLLECTION, fileId)
    const docSnap = await getDoc(docRef)

    if (docSnap.exists()) {
      const data = docSnap.data() as DAMFile
      // Convert Timestamp objects to milliseconds
      if (data.modifiedAt && typeof data.modifiedAt === 'object' && 'toMillis' in data.modifiedAt) {
        data.modifiedAt = (data.modifiedAt as any).toMillis()
      }
      if (data.createdAt && typeof data.createdAt === 'object' && 'toMillis' in data.createdAt) {
        data.createdAt = (data.createdAt as any).toMillis()
      }
      if (data.uploadedAt && typeof data.uploadedAt === 'object' && 'toMillis' in data.uploadedAt) {
        data.uploadedAt = (data.uploadedAt as any).toMillis()
      }
      return enrichFile(data)
    }
    return null
  } catch (error) {
    console.error('Error getting file:', error)
    throw error
  }
}

/**
 * Create new file document
 */
export async function createFile(file: Omit<DAMFile, 'fileId'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, FILES_COLLECTION), file)
    return docRef.id
  } catch (error) {
    console.error('Error creating file:', error)
    throw error
  }
}

/**
 * Update file metadata
 */
export async function updateFile(
  fileId: string,
  updates: Partial<DAMFile>
): Promise<void> {
  try {
    const docRef = doc(db, FILES_COLLECTION, fileId)
    await updateDoc(docRef, updates)
  } catch (error) {
    console.error('Error updating file:', error)
    throw error
  }
}

/**
 * Keeps the `tags` collection's usageCount in sync with tags actually
 * present on files — getTags() (used by the tag filter and search
 * autocomplete) reads from this collection, not by scanning every file.
 * setDoc with merge upserts: a tag used for the first time gets its doc
 * created here, not just incremented.
 */
async function bumpTagUsage(tagName: string, delta: number): Promise<void> {
  const tagRef = doc(db, TAGS_COLLECTION, tagName)
  await setDoc(
    tagRef,
    { tagId: tagName, displayName: tagName, usageCount: increment(delta) },
    { merge: true }
  )
}

/**
 * Add tags to file
 */
export async function addTagsToFile(fileId: string, tags: string[]): Promise<void> {
  try {
    const file = await getFile(fileId)
    if (file) {
      const newTags = tags.filter((t) => !file.tags.includes(t))
      if (newTags.length === 0) return
      const updated = new Set([...file.tags, ...newTags])
      await updateFile(fileId, { tags: Array.from(updated) })
      await Promise.all(newTags.map((t) => bumpTagUsage(t, 1)))
    }
  } catch (error) {
    console.error('Error adding tags:', error)
    throw error
  }
}

/**
 * Remove a tag from file
 */
export async function removeTagFromFile(fileId: string, tag: string): Promise<void> {
  try {
    const file = await getFile(fileId)
    if (file) {
      const updated = file.tags.filter((t) => t !== tag)
      if (updated.length === file.tags.length) return
      await updateFile(fileId, { tags: updated })
      await bumpTagUsage(tag, -1)
    }
  } catch (error) {
    console.error('Error removing tag:', error)
    throw error
  }
}

/**
 * Update copyright/license/usage rights on a file.
 * Restricted to admin/super_admin by Firestore security rules.
 */
export async function updateFileRights(
  fileId: string,
  rights: {
    owner?: string
    licenseType?: string
    expirationDate?: number | null
    usageRights?: string
    productionCompany?: string
    department?: string
    contactPerson?: string
  }
): Promise<void> {
  try {
    const file = await getFile(fileId)
    if (!file) return

    // `any` because expirationDate may hold a Firestore deleteField() sentinel,
    // which isn't assignable to the plain `number` type on DAMFile.
    const updates: any = {}

    if (
      rights.owner !== undefined ||
      rights.productionCompany !== undefined ||
      rights.department !== undefined ||
      rights.contactPerson !== undefined
    ) {
      updates.copyright = {
        ...file.copyright,
        ...(rights.owner !== undefined ? { owner: rights.owner } : {}),
        ...(rights.productionCompany !== undefined ? { productionCompany: rights.productionCompany } : {}),
        ...(rights.department !== undefined ? { department: rights.department } : {}),
        ...(rights.contactPerson !== undefined ? { contactPerson: rights.contactPerson } : {}),
      }
    }

    if (rights.licenseType !== undefined || rights.expirationDate !== undefined) {
      // `license` is written as a whole map (the key is "license", not a
      // "license.expirationDate" path), so clearing the date is just
      // omitting it here rather than needing a deleteField() sentinel.
      const { expirationDate: _drop, ...licenseWithoutExpiration } = file.license
      updates.license = {
        ...(rights.expirationDate === null ? licenseWithoutExpiration : file.license),
        ...(rights.licenseType !== undefined ? { type: rights.licenseType as DAMFile['license']['type'] } : {}),
        ...(rights.expirationDate !== undefined && rights.expirationDate !== null
          ? { expirationDate: rights.expirationDate }
          : {}),
      }
    }

    if (rights.usageRights !== undefined) {
      updates.usage = { ...file.usage, usage_rights: rights.usageRights }
    }

    await updateFile(fileId, updates)
  } catch (error) {
    console.error('Error updating file rights:', error)
    throw error
  }
}

/**
 * Delete file document
 */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    const docRef = doc(db, FILES_COLLECTION, fileId)
    await deleteDoc(docRef)
  } catch (error) {
    console.error('Error deleting file:', error)
    throw error
  }
}

// ============================================================================
// SCANS OPERATIONS
// ============================================================================

/**
 * Convert Firestore Timestamp to milliseconds
 */
function convertTimestamp(value: any): number {
  if (value instanceof Timestamp) {
    return value.toMillis()
  }
  return value
}

/**
 * Get scan history
 */
export async function getScanHistory(limit_count: number = 20): Promise<DAMScan[]> {
  try {
    const q = query(
      collection(db, SCANS_COLLECTION),
      orderBy('completedAt', 'desc'),
      limit(limit_count)
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => {
      const data = doc.data() as DAMScan
      return {
        ...data,
        startedAt: convertTimestamp(data.startedAt),
        completedAt: data.completedAt ? convertTimestamp(data.completedAt) : undefined,
      }
    })
  } catch (error) {
    console.error('Error getting scan history:', error)
    throw error
  }
}

/**
 * Get latest scan for source
 */
export async function getLatestScan(source: 'local' | 'drive'): Promise<DAMScan | null> {
  try {
    const q = query(
      collection(db, SCANS_COLLECTION),
      where('source', '==', source),
      where('status', '==', 'completed'),
      orderBy('completedAt', 'desc'),
      limit(1)
    )
    const snapshot = await getDocs(q)
    const data = snapshot.docs[0]?.data() as DAMScan
    if (!data) return null
    return {
      ...data,
      startedAt: convertTimestamp(data.startedAt),
      completedAt: data.completedAt ? convertTimestamp(data.completedAt) : undefined,
    }
  } catch (error) {
    console.error('Error getting latest scan:', error)
    throw error
  }
}

/**
 * Create new scan document
 */
export async function createScan(scan: Omit<DAMScan, 'scanId'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, SCANS_COLLECTION), scan)
    return docRef.id
  } catch (error) {
    console.error('Error creating scan:', error)
    throw error
  }
}

/**
 * Update scan status
 */
export async function updateScan(
  scanId: string,
  updates: Partial<DAMScan>
): Promise<void> {
  try {
    const docRef = doc(db, SCANS_COLLECTION, scanId)
    await updateDoc(docRef, updates)
  } catch (error) {
    console.error('Error updating scan:', error)
    throw error
  }
}

// ============================================================================
// CHANGES OPERATIONS
// ============================================================================

/**
 * Get changes from scan
 */
export async function getChangesByScan(scanId: string): Promise<DAMChange[]> {
  try {
    const q = query(
      collection(db, CHANGES_COLLECTION),
      where('scanId', '==', scanId),
      orderBy('detectedAt', 'desc')
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => doc.data() as DAMChange)
  } catch (error) {
    console.error('Error getting changes:', error)
    throw error
  }
}

/**
 * Create change record
 */
export async function createChange(change: Omit<DAMChange, 'changeId'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, CHANGES_COLLECTION), change)
    return docRef.id
  } catch (error) {
    console.error('Error creating change:', error)
    throw error
  }
}

// ============================================================================
// TAGS OPERATIONS
// ============================================================================

/**
 * Get all managed tags
 */
export async function getTags(): Promise<DAMTag[]> {
  try {
    const q = query(
      collection(db, TAGS_COLLECTION),
      orderBy('usageCount', 'desc')
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => doc.data() as DAMTag)
  } catch (error) {
    console.error('Error getting tags:', error)
    throw error
  }
}

/**
 * Create new tag
 */
export async function createTag(tag: Omit<DAMTag, 'tagId'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, TAGS_COLLECTION), tag)
    return docRef.id
  } catch (error) {
    console.error('Error creating tag:', error)
    throw error
  }
}

export default {
  searchFiles,
  getFileCounts,
  getFile,
  createFile,
  updateFile,
  addTagsToFile,
  removeTagFromFile,
  updateFileRights,
  deleteFile,
  getScanHistory,
  getLatestScan,
  createScan,
  updateScan,
  getChangesByScan,
  createChange,
  getTags,
  createTag,
}
