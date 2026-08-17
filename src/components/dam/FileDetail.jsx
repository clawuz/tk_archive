import { useState, useEffect, memo } from 'react'
import damService from '../../services/damService'
import * as yoloService from '../../services/yoloService'
import VideoPreview from './VideoPreview'
import FileDownload from './FileDownload'
import FolderBrowser from './FolderBrowser'
import { useAuth } from '../../auth/AuthProvider'

const LICENSE_TYPES = ['commercial', 'RF', 'RM', 'custom']

function buildRightsForm(file) {
  return {
    owner: file.copyright?.owner || '',
    licenseType: file.license?.type || 'commercial',
    expirationDate: file.license?.expirationDate
      ? new Date(file.license.expirationDate).toISOString().slice(0, 10)
      : '',
    usageRights: file.usage?.usage_rights || '',
    productionCompany: file.copyright?.productionCompany || '',
    department: file.copyright?.department || '',
    contactPerson: file.copyright?.contactPerson || '',
  }
}

const TagDisplay = memo(({ tags, onAutoTag, tagging }) => {
  if (!tags && !onAutoTag) return null

  return (
    <div className="mt-6 border-t pt-6 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          🏷️ Etiketler
        </h3>
        {onAutoTag && (
          <button
            onClick={onAutoTag}
            disabled={tagging}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
          >
            {tagging ? '⏳ Etiketleniyor...' : '✨ Otomatik Etiketle'}
          </button>
        )}
      </div>

      {tags?.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 text-xs rounded-full font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">Henüz etiket yok</p>
      )}
    </div>
  )
})

TagDisplay.displayName = 'TagDisplay'

