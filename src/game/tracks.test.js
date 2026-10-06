import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TRACK_ID, TRACKS, getTrack, getTrackData } from './tracks.js'
import { trackFromData } from './track.js'

describe('track library', () => {
  it('Switchback Park is the default', () => {
    expect(DEFAULT_TRACK_ID).toBe('switchback')
    expect(getTrackData('nope').id).toBe('switchback')
    expect(getTrack('speedway')).toBe(getTrack('speedway')) // cached
  })

  it('every premade validates and has the full kit', () => {
    expect(TRACKS.length).toBe(6)
    for (const t of TRACKS) {
      const res = trackFromData(t.data)
      expect(res.ok, t.id).toBe(true)
      expect(t.data.points.length).toBeGreaterThan(20)
      expect(t.data.boxes).toHaveLength(6)
      expect(t.data.pit.length).toBeGreaterThan(200)
      expect(t.data.start.angle).toBeDefined()
      // fits on a laptop screen: everything inside the world with margin
      for (const [x, y] of t.data.points) {
        expect(x, `${t.id} x`).toBeGreaterThanOrEqual(40)
        expect(x, `${t.id} x`).toBeLessThanOrEqual(1560)
        expect(y, `${t.id} y`).toBeGreaterThanOrEqual(40)
        expect(y, `${t.id} y`).toBeLessThanOrEqual(860)
      }
      expect(t.data.pit.cx).toBeGreaterThanOrEqual(40)
      expect(t.data.pit.cx).toBeLessThanOrEqual(1560)
      expect(t.data.pit.cy).toBeGreaterThanOrEqual(40)
      expect(t.data.pit.cy).toBeLessThanOrEqual(860)
    }
  })

  it('circle is actually round and big', () => {
    const { data } = getTrackData('speedway')
    const cx = data.points.reduce((s, p) => s + p[0], 0) / data.points.length
    const cy = data.points.reduce((s, p) => s + p[1], 0) / data.points.length
    const radii = data.points.map(p => Math.hypot(p[0] - cx, p[1] - cy))
    const avg = radii.reduce((s, r) => s + r, 0) / radii.length
    expect(avg).toBeGreaterThan(300)
    for (const r of radii) expect(Math.abs(r - avg)).toBeLessThan(avg * 0.05)
  })
})

describe('every premade hosts a full AI race', () => {
  it.each(TRACKS.map(t => [t.id]))('%s completes with a winner', async id => {
    let s = 987654321
    vi.spyOn(Math, 'random').mockImplementation(() => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 2 ** 32
    })
    try {
      const { aiInput, aiItems } = await import('../../server/sim.js')
      const { LocalRace } = await import('./localRace.js')
      const { data } = getTrackData(id)
      const race = new LocalRace({ playerName: 'Tester', trackData: data })
      let now = 9_000_000
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
        race.pitPress()
        race.tick(now, 50)
      }
      expect(race.race.phase).toBe('finished')
      expect(race.race.winnerSeat).toBeGreaterThanOrEqual(0)
    } finally {
      vi.restoreAllMocks()
    }
  }, 90000)
})
