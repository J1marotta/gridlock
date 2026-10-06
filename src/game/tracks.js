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

// Monza homage: flat-out start straight, T1 + Roggia chicanes, Curva
// Grande sweeper, two Lesmos, Ascari, and the long Parabolica onto the
// straight. Sparse control points — smoothed like switchback.
function monzaPoints() {
  return [
    [860, 736], [1100, 736], [1300, 730],
    [1400, 748], [1460, 720], [1468, 662],
    [1435, 600], [1355, 525], [1255, 468], [1150, 430],
    [1060, 412], [1015, 425], [970, 408],
    [880, 400], [795, 392], [730, 398], [655, 390],
    [610, 420], [622, 540], [598, 588], [608, 638],
    [645, 685], [720, 715],
  ]
}

function premade(id, name, blurb, points, smooth = false, pit = null) {
  const source = smooth ? smoothClosed(points, 2) : points
  const res = prepareData(source, { name, pit })
  if (!res.ok) throw new Error(`Premade ${id} failed: ${res.errors.join('; ')}`)
  return { id, name, blurb, data: res.data, warnings: res.warnings }
}

const MONZA_PIT = { cx: 650, cy: 838, angle: 0, length: 750, width: 96 }

// Silverstone homage: Hamilton straight, Abbey/Farm kinks, Village/Loop,
// Aintree, Brooklands, Luffield, Woodcote, Copse, Maggotts-Becketts-Chapel,
// Hanger straight, Stowe, Vale and Club. Sparse control points, smoothed.
function silverstonePoints() {
  return [
    [350, 730], [700, 730], [1050, 728],
    [1200, 715], [1300, 675], [1345, 615],
    [1330, 555], [1270, 515], [1190, 520], [1110, 490],
    [1050, 440], [1000, 390], [920, 355],
    [830, 340], [750, 355], [680, 335],
    [560, 320], [440, 325],
    [350, 345], [300, 400], [282, 470],
    [302, 528], [285, 590], [305, 665],
  ]
}

export const TRACKS = [
  premade('switchback', 'Switchback Park', 'Fast front straight, a tight hairpin and a flowing chicane.', switchbackPoints(), true),
  premade('monza', 'Monza', 'Flat-out straights, T1 and Roggia chicanes, Curva Grande, Lesmos, Ascari, Parabolica.', monzaPoints(), true, MONZA_PIT),
  premade('silverstone', 'Silverstone', 'Copse, Maggotts-Becketts-Chapel, Hanger straight, Stowe, Vale and Club.', silverstonePoints(), true),
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
