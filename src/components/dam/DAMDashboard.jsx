import { useState, useEffect, useRef } from 'react'
import { httpsCallable } from 'firebase/functions'
import damService, { getScanHistory } from '../../services/damService'
import { functions } from '../../firebase'
import FileGallery from './FileGallery'
import SearchFilters from './SearchFilters'
import FileDetail from './FileDetail'
import ScanTimeline from './ScanTimeline'
import HeroAnimation from './HeroAnimation'
import VideoPreview from './VideoPreview'
import { useAuth } from '../../auth/AuthProvider'

const SCAN_SOURCE_OPTIONS = [
  { value: 'local', label: '📂 Yerel Klasör' },
  { value: 'drive', label: '☁️ Google Drive' },
  { value: 'both', label: '🔄 İkisi de' },
]

// Files displayed per page vs. how many raw Firestore docs are pulled per
// fetch — batch > page so most page turns are served from an already-loaded
// batch instead of a fresh round trip.
const PAGE_SIZE = 60
const FETCH_BATCH_SIZE = 100

export default function DAMDashboard() {
  const { userProfile } = useAuth()
  const isSuperAdmin = userProfile?.role === 'super_admin'

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
    dateRange: null,
    licenseType: [],
    sortBy: 'modifiedAt',
    sortOrder: 'desc',
  })

  // Detail panel state
  const [selectedFile, setSelectedFile] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showLightbox, setShowLightbox] = useState(false)

  // Scan timeline (sidebar)
  const [scanHistory, setScanHistory] = useState([])

  // Scan control state
  const [currentScan, setCurrentScan] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [scanSource, setScanSource] = useState('both')
  const [forceFlag, setForceFlag] = useState(false)
  const [archiveRoot, setArchiveRoot] = useState('/Users/okilavuz/Desktop/Omer/TK-2026')
  const [scanError, setScanError] = useState(null)

  // Load the first page whenever filters change
  useEffect(() => {
    loadFiles()
  }, [filters])

  // Load scan history on mount
  useEffect(() => {
    loadScanHistory()
  }, [])

  // Archive-wide totals, independent of filters/pagination — loaded once,
  // then refreshed whenever a scan finishes (new files may have appeared).
  useEffect(() => {
    loadFileCounts()
  }, [])

  async function loadFileCounts() {
    try {
      const counts = await damService.getFileCounts()
      setFileCounts(counts)
    } catch (err) {
      console.error('Dosya sayıları alınamadı:', err)
    }
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
      // Reflect the latest known scan in the status card unless a scan
      // triggered by this session is actively running.
      if (!isScanning) {
        setCurrentScan(scanList[0] || null)
      }
    } catch (err) {
      console.error('Tarama geçmişi yüklenemedi:', err)
    }
  }

  async function handleStartScan() {
    if (isScanning) return
    if (!archiveRoot.trim()) {
      setScanError('Lütfen arşiv kök dizinini belirtiniz')
      return
    }

    setIsScanning(true)
    setScanError(null)

    try {
      const startScan = httpsCallable(functions, 'startScan')
      const result = await startScan({
        archiveRoot: archiveRoot.trim(),
        scanType: scanSource
      })

      // Poll for status
      const getScanStatus = httpsCallable(functions, 'getScanStatus')
      const pollInterval = setInterval(async () => {
        try {
          const statusResult = await getScanStatus({ jobId: result.data.jobId })

          if (statusResult.data.status === 'completed' || statusResult.data.status === 'failed') {
            clearInterval(pollInterval)
            setIsScanning(false)

            if (statusResult.data.status === 'completed') {
              // Refresh scan history
              const history = await getScanHistory()
              setScanHistory(history)
              setCurrentScan(history[0] || null)
              await loadFiles()
              await loadFileCounts()
            } else {
              setScanError('Scan failed: ' + statusResult.data.error)
            }
          }
        } catch (pollErr) {
          console.error('Poll error:', pollErr)
        }
      }, 2000) // Poll every 2 seconds
    } catch (err) {
      setScanError(err.message || 'Tarama başarısız oldu')
      setIsScanning(false)
    }
  }

  function handleRerunScan(scan) {
    if (isScanning) return
    setScanSource(scan.source || scan.scanType)
    setArchiveRoot(scan.archiveRoot || '')
    // Defer to next tick so the state settles first.
    setTimeout(() => handleStartScan(), 0)
  }

  function handleFileSelect(file) {
    setSelectedFile(file)
    setShowDetail(true)
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
    setFilters({ ...filters, ...newFilters })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      {/* Header — the animation carries the title, so this is the only header block */}
      <div className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <HeroAnimation height={120} />
      </div>

      {/* Scan Control Section — running a scan touches every file in the
          archive and can trigger real cost (see the auto-tagging incident
          this system has already had once), so it's restricted to
          super_admin rather than any authenticated admin. */}
      {isSuperAdmin && (
        <div className="max-w-7xl mx-auto px-6 pt-8">
          <ScanControlPanel
            currentScan={currentScan}
            isScanning={isScanning}
            scanSource={scanSource}
            forceFlag={forceFlag}
            archiveRoot={archiveRoot}
            scanError={scanError}
            scanHistory={scanHistory}
            onSourceChange={setScanSource}
            onForceFlagChange={setForceFlag}
            onArchiveRootChange={setArchiveRoot}
            onStartScan={handleStartScan}
            onRerunScan={handleRerunScan}
          />
        </div>
      )}

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar: Filters + Timeline */}
        <div className="lg:col-span-1 space-y-6">
          <SearchFilters filters={filters} onChange={handleFilterChange} />
          <ScanTimeline scans={scanHistory} />
        </div>

        {/* Center: File Gallery — widens to reclaim the detail panel's column when it's closed.
            Kept at a fixed 2/1 split regardless of file type: FileGallery's own thumbnail grid
            uses viewport-width breakpoints (sm:/lg:grid-cols-N), not container queries, so
            shrinking its column further makes it try to fit the same column count into less
            space and the thumbnails start overlapping. Drive videos get a wide, unconstrained
            player via the lightbox instead of trying to widen this column — see FileDetail.jsx. */}
        <div className={showDetail && selectedFile ? 'lg:col-span-2' : 'lg:col-span-3'}>
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
              fileCounts={fileCounts}
              onFileSelect={handleFileSelect}
              loading={loading}
              onRefresh={loadFiles}
              pageIndex={pageIndex}
              hasNextPage={hasNextPage}
              hasPrevPage={hasPrevPage}
              pageLoading={pageLoading}
              onNextPage={handleNextPage}
              onPrevPage={handlePrevPage}
            />
          )}
        </div>

        {/* Right Sidebar: File Detail */}
        {showDetail && selectedFile && (
          <div className="lg:col-span-1">
            <FileDetail
              file={selectedFile}
              onClose={() => setShowDetail(false)}
              onOpenLightbox={() => setShowLightbox(true)}
              onShowPreview={() => setShowLightbox(true)}
              onFileUpdate={handleFileUpdate}
            />
          </div>
        )}
      </div>

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

