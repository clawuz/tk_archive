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
  onSnapshot,
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
  DAMGroup,
  DAMSearchFilters,
  DAMFileUI,
  MediaCategory,
} from '../types/dam'

// Collection references
const FILES_COLLECTION = 'files'
const SCANS_COLLECTION = 'scans'
const CHANGES_COLLECTION = 'changes'
const TAGS_COLLECTION = 'tags'

/**
 * Mirrors lib/searchTokens.cjs (the scanners' copy) — every prefix of every
 * word in the name/tags, so free-text search can use a fast array-contains
 * query instead of scanning every raw document. Kept in sync with tags here
 * (see addTagsToFile/removeTagFromFile) rather than only at scan time, so a
 * tag added through the UI is searchable immediately, not just after a rescan.
 */
function generateSearchTokens(name: string, tags: string[], extraText = ''): string[] {
  const words = new Set<string>()
  const wordsOf = (str: string) =>
    (str || '').toLowerCase().split(/[^a-z0-9çğıöşüâîû]+/i).filter((w) => w.length >= 2)
  for (const w of wordsOf(name)) words.add(w)
  for (const t of tags || []) {
    for (const w of wordsOf(t.replace(/-/g, ' '))) words.add(w)
  }
  // AI description + on-screen text, capped like lib/searchTokens.cjs.
  let aiWords = 0
  for (const w of wordsOf(extraText)) {
    if (w.length > 24 || words.has(w)) continue
    words.add(w)
    if (++aiWords >= 300) break
  }

  const tokens = new Set<string>()
  for (const w of words) {
    for (let i = 2; i <= w.length; i++) {
      tokens.add(w.slice(0, i))
    }
  }
  return Array.from(tokens)
}

/** Description + on-screen text the local vision worker wrote (see lib/searchTokens.cjs). */
function aiSearchText(ai?: DAMFile['ai']): string {
  if (!ai) return ''
  return [ai.description, ...(ai.onScreenText || [])].filter((p) => typeof p === 'string').join(' ')
}

// Mirrors the scanners' own extension lists (scannerLocalPreview.cjs,
// scannerLocalImages.cjs) — see the comment on getFileTypeCounts() below,
// the archive-wide stats bar this file also powers.
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mts', 'm2ts']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif', 'bmp', 'heic', 'heif', 'svg', 'arw', 'cr2', 'nef', 'dng']
const DESIGN_EXTENSIONS = ['psd', 'ai', 'eps']
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']

/**
 * Buckets a file's extension into a broad category for the "Dosya Türü"
 * search filter — the raw `type` (MIME) field has 25+ distinct values
 * across the archive (checked against a 20k-file sample, 2026-09-24), too
 * granular for users to pick from, so this groups by intent instead
 * (Video/Fotoğraf/Tasarım/Belge/Diğer).
 */
function getMediaCategory(extension: string): MediaCategory {
  const ext = (extension || '').toLowerCase()
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (DESIGN_EXTENSIONS.includes(ext)) return 'design'
  if (DOCUMENT_EXTENSIONS.includes(ext)) return 'document'
  return 'other'
}

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

// Word → how many files carry it in searchTokens. Counts are cheap (server-side
// aggregation, ~1 read per 1000 index entries) and stable enough to keep for
// the session, so a query is only ever counted once per word.
const tokenCountCache = new Map<string, number>()

/**
 * Picks the word to probe Firestore with. The probe decides how many raw
 * documents the client has to page through before it has enough matches (the
 * other words are only checked client-side), so the RAREST word wins — e.g.
 * "a350 kargo" was probing "kargo" (tens of thousands of files, 66 rounds,
 * 460 MB) instead of "a350". Falls back to the longest word, which is a good
 * proxy for rarity, whenever counting is not possible.
 */
