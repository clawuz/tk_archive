import { useState } from 'react'
import { resolvePath } from '../../services/pathResolver'

export default function FileDownload({ file }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(0)

  const handleDownload = async () => {
    try {
      setDownloading(true)
      setError(null)
      setProgress(0)

      const downloadUrl = resolvePath(file)
      if (!downloadUrl) {
        setError('Cannot download this file')
        return
      }

      if (file.source === 'drive') {
        window.open(downloadUrl, '_blank')
        setDownloading(false)
        return
      }

      const response = await fetch(downloadUrl)
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`)
      }

      const contentLength = response.headers.get('content-length')
      const total = parseInt(contentLength, 10)

      const reader = response.body.getReader()
      const chunks = []
      let receivedLength = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        receivedLength += value.length

        if (total) {
          setProgress(Math.round((receivedLength / total) * 100))
        }
      }

      const blob = new Blob(chunks, { type: file.mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      setDownloading(false)
      setProgress(0)
    } catch (err) {
      setError(err.message)
      setDownloading(false)
      console.error('Download error:', err)
    }
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center justify-center gap-2"
      >
        {downloading ? (
          <>
            <span className="animate-spin">⟳</span>
            {progress}%
          </>
        ) : file.source === 'drive' ? (
          <>
            <span>☁️</span> Open in Google Drive
          </>
        ) : (
          <>
            <span>⬇️</span> Download
          </>
        )}
      </button>

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm mt-2">{error}</p>
      )}

      {downloading && (
        <div className="mt-2 bg-slate-200 dark:bg-slate-700 rounded h-2 overflow-hidden">
          <div
            className="bg-blue-600 h-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
