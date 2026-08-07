import { useState, useEffect } from 'react'
import ThumbnailCard from './ThumbnailCard'

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
          <ThumbnailCard
            key={file.fileId}
            file={file}
            onSelect={() => onFileSelect(file)}
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
