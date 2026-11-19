import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../../firebase'
import { useAuth } from '../../auth/AuthProvider'
import tribalWordmarkBlack from '../../assets/tribal-wordmark-black.png'
import tribalWordmarkWhite from '../../assets/tribal-wordmark-white.png'
import GlobeLoader from './GlobeLoader'
import { GridIcon, StarIcon, ClockIcon, LogOutIcon, UsersIcon } from '../icons'

const NAVY = '#0A1E42'
// A lighter blue than the brand accent — reads clearly as text on both the
// dark collapsed navy and the dim gradient behind the expanded tabs, where a
// deeper blue would sit too close to the background to read easily.
const ACCENT_BLUE = '#93c5fd'
// Two thresholds instead of one, with a dead zone between them — a single
// value flickers the header open/closed whenever scrollY hovers right on
// top of it (trackpad rubber-banding, momentum micro-scrolls).
const COLLAPSE_AT = 40 // px scrolled before the header shrinks
const EXPAND_AT = 16 // px scrolled before it's allowed to expand back
// Every scroll event pushes the decision back by this much — as long as
// events keep arriving (including a bounce's own trailing oscillation) the
// timer keeps resetting, so this naturally covers a bounce of any length
// rather than assuming a fixed settle time.
const SCROLL_DEBOUNCE_MS = 120
const EXPANDED_HEIGHT = 140
const COLLAPSED_HEIGHT = 56

const VIEW_TABS = [
  { value: 'all', label: 'Tüm Arşiv', Icon: GridIcon },
  { value: 'favorites', label: 'Favoriler', Icon: StarIcon },
  { value: 'recent', label: 'Son Görüntülenenler', Icon: ClockIcon },
]

/**
 * Header banner: the THY globe animation fills the background, with the
 * Tribal logo and app title layered on top, and the archive's view-switcher
 * tabs embedded along the bottom edge. Shrinks on scroll (140px -> 56px) so
 * the tabs stay reachable without the full band eating vertical space while
 * browsing — see the "sticky, ince gezinme" plan. The parent still wraps
 * this in `sticky top-0`; this component only handles its own collapse.
 */
