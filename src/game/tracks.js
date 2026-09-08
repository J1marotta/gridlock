// Premade track library. Speedway (big circle) is the default; Riverside is
// the original hand-built loop. All entries validate and host full AI races
// in tracks.test.js — nothing ships unraceable.
import { buildTrack, makeTrack } from './track.js'
import { prepareData } from './trackEdit.js'

function circlePoints(cx, cy, r, n = 64, startAngle = Math.PI / 2) {
  // sweep decreasing angle so the start heads east along the bottom
  return Array.from({ length: n }, (_, i) => {
    const a = startAngle - (i / n) * Math.PI * 2
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}

function roundedRectPoints(cx, cy, w, h, r, per = 16) {
  const arcs = [
    [cx + w / 2 - r, cy - h / 2 + r, -90, 0],
    [cx + w / 2 - r, cy + h / 2 - r, 0, 90],
    [cx - w / 2 + r, cy + h / 2 - r, 90, 180],
    [cx - w / 2 + r, cy - h / 2 + r, 180, 270],
  ]
  const pts = []
  for (const [ax, ay, a0, a1] of arcs) {
    for (let i = 0; i < per; i += 1) {
      const a = ((a0 + ((a1 - a0) * i) / per) * Math.PI) / 180
      pts.push([ax + Math.cos(a) * r, ay + Math.sin(a) * r])
    }
  }
  return pts
}

function kidneyPoints(cx, cy, base, wobble, phase, n = 72) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const r = base * (1 + wobble * Math.cos(2 * a + phase))
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}

function premade(id, name, blurb, points) {
  const res = prepareData(points, { name })
  if (!res.ok) throw new Error(`Premade ${id} failed: ${res.errors.join('; ')}`)
  return { id, name, blurb, data: res.data, warnings: res.warnings }
}

// Riverside: the original hand-tuned loop, exactly as built (pit included).
function riversideData() {
  const stock = buildTrack()
  return {
    name: 'Riverside Park',
    points: stock.points,
    halfWidth: stock.halfWidth,
    pit: stock.pit,
    levels: stock.levels,
    boxes: stock.boxes,
    start: stock.start,
  }
}

export const TRACKS = [
  premade('speedway', 'Speedway', 'Big circle. Flat out, close packs, pits decide it.', circlePoints(800, 450, 390)),
  { id: 'riverside', name: 'Riverside Park', blurb: 'The original: sweeper, Esses, climb, hairpin, infield.', data: riversideData(), warnings: [] },
  premade('hairpin', 'Hairpin Alley', 'Stadium straights, brutal hairpins both ends.', roundedRectPoints(800, 450, 1050, 430, 70)),
  premade('esses', 'The Esses', 'Kidney loop — curvature never sits still.', kidneyPoints(800, 450, 335, 0.16, 0.6)),
]

export const DEFAULT_TRACK_ID = 'speedway'

export function getTrackData(id) {
  return TRACKS.find(t => t.id === id) ?? TRACKS[0]
}

// Runtime object (cached per id).
const cache = new Map()
export function getTrack(id) {
  if (!cache.has(id)) {
    const { data } = getTrackData(id)
    const built = makeTrack(data.points, data)
    cache.set(id, built)
  }
  return cache.get(id)
}