export default function FileDetail({
  file,
  onClose,
  onOpenLightbox,
  onShowPreview,
  // Tag/rights edits below only ever wrote to Firestore and this
  // component's own local state (localTags/rightsForm) — the parent's
  // cached file list (loadedFiles in DAMDashboard) never heard about it.
  // Editing felt fine in the moment (local state matched what you just
  // did), but re-selecting the same file later — even without a reload —
  // handed FileDetail the stale cached object again, and its
  // useEffect([file.fileId]) reset localTags/rightsForm right back to the
  // pre-edit values. onFileUpdate closes that loop: call it with whatever
  // changed after every successful write, so the parent's cache — and
  // anything else reading it — stays correct.
  onFileUpdate,
}) {
  const { userProfile } = useAuth()
  // Only admin/super_admin may add/remove tags or edit copyright & license fields.
  const canEdit = userProfile?.role === 'admin' || userProfile?.role === 'super_admin'

  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [tagError, setTagError] = useState(null)
  const [localTags, setLocalTags] = useState(file.tags || [])

  const [editingRights, setEditingRights] = useState(false)
  const [rightsForm, setRightsForm] = useState(() => buildRightsForm(file))
  const [savingRights, setSavingRights] = useState(false)
  const [rightsError, setRightsError] = useState(null)
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0)
  const isVideoFile = !!file.mimeType?.startsWith('video/')
  const hasVideoFrames = file.videoPreviewFrames?.length > 0
  // Google Drive's embedded player has fixed-size controls that don't
  // scale down, so it needs real width to be usable — this narrow sidebar
  // never has that. Drive videos get a clickable poster here instead of
  // the live iframe; actual playback happens in the lightbox (max-w-4xl,
  // unconstrained by this grid column). Local videos keep the inline
  // player — the browser's native controls scale fine at any width.
  const isDriveVideo = isVideoFile && file.source === 'drive'

  // Reset local tags when the selected file changes
  useEffect(() => {
    setLocalTags(file.tags || [])
    setRightsForm(buildRightsForm(file))
    setSelectedFrameIndex(0)
    setEditingRights(false)
    setRightsError(null)
  }, [file.fileId])

  const handleFolderNavigate = async (folderPath) => {
    try {
      setLoading(true)
      // Search for files with path starting with folderPath
      const result = await damService.searchFiles(
        { sources: ['local'], query: folderPath },
        null,
        100
      )

      // Filter to files in this folder and subfolders
      const filesInFolder = result.files.filter(f =>
        f.path.startsWith(folderPath + '/')
      )

      // Update gallery to show filtered files
      setFiles(filesInFolder)
    } catch (err) {
      console.error('Navigation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddTag() {
    if (!canEdit) return
    const trimmed = newTag.trim()
    if (trimmed) {
      try {
        await damService.addTagsToFile(file.fileId, [trimmed])
        const updatedTags = localTags.includes(trimmed) ? localTags : [...localTags, trimmed]
        setLocalTags(updatedTags)
        onFileUpdate?.(file.fileId, { tags: updatedTags })
        setNewTag('')
        setAddingTag(false)
      } catch (err) {
        console.error('Etiket eklenemedi:', err)
      }
    }
  }

  async function handleRemoveTag(tag) {
    if (!canEdit) return
    const prevTags = localTags
    const updatedTags = localTags.filter((t) => t !== tag)
    setLocalTags(updatedTags)
    try {
      await damService.removeTagFromFile(file.fileId, tag)
      onFileUpdate?.(file.fileId, { tags: updatedTags })
    } catch (err) {
      console.error('Etiket silinemedi:', err)
      setLocalTags(prevTags)
    }
  }

  async function handleAutoTag() {
    if (!canEdit) return
    try {
      setTagging(true)
      setTagError(null)
      const newTags = await yoloService.tagFile(file.fileId)
      const updatedTags = Array.from(new Set([...localTags, ...newTags]))
      setLocalTags(updatedTags)
      onFileUpdate?.(file.fileId, { tags: updatedTags })
    } catch (err) {
      console.error('Auto-tagging failed:', err)
      setTagError(err.message || 'Otomatik etiketleme başarısız oldu')
    } finally {
      setTagging(false)
    }
  }

  async function handleSaveRights() {
    if (!canEdit) return
    setSavingRights(true)
    setRightsError(null)
    try {
      const expirationDate = rightsForm.expirationDate
        ? new Date(rightsForm.expirationDate).getTime()
        : null
      await damService.updateFileRights(file.fileId, {
        owner: rightsForm.owner,
        licenseType: rightsForm.licenseType,
        expirationDate,
        usageRights: rightsForm.usageRights,
        productionCompany: rightsForm.productionCompany,
        department: rightsForm.department,
        contactPerson: rightsForm.contactPerson,
      })
      // Mirrors updateFileRights' own merge logic (damService.ts) so the
      // parent's cache matches exactly what was actually written.
      const { expirationDate: _drop, ...licenseWithoutExpiration } = file.license || {}
      onFileUpdate?.(file.fileId, {
        copyright: {
          ...file.copyright,
          owner: rightsForm.owner,
          productionCompany: rightsForm.productionCompany,
          department: rightsForm.department,
          contactPerson: rightsForm.contactPerson,
        },
        license: {
          ...(expirationDate === null ? licenseWithoutExpiration : file.license),
          type: rightsForm.licenseType,
          ...(expirationDate !== null ? { expirationDate } : {}),
        },
        usage: { ...file.usage, usage_rights: rightsForm.usageRights },
      })
      setEditingRights(false)
    } catch (err) {
      console.error('Telif bilgisi güncellenemedi:', err)
      setRightsError(err.message || 'Güncelleme başarısız oldu')
    } finally {
      setSavingRights(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
          Detaylar
        </h3>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Preview Thumbnail — skipped only for local videos with no
            extracted frames: the inline <video> player below is already
            the preview there, and stacking a second static thumbnail above
            it just reads as a broken video area. Drive videos always get
            this clickable poster (with frames if any exist) instead of the
            live iframe — see isDriveVideo above — non-video files always
            get the plain thumbnail (their only preview). */}
        {(!isVideoFile || hasVideoFrames || isDriveVideo) && (
          <div>
            <div
              className="relative w-full aspect-video bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 rounded-lg overflow-hidden cursor-pointer hover:opacity-75 transition group"
              onClick={onOpenLightbox}
            >
              <img
                src={
                  hasVideoFrames
                    ? `data:image/jpeg;base64,${file.videoPreviewFrames[selectedFrameIndex]?.frameData}`
                    : file.thumbnailUrl
                }
                alt={file.name}
                className="w-full h-full object-cover"
              />
              <div
                className={`absolute inset-0 flex items-center justify-center transition bg-black/20 ${
                  isVideoFile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {isVideoFile ? (
                  <span className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-105 transition">
                    <svg className="w-6 h-6 text-slate-900 ml-1" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6 4l12 6-12 6V4z" />
                    </svg>
                  </span>
                ) : (
                  <svg
                    className="w-8 h-8 text-white"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  </svg>
                )}
              </div>
            </div>

            {hasVideoFrames && (
              <div className="grid grid-cols-5 gap-2 mt-2">
                {file.videoPreviewFrames.map((frame, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedFrameIndex(idx)}
                    title={`${Math.floor(frame.timestamp)}s`}
                    className={`relative aspect-video rounded overflow-hidden border-2 transition ${
                      idx === selectedFrameIndex
                        ? 'border-blue-500'
                        : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <img
                      src={`data:image/jpeg;base64,${frame.frameData}`}
                      alt={`Kare ${frame.frameNumber}`}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute bottom-0.5 right-0.5 text-[10px] leading-none px-1 py-0.5 bg-black/60 text-white rounded">
                      {Math.floor(frame.timestamp)}s
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Video Preview Player — Drive videos are click-to-play via the
            poster above (opens the lightbox) instead of an inline player;
            see isDriveVideo above. */}
        {!isDriveVideo && <VideoPreview file={file} />}

        {/* Folder Navigation Breadcrumb */}
        <FolderBrowser file={file} onNavigate={handleFolderNavigate} />

        {/* File Info */}
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
            📋 Dosya Bilgisi
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Ad:</span>
              <span className="text-slate-900 dark:text-white font-medium truncate ml-2">
                {file.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Boyut:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.sizeFormatted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Tip:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.type}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Değiştirildi:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.dateFormatted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Kaynak:</span>
              <span className="text-slate-900 dark:text-white font-medium">
                {file.sourceLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Rights & License */}
        {file.copyright && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-900 dark:text-white">
                ⚖️ Telif & Lisans
              </h4>
              {canEdit && !editingRights && (
                <button
                  onClick={() => setEditingRights(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  ✏️ Düzenle
                </button>
              )}
            </div>

            {!editingRights ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Sahip:</span>
                  <span className="text-slate-900 dark:text-white font-medium">
                    {rightsForm.owner || '—'}
                  </span>
                </div>
                {rightsForm.productionCompany && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Prodüksiyon Şirketi:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {rightsForm.productionCompany}
                    </span>
                  </div>
                )}
                {rightsForm.department && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">İlgili Birim:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {rightsForm.department}
                    </span>
                  </div>
                )}
                {rightsForm.contactPerson && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">İlgili Kişi:</span>
                    <span className="text-slate-900 dark:text-white font-medium">
                      {rightsForm.contactPerson}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Lisans:</span>
                  <span
                    className={`font-medium px-2 py-1 rounded text-xs ${
                      rightsForm.licenseType === 'RF'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {rightsForm.licenseType}
                  </span>
                </div>
                {rightsForm.expirationDate && (
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">
                      Süresi:
                    </span>
                    <span
                      className={`font-medium ${
                        new Date(rightsForm.expirationDate).getTime() < Date.now()
                          ? 'text-red-600'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {new Date(rightsForm.expirationDate).toLocaleDateString('tr-TR')}
                      {new Date(rightsForm.expirationDate).getTime() < Date.now() && ' ⚠️'}
                    </span>
                  </div>
                )}
                {rightsForm.usageRights && (
                  <div>
                    <span className="text-slate-600 dark:text-slate-400 block mb-1">
                      Kullanım Hakları:
                    </span>
                    <p className="text-slate-900 dark:text-white text-sm whitespace-pre-wrap">
                      {rightsForm.usageRights}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    Sahip
                  </label>
                  <input
                    type="text"
                    value={rightsForm.owner}
                    onChange={(e) => setRightsForm({ ...rightsForm, owner: e.target.value })}
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    Prodüksiyon Şirketi (varsa)
                  </label>
                  <input
                    type="text"
                    value={rightsForm.productionCompany}
                    onChange={(e) => setRightsForm({ ...rightsForm, productionCompany: e.target.value })}
                    placeholder="Örn. XYZ Prodüksiyon"
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    İlgili Birim
                  </label>
                  <input
                    type="text"
                    value={rightsForm.department}
                    onChange={(e) => setRightsForm({ ...rightsForm, department: e.target.value })}
                    placeholder="Örn. Kurumsal İletişim"
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    İlgili Kişi
                  </label>
                  <input
                    type="text"
                    value={rightsForm.contactPerson}
                    onChange={(e) => setRightsForm({ ...rightsForm, contactPerson: e.target.value })}
                    placeholder="Örn. Ad Soyad"
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    Lisans Tipi
                  </label>
                  <select
                    value={rightsForm.licenseType}
                    onChange={(e) => setRightsForm({ ...rightsForm, licenseType: e.target.value })}
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  >
                    {LICENSE_TYPES.map((lt) => (
                      <option key={lt} value={lt}>{lt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    Son Kullanma Tarihi
                  </label>
                  <input
                    type="date"
                    value={rightsForm.expirationDate}
                    onChange={(e) => setRightsForm({ ...rightsForm, expirationDate: e.target.value })}
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">
                    Kullanım Hakları / Kısıtlamalar
                  </label>
                  <textarea
                    value={rightsForm.usageRights}
                    onChange={(e) => setRightsForm({ ...rightsForm, usageRights: e.target.value })}
                    rows={3}
                    placeholder="Örn. sadece sosyal medya, Nisan 2026'ya kadar geçerli..."
                    className="w-full px-2 py-1 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                  />
                </div>

                {rightsError && (
                  <div className="p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
                    {rightsError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveRights}
                    disabled={savingRights}
                    className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    {savingRights ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                  <button
                    onClick={() => {
                      setRightsForm(buildRightsForm(file))
                      setEditingRights(false)
                      setRightsError(null)
                    }}
                    disabled={savingRights}
                    className="px-3 py-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-600"
                  >
                    İptal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
            🏷️ Etiketler
          </h4>
          <div className="flex flex-wrap gap-2 mb-3">
            {localTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-medium"
              >
                {tag}
                {canEdit && (
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-600 dark:hover:text-red-400"
                    aria-label={`${tag} etiketini kaldır`}
                    title="Etiketi kaldır"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>

          {/* Auto-tag error message */}
          {tagError && (
            <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
              {tagError}
            </div>
          )}

          {/* Tag action buttons — add/remove/auto-tag restricted to admin/super_admin */}
          {canEdit && (
            <div className="flex gap-2 flex-wrap">
              {!addingTag ? (
                <>
                  <button
                    onClick={() => setAddingTag(true)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Etiket Ekle
                  </button>
                  {(file.type?.startsWith('video/') || file.type?.startsWith('image/')) && (
                    <button
                      onClick={handleAutoTag}
                      disabled={tagging}
                      className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {tagging ? '✨ Etiketleniyor...' : '✨ Otomatik Etiketle'}
                    </button>
                  )}
                </>
              ) : (
                <div className="flex gap-2 w-full">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Yeni etiket..."
                    className="flex-1 px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTag()
                      if (e.key === 'Escape') setAddingTag(false)
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleAddTag}
                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Ekle
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Usage Stats */}
        {file.stats && (
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white mb-3">
              📊 Kullanım
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">
                  Görüntülemeler:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {file.stats.views}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">
                  İndirmeler:
                </span>
                <span className="text-slate-900 dark:text-white font-medium">
                  {file.stats.downloads}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer - Action Buttons */}
      <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-2">
        <button
          onClick={onOpenLightbox}
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition text-sm"
        >
          👁️ Önizleme
        </button>
        <FileDownload file={file} />
      </div>
    </div>
  )
}
