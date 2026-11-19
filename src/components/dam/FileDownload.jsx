import { useState } from 'react'
import { resolvePath, resolveDownloadUrl } from '../../services/pathResolver'
import { DownloadIcon, CloudIcon, MapPinIcon, CheckIcon, ClipboardIcon, LightbulbIcon } from '../icons'

export default function FileDownload({ file }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const filePath = resolvePath(file)
  const downloadUrl = resolveDownloadUrl(file)

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

  // Google Drive files: real download as the primary action, viewer as secondary
  if (file.source === 'drive') {
    return (
      <div className="space-y-2">
        <a
          href={downloadUrl}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
        >
          <DownloadIcon size={16} /> İndir
        </a>
        <button
          onClick={handleOpenInDrive}
          className="w-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium py-2 px-4 rounded-lg transition flex items-center justify-center gap-2 text-sm"
        >
          <CloudIcon size={15} /> Drive'da Görüntüle
        </button>
      </div>
    )
  }

  // Local files: show path display
  return (
    <div className="space-y-3">
      <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
          <MapPinIcon size={14} /> Dosya Konumu
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
        {copied ? <CheckIcon size={16} /> : <ClipboardIcon size={16} />}
        {copied ? 'Kopyalandı' : 'Kopyala Yolu'}
      </button>

      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <p className="text-xs text-blue-800 dark:text-blue-300 flex items-start gap-1.5">
          <LightbulbIcon size={14} className="shrink-0 mt-0.5" />
          Dosyayı açmak için yolu Finder'da kullanın veya doğrudan sistem tarayıcısında açın.
        </p>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
      )}
    </div>
  )
}
