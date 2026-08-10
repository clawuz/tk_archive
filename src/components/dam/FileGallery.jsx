import { useState, useEffect } from 'react'
import ThumbnailCard from './ThumbnailCard'
import FileListRow from './FileListRow'
import damService from '../../services/damService'
import { useAuth } from '../../auth/AuthProvider'

const VIEW_MODE_KEY = 'tk-archive-view-mode'

export default function FileGallery({
  files, // current page only
  fileCounts = { total: 0, local: 0, drive: 0 }, // archive-wide totals, independent of pagination/filters
  onFileSelect,
  loading,
  onRefresh,
  pageIndex = 0,
  hasNextPage = false,
  hasPrevPage = false,
  pageLoading = false,
  onNextPage,
  onPrevPage,
}) {
  const { userProfile } = useAuth()
  const canEdit = userProfile?.role === 'admin' || userProfile?.role === 'super_admin'

  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem(VIEW_MODE_KEY) || 'grid'
  )

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState(null)

  function handleViewModeChange(mode) {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }

  // Selection resets whenever the underlying page changes (new search, page turn, refresh)
  useEffect(() => {
    setSelectedIds(new Set())
  }, [files])

  function handleToggleSelect(fileId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  function handleSelectAllVisible() {
    setSelectedIds(new Set(files.map((f) => f.fileId)))
  }

  function handleClearSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkAddTag() {
    const trimmed = bulkTagInput.trim()
    if (!trimmed || selectedIds.size === 0) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      await Promise.all(
        Array.from(selectedIds).map((fileId) =>
          damService.addTagsToFile(fileId, [trimmed])
        )
      )
      setBulkTagInput('')
      setSelectedIds(new Set())
      await onRefresh?.()
    } catch (err) {
      console.error('Toplu etiket eklenemedi:', err)
      setBulkError(err.message || 'Toplu etiket eklenemedi')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats — true archive-wide totals (Firestore count aggregate), independent of filters/pagination */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {fileCounts.total}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Toplam Dosya
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {fileCounts.local}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Yerel
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {fileCounts.drive}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Drive
          </div>
        </div>
      </div>

      {/* Toolbar: page info + view mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Sayfa {pageIndex + 1} • {files.length} dosya
          </span>
          {canEdit && (
            <button
              onClick={
                selectedIds.size === files.length && files.length > 0
                  ? handleClearSelection
                  : handleSelectAllVisible
              }
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {selectedIds.size === files.length && files.length > 0
                ? 'Seçimi Kaldır'
                : 'Tümünü Seç'}
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => handleViewModeChange('grid')}
            title="Kutucuk görünümü"
            aria-pressed={viewMode === 'grid'}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              viewMode === 'grid'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            ▦ Kutucuk
          </button>
          <button
            onClick={() => handleViewModeChange('list')}
            title="Liste görünümü"
            aria-pressed={viewMode === 'list'}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              viewMode === 'list'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            ☰ Liste
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {canEdit && selectedIds.size > 0 && (
        <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
            {selectedIds.size} dosya seçili
          </span>
          <input
            type="text"
            value={bulkTagInput}
            onChange={(e) => setBulkTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBulkAddTag()
            }}
            placeholder="Etiket ekle..."
            disabled={bulkBusy}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleBulkAddTag}
            disabled={bulkBusy || !bulkTagInput.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
          >
            {bulkBusy ? 'Ekleniyor...' : 'Etikete Ekle'}
          </button>
          <button
            onClick={handleClearSelection}
            disabled={bulkBusy}
            className="text-sm text-slate-600 dark:text-slate-400 hover:underline"
          >
            Seçimi Temizle
          </button>
          {bulkError && (
            <span className="text-sm text-red-600 dark:text-red-400">{bulkError}</span>
          )}
        </div>
      )}

      {/* Gallery */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {files.map((file) => (
            <ThumbnailCard
              key={file.fileId}
              file={file}
              onSelect={() => onFileSelect(file)}
              selectable={canEdit}
              selected={selectedIds.has(file.fileId)}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {files.map((file) => (
            <FileListRow
              key={file.fileId}
              file={file}
              onSelect={() => onFileSelect(file)}
              selectable={canEdit}
              selected={selectedIds.has(file.fileId)}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4 pt-2">
        <button
          onClick={onPrevPage}
          disabled={!hasPrevPage || pageLoading || loading}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg transition hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          ‹ Önceki
        </button>
        <span className="text-sm text-slate-500 dark:text-slate-400 min-w-[72px] text-center">
          Sayfa {pageIndex + 1}
        </span>
        <button
          onClick={onNextPage}
          disabled={!hasNextPage || pageLoading || loading}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg transition hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          {pageLoading ? 'Yükleniyor...' : 'Sonraki ›'}
        </button>
      </div>
    </div>
  )
}
