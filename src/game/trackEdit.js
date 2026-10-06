// Paint-studio geometry: brush stroke -> raceable loop.
import { WORLD_H, WORLD_W, makeTrack, pointAhead } from './track.js'

const dist2 = (a, b) => {
  const dx = a[0] - b[0], dy = a[1] - b[1]
  return dx * dx + dy * dy
}

export function smoothClosed(points, iterations = 2) {
  let pts = points.map(p => [...p])
  for (let k = 0; k < iterations; k += 1) {
    const out = []
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    pts = out
  }
  return pts
}

export function rawLength(points) {
  let total = 0
  for (let i = 0; i < points.length; i += 1) {
    total += Math.sqrt(dist2(points[i], points[(i + 1) % points.length]))
  }
  return total
}

export function resampleClosed(points, step = 18) {
  const total = rawLength(points)
  const count = Math.max(8, Math.round(total / step))
  const out = []
  let acc = 0
  let target = 0
  const n = points.length
  for (let i = 0; i < n; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const len = Math.sqrt(dist2(a, b)) || 0.0001
    while (target <= acc + len && out.length < count) {
      const t = (target - acc) / len
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      target += total / count
    }
    acc += len
  }
  while (out.length < count) out.push([...points[0]])
  return out.slice(0, count)
}

export function segSegDist(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1]
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1]
  const rxs = d1x * d2y - d1y * d2x
  if (Math.abs(rxs) < 1e-9) {
    // parallel: min endpoint distance
    return Math.sqrt(Math.min(
      dist2(p1, p3), dist2(p1, p4), dist2(p2, p3), dist2(p2, p4),
    ))
  }
  const qpx = p1[0] - p3[0], qpy = p1[1] - p3[1]
  const t = (qpx * d2y - qpy * d2x) / rxs
  const u = (qpx * d1y - qpy * d1x) / rxs
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
  const ptSeg = (p, a, b) => {
    const abx = b[0] - a[0], aby = b[1] - a[1]
    const t2 = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / ((abx * abx + aby * aby) || 1)))
    return Math.hypot(p[0] - (a[0] + abx * t2), p[1] - (a[1] + abx * t2))
  }
  return Math.min(ptSeg(p1, p3, p4), ptSeg(p2, p3, p4), ptSeg(p3, p1, p2), ptSeg(p4, p1, p2))
}

export function findPinches(points, halfWidth) {
  const n = points.length
  const cum = [0]
  for (let i = 0; i < n; i += 1) {
    const a = points[i], b = points[(i + 1) % n]
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = cum[n] || 1
  const arcDist = (a, b) => {
    const d = Math.abs(a - b) % total
    return Math.min(d, total - d)
  }
  const pinches = []
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue // closing pair is adjacent
      // nearest arclength gap between any endpoints (wrap-aware)
      let sep = Infinity
      for (const a of [cum[i] % total, cum[i + 1] % total]) {
        for (const b of [cum[j] % total, cum[j + 1] % total]) {
          sep = Math.min(sep, arcDist(a, b))
        }
      }
      if (sep < total * 0.2) continue
      const a = points[i], b = points[(i + 1) % n]
      const c = points[j], d = points[(j + 1) % n]
      if (segSegDist(a, b, c, d) < halfWidth * 2 + 12) {
        pinches.push({ segA: i, segB: j, x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2 })
        if (pinches.length > 8) return pinches
      }
    }
  }
  return pinches
}

export function clearanceAt(points, halfWidth, x, y) {
  let best = Infinity
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length]
    const abx = b[0] - a[0], aby = b[1] - a[1]
    const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / ((abx * abx + aby * aby) || 1)))
    best = Math.min(best, Math.hypot(x - (a[0] + abx * t), y - (a[1] + aby * t)))
  }
  return best - halfWidth
}

