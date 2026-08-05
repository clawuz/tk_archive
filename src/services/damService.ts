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
  query,
  where,
  orderBy,
  limit,
  Query,
  DocumentSnapshot,
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
  return {
    ...file,
    sizeFormatted: formatFileSize(file.size),
    dateFormatted: formatDate(file.modifiedAt),
    thumbnailUrl: file.thumbnail?.url || '/placeholder-thumbnail.jpg',
    sourceLabel: file.source === 'local' ? 'Yerel' : 'Google Drive',
    isExpired: file.license?.expirationDate
      ? file.license.expirationDate < Date.now()
      : false,
  }
}

// ============================================================================
// FILES OPERATIONS
// ============================================================================

/**
 * Get all files with filters and pagination
 */
export async function searchFiles(
  filters: DAMSearchFilters
): Promise<{ files: DAMFileUI[]; total: number }> {
  let q: Query = collection(db, FILES_COLLECTION)
  const queryConstraints = []

  // Build query constraints
  if (filters.sources && filters.sources.length > 0) {
    // Query by source (separate queries if multiple sources)
    // For simplicity, fetch all and filter in app
  }

  if (filters.tags && filters.tags.length > 0) {
    queryConstraints.push(where('tags', 'array-contains-any', filters.tags))
  }

  if (filters.dateRange) {
    queryConstraints.push(where('modifiedAt', '>=', filters.dateRange.from))
    queryConstraints.push(where('modifiedAt', '<=', filters.dateRange.to))
  }

  // Add sorting
  const sortField = filters.sortBy || 'modifiedAt'
  const sortDirection = filters.sortOrder === 'asc' ? 'asc' : 'desc'
  queryConstraints.push(orderBy(sortField, sortDirection))

  // Add pagination (limit only for now, use cursor-based pagination later)
  queryConstraints.push(limit(filters.limit || 50))

  // Execute query
  try {
    const snapshot = await getDocs(
      query(collection(db, FILES_COLLECTION), ...queryConstraints)
    )
    let files = snapshot.docs.map((doc) => enrichFile(doc.data() as DAMFile))

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

    return {
      files,
      total: files.length,
    }
  } catch (error) {
    console.error('Error searching files:', error)
    throw error
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
      return enrichFile(docSnap.data() as DAMFile)
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
 * Add tags to file
 */
export async function addTagsToFile(fileId: string, tags: string[]): Promise<void> {
  try {
    const file = await getFile(fileId)
    if (file) {
      const updated = new Set([...file.tags, ...tags])
      await updateFile(fileId, { tags: Array.from(updated) })
    }
  } catch (error) {
    console.error('Error adding tags:', error)
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
    return snapshot.docs.map((doc) => doc.data() as DAMScan)
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
    return snapshot.docs[0]?.data() as DAMScan
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
  getFile,
  createFile,
  updateFile,
  addTagsToFile,
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
