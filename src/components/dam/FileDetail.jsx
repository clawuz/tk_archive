import { useState, memo } from 'react'
import damService from '../../services/damService'
import * as yoloService from '../../services/yoloService'
import VideoPreview from './VideoPreview'
import FileDownload from './FileDownload'
import FolderBrowser from './FolderBrowser'

const VideoFrameGallery = memo(({ frames, loading }) => {
  if (!frames?.length) return null

  return (
    <div className="mt-6 border-t pt-6 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">
        📹 Video Ön İzleme Kareleri
      </h3>
      <div className="grid grid-cols-5 gap-3">
        {frames.map((frame, idx) => (
          <div key={idx} className="relative group overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 aspect-video">
            <img
              src={`data:image/jpeg;base64,${frame.frameData}`}
              alt={`Frame ${frame.frameNumber}`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium">
              {Math.floor(frame.timestamp)}s
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

VideoFrameGallery.displayName = 'VideoFrameGallery'

const TagDisplay = memo(({ tags, onAutoTag, tagging }) => {
  if (!tags && !onAutoTag) return null

  return (
    <div className="mt-6 border-t pt-6 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          🏷️ Etiketler
        </h3>
        {onAutoTag && (
          <button
            onClick={onAutoTag}
            disabled={tagging}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
          >
            {tagging ? '⏳ Etiketleniyor...' : '✨ Otomatik Etiketle'}
          </button>
        )}
      </div>

      {tags?.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 text-xs rounded-full font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Henüz etiket yok</p>
      )}
    </div>
  )
})

TagDisplay.displayName = 'TagDisplay'

export default function FileDetail({
  file,
  onClose,
  onOpenLightbox,
  onShowPreview,
}) {
  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [tagError, setTagError] = useState(null)

  const handleFolderNavigate = async (folderPath) => {
    try {
      setLoading(true)
      // Search for files with path starting with folderPath
      const result = await damService.searchFiles({
        sources: ['local'],
        query: folderPath,
        limit: 100,
      })

      // Filter to files in this folder and subfolders
      const filesInFolder = result.files.filter(f =>
        f.path.startsWith(folderPath + '/')
      )

      // Update gallery to show filtered files
      setFiles(filesInFolder)
    } catch (err) {
      console.error('Navigation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddTag() {
    if (newTag.trim()) {
      try {
        await damService.addTagsToFile(file.fileId, [newTag.trim()])
        setNewTag('')
        setAddingTag(false)
        // Refresh file data
      } catch (err) {
        console.error('Etiket eklenemedi:', err)
      }
    }
  }

  async function handleAutoTag() {
    try {
      setTagging(true)
      setTagError(null)
      const tags = await yoloService.tagFile(file.fileId)
      console.log('File tagged with:', tags)
      // Note: File refresh would normally happen here via parent component callback
      // For now, just show success message
    } catch (err) {
      console.error('Auto-tagging failed:', err)
      setTagError(err.message || 'Otomatik etiketleme başarısız oldu')
    } finally {
      setTagging(false)
    }
  }

  const expirationDate = file.license?.expirationDate
    ? new Date(file.license.expirationDate).toLocaleDateString('tr-TR')
    : null

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
          Detaylar
        </h3>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Preview Thumbnail */}
        <div
          className="relative w-full aspect-video bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 rounded-lg overflow-hidden cursor-pointer hover:opacity-75 transition group"
          onClick={onOpenLightbox}
        >
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/20">
            <svg
              className="w-8 h-8 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
            </svg>
          </div>
        </div>

        {/* Video Preview Player */}
        <VideoPreview file={file} />

        {/* Video Frame Gallery */}
        {file.videoPreviewFrames && file.videoPreviewFrames.length > 0 && (
          <VideoFrameGallery frames={file.videoPreviewFrames} />
        )}

        {/* Folder Navigation Breadcrumb */}
        <FolderBrowser file={file} onNavigate={handleFolderNavigate} />

        {/* File Info */}
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
            📋 Dosya Bilgisi
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Ad:</span>
              <span className="text-slate-900 dark:text-white font-medium truncate ml-2">
                {file.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Boyut:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.sizeFormatted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Tip:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.type}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Değiştirildi:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.dateFormatted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Kaynak:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.sourceLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Rights & License */}
        {file.copyright && (
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
              ⚖️ Telif & Lisans
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Sahip:</span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {file.copyright.owner}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Lisans:</span>
                <span
                  className={`font-medium px-2 py-1 rounded text-xs ${
                    file.license?.type === 'RF'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {file.license?.type}
                </span>
              </div>
              {expirationDate && (
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">
                    Süresi:
                  </span>
                  <span
                    className={`font-medium ${
                      file.isExpired ? 'text-red-600' : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {expirationDate}
                    {file.isExpired && ' ⚠️'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tags */}
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
            🏷️ Etiketler
          </h4>
          <div className="flex flex-wrap gap-2 mb-3">
            {file.tags?.map((tag) => (
              <span
                key={tag}
                className="inline-block px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-medium"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Auto-tag error message */}
          {tagError && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
              {tagError}
            </div>
          )}

          {/* Tag action buttons */}
          <div className="flex gap-2 flex-wrap">
            {!addingTag ? (
              <>
                <button
                  onClick={() => setAddingTag(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Etiket Ekle
                </button>
                {(file.type?.startsWith('video/') || file.type?.startsWith('image/')) && (
                  <button
                    onClick={handleAutoTag}
                    disabled={tagging}
                    className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {tagging ? '✨ Etiketleniyor...' : '✨ Otomatik Etiketle'}
                  </button>
                )}
              </>
            ) : (
              <div className="flex gap-2 w-full">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Yeni etiket..."
                  className="flex-1 px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTag()
                    if (e.key === 'Escape') setAddingTag(false)
                  }}
                  autoFocus
                />
                <button
                  onClick={handleAddTag}
                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Ekle
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Usage Stats */}
        {file.stats && (
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
              📊 Kullanım
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">
                  Görüntülemeler:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {file.stats.views}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">
                  İndirmeler:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {file.stats.downloads}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer - Action Buttons */}
      <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-2">
        <button
          onClick={onOpenLightbox}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition text-sm"
        >
          👁️ Önizleme
        </button>
        <FileDownload file={file} />
      </div>
    </div>
  )
}