export function autoPit(points, halfWidth) {
  // Strongest straight wins: longest window with the best chord/arc ratio,
  // so the lane sits beside real straightaway instead of a curve tangent.
  // The center stays on a ribbon point (reachable); only the angle comes
  // from the chord, keeping the edges parallel to the straight.
  const n = points.length
  const k = Math.max(2, Math.round(n / 16))
  const hop = i => Math.sqrt(dist2(points[((i % n) + n) % n], points[(((i + 1) % n) + n) % n]))
  let best = null
  for (let i = 0; i < n; i += 1) {
    let arc = 0
    for (let j = i - k; j < i + k; j += 1) arc += hop(j)
    const a = points[(((i - k) % n) + n) % n]
    const b = points[(i + k) % n]
    const chord = Math.sqrt(dist2(a, b))
    const score = arc * (chord / (arc || 1)) ** 2
    if (!best || score > best.score + 1e-9) best = { score, i, arc, chord }
  }
  const a = points[(((best.i - k) % n) + n) % n]
  const b = points[(best.i + k) % n]
  const chord = Math.sqrt(dist2(a, b)) || 1
  const dx = (b[0] - a[0]) / chord
  const dy = (b[1] - a[1]) / chord
  const m0 = points[best.i]
  const m1 = points[(best.i + 1) % n]
  const mx = (m0[0] + m1[0]) / 2
  const my = (m0[1] + m1[1]) / 2
  const off = halfWidth + 56
  const cands = [
    { x: mx - dy * off, y: my + dx * off },
    { x: mx + dy * off, y: my - dx * off },
  ]
  const scored = cands.map(c => {
    const inBounds = c.x > 90 && c.x < WORLD_W - 90 && c.y > 90 && c.y < WORLD_H - 90
    return { ...c, clear: clearanceAt(points, halfWidth, c.x, c.y) - (inBounds ? 0 : 1000) }
  })
  scored.sort((p, q) => q.clear - p.clear)
  const chosen = scored[0]
  const warnings = []
  if (chosen.clear < 24) warnings.push('Pit lane is close to the track — expect chaos')
  return {
    pit: {
      cx: Math.round(chosen.x), cy: Math.round(chosen.y),
      angle: Math.atan2(dy, dx),
      length: Math.round(Math.min(860, best.chord + 200)), width: 96,
    },
    warnings,
  }
}

export function validateLoop(points, halfWidth) {
  const errors = []
  const warnings = []
  if (points.length < 8) errors.push('Keep painting — need a longer stroke')
  const total = rawLength(points)
  if (total < 1000) errors.push('Loop is too short (min ~1000px)')
  for (const [x, y] of points) {
    if (x < 20 || x > WORLD_W - 20 || y < 20 || y > WORLD_H - 20) {
      errors.push('Stay inside the park bounds')
      break
    }
  }
  const pinches = findPinches(points, halfWidth)
  if (pinches.length) warnings.push(`${pinches.length} tight spot${pinches.length > 1 ? 's' : ''} where the ribbon nearly touches — racing line may jump`)
  return { errors, warnings, total, pinches }
}

export function finalizeTrack(raw, opts = {}) {
  const halfWidth = opts.halfWidth ?? 46
  const smoothed = smoothClosed(raw, 2)
  const pts = resampleClosed(smoothed, 18)
  const check = validateLoop(pts, halfWidth)
  if (check.errors.length) return { ok: false, errors: check.errors, warnings: check.warnings }
  return prepareData(pts, {
    name: opts.name, halfWidth,
    pit: opts.pit, start: opts.start, levels: opts.levels,
    warnings: check.warnings,
  })
}

// Assemble final JSON from resampled points + optional overrides.
export function prepareData(pts, opts = {}) {
  const halfWidth = opts.halfWidth ?? 46
  const track = makeTrack(pts, { halfWidth })
  const boxes = []
  for (let k = 0; k < 6; k += 1) {
    const p = pointAhead(track, (track.total * (k + 0.5)) / 6, 0)
    boxes.push({ x: p.x, y: p.y })
  }
  const auto = autoPit(pts, halfWidth)
  const pit = opts.pit ?? auto.pit
  const start = opts.start ?? track.start
  const levels = opts.levels ?? pts.map(() => 0)
  const data = {
    name: opts.name || 'Custom Loop',
    points: pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
    halfWidth,
    pit,
    levels,
    boxes,
    start,
  }
  return { ok: true, data, warnings: [...(opts.warnings ?? []), ...auto.warnings], total: track.total }
}

export function snapToLoop(pts, x, y) {
  let best = null
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const abx = b[0] - a[0], aby = b[1] - a[1]
    const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / ((abx * abx + aby * aby) || 1)))
    const px = a[0] + abx * t, py = a[1] + aby * t
    const d = Math.hypot(x - px, y - py)
    if (!best || d < best.d) best = { d, x: px, y: py, angle: Math.atan2(aby, abx), seg: i }
  }
  return best
}

export function placePitAt(snap, halfWidth, side = 1) {
  const nx = -Math.sin(snap.angle), ny = Math.cos(snap.angle)
  return {
    cx: Math.round(snap.x + nx * side * (halfWidth + 52)),
    cy: Math.round(snap.y + ny * side * (halfWidth + 52)),
    angle: snap.angle,
    length: 620, width: 96,
  }
}
