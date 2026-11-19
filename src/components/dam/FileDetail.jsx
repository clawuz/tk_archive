import { useState, useEffect, memo } from 'react'
import damService from '../../services/damService'
import VideoPreview from './VideoPreview'
import FileDownload from './FileDownload'
import { useAuth } from '../../auth/AuthProvider'
import {
  XIcon,
  ClipboardIcon,
  ScaleIcon,
  PencilIcon,
  AlertTriangleIcon,
  TagIcon,
  SparklesIcon,
  HourglassIcon,
  BarChartIcon,
  EyeIcon,
} from '../icons'

// Byte-identical copies of this file (hidden from the grid, see
// mark_duplicates.py) — lists where else the same content lives.
const DuplicatesList = ({ file }) => {
  const [copies, setCopies] = useState(null)
  const ids = file.duplicateIds || []

  useEffect(() => {
    let cancelled = false
    setCopies(null)
    Promise.all(ids.map((id) => damService.getFile(id).catch(() => null))).then((docs) => {
      if (!cancelled) setCopies(docs.filter(Boolean))
    })
    return () => {
      cancelled = true
    }
  }, [file.fileId])

  if (!file.duplicateCount) return null
  const more = file.duplicateCount - ids.length

  return (
    <div>
      <h4 className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
        <ClipboardIcon size={16} /> Kopyalar ({file.duplicateCount})
      </h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
        Aynı içerik sunucuda {file.duplicateCount} yerde daha duruyor; listede yalnızca bu kayıt gösterilir.
      </p>
      {copies === null ? (
        <p className="text-xs text-slate-500">Yükleniyor...</p>
      ) : (
        <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-slate-700 dark:text-slate-300">
          {copies.map((c) => (
            <li key={c.fileId} className="break-all" title={c.path}>
              {c.path}
            </li>
          ))}
          {more > 0 && <li className="text-slate-500">…ve {more} kopya daha</li>}
        </ul>
      )}
    </div>
  )
}

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
  const [tagging, setTagging] = useState(false)
  // Request sent, local v2 worker hasn't finished yet — see handleAutoTag
  const [tagQueued, setTagQueued] = useState(false)
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
  const isDriveVideo = isVideoFile && !!file.driveFileId

  // The poster box below was hardcoded to aspect-video (16:9, landscape)
  // with object-cover — fine for landscape frames, but a portrait-shot
  // video (common for social content) got its preview frame cropped down
  // to a thin horizontal sliver, since object-cover fills a wide box by
  // scaling to width and cutting off everything above/below. Real example
  // (2026-10-02): DSC_3865.MOV, a vertical video, showed only a cropped-in
  // strip of its frame. Fixed the same way VideoPreview.jsx already
  // handles this for the actual <video> element — measure the real
  // image's natural dimensions and size the box to match, so nothing
  // gets cropped regardless of orientation.
  const posterSrc = hasVideoFrames
    ? `data:image/jpeg;base64,${file.videoPreviewFrames[selectedFrameIndex]?.frameData}`
    : file.thumbnailUrl
  const [posterAspectRatio, setPosterAspectRatio] = useState('16 / 9')

  useEffect(() => {
    if (!posterSrc) return
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setPosterAspectRatio(`${img.naturalWidth} / ${img.naturalHeight}`)
      }
    }
    img.onerror = () => setPosterAspectRatio('16 / 9')
    img.src = posterSrc
  }, [posterSrc])

  // Reset local tags when the selected file changes
  useEffect(() => {
    setLocalTags(file.tags || [])
    setRightsForm(buildRightsForm(file))
    setSelectedFrameIndex(0)
    setEditingRights(false)
    setRightsError(null)
  }, [file.fileId])

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

  // The button no longer calls Claude (API credit ran out): it raises a
  // Firestore flag and the local v2 vision worker on the Mac picks it up
  // (priority queue — see damService.requestAutoTag). The worker is a
  // separate process, so there's no response to await — the effect below
  // watches the file doc and applies the result when the worker clears
  // `tag_requested`.
  async function handleAutoTag() {
    if (!canEdit) return
    try {
      setTagging(true)
      setTagError(null)
      await damService.requestAutoTag(file.fileId)
      onFileUpdate?.(file.fileId, { tag_requested: true, needs_tagging: true })
      setTagQueued(true)
    } catch (err) {
      console.error('Auto-tagging request failed:', err)
      setTagError(err.message || 'Otomatik etiketleme isteği gönderilemedi')
    } finally {
      setTagging(false)
    }
  }

  // While a request waits, watch the Mac worker's heartbeat: if it has been
  // silent for 5+ minutes the request will just sit in the queue.
  const [workerSilentMin, setWorkerSilentMin] = useState(null)
  useEffect(() => {
    if (!tagQueued) {
      setWorkerSilentMin(null)
      return
    }
    let lastSeenMs = null
    let loaded = false
    const recompute = () => {
      if (!loaded) return
      const min = lastSeenMs ? Math.floor((Date.now() - lastSeenMs) / 60000) : Infinity
      setWorkerSilentMin(min >= 5 ? min : null)
    }
    const unsub = damService.watchWorkerStatus((st) => {
      lastSeenMs = st.lastSeenMs
      loaded = true
      recompute()
    })
    const timer = setInterval(recompute, 30000)
    return () => {
      unsub()
      clearInterval(timer)
    }
  }, [tagQueued])

  // A request made earlier (panel closed/reopened, or another admin's click)
  // may still be waiting on the worker when this file is opened.
  useEffect(() => {
    setTagQueued(file.tag_requested === true)
  }, [file.fileId])

  useEffect(() => {
    if (!tagQueued) return
    return damService.watchFile(file.fileId, (data) => {
      if (data.tag_requested) return
      const tags = data.tags || []
      setLocalTags(tags)
      setTagQueued(false)
      if (data.ai?.status === 'failed') {
        setTagError(data.ai.error || 'Otomatik etiketleme başarısız oldu')
      }
      onFileUpdate?.(file.fileId, {
        tags,
        ai: data.ai,
        tagSource: data.tagSource,
        needs_tagging: false,
        tag_requested: false,
      })
    })
  }, [tagQueued, file.fileId])

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
    // Sized by the modal wrapper in DAMDashboard.jsx now (bg/rounding/border
    // live there) — this is just the flex-column content structure so the
    // header stays pinned while the body scrolls.
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
          Detaylar
        </h3>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          <XIcon size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Media (preview/player) left, info/rights right on wide screens —
            this used to be one long stacked column even in the wide modal
            it now renders in, which read as cramped/scroll-heavy on
            desktop. Both sides scroll together in the single outer
            container above; this grid only controls left/right placement. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start space-y-6 lg:space-y-0">
        <div className="space-y-6">
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
              className="relative w-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-600 rounded-lg overflow-hidden cursor-pointer hover:opacity-75 transition group"
              style={{ aspectRatio: posterAspectRatio }}
              onClick={onOpenLightbox}
            >
              <img
                src={posterSrc}
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
        </div>

        {/* Right column: File Info + Rights & License */}
        <div className="space-y-6">
        {/* File Info */}
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-1.5">
            <ClipboardIcon size={16} /> Dosya Bilgisi
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

        <DuplicatesList file={file} />

        {/* AI Analizi — v2 (yerel AI worker) sonuçları, sadece bilgi
            amaçlı gösterim. file.ai varsa gösterilir; şu an worker izole
            bir test koleksiyonuna yazıyor (bkz. tk-ai-engine planı),
            gerçek dosyalarda bu alan henüz yok — bölüm o zamana kadar
            görünmez, mevcut arama/filtre tags alanına dokunmuyor. */}
        {file.ai?.status === 'completed' && (
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-1.5">
              <SparklesIcon size={16} /> AI Analizi
              <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                ({file.ai.model?.split('/').pop() || 'yerel model'})
              </span>
            </h4>
            <div className="space-y-3 text-sm">
              {file.ai.description && (
                <p className="text-slate-700 dark:text-slate-300">{file.ai.description}</p>
              )}
              {file.ai.tags?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {file.ai.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 rounded-full text-xs font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {file.ai.onScreenText?.length > 0 && (
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Ekrandaki yazılar:</span>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {file.ai.onScreenText.map((text, i) => (
                      <li key={i}>&ldquo;{text}&rdquo;</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rights & License */}
        {file.copyright && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ScaleIcon size={16} /> Telif & Lisans
              </h4>
              {canEdit && !editingRights && (
                <button
                  onClick={() => setEditingRights(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <PencilIcon size={12} /> Düzenle
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
                      className={`font-medium inline-flex items-center gap-1 ${
                        new Date(rightsForm.expirationDate).getTime() < Date.now()
                          ? 'text-red-600'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {new Date(rightsForm.expirationDate).toLocaleDateString('tr-TR')}
                      {new Date(rightsForm.expirationDate).getTime() < Date.now() && <AlertTriangleIcon size={13} />}
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
        </div>
        </div>

        {/* Tags — tagSource is a per-file flag (not per-tag: manual edits
            after an auto-tag pass don't get their own provenance), so this
            surfaces "this file was auto-tagged" rather than fabricating a
            per-chip AI/manual split the data can't actually support. */}
        <div>
          <h4 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <span className="flex items-center gap-1.5"><TagIcon size={16} /> Etiketler</span>
            {(file.tagSource === 'claude-vision' || file.tagSource === 'local-vision') && (
              <span className="inline-flex items-center gap-1 text-[10px] font-normal px-2 py-0.5 border border-dashed border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 rounded-full">
                <SparklesIcon size={11} /> AI ile etiketlendi
              </span>
            )}
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
                    <XIcon size={12} />
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
                      disabled={tagging || tagQueued}
                      className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition inline-flex items-center gap-1"
                    >
                      {tagging || tagQueued ? <HourglassIcon size={12} /> : <SparklesIcon size={12} />}
                      {tagging ? 'İstek gönderiliyor...' : tagQueued ? 'Kuyrukta, işleniyor...' : 'Otomatik Etiketle'}
                    </button>
                  )}
                  {tagQueued && (
                    <p className="w-full text-[11px] text-slate-500 dark:text-slate-400">
                      Yerel model işliyor (fotoğraf ~15 sn, video ~1-2 dk). Bitince etiketler burada otomatik güncellenir; paneli kapatabilirsiniz.
                    </p>
                  )}
                  {tagQueued && workerSilentMin !== null && (
                    <p className="w-full text-[11px] text-amber-600 dark:text-amber-400">
                      AI worker şu an çevrimdışı görünüyor{Number.isFinite(workerSilentMin) ? ` (son sinyal ${workerSilentMin} dk önce)` : ''}. İstek kuyrukta bekliyor; worker açılınca otomatik işlenecek.
                    </p>
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
            <h4 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-1.5">
              <BarChartIcon size={16} /> Kullanım
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
          className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition text-sm flex items-center justify-center gap-1.5"
        >
          <EyeIcon size={16} /> Önizleme
        </button>
        <FileDownload file={file} />
      </div>
    </div>
  )
}
