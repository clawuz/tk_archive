import { useState, useEffect, useRef } from 'react'
import damService, { getScanHistory } from '../../services/damService'
import FileGallery from './FileGallery'
import SearchFilters from './SearchFilters'
import SearchBar from './SearchBar'
import FileDetail from './FileDetail'
import ScanTimeline from './ScanTimeline'
import HeroAnimation from './HeroAnimation'
import UsersPanel from './UsersPanel'
import VideoPreview from './VideoPreview'
import { getImagePreviewUrl } from '../../services/streamingService'
import {
  getFavoriteIds,
  getRecentlyViewedIds,
  addRecentlyViewed,
  onFavoritesChanged,
} from '../../services/favoritesService'
import { FolderIcon, CloudIcon } from '../icons'

// Files displayed per page vs. how many raw Firestore docs are pulled per
// fetch — batch > page so most page turns are served from an already-loaded
// batch instead of a fresh round trip.
const PAGE_SIZE = 60
const FETCH_BATCH_SIZE = 100

export default function DAMDashboard() {
  // Gallery state — loadedFiles accumulates every filtered file fetched so
  // far across visited pages (an archive of thousands never loads at once;
  // Firestore is paged with a cursor, one or two batches ahead of the page
  // the user is on). See fetchUntil/ensurePage below.
  const [loadedFiles, setLoadedFiles] = useState([])
  const [pageIndex, setPageIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState(null)
  // Archive-wide totals — independent of pagination/filters, see loadFileCounts.
  const [fileCounts, setFileCounts] = useState({ total: 0, local: 0, drive: 0 })
  const [typeCounts, setTypeCounts] = useState(null)

  // Hero view-switcher: 'all' runs the normal filtered/paginated query below;
  // 'favorites'/'recent' short-circuit it and load a small, specific set of
  // fileIds instead (see loadSpecialView) — see favoritesService.js for why
  // this is localStorage-backed rather than a new Firestore collection.
  const [activeView, setActiveView] = useState('all')
  const [viewCounts, setViewCounts] = useState({ all: 0, favorites: 0, recent: 0 })
  const cursorRef = useRef(null)
  const rawExhaustedRef = useRef(false)
  // Bumped at the start of every loadFiles() call; fetchUntil's caller
  // compares its own snapshot against the live value once the (possibly
  // slow) fetch resolves, and discards the result if a newer search has
  // since started. Without this, typing fast fires overlapping searches
  // and whichever happens to resolve last wins — not necessarily the most
  // recent one — visible as results flashing correct then reverting.
  const requestIdRef = useRef(0)
  const [filters, setFilters] = useState({
    query: '',
    sources: ['local', 'drive'],
    tags: [],
    type: [],
    dateRange: null,
    licenseType: [],
    sortBy: 'modifiedAt',
    sortOrder: 'desc',
  })

  // Detail panel state
  const [selectedFile, setSelectedFile] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showLightbox, setShowLightbox] = useState(false)
  const [showUsers, setShowUsers] = useState(false)

  // Scan timeline (sidebar) — read-only, sourced from the `scans` collection
  // that the local CLI scanners write to directly (there is no in-app scan
  // trigger).
  const [scanHistory, setScanHistory] = useState([])

  // Load the first page whenever filters change, or the hero tab switches —
  // 'all' runs the real filtered query; 'favorites'/'recent' load their own
  // small fixed set instead (see loadSpecialView).
  useEffect(() => {
    if (activeView === 'all') {
      loadFiles()
    } else {
      loadSpecialView(activeView)
    }
  }, [filters, activeView])

  // Load scan history on mount
  useEffect(() => {
    loadScanHistory()
  }, [])

  // Escape closes the detail modal — but not while the lightbox is layered
  // on top of it (showLightbox true), so Escape closes the topmost thing
  // first instead of both at once.
  useEffect(() => {
    if (!showDetail || showLightbox) return
    function handleKey(e) {
      if (e.key === 'Escape') setShowDetail(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [showDetail, showLightbox])

  // Archive-wide totals, independent of filters/pagination — loaded once,
  // then refreshed whenever a scan finishes (new files may have appeared).
  useEffect(() => {
    loadFileCounts()
    loadTypeCounts()
  }, [])

  // Favorites count in the hero tab needs to react to stars toggled from
  // inside the gallery cards, not just on mount.
  useEffect(() => {
    refreshViewCounts()
    return onFavoritesChanged(refreshViewCounts)
  }, [])

  useEffect(() => {
    setViewCounts((prev) => ({ ...prev, all: fileCounts.total }))
  }, [fileCounts.total])

  function refreshViewCounts() {
    setViewCounts((prev) => ({
      ...prev,
      favorites: getFavoriteIds().length,
      recent: getRecentlyViewedIds().length,
    }))
  }

  async function loadFileCounts() {
    try {
      const counts = await damService.getFileCounts()
      setFileCounts(counts)
    } catch (err) {
      console.error('Dosya sayıları alınamadı:', err)
    }
  }

  async function loadTypeCounts() {
    try {
      const counts = await damService.getFileTypeCounts()
      setTypeCounts(counts)
    } catch (err) {
      console.error('Tür kırılımı alınamadı:', err)
    }
  }

  // Favorites/Recently-Viewed aren't a Firestore filter — they're a fixed,
  // small list of fileIds from localStorage — so this bypasses the
  // cursor-based fetchUntil/ensurePage pagination entirely rather than
  // trying to express "these 30 specific IDs" as a searchFiles() query.
  async function loadSpecialView(view) {
    const myRequestId = ++requestIdRef.current
    setPageIndex(0)
    setLoading(true)
    try {
      const ids = view === 'favorites' ? getFavoriteIds() : getRecentlyViewedIds()
      const files = (await Promise.all(ids.map((id) => damService.getFile(id)))).filter(Boolean)
      if (myRequestId !== requestIdRef.current) return
      cursorRef.current = null
      rawExhaustedRef.current = true
      setLoadedFiles(files)
      setError(null)
    } catch (err) {
      if (myRequestId !== requestIdRef.current) return
      setError(err.message || 'Dosyalar yüklenemedi')
      console.error(err)
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false)
    }
  }

  function handleViewChange(view) {
    setActiveView(view)
  }

  // Fetches raw batches from Firestore (via damService.searchFiles) — each
  // batch is filtered client-side before being appended — until the buffer
  // has at least `minCount` files or there are no more raw documents left.
  // Cursor/exhausted are threaded through as plain values, not shared refs,
  // so two overlapping calls (e.g. from fast typing) never read or clobber
  // each other's pagination state mid-flight.
  async function fetchUntil(minCount, buffer, startCursor, startExhausted) {
    let acc = buffer
    let cursor = startCursor
    let exhausted = startExhausted
    while (acc.length < minCount && !exhausted) {
      const result = await damService.searchFiles(filters, cursor, FETCH_BATCH_SIZE)
      cursor = result.lastDoc
      if (result.rawCount < FETCH_BATCH_SIZE) exhausted = true
      if (result.rawCount === 0) break
      acc = [...acc, ...result.files]
    }
    return { files: acc, cursor, exhausted }
  }

  // Resets the pagination cursor/buffer and loads the first page (plus one
  // page ahead, so "hasNextPage" is known without an extra round trip).
  async function loadFiles() {
    const myRequestId = ++requestIdRef.current
    setPageIndex(0)
    setLoading(true)
    try {
      const { files: buffer, cursor, exhausted } = await fetchUntil(PAGE_SIZE * 2, [], null, false)
      if (myRequestId !== requestIdRef.current) return // a newer search started meanwhile — discard
      cursorRef.current = cursor
      rawExhaustedRef.current = exhausted
      setLoadedFiles(buffer)
      setError(null)
    } catch (err) {
      if (myRequestId !== requestIdRef.current) return
      setError(err.message || 'Dosyalar yüklenemedi')
      console.error(err)
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false)
    }
  }

  // Ensures loadedFiles has enough files buffered to display targetPageIndex
  // plus one page ahead (to know whether a "next" page exists).
  async function ensurePage(targetPageIndex) {
    const needed = (targetPageIndex + 2) * PAGE_SIZE
    if (loadedFiles.length >= needed || rawExhaustedRef.current) return
    const myRequestId = requestIdRef.current // paginating the current search, not starting a new one — still discard if a new search supersedes it
    setPageLoading(true)
    try {
      const { files: buffer, cursor, exhausted } = await fetchUntil(needed, loadedFiles, cursorRef.current, rawExhaustedRef.current)
      if (myRequestId !== requestIdRef.current) return
      cursorRef.current = cursor
      rawExhaustedRef.current = exhausted
      setLoadedFiles(buffer)
    } catch (err) {
      if (myRequestId !== requestIdRef.current) return
      console.error('Sonraki sayfa yüklenemedi:', err)
    } finally {
      if (myRequestId === requestIdRef.current) setPageLoading(false)
    }
  }

  async function handleNextPage() {
    const target = pageIndex + 1
    await ensurePage(target)
    setPageIndex(target)
  }

  function handlePrevPage() {
    setPageIndex((p) => Math.max(0, p - 1))
  }

  const pageFiles = loadedFiles.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)
  const hasNextPage = loadedFiles.length > (pageIndex + 1) * PAGE_SIZE
  const hasPrevPage = pageIndex > 0

  async function loadScanHistory() {
    try {
      const scanList = await getScanHistory(10)
      setScanHistory(scanList)
    } catch (err) {
      console.error('Tarama geçmişi yüklenemedi:', err)
    }
  }

  function handleFileSelect(file) {
    setSelectedFile(file)
    setShowDetail(true)
    addRecentlyViewed(file.fileId)
    if (activeView === 'recent') refreshViewCounts()
  }

  // FileDetail writes tag/rights edits straight to Firestore, but
  // loadedFiles (the page's own cache) never heard about it — re-selecting
  // the same file later handed back the pre-edit data. This is FileDetail's
  // onFileUpdate: patch both the cache and the currently-selected file with
  // whatever actually changed.
  function handleFileUpdate(fileId, updates) {
    setLoadedFiles((prev) => prev.map((f) => (f.fileId === fileId ? { ...f, ...updates } : f)))
    setSelectedFile((prev) => (prev && prev.fileId === fileId ? { ...prev, ...updates } : prev))
  }

  function handleFilterChange(newFilters) {
    // Functional update: the search box debounces its onChange (350ms) while
    // the tag checkboxes fire immediately, so a debounced callback scheduled
    // before a checkbox click can still be holding a stale `filters` closure
    // when it commits — merging against that stale value silently dropped
    // whichever filter changed first (e.g. a just-checked tag reverting to
    // unchecked). Merging against the latest state instead of the closure
    // fixes that regardless of ordering.
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      {/* Header — the animation carries the title, so this is the only header block */}
      <div className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <HeroAnimation
          activeView={activeView}
          onViewChange={handleViewChange}
          viewCounts={viewCounts}
          onOpenUsers={() => setShowUsers(true)}
        />
      </div>

      {/* Archive-wide stats — total + source breakdown + type tiles. Real
          counts (getFileCounts/getFileTypeCounts), just surfaced prominently
          instead of buried mid-page — see the "üst bilgi şeridi" plan. */}
      <div className="max-w-7xl mx-auto px-6 pt-8">
        <ArchiveStatsBar fileCounts={fileCounts} typeCounts={typeCounts} />
      </div>

      {/* The page's dominant search element — full width, visible to every
          user (unlike the scan panel below, which is super_admin-only).
          Secondary filters (source/tags/date/license) stay in the sidebar. */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <SearchBar filters={filters} onChange={handleFilterChange} />
      </div>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar: Filters + Timeline */}
        <div className="lg:col-span-1 space-y-6">
          <SearchFilters filters={filters} onChange={handleFilterChange} />
          {/* Mobile stacks this sidebar above the gallery (grid-cols-1), so
              the scan history ate the whole first screen before any files
              were visible — desktop-only where it sits beside the gallery
              instead of on top of it. */}
          <div className="hidden lg:block">
            <ScanTimeline scans={scanHistory} />
          </div>
        </div>

        {/* Center: File Gallery — full width always now that the detail view
            is an overlay modal (see below) rather than a column that used to
            steal grid space; the "does it fit" tension with FileGallery's
            viewport-width breakpoints (sm:/lg:grid-cols-N) this note used to
            describe no longer applies. */}
        <div className="lg:col-span-3">
          {error && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-slate-600 dark:text-slate-400">
                Yükleniyor...
              </span>
            </div>
          )}

          {!loading && loadedFiles.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500 dark:text-slate-400">
                Dosya bulunamadı
              </p>
            </div>
          )}

          {!loading && loadedFiles.length > 0 && (
            <FileGallery
              files={pageFiles}
              onFileSelect={handleFileSelect}
              loading={loading}
              onRefresh={() => (activeView === 'all' ? loadFiles() : loadSpecialView(activeView))}
              pageIndex={pageIndex}
              hasNextPage={hasNextPage}
              hasPrevPage={hasPrevPage}
              pageLoading={pageLoading}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
            />
          )}
        </div>

      </div>

      {showUsers && <UsersPanel onClose={() => setShowUsers(false)} />}

      {/* File Detail — a large modal over the result grid rather than a
          column that used to shrink the gallery and force scrolling back
          up to see it change. Search/filter state underneath is untouched,
          so closing this returns to exactly where browsing left off. */}
      {showDetail && selectedFile && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDetail(false)
          }}
        >
          <div className="w-full sm:max-w-3xl sm:my-8 bg-white dark:bg-slate-800 sm:rounded-xl shadow-2xl min-h-screen sm:min-h-0 sm:max-h-[88vh] flex flex-col">
            <FileDetail
              file={selectedFile}
              onClose={() => setShowDetail(false)}
              onOpenLightbox={() => setShowLightbox(true)}
              onShowPreview={() => setShowLightbox(true)}
              onFileUpdate={handleFileUpdate}
            />
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {showLightbox && selectedFile && (
        <FilePreview
          file={selectedFile}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </div>
  )
}

