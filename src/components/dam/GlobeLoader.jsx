import { useEffect, useRef } from 'react'
import { geoOrthographic, geoPath, geoGraticule, geoInterpolate, geoDistance } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import worldAtlas from '../../assets/countries-110m.json'

// THY wordmark, traced as a Path2D (viewBox 0 0 24 24) — appears at the end
// of the loop as the globe morphs into it.
const THY_PATH_D =
  'M.168 13.988c.272 1.623.86 3.115 1.69 4.423 3.095-.863 5.817-2.495 6.785-6.132' +
  ' 1.065-4.003-.15-8.199-3.057-10.422C1.626 4.364-.657 9.077.168 13.988' +
  'm23.664-3.975c1.098 6.534-3.308 12.722-9.844 13.819-1.1.185-2.19.214-3.245.103' +
  'a12.023 12.023 0 0 1-8.46-4.892l19.428-5.57c.279-.08.207-.349-.024-.333l-8.145.569' +
  'c1.148-1.108 2.021-2.467 1.915-4.345-.214-3.043-3.311-6.013-9.071-7.967' +
  'a12.016 12.016 0 0 1 6.87-1.333c5.228.548 9.663 4.512 10.576 9.95'

// Timeline (authored seconds) — spin in, orient to Istanbul, zoom in, draw
// routes to every THY destination, hold, zoom out, free-spin, morph into the
// wordmark, hold, fade to white, loop.
const TL = {
  spinEnd: 3.0,
  orientEnd: 7.2,
  zoomEnd: 12.0,
  istShow: 11.2,
  routeStart: 12.8,
  routeDrawEnd: 25.5,
  holdEnd: 27.0,
  zoomOutEnd: 32.0,
  freeSpinEnd: 36.0,
  morphEnd: 42.0,
  holdLogoEnd: 47.0,
  fadeEnd: 48.2,
  loopAt: 48.2,
}

const ISTANBUL = [28.97, 41.01]
const ROT_IST = [-28.97, -41.01, 0]

