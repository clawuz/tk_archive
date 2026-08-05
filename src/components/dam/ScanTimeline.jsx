export default function ScanTimeline({ scans }) {
  if (!scans || scans.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">
          📅 Tarama Geçmişi
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Henüz tarama geçmişi yok
        </p>
      </div>
    )
  }

  // Get the most recent scan
  const latestScan = scans[0]
  const previousScan = scans[1]

  // Calculate changes since last scan
  const newFilesSinceLastScan = latestScan.results?.newFiles || 0
  const deletedFilesSinceLastScan = latestScan.results?.deletedFiles || 0
  const modifiedFilesSinceLastScan = latestScan.results?.modifiedFiles || 0

  const formatDate = (ms) => {
    const date = new Date(ms)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return 'Bugün'
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Dün'
    }
    return date.toLocaleDateString('tr-TR', {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-white">
          📅 Tarama Geçmişi
        </h3>
      </div>

      {/* Timeline */}
      <div className="p-4 space-y-4">
        {/* Latest Scan - Highlighted */}
        <div className="relative pl-6 pb-4 border-l-2 border-blue-500">
          <div className="absolute -left-3 top-0 w-5 h-5 bg-blue-500 rounded-full border-4 border-white dark:border-slate-800"></div>

          <div className="space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-medium text-slate-900 dark:text-white text-sm">
                  {latestScan.source === 'local' ? '📂 Yerel Tarama' : '☁️ Drive Tarama'}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {formatDate(latestScan.completedAt)}
                  {latestScan.duration && (
                    <span className="ml-1">
                      ({Math.round(latestScan.duration / 1000)}s)
                    </span>
                  )}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2 py-1 rounded ${
                  latestScan.status === 'completed'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {latestScan.status === 'completed' ? '✓ Tamamlandı' : '⏳ İşleniyor'}
              </span>
            </div>

            {/* Changes Summary */}
            {latestScan.results && (
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                {newFilesSinceLastScan > 0 && (
                  <div className="bg-green-50 dark:bg-green-900/20 rounded p-2 border border-green-200 dark:border-green-800">
                    <div className="font-medium text-green-800 dark:text-green-300">
                      +{newFilesSinceLastScan}
                    </div>
                    <div className="text-green-700 dark:text-green-400 text-xs">
                      Yeni dosya
                    </div>
                  </div>
                )}

                {modifiedFilesSinceLastScan > 0 && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-2 border border-blue-200 dark:border-blue-800">
                    <div className="font-medium text-blue-800 dark:text-blue-300">
                      {modifiedFilesSinceLastScan}
                    </div>
                    <div className="text-blue-700 dark:text-blue-400 text-xs">
                      Değiştirildi
                    </div>
                  </div>
                )}

                {deletedFilesSinceLastScan > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/20 rounded p-2 border border-red-200 dark:border-red-800 col-span-2">
                    <div className="font-medium text-red-800 dark:text-red-300">
                      -{deletedFilesSinceLastScan}
                    </div>
                    <div className="text-red-700 dark:text-red-400 text-xs">
                      Silinen dosya
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stats */}
            {latestScan.results && (
              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1 text-xs">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Toplam:</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {latestScan.results.totalFiles} dosya
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Boyut:</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {latestScan.results.totalSizeGB} GB
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Previous Scans */}
        {scans.slice(1, 4).map((scan, index) => (
          <div key={scan.scanId} className="relative pl-6 pb-3 border-l-2 border-slate-200 dark:border-slate-700 last:pb-0">
            <div className="absolute -left-2.5 top-1 w-3 h-3 bg-slate-300 dark:bg-slate-600 rounded-full"></div>

            <div>
              <h4 className="font-medium text-slate-700 dark:text-slate-300 text-sm">
                {scan.source === 'local' ? '📂 Yerel' : '☁️ Drive'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {formatDate(scan.completedAt)}
              </p>
              {scan.results && (
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {scan.results.totalFiles} dosya • {scan.results.totalSizeGB} GB
                </p>
              )}
            </div>
          </div>
        ))}

        {/* View More */}
        {scans.length > 4 && (
          <button className="w-full text-center text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2">
            +{scans.length - 4} daha eski tarama göster
          </button>
        )}
      </div>
    </div>
  )
}
