import { useMemo } from 'react'
import { getParentDirectory } from '../../services/pathResolver'

export default function FolderBrowser({ file, onNavigate }) {
  if (file?.source !== 'local') return null

  const filePath = file?.path || ''

  const breadcrumbs = useMemo(() => {
    const parts = filePath.split('/').filter(Boolean)
    return parts.map((part, index) => ({
      label: part,
      path: '/' + parts.slice(0, index + 1).join('/')
    }))
  }, [filePath])

  const handleNavigateToParent = () => {
    const parent = getParentDirectory(filePath)
    if (parent) {
      onNavigate?.(parent)
    }
  }

  const handleNavigateTo = (path) => {
    onNavigate?.(path)
  }

  return (
    <div className="text-sm text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-1 flex-wrap">
      <button
        onClick={handleNavigateToParent}
        className="hover:text-slate-900 dark:hover:text-slate-200 transition"
        title="Parent directory"
      >
        ↑
      </button>

      {breadcrumbs.map((crumb, index) => (
        <div key={index} className="flex items-center gap-1">
          <span>/</span>
          <button
            onClick={() => handleNavigateTo(crumb.path)}
            className="hover:text-slate-900 dark:hover:text-slate-200 hover:underline transition"
          >
            {crumb.label}
          </button>
        </div>
      ))}
    </div>
  )
}
