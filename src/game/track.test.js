import { describe, expect, it } from 'vitest'
import {
  HALF_WIDTH, WORLD_H, WORLD_W,
  buildDecor, buildTrack, closestOnTrack, closestOnTrackLevel, gateAt, gridSlot, inPitZone, levelAt, makeTrack, pointAhead, trackFromData,
} from './track.js'

describe('riverside park', () => {
  const track = buildTrack()

  it('loop is large and closed', () => {
    expect(track.total).toBeGreaterThan(3000)
    expect(track.points.length).toBeGreaterThan(20)
    const xs = track.points.map(p => p[0])
    const ys = track.points.map(p => p[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1100)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(450)
    for (const [x, y] of track.points) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(WORLD_W)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(WORLD_H)
    }
  })

  it('centerline points read as on-track', () => {
    for (const [x, y] of track.points) {
      expect(closestOnTrack(track, x, y).dist).toBeLessThan(1)
    }
  })

  it('far corners read as off-track', () => {
    expect(closestOnTrack(track, 60, 60).dist).toBeGreaterThan(HALF_WIDTH)
    expect(closestOnTrack(track, 800, 550).dist).toBeGreaterThan(HALF_WIDTH)
  })

  it('gates tile the loop without gaps', () => {
    let lastStart = -1
    for (let g = 0; g < 12; g += 1) {
      const { gate, gateStart } = gateAt(track, (g / 12) * track.total + 1)
      expect(gate).toBe(g)
      expect(gateStart).toBeGreaterThan(lastStart)
      lastStart = gateStart
    }
  })

  it('along-distance is continuous past the wrap', () => {
    const a = closestOnTrack(track, track.points[0][0], track.points[0][1])
    expect(a.along).toBeGreaterThanOrEqual(0)
    expect(a.along).toBeLessThan(track.total)
    const p = pointAhead(track, track.total - 10, 30)
    const c = closestOnTrack(track, p.x, p.y)
    expect(c.along).toBeLessThan(100)
  })

  it('grid slots sit on the ribbon behind the start', () => {
    for (let i = 0; i < 12; i += 1) {
      const s = gridSlot(track, i)
      expect(closestOnTrack(track, s.x, s.y).dist).toBeLessThan(HALF_WIDTH)
      // within 300m of the wrap on either reading (shared start vertex)
      const along = closestOnTrack(track, s.x, s.y).along
      expect(along > track.total - 600 || along < 300).toBe(true)
    }
  })

  it('pit lane is an oriented zone any stopped car can use', () => {
    const pit = track.pit
    expect(pit.length).toBeGreaterThan(400)
    expect(pit.width).toBeGreaterThan(60)
    // center + deep inside serve; far straight does not
    expect(inPitZone(track, pit.cx, pit.cy)).toBe(true)
    expect(inPitZone(track, 500, 748)).toBe(false)
    expect(inPitZone(track, 60, 60)).toBe(false)
  })

  it('item boxes sit on the racing surface', () => {
    for (const b of track.boxes) {
      expect(closestOnTrack(track, b.x, b.y).dist).toBeLessThan(HALF_WIDTH)
    }
    expect(track.boxes.length).toBe(6)
  })

  it('decor stays clear of the track and pits', () => {
    const d = buildDecor(track, 7)
    expect(d.trees.length).toBeGreaterThan(50)
    for (const t of d.trees) {
      expect(closestOnTrack(track, t.x, t.y).dist).toBeGreaterThanOrEqual(90)
    }
  })

  it('stock track is all ground level', () => {
    for (let i = 0; i < track.points.length; i += 1) expect(levelAt(track, i)).toBe(0)
  })

  it('windowed queries stick to their deck at an overlap', () => {
    // subdivided bowtie: straights cross at (400,400); the second
    // diagonal (segs ~12-17) is a bridge over the first (segs ~0-5)
    const leg = (a, b, n) => Array.from({ length: n }, (_, i) => [
      a[0] + ((b[0] - a[0]) * i) / n,
      a[1] + ((b[1] - a[1]) * i) / n,
    ])
    const pts = [
      ...leg([200, 200], [600, 600], 6),
      ...leg([600, 600], [200, 600], 6),
      ...leg([200, 600], [600, 200], 6),
      ...leg([600, 200], [200, 200], 6),
    ]
    const levels = pts.map((_, i) => (i >= 12 && i < 18 ? 1 : 0))
    const bow = makeTrack(pts, { levels })
    expect(bow.points.length).toBe(24)
    const ground = closestOnTrackLevel(bow, 400, 400, 3)
    expect(levelAt(bow, ground.seg)).toBe(0)
    expect(ground.seg).toBeLessThan(12)
    const bridge = closestOnTrackLevel(bow, 400, 400, 15)
    expect(levelAt(bow, bridge.seg)).toBe(1)
    expect(bridge.seg).toBeGreaterThanOrEqual(12)
    expect(bridge.seg).toBeLessThan(18)
  })

  it('legacy saves load with oriented pits', () => {
    const pts = track.points.map(p => [...p])
    const res = trackFromData({
      points: pts,
      pit: { x0: 170, x1: 1030, y0: 792, y1: 872 },
      pitBoxes: [{ x: 1, y: 2 }],
    })
    expect(res.ok).toBe(true)
    expect(res.track.pit.cx).toBe(600)
    expect(res.track.pit.angle).toBe(0)
    expect(inPitZone(res.track, 600, 832)).toBe(true)
  })
})
