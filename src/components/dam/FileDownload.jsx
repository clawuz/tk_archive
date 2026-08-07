import { useState } from 'react'
import { resolvePath } from '../../services/pathResolver'

export default function FileDownload({ file }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const filePath = resolvePath(file)

  const handleCopyPath = () => {
    if (!filePath) {
      setError('Cannot copy path for this file')
      return
    }
    navigator.clipboard.writeText(filePath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenInDrive = () => {
    if (file.source === 'drive' && filePath) {
      window.open(filePath, '_blank')
    }
  }

  if (!filePath) {
    return (
      <div>
        <p className="text-red-600 dark:text-red-400 text-sm">Cannot access this file</p>
      </div>
    )
  }

  // Google Drive files: open in Drive
  if (file.source === 'drive') {
    return (
      <div>
        <button
          onClick={handleOpenInDrive}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
        >
          <span>☁️</span> Open in Google Drive
        </button>
      </div>
    )
  }

  // Local files: show path display
  return (
    <div className="space-y-3">
      <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
          📍 Dosya Konumu
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 break-all font-mono bg-white dark:bg-slate-900 p-3 rounded border border-slate-200 dark:border-slate-700">
          {filePath}
        </p>
      </div>

      <button
        onClick={handleCopyPath}
        className={`w-full font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2 ${
          copied
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-slate-600 hover:bg-slate-700 text-white'
        }`}
      >
        <span>{copied ? '✓' : '📋'}</span>
        {copied ? 'Kopyalandı' : 'Kopyala Yolu'}
      </button>

      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <p className="text-xs text-blue-800 dark:text-blue-300">
          💡 Dosyayı açmak için yolu Finder'da kullanın veya doğrudan sistem tarayıcısında açın.
        </p>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
      )}
    </div>
  )
}
