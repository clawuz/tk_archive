import { useState, useEffect, useRef } from 'react'
import damService from '../../services/damService'
import { XIcon, TagIcon } from '../icons'

const SEARCH_DEBOUNCE_MS = 350

/**
 * The page's dominant search element — full-width, above the fold, visible
 * to every user (not the admin-gated scan panel below it). Split out of
 * SearchFilters.jsx, which now only holds the secondary filters (source,
 * tag checkboxes, date, license); this owns the query input and the tag
 * suggestions dropdown, reading/writing `filters.tags` directly so both
 * stay in sync without a second copy of "which tags are selected".
 */
export default function SearchBar({ filters, onChange }) {
  const [tags, setTags] = useState([])
  const [searchQuery, setSearchQuery] = useState(filters.query || '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchDebounceRef = useRef(null)

  useEffect(() => {
    damService
      .getTags()
      .then(setTags)
      .catch((err) => console.error('Etiketler yüklenemedi:', err))
  }, [])

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  // Stays in sync when the query is cleared from elsewhere (the sidebar's
  // active-filter chip, or its "Temizle" button) — this only ever fires
  // after a committed change lands in `filters`, never mid-keystroke, since
  // typing here updates `filters.query` itself only once the debounce fires.
  useEffect(() => {
    setSearchQuery(filters.query || '')
  }, [filters.query])

  function handleSearchChange(value) {
    setSearchQuery(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      onChange({ query: value })
    }, SEARCH_DEBOUNCE_MS)
  }

  function handleClear() {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    setSearchQuery('')
    onChange({ query: '' })
  }

  const selectedTags = filters.tags || []

  function handleSelectTagSuggestion(tagId) {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    onChange({ tags: selectedTags.includes(tagId) ? selectedTags : [...selectedTags, tagId] })
    setSearchQuery('')
    onChange({ query: '' })
    setShowSuggestions(false)
  }

  const trimmed = searchQuery.trim().toLowerCase()
  const availableTags = tags.filter((tag) => !selectedTags.includes(tag.tagId))
  // Typing narrows to matching tags; an empty, focused box shows the most-
  // used tags instead — "önerilen etiketler" should be a discovery surface,
  // not only appear after the user already knows what to type.
  const tagSuggestions = trimmed
    ? availableTags.filter((tag) => tag.displayName.toLowerCase().includes(trimmed)).slice(0, 8)
    : availableTags.slice(0, 8)

  return (
    <div className="relative">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onClick={() => setShowSuggestions(true)}
          onBlur={() => setShowSuggestions(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowSuggestions(false)
              e.target.blur()
            }
          }}
          placeholder="Kampanya, dosya adı, etiket ara…"
          autoComplete="off"
          className="w-full pl-12 pr-11 py-4 text-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl shadow-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {searchQuery && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              handleClear()
            }}
            title="Aramayı temizle"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <XIcon size={16} />
          </button>
        )}
      </div>

      {showSuggestions && tagSuggestions.length > 0 && (
        <div className="absolute z-20 mt-2 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-3">
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2 px-1">
            {trimmed ? 'Eşleşen etiketler' : 'Önerilen etiketler'}
          </p>
          <div className="flex flex-wrap gap-2">
            {tagSuggestions.map((tag) => (
              <button
                key={tag.tagId}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelectTagSuggestion(tag.tagId)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/40 text-slate-700 dark:text-slate-200 rounded-full transition-colors"
              >
                <TagIcon size={13} /> {tag.displayName}
                <span className="text-xs text-slate-400 dark:text-slate-500">{tag.usageCount}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
