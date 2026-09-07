import { describe, expect, it } from 'vitest'
import {
  HALF_WIDTH, WORLD_H, WORLD_W,
  buildDecor, buildTrack, closestOnTrack, gateAt, gridSlot, inPitBox, inPitZone, pitBox, pointAhead,
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

  it('grid slots sit behind the start line on the straight', () => {
    for (let i = 0; i < 12; i += 1) {
      const s = gridSlot(i)
      expect(s.x).toBeLessThan(300)
      expect(Math.abs(s.y - 748)).toBeLessThan(HALF_WIDTH)
    }
  })

  it('pit boxes live inside the pit zone', () => {
    expect(inPitZone(500, 832)).toBe(true)
    expect(inPitZone(500, 748)).toBe(false)
    for (let i = 0; i < 12; i += 1) {
      const b = pitBox(i)
      expect(inPitBox(i, b.x, b.y)).toBe(true)
    }
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
})
