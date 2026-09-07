// Riverside Park — one big hand-built circuit, always fully visible.
// World is 1600x900. Cars drive the loop counter-clockwise starting east
// along the bottom straight: sweeper, S-curves, climb, top straight,
// hairpin, drop, infield twist, home straight.
//
// Tracks are DATA (see makeTrack): the paint studio builds custom ones with
// the same shape, so the sim, renderer and pits work on any loop.
export const WORLD_W = 1600
export const WORLD_H = 900
export const HALF_WIDTH = 46
export const GATE_COUNT = 12

const CENTER = [
  [240, 740], [420, 748], [600, 748], [780, 742],
  [940, 720], [1040, 670], [1100, 600],
  [1120, 520], [1060, 460], [980, 470], [920, 430],
  [880, 350], [930, 280], [1020, 250],
  [1180, 245], [1330, 260],
  [1440, 300], [1480, 380], [1440, 450],
  [1360, 500], [1370, 580], [1310, 640],
  [1210, 650], [1140, 700], [1010, 690],
  [880, 700], [700, 730], [520, 745], [360, 748],
]

const DEFAULT_PIT = { x0: 170, x1: 1030, y0: 792, y1: 872 }
const DEFAULT_BOX_SPOTS = [3, 8, 13, 16, 20, 24]

function segLen(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

// Full track object from a raw loop. Options override the auto-derived bits.
export function makeTrack(points, opts = {}) {
  const pts = points.map(p => [...p])
  const n = pts.length
  const cum = [0]
  for (let i = 0; i < n; i += 1) {
    cum.push(cum[i] + segLen(points[i], points[(i + 1) % n]))
  }
  const total = cum[n]
  const halfWidth = opts.halfWidth ?? HALF_WIDTH
  const start = opts.start ?? {
    x: pts[0][0],
    y: pts[0][1],
    angle: Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]),
  }
  const pit = opts.pit ?? { ...DEFAULT_PIT }
  const pitBoxes = opts.pitBoxes ?? Array.from({ length: 12 }, (_, i) => ({ x: 300 + i * 55, y: 832 }))
  const boxes = opts.boxes ?? DEFAULT_BOX_SPOTS.map(idx => ({ x: pts[idx % n][0], y: pts[idx % n][1] }))
  return { points: pts, cum, total, halfWidth, gateCount: GATE_COUNT, boxes, pit, pitBoxes, start }
}

export function buildTrack() {
  return makeTrack(CENTER)
}

// Rebuild a track from studio JSON. Returns { ok, track?, error? }.
export function trackFromData(data) {
  if (!data || !Array.isArray(data.points) || data.points.length < 8) {
    return { ok: false, error: 'Need at least 8 loop points' }
  }
  for (const p of data.points) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) {
      return { ok: false, error: 'Points must be [x, y] pairs' }
    }
  }
  const halfWidth = data.halfWidth ?? HALF_WIDTH
  if (!(halfWidth >= 24 && halfWidth <= 90)) return { ok: false, error: 'Width out of range' }
  return { ok: true, track: makeTrack(data.points, data) }
}

export function gridSlot(track, i) {
  // Slots ride the ribbon itself, staggered behind the start line, so every
  // seat starts on asphalt no matter the loop shape.
  const row = Math.floor(i / 2)
  const side = i % 2 === 0 ? -1 : 1
  const back = 50 + row * 48
  const c = pointAhead(track, track.total - back, 0)
  const ahead = pointAhead(track, track.total - back + 5, 0)
  const dx = ahead.x - c.x, dy = ahead.y - c.y
  const len = Math.hypot(dx, dy) || 1
  return {
    x: c.x + (-dy / len) * side * 26,
    y: c.y + (dx / len) * side * 26,
    angle: Math.atan2(dy, dx),
  }
}

export function pitBoxFor(track, seat) {
  const b = track.pitBoxes[seat % track.pitBoxes.length]
  return { x: b.x, y: b.y, w: 44, h: 60 }
}

export function inPitZone(track, x, y) {
  const p = track.pit
  return x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1
}

export function inPitBox(track, seat, x, y) {
  const b = pitBoxFor(track, seat)
  return Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2
}

// Closest point on the loop. Returns distance, cumulative along-distance,
// segment index and the closest point.
export function closestOnTrack(track, x, y) {
  const { points, cum } = track
  const n = points.length
  let best = { dist: Infinity, along: 0, seg: 0, px: x, py: y }
  for (let i = 0; i < n; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const abx = b[0] - a[0], aby = b[1] - a[1]
    const len2 = abx * abx + aby * aby || 1
    let t = ((x - a[0]) * abx + (y - a[1]) * aby) / len2
    t = Math.min(1, Math.max(0, t))
    const px = a[0] + abx * t, py = a[1] + aby * t
    const d = Math.hypot(x - px, y - py)
    if (d < best.dist) best = { dist: d, along: cum[i] + Math.sqrt(len2) * t, seg: i, px, py }
  }
  return best
}

export function gateAt(track, along) {
  const a = ((along % track.total) + track.total) % track.total
  const gate = Math.floor((a / track.total) * track.gateCount) % track.gateCount
  return { gate, gateStart: (gate / track.gateCount) * track.total }
}

// Point ahead on the centerline (for AI steering + minimap dots).
export function pointAhead(track, along, aheadDist) {
  const a = ((along + aheadDist) % track.total + track.total) % track.total
  const { points, cum } = track
  const n = points.length
  for (let i = 0; i < n; i += 1) {
    if (a >= cum[i] && a <= cum[i + 1]) {
      const p = points[i], q = points[(i + 1) % n]
      const t = cum[i + 1] === cum[i] ? 0 : (a - cum[i]) / (cum[i + 1] - cum[i])
      return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t }
    }
  }
  return { x: points[0][0], y: points[0][1] }
}

// Seeded decor that stays clear of the racing surface.
export function mulberry(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildDecor(track, seed = 7) {
  const rnd = mulberry(seed)
  const trees = []
  const houses = []
  const fields = []
  let guard = 0
  while (trees.length < 90 && guard++ < 2000) {
    const x = 40 + rnd() * (WORLD_W - 80)
    const y = 40 + rnd() * (WORLD_H - 80)
    if (closestOnTrack(track, x, y).dist < 95) continue
    if (inPitZone(track, x, y)) continue
    trees.push({ x, y, s: 8 + rnd() * 10 })
  }
  const houseSpots = [[150, 560], [1370, 130], [420, 420], [1500, 700], [650, 130]]
  for (const [hx, hy] of houseSpots) {
    if (closestOnTrack(track, hx, hy).dist < 110) continue
    houses.push({ x: hx, y: hy, w: 70 + rnd() * 40, h: 50 + rnd() * 30, rot: rnd() * 0.6 - 0.3 })
  }
  const fieldSpots = [[300, 200, 220, 130], [1150, 420, 150, 110], [700, 560, 180, 100]]
  for (const [fx, fy, fw, fh] of fieldSpots) {
    if (closestOnTrack(track, fx, fy).dist < 100) continue
    fields.push({ x: fx, y: fy, w: fw, h: fh })
  }
  return { trees, houses, fields }
}
