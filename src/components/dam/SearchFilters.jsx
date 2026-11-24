import { useState, useEffect } from 'react'
import damService from '../../services/damService'
import { XIcon, TagIcon, ScaleIcon, CalendarIcon, FileIcon, BarChartIcon, FilmIcon } from '../icons'

const MEDIA_TYPE_LABELS = {
  video: 'Video',
  image: 'Fotoğraf',
  design: 'Tasarım (PSD/AI)',
  document: 'Belge (PDF vb.)',
  other: 'Diğer',
}

export default function SearchFilters({ filters, onChange }) {
  const [tags, setTags] = useState([])
  const [groups, setGroups] = useState([])
  const [openGroups, setOpenGroups] = useState([])
  const [selectedSources, setSelectedSources] = useState(filters.sources || ['local', 'drive'])
  // Derived straight from the prop, not mirrored into local state — tags can
  // also be selected from SearchBar.jsx's suggestion dropdown, so a local
  // copy here would go stale the moment that happens (checkboxes and the
  // active-filter chips below would silently stop reflecting reality).
  const selectedTags = filters.tags || []
  const selectedGroups = filters.groups || []
  const [dateFrom, setDateFrom] = useState(
    filters.dateRange?.from ? new Date(filters.dateRange.from).toISOString().slice(0, 7) : ''
  )
  const [dateTo, setDateTo] = useState(
    filters.dateRange?.to ? new Date(filters.dateRange.to).toISOString().slice(0, 7) : ''
  )
  const [selectedLicenseTypes, setSelectedLicenseTypes] = useState(filters.licenseType || [])
  const [selectedMediaTypes, setSelectedMediaTypes] = useState(filters.type || [])

  const LICENSE_TYPE_LABELS = {
    commercial: 'commercial — Ticari Kullanım',
    RF: 'RF — Royalty-Free (Telifsiz)',
    RM: 'RM — Rights-Managed (Haklar Yönetilen)',
    custom: 'custom — Özel Anlaşma',
  }

  // Load available tags
  useEffect(() => {
    loadTags()
    damService.getGroups().then(setGroups).catch(() => {})
  }, [])

  // Üst grup seçilince alt gruplar ayrıca işaretlenmez: dosyalar alt gruba girerken
  // üst gruba da yazıldığı için üst grup zaten hepsini kapsar.
  function handleGroupToggle(groupId) {
    const updated = selectedGroups.includes(groupId)
      ? selectedGroups.filter((g) => g !== groupId)
      : [...selectedGroups, groupId]
    onChange({ groups: updated })
  }

  async function loadTags() {
    try {
      const tagList = await damService.getTags()
      setTags(tagList)
    } catch (err) {
      console.error('Etiketler yüklenemedi:', err)
    }
  }

  function handleSourceToggle(source) {
    const updated = selectedSources.includes(source)
      ? selectedSources.filter((s) => s !== source)
      : [...selectedSources, source]
    setSelectedSources(updated)
    onChange({ sources: updated })
  }

  // Segmented control over the same `sources` filter as handleSourceToggle
  // (both/local/drive) — 'all' sets both flags back on rather than being a
  // separate mode, so this stays in sync with the checkbox-style toggle
  // logic above instead of introducing a second source of truth.
  function handleSourceSegment(segment) {
    const updated = segment === 'all' ? ['local', 'drive'] : [segment]
    setSelectedSources(updated)
    onChange({ sources: updated })
  }
  const sourceSegment =
    selectedSources.length === 1 ? selectedSources[0] : 'all'

  function handleTagToggle(tagId) {
    const updated = selectedTags.includes(tagId)
      ? selectedTags.filter((t) => t !== tagId)
      : [...selectedTags, tagId]
    onChange({ tags: updated })
  }

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

  function handleMediaTypeToggle(type) {
    const updated = selectedMediaTypes.includes(type)
      ? selectedMediaTypes.filter((t) => t !== type)
      : [...selectedMediaTypes, type]
    setSelectedMediaTypes(updated)
    onChange({ type: updated })
  }

  function handleClearFilters() {
    setSelectedSources(['local', 'drive'])
    setDateFrom('')
    setDateTo('')
    setSelectedLicenseTypes([])
    setSelectedMediaTypes([])
    onChange({
      query: '',
      sources: ['local', 'drive'],
      tags: [],
      groups: [],
      dateRange: null,
      licenseType: [],
      type: [],
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
        {/* Source Filter — segmented control, sits above every other filter
            per the source location it implies (Drive assets download
            directly; local/TRIBAL assets only expose a path). */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            Kaynak
          </label>
          <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
            {[
              { value: 'all', label: 'Tümü' },
              { value: 'local', label: 'Yerel' },
              { value: 'drive', label: 'Drive' },
            ].map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSourceSegment(opt.value)}
                className={`flex-1 py-1.5 font-medium transition-colors ${
                  i > 0 ? 'border-l border-slate-300 dark:border-slate-600' : ''
                } ${
                  sourceSegment === opt.value
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Media Type Filter — broad category (video/image/design/document),
            not raw extension/MIME; see getMediaCategory() in damService.ts. */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white mb-2">
            <FilmIcon size={15} /> Dosya Türü
          </label>
          <div className="space-y-2">
            {['video', 'image', 'design', 'document', 'other'].map((type) => (
              <label key={type} className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedMediaTypes.includes(type)}
                  onChange={() => handleMediaTypeToggle(type)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="ml-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  {MEDIA_TYPE_LABELS[type]}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Search itself now lives in SearchBar.jsx, full-width above the
            fold — this panel keeps only the secondary filters. The active
            summary below still surfaces the query as a removable chip since
            `filters.query` is shared state either way. */}

        {/* Active filter summary — every non-default selection as a
            removable chip, so a full set of filters is scannable/undoable
            at a glance instead of only visible by re-opening each section. */}
        {(filters.query || selectedGroups.length > 0 || selectedTags.length > 0 || selectedLicenseTypes.length > 0 || selectedMediaTypes.length > 0 || dateFrom || dateTo) && (
          <div className="flex flex-wrap gap-1.5 -mt-2">
            {filters.query && (
              <span className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full">
                "{filters.query}"
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange({ query: '' })
                  }}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <XIcon size={12} />
                </button>
              </span>
            )}
            {selectedGroups.map((gid) => (
              <span
                key={gid}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded-full"
              >
                {groups.find((g) => g.groupId === gid)?.name || gid}
                <button
                  type="button"
                  onClick={() => handleGroupToggle(gid)}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
            {selectedTags.map((tagId) => (
              <span
                key={tagId}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full"
              >
                <TagIcon size={12} /> {tags.find((t) => t.tagId === tagId)?.displayName || tagId}
                <button
                  type="button"
                  onClick={() => handleTagToggle(tagId)}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
            {selectedMediaTypes.map((type) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-full"
              >
                <FilmIcon size={12} /> {MEDIA_TYPE_LABELS[type] || type}
                <button
                  type="button"
                  onClick={() => handleMediaTypeToggle(type)}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
            {selectedLicenseTypes.map((type) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full"
              >
<ScaleIcon size={12} /> {type}
                <button
                  type="button"
                  onClick={() => handleLicenseTypeToggle(type)}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
            {(dateFrom || dateTo) && (
              <span className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full">
<CalendarIcon size={12} /> {dateFrom || '…'} – {dateTo || '…'}
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('')
                    setDateTo('')
                    onChange({ dateRange: null })
                  }}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <XIcon size={12} />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Konu Grupları (İK, Take-Off, Meslekler …) — tag_groups kurallarıyla dosyalara yazılır */}
        {groups.length > 0 && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white mb-2">
              <TagIcon size={15} /> Konu Grupları
            </label>
            <div className="space-y-1.5">
              {groups.filter((g) => !g.parent).map((root) => {
                const kids = groups.filter((k) => k.parent === root.groupId)
                const open = !root.collapsed || openGroups.includes(root.groupId) || kids.some((k) => selectedGroups.includes(k.groupId))
                const renderRow = (g, child) => (
                  <label key={g.groupId} className={`flex items-center ${child ? 'ml-5' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g.groupId)}
                      onChange={() => handleGroupToggle(g.groupId)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="ml-2 inline-block w-2 h-2 rounded-full" style={{ background: g.color || '#64748b' }} />
                    <span
                      className={`ml-1.5 text-sm text-slate-700 dark:text-slate-300 ${child ? '' : 'font-medium'}`}
                      title={g.description || undefined}
                    >
                      {g.name}
                    </span>
                    {typeof g.fileCount === 'number' && (
                      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">({g.fileCount})</span>
                    )}
                  </label>
                )
                return (
                  <div key={root.groupId} className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      {kids.length > 0 && root.collapsed ? (
                        <button
                          type="button"
                          onClick={() => setOpenGroups((o) => (o.includes(root.groupId) ? o.filter((x) => x !== root.groupId) : [...o, root.groupId]))}
                          className="w-4 text-xs text-slate-500 dark:text-slate-400"
                          aria-label={open ? 'Alt konuları gizle' : 'Alt konuları göster'}
                        >
                          {open ? '▾' : '▸'}
                        </button>
                      ) : null}
                      <div className="flex-1">{renderRow(root, false)}</div>
                    </div>
                    {open && kids.map((k) => renderRow(k, true))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tags Filter */}
        {tags.length > 0 && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white mb-2">
              <TagIcon size={15} /> Etiketler
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
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white mb-2">
            <CalendarIcon size={15} /> Tarih Aralığı (Ay/Yıl)
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
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white mb-2">
            <FileIcon size={15} /> Lisans Türü
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
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white mb-2">
            <BarChartIcon size={15} /> Sıralama
          </label>
          <div className="space-y-2">
            <select
              onChange={(e) => {
                const [sortBy, sortOrder] = e.target.value.split(':')
                handleSortChange(sortBy, sortOrder)
              }}
              defaultValue={`${filters.sortBy || 'modifiedAt'}:${filters.sortOrder || 'desc'}`}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <optgroup label="Değiştirilme Tarihi">
                <option value="modifiedAt:desc">Tarihe Göre (Yeni)</option>
                <option value="modifiedAt:asc">Tarihe Göre (Eski)</option>
              </optgroup>
              <optgroup label="Oluşturulma Tarihi">
                <option value="createdAt:desc">Oluşturulma Tarihine Göre (Yeni)</option>
                <option value="createdAt:asc">Oluşturulma Tarihine Göre (Eski)</option>
              </optgroup>
              <optgroup label="Ad">
                <option value="name:asc">Adına Göre (A-Z)</option>
                <option value="name:desc">Adına Göre (Z-A)</option>
              </optgroup>
              <optgroup label="Boyut">
                <option value="size:desc">Boyuta Göre (Büyük)</option>
                <option value="size:asc">Boyuta Göre (Küçük)</option>
              </optgroup>
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
            {filters.query && (
              <span>
                "{filters.query}" için arama yapılıyor
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