async function pickProbeWord(words: string[]): Promise<string> {
  const unique = [...new Set(words)]
  const longest = unique.reduce((l, w) => (w.length > l.length ? w : l), '')
  if (unique.length <= 1) return longest
  try {
    const counts = await Promise.all(
      unique.map(async (w) => {
        const cached = tokenCountCache.get(w)
        if (cached !== undefined) return { w, count: cached }
        const snap = await getCountFromServer(
          query(collection(db, FILES_COLLECTION), where('searchTokens', 'array-contains', w))
        )
        const count = snap.data().count
        tokenCountCache.set(w, count)
        return { w, count }
      })
    )
    // A word nobody carries (typo) wins too: the search ends immediately, empty.
    return counts.reduce((best, c) => (c.count < best.count ? c : best)).w
  } catch {
    return longest
  }
}

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

  // Firestore allows only one array-contains(-any) clause per query, so tags
  // wins when both a tag filter and free text are active — the text is still
  // applied as a post-filter below, just against a smaller, already-narrowed
  // candidate set instead of the whole collection.
  const groupFilter = filters.groups && filters.groups.length > 0
  if (groupFilter) {
    // Konu grubu seçiliyse sorguyu o belirler (array-contains tek kez kullanılabilir);
    // etiket/metin süzgeçleri aşağıda istemci tarafında uygulanır.
    queryConstraints.push(where('groups', 'array-contains-any', filters.groups!.slice(0, 30)))
  } else if (filters.tags && filters.tags.length > 0) {
    queryConstraints.push(where('tags', 'array-contains-any', filters.tags))
  } else if (filters.query && filters.query.trim().length >= 2) {
    // searchTokens holds every prefix of every word in the name/tags (see
    // generateSearchTokens above) — array-contains on one of the query's
    // words turns free-text search into a real indexed query instead of
    // scanning every raw document, which is what made rare-term search slow
    // before. Later words in a multi-word query are still checked in the
    // post-filter below for full correctness.
    // Split the same way generateSearchTokens does (including on hyphens) so
    // a query like "kabin-ici" probes for the token "kabin" instead of the
    // literal "kabin-ici", which searchTokens never contains as a single
    // entry — a plain \s+ split left hyphenated queries matching nothing.
    //
    // Probe with the LONGEST word, not the first. Real example (2026-09-16):
    // "11_A0087.MP4" split into ["11", "a0087", "mp4"] — the archive's stock
    // footage uses a common "NN_XXXX.ext" naming convention, so "11" alone
    // matches thousands of files across the whole collection. The result-set
    // fetch only pages through the collection (ordered by recency) until it
    // has ~2 pages of client-filtered matches, so the actual target file —
    // unless recently modified — never gets pulled in; the search silently
    // "finds nothing" from the user's point of view. A longer word ("a0087")
    // is statistically far rarer and narrows the Firestore candidate set
    // enough that the real match actually surfaces.
    const words = filters.query.trim().toLowerCase().split(/[^a-z0-9çğıöşüâîû]+/i).filter(w => w.length > 0)
    const probeWord = await pickProbeWord(words)
    queryConstraints.push(where('searchTokens', 'array-contains', probeWord))
  }

  // Note: sources/licenseType/dateRange are post-filtered below (not query
  // constraints) so they combine freely without a composite index for every
  // field/filter pairing.

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

    // Hide byte-identical copies (same hash) — the representative stays and
    // lists its copies in the detail panel. rawCount above is pre-filter, so
    // paging keeps fetching as with every other post-filter.
    files = files.filter((f) => !f.isDuplicate)

    // Post-query filtering (for complex filters)
    if (filters.sources && filters.sources.length > 0) {
      files = files.filter((f) => filters.sources!.includes(f.source))
    }

    if (groupFilter && filters.tags && filters.tags.length > 0) {
      files = files.filter((f) => filters.tags!.some((t) => f.tags?.includes(t)))
    }

    if (filters.type && filters.type.length > 0) {
      files = files.filter((f) => filters.type!.includes(getMediaCategory(f.extension)))
    }

    if (filters.query) {
      // Every query word must appear somewhere in the name, tags, or the AI's
      // description / on-screen text. (The Firestore probe above only proves
      // the longest word is indexed on the file.)
      const q = filters.query.toLowerCase()
      const qWords = q.split(/[^a-z0-9çğıöşüâîû]+/i).filter((w) => w.length > 0)
      files = files.filter((f) => {
        const haystack = [f.name, ...f.tags, aiSearchText(f.ai), f.duplicateSearchText || ''].join(' ').toLowerCase()
        return haystack.includes(q) || qWords.every((w) => haystack.includes(w))
      })
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
  const [totalSnap, localSnap, driveSnap, dups] = await Promise.all([
    getCountFromServer(filesRef),
    getCountFromServer(query(filesRef, where('source', '==', 'local'))),
    getCountFromServer(query(filesRef, where('source', '==', 'drive'))),
    countDuplicates(),
  ])
  // Hidden copies are all local files (hash-matched, see mark_duplicates.py).
  return {
    total: Math.max(0, totalSnap.data().count - dups),
    local: Math.max(0, localSnap.data().count - dups),
    drive: driveSnap.data().count,
  }
}

/** Number of copies hidden from the UI (isDuplicate == true), optionally for a set of extensions. */
async function countDuplicates(extensions?: string[]): Promise<number> {
  try {
    const filesRef = collection(db, FILES_COLLECTION)
    const constraints = [where('isDuplicate', '==', true)]
    if (extensions) constraints.push(where('extension', 'in', extensions))
    return (await getCountFromServer(query(filesRef, ...constraints))).data().count
  } catch (err) {
    console.error('countDuplicates failed — showing raw counts:', err)
    return 0
  }
}

