// Lightweight, per-browser favorites + recently-viewed tracking via
// localStorage — no new Firestore schema/security rules needed for what the
// UX brief calls a "low-effort, high-value" feature. Not synced across
// devices; upgrading to a per-user Firestore collection later is a drop-in
// swap behind this same function surface.

const FAVORITES_KEY = 'tk-archive-favorites'
const RECENT_KEY = 'tk-archive-recent'
const RECENT_LIMIT = 30
const CHANGE_EVENT = 'tk-archive:favorites-changed'

function readIds(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeIds(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // Storage unavailable (private mode, quota) — favorites just won't persist.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function getFavoriteIds() {
  return readIds(FAVORITES_KEY)
}

export function isFavorite(fileId) {
  return getFavoriteIds().includes(fileId)
}

export function toggleFavorite(fileId) {
  const current = getFavoriteIds()
  const next = current.includes(fileId)
    ? current.filter((id) => id !== fileId)
    : [...current, fileId]
  writeIds(FAVORITES_KEY, next)
  return next.includes(fileId)
}

export function getRecentlyViewedIds() {
  return readIds(RECENT_KEY)
}

// Most-recently-viewed first, deduped, capped — called from the file
// detail open handler so it reflects real navigation, not gallery scroll.
export function addRecentlyViewed(fileId) {
  const current = readIds(RECENT_KEY).filter((id) => id !== fileId)
  const next = [fileId, ...current].slice(0, RECENT_LIMIT)
  writeIds(RECENT_KEY, next)
}

export function onFavoritesChanged(callback) {
  window.addEventListener(CHANGE_EVENT, callback)
  return () => window.removeEventListener(CHANGE_EVENT, callback)
}
