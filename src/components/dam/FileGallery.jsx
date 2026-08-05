import { useState, useEffect } from 'react'

export default function FileGallery({ files, onFileSelect, loading }) {
  const [displayFiles, setDisplayFiles] = useState([])
  const [visibleCount, setVisibleCount] = useState(50)

  useEffect(() => {
    setDisplayFiles(files.slice(0, visibleCount))
  }, [files, visibleCount])

  function handleLoadMore() {
    setVisibleCount((prev) => prev + 25)
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {files.length}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Toplam Dosya
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {files.filter((f) => f.source === 'local').length}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Yerel
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {files.filter((f) => f.source === 'drive').length}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Drive
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {displayFiles.map((file) => (
          <FileCard
            key={file.fileId}
            file={file}
            onClick={() => onFileSelect(file)}
          />
        ))}
      </div>

      {/* Load More */}
      {visibleCount < files.length && (
        <div className="flex justify-center">
          <button
            onClick={handleLoadMore}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition"
          >
            Daha Fazla Yükle ({files.length - visibleCount} kaldı)
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Single file card in gallery
 */
function FileCard({ file, onClick }) {
  const [imageError, setImageError] = useState(false)

  const sourceColor = file.source === 'local' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
  const sourceLabel = file.source === 'local' ? '📂 Yerel' : '☁️ Drive'

  // Get file icon based on type
  const getFileIcon = () => {
    if (file.type.startsWith('image/')) return '🖼️'
    if (file.type.startsWith('video/')) return '🎬'
    if (file.type === 'application/pdf') return '📄'
    if (file.type.includes('psd')) return '🎨'
    return '📄'
  }

  return (
    <button
      onClick={onClick}
      className="group relative bg-white dark:bg-slate-800 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-500 transition cursor-pointer"
    >
      {/* Thumbnail Container */}
      <div className="relative w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 overflow-hidden">
        {/* Thumbnail Image */}
        {!imageError ? (
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl">
            {getFileIcon()}
          </div>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition">
            <svg
              className="w-8 h-8 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>

        {/* Source Badge */}
        <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium ${sourceColor} dark:${sourceColor}`}>
          {sourceLabel.split(' ')[1]}
        </div>

        {/* Expired License Badge */}
        {file.isExpired && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
            ⚠️ Süresi Geçti
          </div>
        )}
      </div>

      {/* File Info */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-700">
        <h3 className="font-medium text-sm text-slate-900 dark:text-white truncate">
          {file.name}
        </h3>
        <div className="flex items-center justify-between mt-1 text-xs text-slate-600 dark:text-slate-400">
          <span>{file.sizeFormatted}</span>
          <span>{file.dateFormatted}</span>
        </div>

        {/* Tags */}
        {file.tags && file.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {file.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-block px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded"
              >
                {tag}
              </span>
            ))}
            {file.tags.length > 2 && (
              <span className="inline-block px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
                +{file.tags.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