// THY network destinations (lon, lat) — used only to draw the great-circle
// route fan from Istanbul; approximate city coordinates, not authoritative.
const DEST = [
  [-0.12, 51.51], [2.35, 48.85], [8.68, 50.11], [4.9, 52.37], [-3.7, 40.42], [2.17, 41.38],
  [12.5, 41.9], [9.19, 45.46], [16.37, 48.21], [8.55, 47.45], [6.15, 46.23], [4.35, 50.85],
  [12.57, 55.68], [18.07, 59.65], [10.75, 59.91], [24.96, 60.32], [21.01, 52.17], [14.43, 50.09],
  [19.04, 47.5], [26.1, 44.44], [23.32, 42.7], [23.72, 37.98], [-9.14, 38.78], [-6.27, 53.42],
  [-3.36, 55.95], [-2.27, 53.35], [4.84, 45.72], [7.26, 43.66], [9.99, 53.63], [11.79, 48.11],
  [13.4, 52.56], [6.77, 51.28], [9.23, 48.69], [11.07, 49.5], [14.18, 40.9], [12.35, 45.5],
  [18.42, 43.86], [20.31, 44.82], [16.07, 45.75], [14.46, 46.22], [21.43, 41.96], [19.79, 41.33],
  [19.25, 42.44], [21.03, 42.65], [30.45, 50.4], [24.04, 49.81], [27.54, 53.88], [24.06, 56.92],
  [24.83, 59.41], [25.29, 54.63], [44.8, 41.7], [44.52, 40.15], [49.86, 40.47],
  [-8.68, 40.72], [15.98, 45.82], [17.03, 51.1],
  [55.27, 25.2], [54.65, 24.43], [51.56, 25.28], [46.72, 24.68], [39.18, 21.68], [39.7, 24.55],
  [50.16, 26.27], [47.97, 29.23], [58.28, 23.59], [50.63, 26.27], [35.99, 31.72], [35.49, 33.82],
  [44.23, 33.26], [44.0, 36.24], [51.31, 35.69], [59.63, 36.24], [51.69, 32.66], [52.59, 29.55],
  [34.88, 31.99], [33.62, 34.87], [45.32, 36.18],
  [69.24, 41.3], [76.95, 43.35], [71.47, 51.18], [74.59, 42.88], [68.77, 38.55], [58.36, 37.98],
  [69.01, 34.57], [73.1, 33.62], [74.4, 31.52], [67.01, 24.86],
  [31.24, 30.04], [-7.59, 33.37], [10.23, 36.85], [3.22, 36.69], [13.16, 32.66], [32.56, 15.6],
  [38.8, 9.03], [36.82, -1.29], [39.2, -6.79], [28.04, -26.2], [18.6, -33.97], [3.32, 6.58],
  [7.27, 9.0], [-0.17, 5.6], [-17.49, 14.74], [-3.97, 5.35], [9.72, 4.01], [15.44, -4.32],
  [28.32, -15.33], [32.57, -25.92], [47.48, -18.8], [57.5, -20.43], [32.44, 0.34], [30.13, -1.97],
  [43.16, 11.55], [13.24, -8.84], [-13.61, 9.56], [-8.0, 12.53], [9.41, 0.46], [15.24, -4.26],
  [17.47, -22.56], [31.09, -17.93], [40.0, 9.57], [44.94, 2.01], [-15.58, 11.89], [34.75, -19.84],
  [72.88, 19.08], [77.1, 28.55], [77.66, 12.99], [78.47, 17.24], [80.28, 13.0], [88.45, 22.65],
  [90.4, 23.85], [79.89, 6.9], [85.37, 27.7], [73.53, 4.18], [72.63, 23.07], [77.04, 8.48],
  [100.52, 13.75], [101.69, 3.15], [103.82, 1.35], [106.65, -6.13], [106.82, 10.82], [105.8, 21.22],
  [121.0, 14.51], [114.17, 22.31], [116.39, 39.9], [121.47, 31.23], [113.32, 23.19], [139.69, 35.68],
  [135.43, 34.43], [126.79, 37.46], [121.22, 25.08], [106.92, 47.91], [96.13, 16.9], [104.93, 11.56],
  [-74.01, 40.71], [-87.65, 41.85], [-118.24, 34.05], [-77.04, 38.94], [-95.37, 29.76],
  [-80.28, 25.8], [-84.43, 33.64], [-71.01, 42.37], [-79.38, 43.65], [-73.74, 45.47],
  [-123.19, 49.19], [-99.08, 19.43], [-86.87, 21.04], [-74.13, 4.7], [-77.11, -11.84],
  [-58.54, -34.81], [-46.63, -23.55], [-43.17, -22.91], [-70.79, -33.39], [-82.35, 23.03],
  [-79.53, 8.99], [-66.9, 10.6], [-57.52, -25.24], [-68.07, -16.52],
]

const easeIO = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
const easeO3 = (t) => 1 - Math.pow(1 - t, 3)
function lerpA(a, b, t) {
  const d = (((b - a) % 360) + 540) % 360 - 180
  return a + d * t
}

const N_PTS = 50
const ROUTE_GEO = DEST.map((dest) => {
  const interp = geoInterpolate(ISTANBUL, dest)
  return Array.from({ length: N_PTS + 1 }, (_, k) => interp(k / N_PTS))
})

const ZOOM_OUT_DUR = TL.zoomOutEnd - TL.holdEnd
const BASE_LON = -28.97 + ZOOM_OUT_DUR * 28