// ============================================================================
// Scan Control Panel — status card, start-scan controls, recent scans
// ============================================================================

const SCAN_STATUS_STYLES = {
  running: {
    label: '⏳ Çalışıyor',
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  },
  queued: {
    label: '⏸ Sırada',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  },
  completed: {
    label: '✓ Tamamlandı',
    badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  failed: {
    label: '✕ Başarısız',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
}

const SCAN_SOURCE_LABELS = {
  local: '📂 Yerel Klasör',
  drive: '☁️ Google Drive',
  both: '🔄 Yerel + Drive',
}

function formatScanTimestamp(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatScanDuration(ms) {
  if (!ms && ms !== 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}sn`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}dk ${remainingSeconds}sn`
}

function ScanControlPanel({
  currentScan,
  isScanning,
  scanSource,
  forceFlag,
  archiveRoot,
  scanError,
  scanHistory,
  onSourceChange,
  onForceFlagChange,
  onArchiveRootChange,
  onStartScan,
  onRerunScan,
}) {
  const recentScans = (scanHistory || []).slice(0, 5)

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-white">
          🔍 Tarama Kontrolü
        </h3>
      </div>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scan Status Card */}
        <div className="lg:col-span-1">
          <ScanStatusCard scan={currentScan} />
        </div>

        {/* Start Scan Controls */}
        <div className="lg:col-span-1">
          <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
            Yeni Tarama Başlat
          </h4>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Arşiv Kök Dizini *
              </label>
              <input
                type="text"
                value={archiveRoot}
                onChange={(e) => onArchiveRootChange(e.target.value)}
                disabled={isScanning}
                placeholder="Örn: /Volumes/Arsiv"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-400"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sonradan değiştirebilirsiniz
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Kaynak
              </label>
              <select
                value={scanSource}
                onChange={(e) => onSourceChange(e.target.value)}
                disabled={isScanning}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {SCAN_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={forceFlag}
                onChange={(e) => onForceFlagChange(e.target.checked)}
                disabled={isScanning}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="ml-2 text-sm text-slate-700 dark:text-slate-300">
                Tam Tarama (Force)
              </span>
            </label>

            <button
              onClick={onStartScan}
              disabled={isScanning}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
            >
              {isScanning ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                  Taranıyor...
                </>
              ) : (
                'Taramayı Başlat'
              )}
            </button>

            {scanError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-xs text-red-800 dark:text-red-200">
                  {scanError}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Scans List */}
        <div className="lg:col-span-1">
          <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
            Son Taramalar
          </h4>

          {recentScans.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Henüz tarama yapılmadı
            </p>
          )}

          {recentScans.length > 0 && (
            <ul className="space-y-2">
              {recentScans.map((scan, idx) => {
                const style = SCAN_STATUS_STYLES[scan.status] || SCAN_STATUS_STYLES.queued
                return (
                  <li
                    key={scan.scanId || idx}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {SCAN_SOURCE_LABELS[scan.source] || scan.source}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatScanTimestamp(scan.completedAt || scan.startedAt)}
                        {scan.results ? ` • ${scan.results.totalFiles} dosya` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => onRerunScan(scan)}
                      disabled={isScanning}
                      title="Aynı kaynakla yeniden tara"
                      className="shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
                    >
                      ↻ Tekrar Tara
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function ScanStatusCard({ scan }) {
  if (!scan) {
    return (
      <div className="h-full flex flex-col justify-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4">
        Henüz tarama yapılmadı. Başlamak için "Taramayı Başlat" düğmesini kullanın.
      </div>
    )
  }

  const style = SCAN_STATUS_STYLES[scan.status] || SCAN_STATUS_STYLES.queued
  const duration = formatScanDuration(scan.duration)

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 h-full">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {SCAN_SOURCE_LABELS[scan.source] || scan.source}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Başlangıç: {formatScanTimestamp(scan.startedAt)}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${style.badge}`}>
          {style.label}
        </span>
      </div>

      {scan.status === 'running' && (
        <div className="mt-3">
          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <div className="bg-blue-500 h-1.5 rounded-full w-1/3 animate-pulse"></div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tarama sürüyor, bu işlem birkaç dakika alabilir...
          </p>
        </div>
      )}

      {scan.status === 'completed' && scan.results && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-2">
            <div className="font-semibold text-slate-900 dark:text-white">
              {scan.results.totalFiles}
            </div>
            <div className="text-slate-500 dark:text-slate-400">Toplam dosya</div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded p-2">
            <div className="font-semibold text-green-800 dark:text-green-300">
              +{scan.results.newFiles}
            </div>
            <div className="text-green-700 dark:text-green-400">Yeni dosya</div>
          </div>
          {duration && (
            <div className="col-span-2 text-slate-500 dark:text-slate-400">
              Süre: {duration}
            </div>
          )}
        </div>
      )}

      {scan.status === 'failed' && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          {scan.errors && scan.errors.length > 0
            ? scan.errors[0]
            : 'Tarama sırasında bir hata oluştu.'}
        </p>
      )}
    </div>
  )
}

// File Preview Component (Lightbox)
function FilePreview({ file, onClose }) {
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
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            className="w-full h-full object-contain"
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

        {/* File info overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-white">
          <h3 className="font-semibold">{file.name}</h3>
          <p className="text-sm opacity-75">{file.sizeFormatted}</p>
        </div>
      </div>
    </div>
  )
}