export default function HeroAnimation({ activeView = 'all', onViewChange, viewCounts = {}, onOpenUsers }) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, userProfile } = useAuth()
  const isStaff = userProfile?.role === 'admin' || userProfile?.role === 'super_admin'

  useEffect(() => {
    // Trackpad momentum/rubber-banding doesn't settle cleanly — a single
    // scroll gesture can report scrollY bouncing back and forth across both
    // thresholds several times, and for longer than any fixed cooldown can
    // safely assume (a first attempt here used a flat 150ms lockout after
    // the first transition, which still flickered whenever a bounce ran
    // longer than that). A real debounce instead: every scroll event pushes
    // the decision back by SCROLL_DEBOUNCE_MS, so nothing commits until
    // scrolling has actually gone quiet — however long the bounce takes —
    // and only the settled position ever gets evaluated.
    let timeoutId = null
    function commit() {
      timeoutId = null
      // Below the sm breakpoint the header never shrinks — the compact
      // 56px layout was designed for the wide desktop bar and cramped the
      // title/logo/buttons together on a phone width. Staying expanded
      // trades some scroll real estate for a header that doesn't overlap.
      if (window.innerWidth < 640) {
        setCollapsed(false)
        return
      }
      setCollapsed((prev) => {
        if (!prev && window.scrollY > COLLAPSE_AT) return true
        if (prev && window.scrollY < EXPAND_AT) return false
        return prev
      })
    }
    function handleScroll() {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(commit, SCROLL_DEBOUNCE_MS)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    commit()
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  const height = collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT

  return (
    <div
      className="relative w-full overflow-hidden transition-[height,background-color] duration-200 ease-out"
      style={{ height, backgroundColor: collapsed ? NAVY : 'transparent' }}
    >
      {/* Globe animation — fades out once collapsed rather than being
          unmounted, so re-expanding (scroll back to top) doesn't restart it. */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-200"
        style={{ opacity: collapsed ? 0 : 1 }}
      >
        <GlobeLoader />
      </div>

      {/* Corner frame — always mounted, faded out rather than conditionally
          unmounted, so it doesn't pop in/out a frame ahead of the height
          transition it's synced with. */}
      {[
        { top: 12, left: 12, borderTop: true, borderLeft: true },
        { top: 12, right: 12, borderTop: true, borderRight: true },
        { bottom: 12, left: 12, borderBottom: true, borderLeft: true },
        { bottom: 12, right: 12, borderBottom: true, borderRight: true },
      ].map((c, i) => (
        <div
          key={i}
          className="absolute w-6 h-6 transition-opacity duration-200"
          style={{
            top: c.top, left: c.left, right: c.right, bottom: c.bottom,
            opacity: collapsed ? 0 : 0.3,
            borderTop: c.borderTop ? `1.5px solid ${NAVY}` : undefined,
            borderLeft: c.borderLeft ? `1.5px solid ${NAVY}` : undefined,
            borderBottom: c.borderBottom ? `1.5px solid ${NAVY}` : undefined,
            borderRight: c.borderRight ? `1.5px solid ${NAVY}` : undefined,
          }}
        />
      ))}

      {/* Tribal wordmark — faded out once collapsed, where the "by" lockup
          next to the title takes over that role instead. Black reads on the
          light expanded background; stays mounted (opacity only) for the
          same reason as the corner frame above. */}
      <img
        src={tribalWordmarkBlack}
        alt="Tribal Worldwide Istanbul"
        className="absolute right-6 top-7 pointer-events-none transition-opacity duration-200"
        style={{ height: 30, width: 'auto', opacity: collapsed ? 0 : 1 }}
      />

      {/* Sign out / users — tucked under the wordmark, expanded state only;
          not frequent enough actions to spend space on in the compact bar. */}
      {user && (
        <div
          className="absolute right-6 top-16 flex items-center gap-3 transition-opacity duration-200"
          style={{ opacity: collapsed ? 0 : 1, pointerEvents: collapsed ? 'none' : 'auto' }}
        >
          {isStaff && (
            <button
              type="button"
              onClick={onOpenUsers}
              className="flex items-center gap-1 text-xs hover:underline"
              style={{ color: NAVY, opacity: 0.55 }}
            >
              <UsersIcon size={12} /> Kullanıcılar
            </button>
          )}
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="flex items-center gap-1 text-xs hover:underline"
            style={{ color: NAVY, opacity: 0.55 }}
          >
            <LogOutIcon size={12} /> Çıkış
          </button>
        </div>
      )}

      {/* Title — pinned top-left; drops the subtitle and slides up when collapsed */}
      <div
        className="absolute left-6 pointer-events-none transition-all duration-200"
        style={{ top: collapsed ? '50%' : 20, transform: collapsed ? 'translateY(-50%)' : 'none' }}
      >
        <h1
          className="font-bold transition-all duration-200 flex items-center gap-2"
          style={{ color: collapsed ? '#ffffff' : NAVY, fontSize: collapsed ? 16 : 24 }}
        >
          TK Archive
          {/* Always mounted, faded/collapsed by width instead of a hard
              conditional — an instant mount/unmount here was landing mid-way
              through the header's own 200ms transition and reading as a
              flicker, even on a small scroll. */}
          <span
            className="flex items-center gap-2 font-normal overflow-hidden transition-all duration-200"
            style={{ fontSize: 13, opacity: collapsed ? 1 : 0, maxWidth: collapsed ? 200 : 0 }}
          >
            <span style={{ opacity: 0.75 }}>by</span>
            <img src={tribalWordmarkWhite} alt="Tribal" style={{ height: 20, width: 'auto' }} />
          </span>
        </h1>
        <p
          className="text-sm overflow-hidden transition-all duration-200"
          style={{ color: NAVY, opacity: collapsed ? 0 : 0.65, maxHeight: collapsed ? 0 : 20, marginTop: collapsed ? 0 : 2 }}
        >
          DAM by Tribal
        </p>
      </div>

      {/* View-switcher tabs — always along the bottom edge, always interactive.
          No dark backing behind them: the expanded state reads dark navy
          text directly on the light globe background (like the title next
          to it), and the collapsed state reads light text on the header's
          own solid navy — so each state gets its own matching palette
          instead of one color forced to work on both. */}
      <div
        className="absolute left-0 right-0 flex items-center justify-end gap-6 px-6 transition-[height,bottom] duration-200"
        style={{ height: collapsed ? height : 40, bottom: collapsed ? 0 : 15 }}
      >
        {VIEW_TABS.map((tab) => {
          const isActive = activeView === tab.value
          const count = viewCounts[tab.value]
          const textColor = collapsed
            ? '#ffffff'
            : (isActive ? NAVY : 'rgba(10,30,66,0.55)')
          const badgeBg = collapsed
            ? (isActive ? 'rgba(147,197,253,0.25)' : 'rgba(255,255,255,0.15)')
            : (isActive ? 'rgba(59,130,246,0.15)' : 'rgba(10,30,66,0.08)')
          const badgeColor = collapsed ? '#ffffff' : NAVY
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onViewChange?.(tab.value)}
              title={tab.label}
              aria-label={tab.label}
              className="flex items-center gap-1.5 text-sm font-medium pb-1 border-b-2 transition-colors"
              style={{
                color: textColor,
                borderBottomColor: isActive ? ACCENT_BLUE : 'transparent',
              }}
            >
              <tab.Icon style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }} />
              {typeof count === 'number' && (
                <span
                  className="font-mono text-[10px] px-1.5 py-0.5 rounded-full transition-colors duration-200"
                  style={{ background: badgeBg, color: badgeColor }}
                >
                  {count.toLocaleString('tr-TR')}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