function getState(e, W, H) {
  const R0 = Math.min(W, H) * 0.38
  const R1 = Math.min(W, H) * 1.05
  const sLon = TL.spinEnd * 28
  const spinLon2 = (t) => BASE_LON + (t - TL.zoomOutEnd) * 28

  if (e <= TL.spinEnd)
    return { rot: [e * 28, -18, 0], scale: R0, whirlA: 1, globeA: 1, istA: 0, routeP: 0, routeA: 1, logoA: 0, logoR: R0, bgA: 0 }

  if (e <= TL.orientEnd) {
    const p = easeIO((e - TL.spinEnd) / (TL.orientEnd - TL.spinEnd))
    return {
      rot: [lerpA(sLon, -28.97, p), lerpA(-18, -41.01, p), 0], scale: R0,
      whirlA: Math.max(0, 1 - p * 2.2), globeA: 1, istA: 0, routeP: 0, routeA: 1, logoA: 0, logoR: R0, bgA: 0,
    }
  }
  if (e <= TL.zoomEnd) {
    const p = easeO3((e - TL.orientEnd) / (TL.zoomEnd - TL.orientEnd))
    return {
      rot: ROT_IST, scale: R0 + (R1 - R0) * p, whirlA: 0, globeA: 1,
      istA: e >= TL.istShow ? easeIO((e - TL.istShow) / 1.0) : 0, routeP: 0, routeA: 1, logoA: 0, logoR: R0, bgA: 0,
    }
  }
  if (e <= TL.routeDrawEnd) {
    const p = Math.max(0, (e - TL.routeStart) / (TL.routeDrawEnd - TL.routeStart))
    return { rot: ROT_IST, scale: R1, whirlA: 0, globeA: 1, istA: 1, routeP: p, routeA: 1, logoA: 0, logoR: R0, bgA: 0 }
  }
  if (e <= TL.holdEnd)
    return { rot: ROT_IST, scale: R1, whirlA: 0, globeA: 1, istA: 1, routeP: 1, routeA: 1, logoA: 0, logoR: R0, bgA: 0 }

  if (e <= TL.zoomOutEnd) {
    const p = easeIO((e - TL.holdEnd) / ZOOM_OUT_DUR)
    return {
      rot: [lerpA(-28.97, -28.97 + ZOOM_OUT_DUR * 28, p), lerpA(-41.01, -18, p), 0],
      scale: R1 + (R0 - R1) * p, whirlA: p > 0.6 ? easeIO((p - 0.6) / 0.4) : 0,
      globeA: 1, istA: Math.max(0, 1 - p * 5), routeP: 1, routeA: 1, logoA: 0, logoR: R0, bgA: 0,
    }
  }
  if (e <= TL.freeSpinEnd) {
    const dt2 = e - TL.zoomOutEnd
    return {
      rot: [spinLon2(e), -18, 0], scale: R0, whirlA: Math.min(1, dt2 / 1.5),
      globeA: 1, istA: 0, routeP: 1, routeA: Math.max(0, 1 - dt2 / 2.5), logoA: 0, logoR: R0, bgA: 0,
    }
  }
  if (e <= TL.morphEnd) {
    const p = (e - TL.freeSpinEnd) / (TL.morphEnd - TL.freeSpinEnd)
    return {
      rot: [spinLon2(e), -18, 0], scale: R0,
      whirlA: Math.max(0, 1 - p * 2.2), globeA: Math.max(0, 1 - p),
      istA: 0, routeP: 0, routeA: 0,
      logoA: p * p, logoR: R0, bgA: 0,
    }
  }
  if (e <= TL.holdLogoEnd)
    return { rot: [0, -18, 0], scale: R0, whirlA: 0, globeA: 0, istA: 0, routeP: 0, routeA: 0, logoA: 1, logoR: R0, bgA: 0 }

  const p = Math.min(1, (e - TL.holdLogoEnd) / (TL.fadeEnd - TL.holdLogoEnd))
  return { rot: [0, -18, 0], scale: R0, whirlA: 0, globeA: 0, istA: 0, routeP: 0, routeA: 0, logoA: 1 - p, logoR: R0, bgA: p }
}

