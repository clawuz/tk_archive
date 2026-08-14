import { useState, useEffect, useRef } from 'react'
import damService from '../../services/damService'

const SEARCH_DEBOUNCE_MS = 350

export default function SearchFilters({ filters, onChange }) {
  const [tags, setTags] = useState([])
  const [searchQuery, setSearchQuery] = useState(filters.query || '')
  const searchDebounceRef = useRef(null)
  const [selectedSources, setSelectedSources] = useState(filters.sources || ['local', 'drive'])
  const [selectedTags, setSelectedTags] = useState(filters.tags || [])
  const [dateFrom, setDateFrom] = useState(
    filters.dateRange?.from ? new Date(filters.dateRange.from).toISOString().slice(0, 7) : ''
  )
  const [dateTo, setDateTo] = useState(
    filters.dateRange?.to ? new Date(filters.dateRange.to).toISOString().slice(0, 7) : ''
  )
  const [selectedLicenseTypes, setSelectedLicenseTypes] = useState(filters.licenseType || [])
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)

  const LICENSE_TYPE_LABELS = {
    commercial: 'commercial — Ticari Kullanım',
    RF: 'RF — Royalty-Free (Telifsiz)',
    RM: 'RM — Rights-Managed (Haklar Yönetilen)',
    custom: 'custom — Özel Anlaşma',
  }

  // Load available tags
  useEffect(() => {
    loadTags()
  }, [])

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  async function loadTags() {
    try {
      const tagList = await damService.getTags()
      setTags(tagList)
    } catch (err) {
      console.error('Etiketler yüklenemedi:', err)
    }
  }

  // The input updates immediately (feels responsive), but the actual query
  // — which now fires a real Firestore request per change, unlike the old
  // slow client-side scan — waits until typing pauses. Without this, each
  // keystroke started its own search, and DAMDashboard.jsx had to guard
  // against them resolving out of order (see requestIdRef there); debouncing
  // here means that mostly doesn't even come up in normal typing.
  function handleSearchChange(value) {
    setSearchQuery(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      onChange({ query: value })
    }, SEARCH_DEBOUNCE_MS)
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

  // Picking a suggestion applies it as a real tag filter (a fast, exact
  // Firestore query) instead of leaving it as free text, which has to
  // scan every raw document client-side to find matches — much slower for
  // an uncommon term. The text box clears so the two don't stack.
  function handleSelectTagSuggestion(tagId) {
    // A pending debounce from the typing that surfaced this suggestion
    // would otherwise fire ~350ms later and overwrite the clear below.
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    handleTagToggle(tagId)
    setSearchQuery('')
    onChange({ query: '' })
    setShowTagSuggestions(false)
  }

  const tagSuggestions =
    searchQuery.trim().length > 0
      ? tags
          .filter(
            (tag) =>
              !selectedTags.includes(tag.tagId) &&
              tag.displayName.toLowerCase().includes(searchQuery.trim().toLowerCase())
          )
          .slice(0, 8)
      : []

  function handleSortChange(sortBy, sortOrder) {
    onChange({ sortBy, sortOrder })
  }

  function handleDateFromChange(value) {
    setDateFrom(value)
    emitDateRange(value, dateTo)
  }

  function handleDateToChange(value) {
    setDateTo(value)
    emitDateRange(dateFrom, value)
  }

  function monthStartMillis(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number)
    return new Date(year, month - 1, 1).getTime()
  }

  function monthEndMillis(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number)
    return new Date(year, month, 0, 23, 59, 59, 999).getTime()
  }

  function emitDateRange(from, to) {
    if (!from && !to) {
      onChange({ dateRange: null })
      return
    }
    onChange({
      dateRange: {
        from: from ? monthStartMillis(from) : 0,
        to: to ? monthEndMillis(to) : Date.now(),
      },
    })
  }

  function handleLicenseTypeToggle(type) {
    const updated = selectedLicenseTypes.includes(type)
      ? selectedLicenseTypes.filter((t) => t !== type)
      : [...selectedLicenseTypes, type]
    setSelectedLicenseTypes(updated)
    onChange({ licenseType: updated })
  }

  function handleClearFilters() {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    setSearchQuery('')
    setSelectedSources(['local', 'drive'])
    setSelectedTags([])
    setDateFrom('')
    setDateTo('')
    setSelectedLicenseTypes([])
    onChange({
      query: '',
      sources: ['local', 'drive'],
      tags: [],
      dateRange: null,
      licenseType: [],
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
        <div className="relative">
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            🔍 Ara
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              handleSearchChange(e.target.value)
              setShowTagSuggestions(true)
            }}
            onFocus={() => setShowTagSuggestions(true)}
            onBlur={() => setShowTagSuggestions(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowTagSuggestions(false)
            }}
            placeholder="Dosya adı, etiket..."
            autoComplete="off"
            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {showTagSuggestions && tagSuggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {tagSuggestions.map((tag) => (
                <li key={tag.tagId}>
                  <button
                    type="button"
                    // onMouseDown fires before the input's onBlur, so the
                    // click registers before the dropdown closes.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelectTagSuggestion(tag.tagId)
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-600"
                  >
                    <span>🏷️ {tag.displayName}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {tag.usageCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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

        {/* Date Range Filter (month/year precision — day doesn't matter) */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            📅 Tarih Aralığı (Ay/Yıl)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={dateFrom}
              onChange={(e) => handleDateFromChange(e.target.value)}
              max={dateTo || undefined}
              className="w-28 px-2 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-400 text-sm">–</span>
            <input
              type="month"
              value={dateTo}
              onChange={(e) => handleDateToChange(e.target.value)}
              min={dateFrom || undefined}
              className="w-28 px-2 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* License Type Filter */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            📜 Lisans Türü
          </label>
          <div className="space-y-2">
            {['commercial', 'RF', 'RM', 'custom'].map((type) => (
              <label key={type} className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedLicenseTypes.includes(type)}
                  onChange={() => handleLicenseTypeToggle(type)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="ml-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  {LICENSE_TYPE_LABELS[type]}
                </span>
              </label>
            ))}
          </div>
        </div>

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
