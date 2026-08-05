import { useState, useEffect } from 'react'
import damService from '../../services/damService'

export default function SearchFilters({ filters, onChange }) {
  const [tags, setTags] = useState([])
  const [searchQuery, setSearchQuery] = useState(filters.query || '')
  const [selectedSources, setSelectedSources] = useState(filters.sources || ['local', 'drive'])
  const [selectedTags, setSelectedTags] = useState(filters.tags || [])
  const [dateRange, setDateRange] = useState(filters.dateRange || null)

  // Load available tags
  useEffect(() => {
    loadTags()
  }, [])

  async function loadTags() {
    try {
      const tagList = await damService.getTags()
      setTags(tagList)
    } catch (err) {
      console.error('Etiketler yüklenemedi:', err)
    }
  }

  function handleSearchChange(value) {
    setSearchQuery(value)
    onChange({ query: value })
  }

  function handleSourceToggle(source) {
    const updated = selectedSources.includes(source)
      ? selectedSources.filter((s) => s !== source)
      : [...selectedSources, source]
    setSelectedSources(updated)
    onChange({ sources: updated })
  }

  function handleTagToggle(tagId) {
    const updated = selectedTags.includes(tagId)
      ? selectedTags.filter((t) => t !== tagId)
      : [...selectedTags, tagId]
    setSelectedTags(updated)
    onChange({ tags: updated })
  }

  function handleSortChange(sortBy, sortOrder) {
    onChange({ sortBy, sortOrder })
  }

  function handleClearFilters() {
    setSearchQuery('')
    setSelectedSources(['local', 'drive'])
    setSelectedTags([])
    onChange({
      query: '',
      sources: ['local', 'drive'],
      tags: [],
    })
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-white">Filtreler</h3>
        <button
          onClick={handleClearFilters}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Temizle
        </button>
      </div>

      <div className="p-4 space-y-6">
        {/* Search */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            🔍 Ara
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Dosya adı, etiket..."
            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Source Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            📂 Kaynak
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={selectedSources.includes('local')}
                onChange={() => handleSourceToggle('local')}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="ml-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                Yerel Klasör
              </span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={selectedSources.includes('drive')}
                onChange={() => handleSourceToggle('drive')}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="ml-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                Google Drive
              </span>
            </label>
          </div>
        </div>

        {/* Tags Filter */}
        {tags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
              🏷️ Etiketler
            </label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {tags.map((tag) => (
                <label key={tag.tagId} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedTags.includes(tag.tagId)}
                    onChange={() => handleTagToggle(tag.tagId)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="ml-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    {tag.displayName}
                  </span>
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                    ({tag.usageCount})
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Sorting */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            📊 Sıralama
          </label>
          <div className="space-y-2">
            <select
              onChange={(e) =>
                handleSortChange(e.target.value, filters.sortOrder)
              }
              defaultValue={filters.sortBy || 'modifiedAt'}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="modifiedAt">Tarihe Göre (Yeni)</option>
              <option value="name">Adına Göre</option>
              <option value="size">Boyuta Göre</option>
              <option value="views">Görüntülemeye Göre</option>
            </select>
          </div>
        </div>

        {/* Filter Info */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {selectedTags.length > 0 && (
              <span>
                {selectedTags.length} etiket seçili •
              </span>
            )}
            {searchQuery && (
              <span>
                "{searchQuery}" için arama yapılıyor
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
