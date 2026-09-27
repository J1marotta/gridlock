// Premade track library. Speedway is the default.
import { makeTrack } from './track.js'
import { prepareData, smoothClosed } from './trackEdit.js'

function circlePoints(cx, cy, r, n = 64, startAngle = Math.PI / 2) {
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

function switchbackPoints() {
  return [
    [250, 720], [550, 720], [850, 720], [1150, 720], [1330, 700],
    [1430, 635], [1470, 535], [1450, 445], [1390, 385], [1300, 355],
    [1170, 350], [1030, 365], [935, 405], [880, 455], [825, 485],
    [755, 478], [685, 450], [635, 405], [570, 375], [475, 355],
    [365, 360], [270, 395], [205, 455], [175, 535], [190, 620], [230, 690],
  ]
}

function premade(id, name, blurb, points) {
  const source = id === 'switchback' ? smoothClosed(points, 2) : points
  const res = prepareData(source, { name })
  if (!res.ok) throw new Error(`Premade ${id} failed: ${res.errors.join('; ')}`)
  return { id, name, blurb, data: res.data, warnings: res.warnings }
}

export const TRACKS = [
  premade('switchback', 'Switchback Park', 'Fast front straight, a tight hairpin and a flowing chicane.', switchbackPoints()),
  premade('speedway', 'Speedway', 'Big circle. Flat out, close packs, pits decide it.', circlePoints(800, 450, 390)),
  premade('hairpin', 'Hairpin Alley', 'Stadium straights, brutal hairpins both ends.', roundedRectPoints(800, 450, 1050, 430, 70)),
  premade('esses', 'The Esses', 'Kidney loop — curvature never sits still.', kidneyPoints(800, 450, 335, 0.16, 0.6)),
]

export const DEFAULT_TRACK_ID = 'switchback'

export function getTrackData(id) {
  return TRACKS.find(t => t.id === id) ?? TRACKS.find(t => t.id === DEFAULT_TRACK_ID)
}

export function getTrackVoteOptions(currentTrackId, seed = 1) {
  const pool = TRACKS.filter(t => t.id !== currentTrackId)
  const start = Math.abs(Math.floor(seed)) % pool.length
  return Array.from({ length: Math.min(3, pool.length) }, (_, i) => pool[(start + i) % pool.length])
}

const cache = new Map()
export function getTrack(id) {
  if (!cache.has(id)) {
    const { data } = getTrackData(id)
    const built = makeTrack(data.points, data)
    cache.set(id, built)
  }
  return cache.get(id)
}
