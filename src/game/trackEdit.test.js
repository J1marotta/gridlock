import { describe, expect, it } from 'vitest'
import {
  autoPit, finalizeTrack, findPinches, rawLength, resampleClosed, segSegDist, smoothClosed, validateLoop,
} from './trackEdit.js'
import { makeTrack } from './track.js'

// A rounded-rectangle loop, clockwise.
function roundedRect(cx, cy, w, h, r, n = 8) {
  const pts = []
  const corners = [
    [cx + w / 2 - r, cy - h / 2, 0],
    [cx + w / 2, cy - h / 2 + r, 90],
    [cx + w / 2, cy + h / 2 - r, 180],
    [cx - w / 2 + r, cy + h / 2, 270],
  ]
  void corners
  const arcs = [
    [cx + w / 2 - r, cy - h / 2 + r, -90, 0],
    [cx + w / 2 - r, cy + h / 2 - r, 0, 90],
    [cx - w / 2 + r, cy + h / 2 - r, 90, 180],
    [cx - w / 2 + r, cy - h / 2 + r, 180, 270],
  ]
  for (const [ax, ay, a0, a1] of arcs) {
    for (let i = 0; i < n; i += 1) {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
      pts.push([ax + Math.cos(a) * r, ay + Math.sin(a) * r])
    }
  }
  return pts
}

describe('studio geometry', () => {
  it('smoothing kills jitter but keeps the shape', () => {
    const noisy = roundedRect(800, 450, 900, 500, 120).map(([x, y], i) => [x + (i % 2 ? 6 : -6), y + (i % 3 ? -5 : 5)])
    const calm = smoothClosed(noisy, 2)
    expect(calm.length).toBeGreaterThan(noisy.length)
    const cx = calm.reduce((s, p) => s + p[0], 0) / calm.length
    const cy = calm.reduce((s, p) => s + p[1], 0) / calm.length
    expect(cx).toBeGreaterThan(700)
    expect(cx).toBeLessThan(900)
    expect(cy).toBeGreaterThan(350)
    expect(cy).toBeLessThan(550)
    expect(Math.abs(rawLength(calm) - rawLength(noisy))).toBeLessThan(rawLength(noisy) * 0.15)
  })

  it('resampling spaces evenly', () => {
    const pts = resampleClosed(roundedRect(800, 450, 900, 500, 120), 18)
    expect(pts.length).toBeGreaterThan(100)
    const gaps = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]))
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length
    for (const g of gaps) expect(Math.abs(g - avg)).toBeLessThan(avg * 0.35 + 2)
  })

  it('segment distance finds crossings and parallels', () => {
    expect(segSegDist([0, 0], [10, 0], [5, -5], [5, 5])).toBe(0) // crossing
    expect(segSegDist([0, 0], [10, 0], [0, 10], [10, 10])).toBe(10) // parallel
  })

  it('validation rejects short, wild and open strokes', () => {
    expect(validateLoop([[100, 100], [200, 100]], 46).errors.length).toBeGreaterThan(0)
    expect(validateLoop(roundedRect(800, 450, 100, 60, 10), 46).errors.length).toBeGreaterThan(0)
    const wild = roundedRect(800, 450, 900, 500, 120).map(([x, y]) => [x + 2000, y])
    expect(validateLoop(wild, 46).errors.length).toBeGreaterThan(0)
    expect(validateLoop(roundedRect(800, 450, 900, 500, 120), 46).errors).toEqual([])
  })

  it('pinch detection spots a figure-8 waist', () => {
    const eight = [...roundedRect(600, 450, 500, 420, 100), ...roundedRect(1050, 450, 500, 420, 100)]
    const pinches = findPinches(eight, 46)
    expect(pinches.length).toBeGreaterThan(0)
    expect(findPinches(roundedRect(800, 450, 900, 500, 120), 46)).toEqual([])
  })

  it('finalize produces a raceable track with pits and boxes', () => {
    const res = finalizeTrack(roundedRect(800, 450, 900, 500, 120), { name: 'Test Oval' })
    expect(res.ok).toBe(true)
    expect(res.data.points.length).toBeGreaterThan(30)
    expect(res.data.pitBoxes).toHaveLength(12)
    expect(res.data.boxes).toHaveLength(6)
    expect(res.data.start.angle).toBeDefined()
    const track = makeTrack(res.data.points, res.data)
    expect(track.total).toBeGreaterThan(1500)
    expect(track.pitBoxes).toHaveLength(12)
  })

  it('auto pit lands clear of the ribbon', () => {
    const pts = roundedRect(800, 450, 900, 500, 120)
    const { pit, pitBoxes } = autoPit(pts, 46)
    expect(pit.x1).toBeGreaterThan(pit.x0)
    expect(pit.y1).toBeGreaterThan(pit.y0)
    expect(pitBoxes).toHaveLength(12)
  })

  it('a finalized custom track hosts a full AI race', async () => {
    const { aiInput, aiItems } = await import('../../server/sim.js')
    const { LocalRace } = await import('./localRace.js')
    const res = finalizeTrack(roundedRect(800, 450, 900, 500, 120), { name: 'Studio Oval' })
    expect(res.ok).toBe(true)
    const race = new LocalRace({ playerName: 'Tester', trackData: res.data })
    expect(race.trackName).toBe('Studio Oval')
    let now = 5_000_000
    race.start(now)
    now = race.race.countdownEndsAt + 50
    race.tick(now, 50)
    expect(race.race.phase).toBe('racing')
    const me = () => race.race.cars[0]
    let ticks = 0
    while (race.race.phase === 'racing' && ticks++ < 30000) {
      now += 50
      const ai = aiInput(race.race, me())
      race.setInput(ai.steer, ai.throttle)
      aiItems(race.race, me())
      if (me().pitState === 'crew') race.pressSpace()
      race.tick(now, 50)
    }
    expect(race.race.phase).toBe('finished')
    expect(race.race.winnerSeat).toBeGreaterThanOrEqual(0)
    expect(me().lap).toBeGreaterThanOrEqual(1)
  }, 60000)
})