/**
 * Server-side aggregate counts by asset type, for the archive-wide stats
 * bar. Extension lists mirror the scanners' own (scannerLocalPreview.cjs,
 * scannerLocalImages.cjs) — kept separate rather than imported since this
 * is frontend TS and those are CommonJS scanner scripts. Also the single
 * source of truth for getMediaCategory() above, so the "Dosya Türü" search
 * filter and this stats bar always agree on what counts as video/image.
 */
export async function getFileTypeCounts(): Promise<{ video: number; image: number; psd: number; other: number }> {
  const filesRef = collection(db, FILES_COLLECTION)
  const [totalSnap, videoSnap, imageSnap, psdSnap, dupAll, dupVideo, dupImage, dupPsd] = await Promise.all([
    getCountFromServer(filesRef),
    getCountFromServer(query(filesRef, where('extension', 'in', VIDEO_EXTENSIONS))),
    getCountFromServer(query(filesRef, where('extension', 'in', IMAGE_EXTENSIONS))),
    getCountFromServer(query(filesRef, where('extension', '==', 'psd'))),
    countDuplicates(),
    countDuplicates(VIDEO_EXTENSIONS),
    countDuplicates(IMAGE_EXTENSIONS),
    countDuplicates(['psd']),
  ])
  const video = Math.max(0, videoSnap.data().count - dupVideo)
  const image = Math.max(0, imageSnap.data().count - dupImage)
  const psd = Math.max(0, psdSnap.data().count - dupPsd)
  const total = Math.max(0, totalSnap.data().count - dupAll)
  return { video, image, psd, other: Math.max(0, total - video - image - psd) }
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
 * "Otomatik Etiketle" button. Used to call the tagNewFiles Cloud Function
 * (Claude Vision); that ran out of API credit, and the local v2 vision
 * worker on the Mac does the same job for free. A browser can't reach the
 * Mac directly, so Firestore is the bridge: this just raises two flags the
 * worker polls for. `tag_requested` is the priority queue — the worker
 * checks it between every file, so a click waits at most one file's
 * processing time instead of sitting behind the whole backlog;
 * `needs_tagging` keeps the file in the normal queue as a fallback.
 * The worker clears `tag_requested` (and writes tags/ai.*) when done —
 * watchFile() below is how the panel notices.
 */
export async function requestAutoTag(fileId: string): Promise<void> {
  await updateFile(fileId, { needs_tagging: true, tag_requested: true })
}

/**
 * "Oynatmak için yükle": asks the Mac enrichment worker (enrich.cjs) to copy
 * a light-scanned video into the streaming bucket. Firestore rules let any
 * signed-in team member set exactly this one field.
 */
export async function requestVideoUpload(fileId: string): Promise<void> {
  await updateDoc(doc(db, FILES_COLLECTION, fileId), { upload_requested: true })
}

/**
 * Live subscription to one file document; returns the unsubscribe fn.
 */
export function watchFile(
  fileId: string,
  onChange: (data: DocumentData) => void
): () => void {
  return onSnapshot(
    doc(db, FILES_COLLECTION, fileId),
    (snap) => {
      if (snap.exists()) onChange(snap.data())
    },
    (error) => console.error('watchFile error:', error)
  )
}

/**
 * Heartbeat of the Mac AI worker (ai_worker_status/main). `lastSeenMs` is
 * null until the first beat lands.
 */
export function watchWorkerStatus(
  onChange: (status: { lastSeenMs: number | null; state: string }) => void
): () => void {
  return onSnapshot(
    doc(db, 'ai_worker_status', 'main'),
    (snap) => {
      const d = snap.data()
      onChange({ lastSeenMs: d?.lastSeen?.toMillis?.() ?? null, state: d?.state ?? 'unknown' })
    },
    (error) => console.error('watchWorkerStatus error:', error)
  )
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
      const updatedTags = Array.from(new Set([...file.tags, ...newTags]))
      await updateFile(fileId, {
        tags: updatedTags,
        searchTokens: generateSearchTokens(file.name, updatedTags, aiSearchText(file.ai)),
      })
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
      await updateFile(fileId, {
        tags: updated,
        searchTokens: generateSearchTokens(file.name, updated, aiSearchText(file.ai)),
      })
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
 * Konu grupları (tag_groups) — filtre panelindeki "Konu Grupları" bölümü
 */
export async function getGroups(): Promise<DAMGroup[]> {
  try {
    const snapshot = await getDocs(collection(db, 'tag_groups'))
    return snapshot.docs
      .map((d) => ({ ...(d.data() as any), groupId: d.id }) as DAMGroup)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  } catch (error) {
    console.error('Error getting groups:', error)
    return []
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
  getFileTypeCounts,
  getFile,
  createFile,
  updateFile,
  requestAutoTag,
  requestVideoUpload,
  watchFile,
  watchWorkerStatus,
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
  getGroups,
  createTag,
}
