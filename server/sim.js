// Gridlock authoritative sim. Shared by the Colyseus room and solo mode.
import {
  WORLD_H, WORLD_W,
  buildTrack, closestOnTrack, closestOnTrackLevel, gateAt, gridSlot, inPitZone, levelAt, pitCenter, pointAhead,
} from '../src/game/track.js'
import { cloneTune } from '../src/game/tune.js'

export const SERVER_TICK_MS = 50
export const BASE_TOP = 340
export const CAR_R = 11
export const VAN_HIT_R = 9
export const SEAT_COLORS = [
  '#ff3355', '#ff9f1c', '#ffee33', '#44ff66',
  '#22dd88', '#33ccff', '#3366ff', '#c26bff',
  '#ff6bfb', '#ffffff', '#8a5a2b', '#9aa0a6',
]
const ITEM_POOL = ['boost', 'oil', 'shield']
const RANK_WEIGHTS = {
  boost: [2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10],
  oil: [10, 9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 2],
  shield: [3, 3, 4, 5, 6, 7, 8, 8, 8, 8, 8, 8],
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const TAU = Math.PI * 2
export function catchupMul(tune, place) {
  return 1 + (tune.car.catchupPerPlace ?? 0) * Math.max(0, (place ?? 1) - 6)
}
export function angDiff(a, b) {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

export function createRace(tune = cloneTune(), trackOverride = null) {
  const track = trackOverride ?? buildTrack()
  return {
    tune, track,
    phase: 'lobby', // lobby | countdown | racing | finished
    countdownEndsAt: 0,
    raceEndsAt: Number.MAX_SAFE_INTEGER,
    winnerSeat: -1,
    winnerTimeMs: 0,
    cars: [],
    vans: [],
    hazards: [],
    hazardSeq: 0,
    boxes: track.boxes.map(() => 0),
    events: [],
    now: 0,
    finalLapAnnounced: false,
  }
}

export function logEvent(race, kind, text, seat = -1) {
  race.events.push({ kind, text, seat, at: race.now })
  while (race.events.length > 40) {
    const idx = race.events.findIndex(e => e.kind !== 'win')
    if (idx === -1) race.events.shift()
    else race.events.splice(idx, 1)
  }
}

export function addCar(race, { playerId, name, color, isNpc, seat }) {
  const slot = gridSlot(race.track, seat)
  const info = closestOnTrack(race.track, slot.x, slot.y)
  const car = {
    seat, playerId, name, color, isNpc: Boolean(isNpc),
    x: slot.x, y: slot.y, angle: slot.angle, vx: 0, vy: 0,
    along: info.along, lastAlong: info.along, alongU: info.along,
    seg: info.seg, level: levelAt(race.track, info.seg),
    lap: 1, nextGate: 1, looped: false, progress: 0, place: seat + 1, // grid sits in gate 11; opening crossing must not count
    wear: 0, item: '', itemHeldMs: 0,
    boostUntil: 0, spinUntil: 0, spinDir: 1, shieldUntil: 0, lastHonk: -9999,
    pitState: 'none', pitHoldMs: 0, pitNeedleT: 0, pitWorkMs: 0, pitTotalMs: 0, pitAutoAt: 0, pitGrade: '',
    pitArmed: true,
    finished: false, finishTimeMs: 0,
    input: { steer: 0, throttle: 0 },
    aiPitTarget: false,
  }
  race.cars.push(car)
  return car
}

function updateGates(race, car) {
  const { gate } = gateAt(race.track, car.along)
  if (gate !== car.nextGate) return
  if (gate === 0) {
    if (car.looped) {
      car.lap += 1
      car.looped = false
      if (car.lap > race.tune.race.laps && !car.finished) {
        car.finished = true
        car.finishTimeMs = race.now
      }
    }
    car.nextGate = 1
  } else {
    if (gate === 6) car.looped = true
    car.nextGate = (gate + 1) % race.track.gateCount
  }
}

function rollItem(race, rank) {
  const idx = clamp(rank - 1, 0, 11)
  const opts = ITEM_POOL.filter(k => race.tune.items[k])
  if (!opts.length) return ''
  let total = 0
  const weights = opts.map(k => {
    const w = RANK_WEIGHTS[k][idx]
    total += w
    return w
  })
  let r = Math.random() * total
  for (let i = 0; i < opts.length; i += 1) {
    r -= weights[i]
    if (r <= 0) return opts[i]
  }
  return opts[opts.length - 1]
}

function dropHazard(race, car, kind) {
  const bx = car.x - Math.cos(car.angle) * (CAR_R + 12)
  const by = car.y - Math.sin(car.angle) * (CAR_R + 12)
  race.hazardSeq += 1
  race.hazards.push({
    id: race.hazardSeq, kind, x: bx, y: by,
    owner: car.playerId, until: race.now + race.tune.items.hazardLifeMs,
  })
}

export function useItem(race, car) {
  const item = car.item
  if (!item || car.finished || car.pitState !== 'none') return false
  const t = race.tune.items
  if (item === 'boost') car.boostUntil = race.now + t.boostMs
  else if (item === 'oil') dropHazard(race, car, 'oil')
  else if (item === 'shield') car.shieldUntil = race.now + t.shieldMs
  else return false
  car.item = ''
  return true
}

export function honk(race, car) {
  if (!car || car.finished || race.phase !== 'racing') return false
  if (race.now - car.lastHonk < 3000) return false
  car.lastHonk = race.now
  logEvent(race, 'horn', `📯 ${car.name} honks!`, car.seat)
  return true
}

function hitHazard(race, car, hz) {
  const t = race.tune.items
  if (hz.owner === car.playerId) return
  if (hz.kind === 'oil') {
    if (race.now < car.shieldUntil) {
      car.shieldUntil = 0
      hz.until = 0
      logEvent(race, 'shield', `🛡 ${car.name}'s shield eats the oil!`, car.seat)
      return
    }
    car.spinUntil = race.now + t.oilSpinMs
    car.spinDir = Math.random() < 0.5 ? -1 : 1
    hz.until = 0
    logEvent(race, 'spin', `🌀 ${car.name} spins on oil!`, car.seat)
  }
}

function stepCar(race, car, dt) {
  const tune = race.tune
  const now = race.now
  if (car.finished) return

  if (car.pitState === 'crew' || car.pitState === 'working') {
    car.vx *= 1 - Math.min(1, 10 * dt)
    car.vy *= 1 - Math.min(1, 10 * dt)
    car.x += car.vx * dt
    car.y += car.vy * dt
    if (car.pitState === 'crew') {
      car.pitNeedleT += dt * tune.pit.needleSpeed
      if (now >= car.pitAutoAt) resolvePit(race, car, true)
      else if (!inPitZone(race.track, car.x, car.y)) {
        car.pitState = 'none'
        logEvent(race, 'pit', `${car.name} jumped the crew — no change!`, car.seat)
      }
    } else {
      car.pitWorkMs -= dt * 1000
      if (car.pitWorkMs <= 0) {
        car.wear = 0
        car.pitState = 'none'
        car.pitArmed = false // re-arms only after leaving the box
        logEvent(race, 'pit', `🔧 ${car.name} ${car.pitGrade} stop!`, car.seat)
      }
    }
    return
  }

  const { steer, throttle } = car.input
  const spinning = now < car.spinUntil
  const wearFrac = clamp(car.wear / 100, 0, 1)
  const gripMul = 1 - wearFrac * tune.tires.gripLoss
  let topMul = (1 - wearFrac * tune.tires.topLoss) * tune.car.topMul
  if (car.wear >= 100) topMul *= tune.tires.baldCap

  const info = closestOnTrackLevel(race.track, car.x, car.y, car.seg)
  car.seg = info.seg
  car.level = levelAt(race.track, info.seg)
  const off = info.dist > race.track.halfWidth
  let top = BASE_TOP * topMul
  if (off) top *= tune.car.offTopMul
  if (now < car.boostUntil) top *= tune.items.boostTopMul
  top *= catchupMul(tune, car.place)

  const dirx = Math.cos(car.angle), diry = Math.sin(car.angle)
  let vf = car.vx * dirx + car.vy * diry
  let vlx = car.vx - dirx * vf, vly = car.vy - diry * vf
  const hb = Boolean(car.input.handbrake) && vf > 60

  if (spinning) {
    car.angle += 9 * car.spinDir * dt
    vf *= 1 - Math.min(1, 3 * dt)
  } else {
    const spdF = clamp(Math.abs(vf) / 120, 0, 1)
    car.angle += steer * tune.car.steerRate * (hb ? tune.car.handbrakeTurn : 1) * spdF * (vf >= 0 ? 1 : -1) * dt
    const drifting = (Math.abs(steer) > 0.7 && Math.abs(vf) > 220) || hb
    if (throttle > 0) {
      const a = tune.car.accel * (now < car.boostUntil ? 1.6 : 1)
      vf = Math.min(top, vf + throttle * a * dt)
    } else if (throttle < 0) {
      vf = Math.max(-tune.car.reverseTop, vf + throttle * tune.car.brakePow * dt)
    } else {
      vf *= 1 - Math.min(1, 0.6 * dt)
    }
    if (hb) vf *= 1 - Math.min(1, 0.7 * dt)
    if (vf > top) vf = Math.max(top, vf - tune.car.brakePow * dt)
    const grip = tune.car.grip * gripMul * (off ? 0.7 : 1) * (drifting ? 0.45 : 1) * (hb ? 0.5 : 1)
    const decay = Math.exp(-grip * dt)
    vlx *= decay
    vly *= decay
    car.wear += tune.tires.wearRate * (Math.abs(vf) / BASE_TOP) *
      (off ? tune.tires.offWearMul : 1) * (drifting ? tune.tires.driftWearMul : 1) * dt
    car.wear = Math.min(120, car.wear)
  }

  const ndx = Math.cos(car.angle), ndy = Math.sin(car.angle)
  car.vx = ndx * vf + vlx
  car.vy = ndy * vf + vly

  if (inPitZone(race.track, car.x, car.y)) {
    const sp = Math.hypot(car.vx, car.vy)
    if (sp > tune.pit.speedLimit) {
      const k = tune.pit.speedLimit / sp
      car.vx *= k
      car.vy *= k
    }
  }

  car.x += car.vx * dt
  car.y += car.vy * dt
  car.x = clamp(car.x, 20, WORLD_W - 20)
  car.y = clamp(car.y, 20, WORLD_H - 20)

  // Level-aware walls: a bridge never collides with the road underneath.
  const w = closestOnTrackLevel(race.track, car.x, car.y, car.seg)
  car.seg = w.seg
  car.level = levelAt(race.track, w.seg)
  const maxD = race.track.halfWidth + 14
  if (w.dist > maxD && !inPitZone(race.track, car.x, car.y)) {
    const nx = (car.x - w.px) / (w.dist || 1)
    const ny = (car.y - w.py) / (w.dist || 1)
    car.x = w.px + nx * maxD
    car.y = w.py + ny * maxD
    const dot = car.vx * nx + car.vy * ny
    if (dot > 0) {
      car.vx -= nx * dot * 1.4
      car.vy -= ny * dot * 1.4
    }
  }

  // progress + gates
  let d = w.along - car.lastAlong
  if (d < -race.track.total / 2) d += race.track.total
  if (d > race.track.total / 2) d -= race.track.total
  car.alongU += clamp(d, -60, 200)
  car.lastAlong = w.along
  car.along = w.along
  updateGates(race, car)
  car.progress = car.lap * race.track.total + (car.alongU - Math.floor(car.alongU / race.track.total) * race.track.total)

  if (!car.item) {
    for (let i = 0; i < race.boxes.length; i += 1) {
      const b = race.track.boxes[i]
      if (race.now >= race.boxes[i] && Math.hypot(car.x - b.x, car.y - b.y) < 30) {
        const item = rollItem(race, car.place)
        if (item) {
          car.item = item
          car.itemHeldMs = race.now
          race.boxes[i] = race.now + tune.items.boxRespawnMs
        }
        break
      }
    }
  }

  for (const hz of race.hazards) {
    if (hz.until <= race.now) continue
    if (Math.hypot(car.x - hz.x, car.y - hz.y) < CAR_R + 13) hitHazard(race, car, hz)
  }

  if (car.isNpc && car.pitState === 'none' && car.pitArmed && inPitZone(race.track, car.x, car.y)) {
    if (Math.hypot(car.vx, car.vy) < 30) {
      car.pitHoldMs += dt * 1000
      if (car.pitHoldMs >= tune.pit.boxHoldMs) {
        car.pitState = 'crew'
        car.pitNeedleT = Math.random()
        car.pitAutoAt = race.now + 5000
        logEvent(race, 'pit', `🔧 Crew on ${car.name} — boxing for fresh tyres`, car.seat)
      }
    } else {
      car.pitHoldMs = 0
    }
  } else if (car.pitState === 'none') {
    car.pitHoldMs = 0
    if (!inPitZone(race.track, car.x, car.y)) car.pitArmed = true
  }
}

export function resolvePit(race, car, auto = false) {
  const t = race.tune.pit
  const pos = (car.pitNeedleT % 1 + 1) % 1
  const err = Math.abs(pos - 0.5)
  let grade = 'slow'
  let extra = t.slowMs
  if (!auto && err <= t.perfectHalf) { grade = 'PERFECT'; extra = t.perfectMs }
  else if (!auto && err <= t.okHalf) { grade = 'ok'; extra = t.okMs }
  car.pitGrade = grade
  car.pitWorkMs = t.crewBaseMs + extra
  car.pitTotalMs = car.pitWorkMs
  car.pitState = 'working'
}

function stepVan(race, van, dt) {
  const tune = race.tune
  const target = pointAhead(race.track, van.along + 70, 0)
  const tx = target.x + van.side * 22
  const ty = target.y
  const want = Math.atan2(ty - van.y, tx - van.x)
  van.angle += clamp(angDiff(van.angle, want), -2.2 * dt, 2.2 * dt)
  const wob = race.now < van.wobbleUntil ? 0.4 : 1
  van.speed += ((tune.traffic.speed * wob) - van.speed) * Math.min(1, 2 * dt)
  van.x += Math.cos(van.angle) * van.speed * dt
  van.y += Math.sin(van.angle) * van.speed * dt
  const info = closestOnTrackLevel(race.track, van.x, van.y, van.seg ?? 0)
  van.seg = info.seg
  van.level = levelAt(race.track, info.seg)
  van.along = info.along
  for (const car of race.cars) {
    if (car.finished) continue
    if (car.level !== van.level) continue
    if (Math.hypot(car.x - van.x, car.y - van.y) < CAR_R + VAN_HIT_R) {
      const nx = (car.x - van.x) / (Math.hypot(car.x - van.x, car.y - van.y) || 1)
      const ny = (car.y - van.y) / (Math.hypot(car.x - van.x, car.y - van.y) || 1)
      car.x = van.x + nx * (CAR_R + VAN_HIT_R)
      car.y = van.y + ny * (CAR_R + VAN_HIT_R)
      car.vx *= 0.7
      car.vy *= 0.7
      van.wobbleUntil = race.now + 1200
      logEvent(race, 'traffic', `🚐 ${car.name} tags traffic!`, car.seat)
    }
  }
}

function collideCars(race) {
  const cars = race.cars
  for (let i = 0; i < cars.length; i += 1) {
    for (let j = i + 1; j < cars.length; j += 1) {
      const a = cars[i], b = cars[j]
      if (a.finished || b.finished) continue
      if (a.level !== b.level) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d > 0 && d < CAR_R * 2) {
        const nx = dx / d, ny = dy / d
        const overlap = CAR_R * 2 - d
        a.x -= nx * overlap / 2
        a.y -= ny * overlap / 2
        b.x += nx * overlap / 2
        b.y += ny * overlap / 2
        const avn = a.vx * nx + a.vy * ny
        const bvn = b.vx * nx + b.vy * ny
        const swap = (avn - bvn) / 2
        a.vx -= nx * swap * 0.9
        a.vy -= ny * swap * 0.9
        b.vx += nx * swap * 0.9
        b.vy += ny * swap * 0.9
      }
    }
  }
}

function syncTraffic(race) {
  const want = race.tune.traffic.count
  while (race.vans.length < want) {
    const i = race.vans.length
    const along = (race.track.total / Math.max(1, want)) * i
    const p = pointAhead(race.track, along, 0)
    race.vans.push({
      id: i + 1, x: p.x, y: p.y, angle: 0, speed: 0,
      along, seg: 0, level: 0, side: i % 2 === 0 ? -1 : 1, wobbleUntil: 0,
    })
  }
  if (race.vans.length > want) race.vans.length = want
}

// Simple bot brain: chase the racing line, brake for big turns, pit when bald, spend items.
// Simple bot brain: chase the racing line, brake for big turns, pit when bald, spend items.
export function aiInput(race, car) {
  if (car.pitState !== 'none') return { steer: 0, throttle: 0 }
  const lookahead = 90 + Math.hypot(car.vx, car.vy) * 0.35
  let tx, ty
  let creep = false
  if (car.wear > 82) {
    const box = pitCenter(race.track)
    const dBox = Math.hypot(box.x - car.x, box.y - car.y)
    if (dBox < 600 || inPitZone(race.track, car.x, car.y)) {
      tx = box.x
      ty = box.y
      creep = dBox < 60
    }
  }
  if (tx === undefined) {
    if (inPitZone(race.track, car.x, car.y)) {
      // Rejoin past the pit exit instead of u-turning.
      const near = closestOnTrack(race.track, race.track.pit.cx, race.track.pit.cy)
      const p0 = race.track.points[near.seg]
      const p1 = race.track.points[(near.seg + 1) % race.track.points.length]
      const dl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1
      const reach = race.track.pit.length / 2 + 120
      tx = race.track.pit.cx + ((p1[0] - p0[0]) / dl) * reach
      ty = race.track.pit.cy + ((p1[1] - p0[1]) / dl) * reach
    } else {
      const p = pointAhead(race.track, car.along + lookahead, 0)
      tx = p.x
      ty = p.y
    }
  }
  const want = Math.atan2(ty - car.y, tx - car.x)
  const diff = angDiff(car.angle, want)
  const sp = Math.hypot(car.vx, car.vy)
  if (sp < 30 && Math.abs(diff) > 2.2) {
    return { steer: clamp(diff * 2.4, -1, 1), throttle: -0.7 }
  }
  if (creep) {
    return {
      steer: clamp(diff * 2.4, -1, 1),
      throttle: sp > 25 ? -0.6 : 0.25,
    }
  }
  const throttle = Math.abs(diff) > 1.1 ? 0.15 : 1
  return { steer: clamp(diff * 2.4, -1, 1), throttle }
}

export function aiItems(race, car) {
  if (!car.item || car.finished || car.pitState !== 'none') return
  if (!race.tune.items[car.item]) { car.item = ''; return }
  if (car.item === 'boost') {
    if (Math.hypot(car.vx, car.vy) > 200) useItem(race, car)
  } else if (car.item === 'shield') {
    if (race.now - car.itemHeldMs > 2000) useItem(race, car)
  } else if (car.item === 'oil' && race.now - car.itemHeldMs > 4000) {
    const behind = race.cars.some(o => o !== car && !o.finished &&
      Math.hypot(o.x - car.x, o.y - car.y) < 150 && o.progress < car.progress)
    if (behind || race.now - car.itemHeldMs > 9000) useItem(race, car)
  }
}

export function stepRace(race, dt, nowMs) {
  race.now = nowMs
  if (race.phase === 'countdown') {
    if (nowMs >= race.countdownEndsAt) {
      race.phase = 'racing'
      race.raceEndsAt = nowMs + race.tune.race.timeLimitMs
      logEvent(race, 'info', '🟢 GREEN GREEN GREEN!')
    } else {
      return
    }
  }
  if (race.phase !== 'racing') return

  syncTraffic(race)
  for (const car of race.cars) {
    if (car.isNpc) {
      const ai = aiInput(race, car)
      car.input.steer = ai.steer
      car.input.throttle = ai.throttle
      // Bots release with a human-ish timing spread.
      if (car.pitState === 'crew' && nowMs >= (car.pitAutoAt - 5000) + 600 + (car.seat * 137) % 900) {
        resolvePit(race, car)
      }
      aiItems(race, car)
    }
    stepCar(race, car, dt)
  }
  for (const van of race.vans) stepVan(race, van, dt)
  collideCars(race)

  race.hazards = race.hazards.filter(h => h.until > nowMs)

  const ranked = [...race.cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs
    if (a.finished !== b.finished) return a.finished ? -1 : 1
    return b.progress - a.progress
  })
  ranked.forEach((c, i) => { c.place = i + 1 })

  if (!race.finalLapAnnounced && ranked.some(c => !c.finished && c.lap >= race.tune.race.laps)) {
    race.finalLapAnnounced = true
    const leader = ranked[0]
    logEvent(race, 'info', `🔔 FINAL LAP — ${leader?.name ?? 'P1'} leads!`, leader?.seat ?? -1)
  }

  const winner = ranked.find(c => c.finished)
  if (winner && race.winnerSeat === -1) {
    race.winnerSeat = winner.seat
    race.winnerTimeMs = nowMs
    logEvent(race, 'win', `🏁 ${winner.name} wins!`, winner.seat)
  }
  const humans = race.cars.filter(c => !c.isNpc)
  const allHumansDone = humans.length > 0 && humans.every(c => c.finished)
  const graceOver = race.winnerSeat !== -1 && nowMs - race.winnerTimeMs >= race.tune.race.winnerGraceMs
  if (allHumansDone || graceOver || nowMs >= race.raceEndsAt) {
    race.phase = 'finished'
    if (race.winnerSeat === -1) {
      race.winnerSeat = ranked[0]?.seat ?? -1
      logEvent(race, 'win', `⏱ Time! ${ranked[0]?.name} takes it!`, race.winnerSeat)
    }
  }
}

export function pitProgressOf(car) {
  if (!car || car.pitState !== 'working' || !(car.pitTotalMs > 0)) return 0
  return Math.min(1, Math.max(0, 1 - car.pitWorkMs / car.pitTotalMs))
}

export function pressPit(race, car) {
  if (!car || car.finished || car.pitState !== 'none' || car.isNpc) return false
  if (!inPitZone(race.track, car.x, car.y) || car.wear < 10) return false
  car.pitState = 'working'
  car.pitGrade = 'SERVICE'
  car.pitWorkMs = Math.max(0, race.tune.pit.crewBaseMs) + 900
  car.pitTotalMs = car.pitWorkMs
  car.pitArmed = false
  car.pitHoldMs = 0
  car.vx = 0
  car.vy = 0
  logEvent(race, 'pit', `🔧 ${car.name} pits for fresh tyres`, car.seat)
  return true
}

export function startCountdown(race, nowMs) {
  race.phase = 'countdown'
  race.countdownEndsAt = nowMs + race.tune.race.countdownMs
}
