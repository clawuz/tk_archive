import tribalLogo from '../../assets/tribal-logo.svg'
import GlobeLoader from './GlobeLoader'

const NAVY = '#0A1E42'

/**
 * Header banner: the THY globe animation fills the background, with the
 * Tribal logo and app title layered on top. Sized to `height`, not the
 * viewport, so it drops into the fixed-height header slot.
 */
export default function HeroAnimation({ height = 140 }) {
  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      {/* Globe animation — fills the header */}
      <div className="absolute inset-0 pointer-events-none">
        <GlobeLoader />
      </div>

      {/* Corner frame */}
      {[
        { top: 12, left: 12, borderTop: true, borderLeft: true },
        { top: 12, right: 12, borderTop: true, borderRight: true },
        { bottom: 12, left: 12, borderBottom: true, borderLeft: true },
        { bottom: 12, right: 12, borderBottom: true, borderRight: true },
      ].map((c, i) => (
        <div
          key={i}
          className="absolute w-6 h-6 opacity-30"
          style={{
            top: c.top, left: c.left, right: c.right, bottom: c.bottom,
            borderTop: c.borderTop ? `1.5px solid ${NAVY}` : undefined,
            borderLeft: c.borderLeft ? `1.5px solid ${NAVY}` : undefined,
            borderBottom: c.borderBottom ? `1.5px solid ${NAVY}` : undefined,
            borderRight: c.borderRight ? `1.5px solid ${NAVY}` : undefined,
          }}
        />
      ))}

      {/* Tribal logo — right side, vertically centered, clear of both the
          title (bottom-left) and the globe (centered) */}
      <img
        src={tribalLogo}
        alt="Tribal Worldwide Istanbul"
        className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ height: 80, width: 'auto', opacity: 0.85 }}
      />

      {/* Title — pinned to the bottom-left */}
      <div className="absolute left-6 bottom-4 pointer-events-none">
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>
          TK Archive
        </h1>
        <p className="text-sm mt-0.5" style={{ color: NAVY, opacity: 0.65 }}>
          Dijital Varlık Yönetim Sistemi by Tribal
        </p>
      </div>
    </div>
  )
}
