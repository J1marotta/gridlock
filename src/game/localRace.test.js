import { describe, expect, it, vi } from 'vitest'
import { aiInput, aiItems } from '../../server/sim.js'
import { LocalRace } from './localRace.js'

describe('LocalRace full solo race', () => {
  it('an AI-driven human completes laps: pits, items, traffic, winner', () => {
    // Fixed dice so the full-race run is deterministic.
    let s = 123456789
    vi.spyOn(Math, 'random').mockImplementation(() => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 2 ** 32
    })
    try {
    const race = new LocalRace({ playerName: 'Tester' })
    let now = 1_000_000
    race.start(now)
    expect(race.race.phase).toBe('countdown')
    now = race.race.countdownEndsAt + 50
    race.tick(now, 50)
    expect(race.race.phase).toBe('racing')

    const me = () => race.race.cars[0]
    me().wear = 90 // start worn so the AI must box during the race
    let ticks = 0
    let sawPit = false
    while (race.race.phase === 'racing' && ticks++ < 30000) {
      now += 50
      const ai = aiInput(race.race, me())
      race.setInput(ai.steer, ai.throttle)
      aiItems(race.race, me())
      if (me().pitState === 'crew') race.pressSpace()
      if (me().pitState !== 'none') sawPit = true
      race.tick(now, 50)
    }
    expect(race.race.phase).toBe('finished')
    expect(race.race.winnerSeat).toBeGreaterThanOrEqual(0)
    expect(me().lap).toBeGreaterThanOrEqual(2)
    expect(me().place).toBeGreaterThanOrEqual(1)
    expect(sawPit).toBe(true)
    const snap = race.snapshot()
    expect(snap.cars).toHaveLength(12)
    expect(snap.vans.length).toBeGreaterThan(0)
    expect(snap.events.some(e => e.kind === 'win')).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  }, 60000)
})