function drawWhirl(ctx, cx, cy, R, t, alpha) {
  const LAYERS = [
    { r: R * 1.08, n: 9, arc: 0.38, spd: 1.1, lw: 2.2, a: 0.22 },
    { r: R * 1.14, n: 7, arc: 0.28, spd: 1.55, lw: 1.4, a: 0.14 },
    { r: R * 1.21, n: 5, arc: 0.22, spd: 2.0, lw: 1.0, a: 0.09 },
  ]
  ctx.save()
  ctx.globalAlpha = alpha
  for (const L of LAYERS) {
    const phase = t * L.spd
    for (let i = 0; i < L.n; i++) {
      const base = (i / L.n) * Math.PI * 2 + phase
      for (let s = 0; s < 17; s++) {
        const f = s / 17
        const a0 = base + f * L.arc
        const a1 = base + (f + 1 / 17) * L.arc
        ctx.beginPath()
        ctx.arc(cx, cy, L.r, a0, a1)
        ctx.strokeStyle = `rgba(26,25,23,${(L.a * Math.sin(f * Math.PI)).toFixed(3)})`
        ctx.lineWidth = L.lw
        ctx.lineCap = 'round'
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

function drawIstanbul(ctx, proj, t, alpha) {
  const pt = proj(ISTANBUL)
  if (!pt) return
  const [x, y] = pt
  ctx.save()
  ctx.globalAlpha = alpha
  for (let ring = 0; ring < 3; ring++) {
    const pulse = (t * 1.4 + ring * 0.33) % 1
    ctx.beginPath()
    ctx.arc(x, y, 4 + pulse * 22, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(26,25,23,${((1 - pulse) * 0.32).toFixed(3)})`
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(x, y, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(26,25,23,0.92)'
  ctx.fill()
  ctx.restore()
}

function drawRoutes(ctx, proj, rot, routeP, routeA) {
  if (routeA < 0.005) return
  const vc = [-rot[0], -rot[1]]
  const N = DEST.length
  const STR = 0.8 / N
  const DUR = 0.2
  ctx.lineWidth = 0.8
  ctx.lineCap = 'round'

  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const s = i * STR
    if (routeP < s) break
    if (routeP < s + DUR) continue
    let b = false
    const gpts = ROUTE_GEO[i]
    for (let k = 0; k <= N_PTS; k++) {
      const c = gpts[k]
      if (geoDistance(c, vc) >= Math.PI / 2) { b = false; continue }
      const pt = proj(c)
      if (!pt) { b = false; continue }
      if (!b) { ctx.moveTo(pt[0], pt[1]); b = true } else ctx.lineTo(pt[0], pt[1])
    }
  }
  ctx.strokeStyle = `rgba(26,25,23,${(0.44 * routeA).toFixed(3)})`
  ctx.stroke()

  for (let i = 0; i < N; i++) {
    const s = i * STR
    if (routeP < s) break
    const p = (routeP - s) / DUR
    if (p >= 1) continue
    let b = false
    const gpts = ROUTE_GEO[i]
    ctx.beginPath()
    for (let k = 0; k <= Math.floor(N_PTS * p); k++) {
      const c = gpts[k]
      if (geoDistance(c, vc) >= Math.PI / 2) { b = false; continue }
      const pt = proj(c)
      if (!pt) { b = false; continue }
      if (!b) { ctx.moveTo(pt[0], pt[1]); b = true } else ctx.lineTo(pt[0], pt[1])
    }
    ctx.strokeStyle = `rgba(26,25,23,${(Math.min(1, p * 3) * 0.44 * routeA).toFixed(3)})`
    ctx.stroke()
  }

  for (let i = 0; i < N; i++) {
    const s = i * STR
    if (routeP < s) break
    if (routeP < s + DUR) continue
    const dest = DEST[i]
    if (geoDistance(dest, vc) >= Math.PI / 2) continue
    const pt = proj(dest)
    if (!pt) continue
    ctx.beginPath()
    ctx.arc(pt[0], pt[1], 1.8, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(26,25,23,${(0.56 * routeA).toFixed(3)})`
    ctx.fill()
  }
}

function drawGlobe(ctx, path, gGraticule, gLand, gBorders, alpha) {
  const sphere = { type: 'Sphere' }
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath(); path(sphere); ctx.fillStyle = '#f4f3f0'; ctx.fill()
  ctx.beginPath(); path(gGraticule); ctx.strokeStyle = 'rgba(26,25,23,0.05)'; ctx.lineWidth = 0.5; ctx.stroke()
  ctx.beginPath(); path(gLand); ctx.fillStyle = 'rgba(26,25,23,0.09)'; ctx.fill()
  ctx.beginPath(); path(gLand); ctx.strokeStyle = 'rgba(26,25,23,0.50)'; ctx.lineWidth = 0.65; ctx.stroke()
  ctx.beginPath(); path(gBorders); ctx.strokeStyle = 'rgba(26,25,23,0.17)'; ctx.lineWidth = 0.4; ctx.stroke()
  ctx.beginPath(); path(sphere); ctx.strokeStyle = 'rgba(26,25,23,0.40)'; ctx.lineWidth = 1.1; ctx.stroke()
  ctx.restore()
}

const THY_PATH = typeof Path2D !== 'undefined' ? new Path2D(THY_PATH_D) : null

function drawTHYLogo(ctx, cx, cy, R, alpha) {
  if (!THY_PATH) return
  const s = (R * 2) / 24
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(cx - 12 * s, cy - 12 * s)
  ctx.scale(s, s)
  ctx.fillStyle = '#c80c0f'
  ctx.fill(THY_PATH)
  ctx.restore()
}

/**
 * Turkish Airlines brand loading animation: a spinning globe orients to
 * Istanbul, draws the route network, zooms out, and morphs into the THY
 * wordmark before looping. Sized to its container (not the viewport) so it
 * can drop into a bounded card — e.g. the scan-status panel while a folder
 * scan is running. One instance only: this is not meant for per-thumbnail
 * use (see the geo-projection cost in drawGlobe/drawRoutes).
 */
export default function GlobeLoader({ className = '' }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ctx = canvas.getContext('2d')
    const gLand = feature(worldAtlas, worldAtlas.objects.land)
    const gBorders = mesh(worldAtlas, worldAtlas.objects.countries, (a, b) => a !== b)
    const gGraticule = geoGraticule()()
    const proj = geoOrthographic().clipAngle(90)
    const path = geoPath(proj, ctx)

    function resize() {
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    function renderFrame(e) {
      const W = canvas.width / (Math.min(window.devicePixelRatio || 1, 2))
      const H = canvas.height / (Math.min(window.devicePixelRatio || 1, 2))
      const cx = W / 2
      const cy = H / 2
      const S = getState(e, W, H)
      proj.scale(S.scale).translate([cx, cy]).rotate(S.rot)
      ctx.clearRect(0, 0, W, H)
      if (S.globeA > 0.005) drawGlobe(ctx, path, gGraticule, gLand, gBorders, S.globeA)
      if (S.whirlA > 0.005) drawWhirl(ctx, cx, cy, S.scale, e, S.whirlA)
      if (S.routeP > 0 && S.routeA > 0.005) drawRoutes(ctx, proj, S.rot, S.routeP, S.routeA)
      if (S.istA > 0.01) drawIstanbul(ctx, proj, e, S.istA)
      if (S.logoA > 0.01) drawTHYLogo(ctx, cx, cy, S.logoR, S.logoA)
      if (S.bgA > 0.005) {
        ctx.fillStyle = `rgba(244,243,240,${S.bgA.toFixed(3)})`
        ctx.fillRect(0, 0, W, H)
      }
    }

    if (reducedMotion) {
      // Static frame: hold on the finished logo, no motion.
      renderFrame(TL.holdLogoEnd)
      return () => ro.disconnect()
    }

    let rafId = null
    let startTime = null
    let hiddenAt = null

    function frame(ts) {
      if (startTime == null) startTime = ts
      let e = (ts - startTime) / 1000
      if (e >= TL.loopAt) { startTime = ts; e = 0 }
      renderFrame(e)
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    function onVisibility() {
      if (document.hidden) {
        hiddenAt = performance.now()
        if (rafId) cancelAnimationFrame(rafId)
        rafId = null
      } else {
        if (hiddenAt && startTime) startTime += performance.now() - hiddenAt
        hiddenAt = null
        if (!rafId) rafId = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
    }
  }, [])

  return (
    <div ref={containerRef} className={`relative w-full h-full overflow-hidden ${className}`} style={{ background: '#f4f3f0' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  )
}
