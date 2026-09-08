import { describe, expect, it } from 'vitest'
import { cloneTune } from '../src/game/tune.js'
import { pointAhead } from '../src/game/track.js'
import {
  SEAT_COLORS, addCar, createRace, pressPit, startCountdown, stepRace, useItem,
} from './sim.js'

function testRace(tunePatch) {
  const tune = cloneTune()
  if (tunePatch) Object.assign(tune.race, tunePatch)
  const race = createRace(tune)
  addCar(race, { playerId: 'a', name: 'Alf', color: SEAT_COLORS[0], isNpc: false, seat: 0 })
  addCar(race, { playerId: 'b', name: 'Bob', color: SEAT_COLORS[1], isNpc: true, seat: 1 })
  race.phase = 'racing'
  race.now = 0
  race.raceEndsAt = Number.MAX_SAFE_INTEGER
  return race
}

const step = (race, ms, now) => stepRace(race, ms / 1000, now)

describe('gridlock driving', () => {
  it('accelerates and steers, but not when stationary', () => {
    const race = testRace()
    const [me] = race.cars
    me.input = { steer: 1, throttle: 1 }
    step(race, 50, 50)
    expect(Math.hypot(me.vx, me.vy)).toBeGreaterThan(0)
    const still = me.angle
    me.vx = 0; me.vy = 0
    me.input = { steer: 1, throttle: 0 }
    step(race, 50, 100)
    expect(me.angle).toBe(still)
  })

  it('grass is slower than asphalt', () => {
    const mk = (x, y) => {
      const tune = cloneTune()
      const r = createRace(tune)
      addCar(r, { playerId: 'g', name: 'G', color: '#fff', seat: 0 })
      const [c] = r.cars
      c.x = x; c.y = y; c.angle = 0
      r.phase = 'racing'
      r.now = 0
      r.raceEndsAt = Number.MAX_SAFE_INTEGER
      return { r, c }
    }
    // both head east along the bottom straight, one on it, one just off it
    const road = mk(500, 748)
    const grass = mk(500, 800)
    for (let t = 0; t < 2000; t += 50) {
      road.c.input = { steer: 0, throttle: 1 }
      grass.c.input = { steer: 0, throttle: 1 }
      stepRace(road.r, 0.05, t)
      stepRace(grass.r, 0.05, t)
    }
    expect(grass.c.x - 500).toBeLessThan(road.c.x - 500)
    expect(road.c.x - 500).toBeGreaterThan(250)
  })

  it('crossing the line with a full loop counts a lap and can finish', () => {
    const tune = cloneTune()
    tune.race.laps = 1
    const race = createRace(tune)
    addCar(race, { playerId: 'a', name: 'Alf', color: '#fff', seat: 0 })
    const [me] = race.cars
    race.phase = 'racing'
    const p = pointAhead(race.track, race.track.total - 40, 0)
    me.x = p.x; me.y = p.y; me.angle = 0
    me.looped = true
    me.nextGate = 0
    me.input = { steer: 0, throttle: 1 }
    for (let t = 0; t < 4000 && !me.finished; t += 50) stepRace(race, 0.05, t)
    expect(me.finished).toBe(true)
    expect(me.lap).toBe(2)
  })

  it('shortcut without the far gate does not count', () => {
    const race = testRace()
    const [me] = race.cars
    race.phase = 'racing'
    me.looped = false
    me.nextGate = 0
    const p = pointAhead(race.track, race.track.total - 40, 0)
    me.x = p.x; me.y = p.y; me.angle = 0
    me.input = { steer: 0, throttle: 1 }
    for (let t = 0; t < 3000; t += 50) stepRace(race, 0.05, t)
    expect(me.lap).toBe(1)
  })
})

describe('gridlock items', () => {
  it('disabled items never roll, enabled ones do', () => {
    const tune = cloneTune()
    Object.assign(tune.items, { boost: false, oil: false, crate: false, shield: false, zap: false })
    const race = createRace(tune)
    addCar(race, { playerId: 'a', name: 'A', color: '#fff', seat: 0 })
    const [me] = race.cars
    race.phase = 'racing'
    const box = race.track.boxes[0]
    me.x = box.x; me.y = box.y
    stepRace(race, 0.05, 50)
    expect(me.item).toBe('')
    tune.items.boost = true
    stepRace(race, 0.05, 100)
    expect(me.item).toBe('boost')
  })

  it('boost raises the ceiling, oil spins, shield absorbs', () => {
    const race = testRace()
    const [me, npc] = race.cars
    me.item = 'boost'
    expect(useItem(race, me)).toBe(true)
    expect(me.boostUntil).toBeGreaterThan(0)
    // oil under the npc spins it
    race.hazards.push({ id: 1, kind: 'oil', x: npc.x, y: npc.y, owner: 'a', until: 60000 })
    stepRace(race, 0.05, 50)
    expect(npc.spinUntil).toBeGreaterThan(0)
    // shield shrugs it off instead
    npc.spinUntil = 0
    npc.shieldUntil = 60000
    race.hazards.push({ id: 2, kind: 'oil', x: npc.x, y: npc.y, owner: 'a', until: 60000 })
    stepRace(race, 0.05, 100)
    expect(npc.spinUntil).toBe(0)
    expect(npc.shieldUntil).toBe(0)
  })

  it('zap only hits cars ahead', () => {
    const race = testRace()
    const [me, npc] = race.cars
    me.progress = 10
    npc.progress = 500
    me.item = 'zap'
    useItem(race, me)
    expect(npc.zapUntil).toBeGreaterThan(0)
    expect(me.zapUntil).toBe(0)
  })
})

