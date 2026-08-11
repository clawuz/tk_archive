import { useEffect, useRef, useState } from 'react'
import kingbirdSide from '../../assets/kingbird-side.png'
import tribalLogo from '../../assets/tribal-logo.svg'

const NAVY = '#0A1E42'

// Scene durations (Approach / Cruise / Depart), in seconds — from the
// original composition.
const TOTAL_DURATION = 1.9 + 0.9 + 1.8

const Easing = {
  linear: (t) => t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
}

function animate({ from, to, start, end, ease }) {
  return (t) => {
    if (t <= start) return from
    if (t >= end) return to
    const local = (t - start) / (end - start)
    return from + (to - from) * ease(local)
  }
}

// Computes one frame of the flight: the Curtiss Kingbird TC-KUS (Turkish
// Airlines' first aircraft) glides in from the left, climbs across the
// header, and fades out near the right edge as the loop resets.
function computeFrame(T) {
  const xFrac = animate({ from: -0.1, to: 1.06, start: 0, end: TOTAL_DURATION, ease: Easing.linear })(T)
  const phase = (T / TOTAL_DURATION) * Math.PI * 2 * 1.5
  const bob = Math.sin(phase) * 0.56 // % of container height (6px / 1080px reference design)
  // Kept in the upper band of the banner so the flight path never crosses
  // the title, which is anchored to the bottom-left.
  const climbPct = animate({ from: 34, to: 14, start: 0, end: TOTAL_DURATION, ease: Easing.easeInOutSine })(T)
  const yFrac = climbPct + bob
  const tilt = -6 + Math.sin(phase) * 2

  const opacity = Math.min(
    animate({ from: 0, to: 1, start: 0, end: 0.4, ease: Easing.easeOutQuad })(T),
    animate({ from: 1, to: 0, start: TOTAL_DURATION - 0.5, end: TOTAL_DURATION, ease: Easing.easeInOutQuad })(T)
  )

  return { xFrac, yFrac, tilt, opacity }
}

/**
 * Looping header banner: a vintage Turkish Airlines aircraft flies across a
 * paper-white strip, referencing the airline's first aircraft (Curtiss
 * Kingbird TC-KUS). Carries the app title so the header doesn't need a
 * separate text block stacked below it. Pauses when scrolled out of view or
 * when the user prefers reduced motion.
 */
export default function HeroAnimation({ height = 140 }) {
  const containerRef = useRef(null)
  const [frame, setFrame] = useState(() => computeFrame(0))
  const [visible, setVisible] = useState(true)
  const rafRef = useRef(null)
  const lastTsRef = useRef(null)
  const tRef = useRef(0)
  const reducedMotionRef = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reducedMotionRef.current) {
      setFrame(computeFrame(TOTAL_DURATION / 2))
      return
    }
    if (!visible) {
      lastTsRef.current = null
      return
    }
    function step(ts) {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      tRef.current = (tRef.current + dt) % TOTAL_DURATION
      setFrame(computeFrame(tRef.current))
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastTsRef.current = null
    }
  }, [visible])

  const { xFrac, yFrac, tilt, opacity } = frame
  const xPct = xFrac * 100

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ height, background: '#FFFFFF' }}
    >
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
          title (bottom-left) and the flight path (upper band) */}
      <img
        src={tribalLogo}
        alt="Tribal Worldwide Istanbul"
        className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ height: 80, width: 'auto', opacity: 0.85 }}
      />

      {/* Title — pinned to the bottom so the flight path above never crosses it */}
      <div className="absolute left-6 bottom-4 pointer-events-none">
        <h1 className="text-2xl font-bold" style={{ color: NAVY }}>
          TK Archive
        </h1>
        <p className="text-sm mt-0.5" style={{ color: NAVY, opacity: 0.65 }}>
          Dijital Varlık Yönetim Sistemi by Tribal
        </p>
      </div>

      {/* Aircraft */}
      <img
        src={kingbirdSide}
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: `${xPct}%`,
          top: `${yFrac}%`,
          width: 110,
          height: 44,
          transform: `translate(-50%, -50%) scaleX(-1) rotate(${-tilt}deg)`,
          opacity,
        }}
      />
    </div>
  )
}