const TYPE_TILES = [
  { key: 'video', label: 'Video' },
  { key: 'image', label: 'Görsel' },
  { key: 'psd', label: 'PSD' },
  { key: 'other', label: 'Diğer' },
]

function ArchiveStatsBar({ fileCounts, typeCounts }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4 mb-5">
        <div>
          <div className="text-4xl font-bold text-slate-900 dark:text-white leading-none">
            {fileCounts.total.toLocaleString('tr-TR')}
          </div>
          <div className="text-xs font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500 mt-1">
            Toplam Varlık
          </div>
        </div>
        <div className="flex gap-6 ml-auto">
          <div className="text-right">
            <div className="text-xl font-semibold text-slate-900 dark:text-white">
              {fileCounts.local.toLocaleString('tr-TR')}
            </div>
            <div className="flex items-center justify-end gap-1 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <FolderIcon size={11} /> Yerel
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold text-slate-900 dark:text-white">
              {fileCounts.drive.toLocaleString('tr-TR')}
            </div>
            <div className="flex items-center justify-end gap-1 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <CloudIcon size={11} /> Drive
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {TYPE_TILES.map((tile) => (
          <div
            key={tile.key}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3.5 py-2.5"
          >
            <div className="text-lg font-mono font-semibold text-slate-900 dark:text-white">
              {typeCounts ? typeCounts[tile.key].toLocaleString('tr-TR') : '—'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{tile.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// File Preview Component (Lightbox)
function FilePreview({ file, onClose }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Prefer the high-res Storage upload (see getImagePreviewUrl) over the
  // small inline thumbnail — falls back to the thumbnail on error, since
  // not every image has a high-res preview yet (only ones scanned/backfilled
  // after this was added). Reset whenever the file changes, since this
  // component isn't remounted when selectedFile changes while the lightbox
  // stays open (no key prop on <FilePreview> in the parent).
  const [imgSrc, setImgSrc] = useState(() => getImagePreviewUrl(file) || file.thumbnailUrl)
  useEffect(() => {
    setImgSrc(getImagePreviewUrl(file) || file.thumbnailUrl)
  }, [file])

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-black rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Preview based on file type */}
        {file.type.startsWith('image/') && (
          // Two bugs here in sequence, both from the same root cause: the
          // modal box (className below this comment's parent) has no
          // explicit height, only max-h-[90vh] — a percentage height
          // against that undefined-height ancestor resolves inconsistently.
          // First version used h-full: resolved too large in practice, so
          // overflow-hidden on the box clipped it — a crop, not a fit.
          // Fixing that by switching to max-h-[80vh] alone (no explicit
          // height demand) overcorrected: these thumbnails are tiny
          // (240px, see scanner.cjs's qlmanage -s 240) and an <img> never
          // upscales past its intrinsic size on its own, so it rendered
          // small instead of filling the available preview area.
          // h-[80vh] (a literal viewport value, not a percentage — sidesteps
          // the undefined-parent problem entirely) paired with object-contain
          // gives the image a real, large box to scale into either
          // direction: shrinks a big image to fit, enlarges a small
          // thumbnail to fill the space, crops nothing either way.
          <img
            src={imgSrc}
            onError={() => {
              if (imgSrc !== file.thumbnailUrl) setImgSrc(file.thumbnailUrl)
            }}
            alt={file.name}
            className="w-full h-[80vh] object-contain"
          />
        )}

        {file.type.startsWith('video/') && (
          // Reuses VideoPreview rather than a raw <video src={file.path}> —
          // file.path is a local filesystem path, not a loadable browser
          // URL; VideoPreview knows how to turn it into one (or fall back
          // to the Google Drive embed).
          <div className="w-full">
            <VideoPreview file={file} />
          </div>
        )}

        {file.type === 'application/pdf' && (
          <iframe
            src={file.path}
            className="w-full h-full"
            title={file.name}
          />
        )}

        {!file.type.startsWith('image/') &&
          !file.type.startsWith('video/') &&
          file.type !== 'application/pdf' && (
            <div className="w-full h-full flex items-center justify-center text-white">
              <div className="text-center">
                <p className="text-lg font-semibold mb-2">Önizleme kullanılamıyor</p>
                <p className="text-sm opacity-75">{file.type}</p>
              </div>
            </div>
          )}

        {/* File info overlay — skipped for video: it sat on top of the
            player's own controls/chrome and duplicated info already shown
            in the FileDetail panel behind this lightbox. */}
        {!file.type.startsWith('video/') && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-white">
            <h3 className="font-semibold">{file.name}</h3>
            <p className="text-sm opacity-75">{file.sizeFormatted}</p>
          </div>
        )}
      </div>
    </div>
  )
}