describe('gridlock pits and tires', () => {
  it('bald tires force a stop, crew timing resets them', () => {
    const race = testRace()
    const [me] = race.cars
    me.wear = 120
    me.x = 300; me.y = 832; me.vx = 0; me.vy = 0
    for (let t = 0; t < 1500; t += 50) stepRace(race, 0.05, t)
    expect(me.pitState).toBe('crew')
    expect(pressPit(race, me)).toBe(true)
    expect(me.pitState).toBe('working')
    for (let t = 1500; t < 8000 && me.pitState !== 'none'; t += 50) stepRace(race, 0.05, t)
    expect(me.wear).toBe(0)
    expect(me.pitState).toBe('none')
  })

  it('worn rubber is slower than fresh', () => {
    const mk = wear => {
      const tune = cloneTune()
      tune.traffic.count = 0
      const r = createRace(tune)
      addCar(r, { playerId: 'w', name: 'W', color: '#fff', seat: 0 })
      const [c] = r.cars
      c.wear = wear
      const p = pointAhead(r.track, 300, 0)
      c.x = p.x; c.y = p.y; c.angle = 0
      r.phase = 'racing'
      r.now = 0
      r.raceEndsAt = Number.MAX_SAFE_INTEGER
      return { r, c }
    }
    const fresh = mk(0)
    const worn = mk(90)
    for (const { r, c } of [fresh, worn]) {
      for (let t = 0; t < 1500; t += 50) {
        c.input = { steer: 0, throttle: 1 }
        stepRace(r, 0.05, t)
      }
    }
    expect(Math.hypot(worn.c.vx, worn.c.vy)).toBeLessThan(
      Math.hypot(fresh.c.vx, fresh.c.vy),
    )
    expect(Math.hypot(fresh.c.vx, fresh.c.vy)).toBeGreaterThan(150)
  })
})

describe('gridlock traffic and race flow', () => {
  it('van count follows the live tune', () => {
    const race = testRace()
    race.tune.traffic.count = 2
    stepRace(race, 0.05, 50)
    expect(race.vans.length).toBe(2)
    race.tune.traffic.count = 0
    stepRace(race, 0.05, 100)
    expect(race.vans.length).toBe(0)
  })

  it('tagging a van slows the car and logs it', () => {
    const race = testRace()
    race.tune.traffic.count = 1
    stepRace(race, 0.05, 50)
    const [me] = race.cars
    const [van] = race.vans
    me.x = van.x; me.y = van.y
    me.vx = 200; me.vy = 0
    stepRace(race, 0.05, 100)
    expect(Math.hypot(me.vx, me.vy)).toBeLessThan(200)
    expect(race.events.some(e => e.kind === 'traffic')).toBe(true)
  })

  it('tune changes apply mid-race', () => {
    const race = testRace()
    const [me] = race.cars
    me.input = { steer: 0, throttle: 1 }
    stepRace(race, 0.05, 50)
    const slow = Math.hypot(me.vx, me.vy)
    race.tune.car.accel = 400
    me.vx = 0; me.vy = 0
    stepRace(race, 0.05, 100)
    expect(Math.hypot(me.vx, me.vy)).toBeGreaterThan(slow)
  })

  it('countdown leads to racing, winner grace ends it', () => {
    const tune = cloneTune()
    tune.race.laps = 1
    tune.race.winnerGraceMs = 1000
    const race = createRace(tune)
    addCar(race, { playerId: 'a', name: 'A', color: '#fff', seat: 0 })
    startCountdown(race, 0)
    expect(race.phase).toBe('countdown')
    stepRace(race, 0.05, tune.race.countdownMs + 10)
    expect(race.phase).toBe('racing')
    const [me] = race.cars
    me.finished = true
    me.finishTimeMs = tune.race.countdownMs + 10
    stepRace(race, 0.05, tune.race.countdownMs + 10)
    expect(race.winnerSeat).toBe(0)
    stepRace(race, 0.05, tune.race.countdownMs + 10 + 1000)
    expect(race.phase).toBe('finished')
  })
})
