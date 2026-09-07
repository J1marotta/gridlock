// Gridlock authoritative sim. Shared by the Colyseus room and solo mode.
// Reads the tune object every tick, so the admin panel (~) changes the live game.
import {
  WORLD_H, WORLD_W,
  buildTrack, closestOnTrack, gateAt, gridSlot, inPitBox, inPitZone, pitBoxFor, pointAhead,
} from '../src/game/track.js'
import { cloneTune } from '../src/game/tune.js'

export const SERVER_TICK_MS = 50
export const BASE_TOP = 340
export const CAR_R = 11
export const VAN_R = 15
export const SEAT_COLORS = [
  '#ff3355', '#ff9f1c', '#ffee33', '#44ff66',
  '#22dd88', '#33ccff', '#3366ff', '#c26bff',
  '#ff6bfb', '#ffffff', '#8a5a2b', '#9aa0a6',
]
const ITEM_POOL = ['boost', 'oil', 'crate', 'shield', 'zap']
const RANK_WEIGHTS = {
  boost: [1, 1, 2, 3, 4, 6, 7, 8, 9, 10, 10, 10],
  oil: [8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1, 1],
  crate: [7, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 2],
  shield: [2, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8, 8],
  zap: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const TAU = Math.PI * 2
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
  }
}

export function logEvent(race, kind, text, seat = -1) {
  race.events.push({ kind, text, seat, at: race.now })
  // Keep the feed bounded but never drop a win announcement.
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
    lap: 1, nextGate: 0, looped: false, progress: 0, place: seat + 1,
    wear: 0, item: '', itemHeldMs: 0,
    boostUntil: 0, shieldUntil: 0, zapUntil: 0, spinUntil: 0, spinDir: 1,
    pitState: 'none', pitHoldMs: 0, pitNeedleT: 0, pitWorkMs: 0, pitAutoAt: 0, pitGrade: '',
    pitArmed: true,
    finished: false, finishTimeMs: 0,
    input: { steer: 0, throttle: 0 },
    aiPitTarget: false,
  }
  // Grid sits in gate 11 heading for gate 0; the opening crossing must not count.
  car.nextGate = 1
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
  if (total <= 0) return ''
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
  else if (item === 'crate') dropHazard(race, car, 'crate')
  else if (item === 'shield') car.shieldUntil = race.now + t.shieldMs
  else if (item === 'zap') {
    for (const other of race.cars) {
      if (other === car || other.finished) continue
      if (other.progress > car.progress) {
        if (other.shieldUntil > race.now) other.shieldUntil = 0
        else other.zapUntil = race.now + t.zapMs
      }
    }
    logEvent(race, 'zap', `⚡ ${car.name} zaps the field!`, car.seat)
  }
  car.item = ''
  return true
}

function hitHazard(race, car, hz) {
  const t = race.tune.items
  if (hz.owner === car.playerId) return
  if (car.shieldUntil > race.now) {
    car.shieldUntil = 0
    hz.until = 0
    logEvent(race, 'block', `🛡 ${car.name} shrugs off a ${hz.kind}!`, car.seat)
    return
  }
  if (hz.kind === 'oil') {
    car.spinUntil = race.now + t.oilSpinMs
    car.spinDir = Math.random() < 0.5 ? -1 : 1
    hz.until = 0
    logEvent(race, 'spin', `🌀 ${car.name} spins on oil!`, car.seat)
  } else if (hz.kind === 'crate') {
    car.vx *= -0.3
    car.vy *= -0.3
    const sp = Math.hypot(car.vx, car.vy) * t.crateSlow
    const a = Math.atan2(car.vy, car.vx) || car.angle
    car.vx = Math.cos(a) * sp
    car.vy = Math.sin(a) * sp
    hz.until = 0
    logEvent(race, 'bonk', `📦 ${car.name} eats a crate!`, car.seat)
  }
}

function stepCar(race, car, dt) {
  const tune = race.tune
  const now = race.now
  if (car.finished) return

  // --- pit crew sequence locks the car ---
  if (car.pitState === 'crew' || car.pitState === 'working') {
    car.vx *= 1 - Math.min(1, 10 * dt)
    car.vy *= 1 - Math.min(1, 10 * dt)
    car.x += car.vx * dt
    car.y += car.vy * dt
    if (car.pitState === 'crew') {
      car.pitNeedleT += dt * tune.pit.needleSpeed
      if (now >= car.pitAutoAt) resolvePit(race, car, 'slow', true)
      else if (!inPitBox(race.track, car.seat, car.x, car.y)) {
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

  const info = closestOnTrack(race.track, car.x, car.y)
  const off = info.dist > race.track.halfWidth
  let top = BASE_TOP * topMul
  if (off) top *= tune.car.offTopMul
  if (now < car.boostUntil) top *= tune.items.boostTopMul
  if (now < car.zapUntil) top *= tune.items.zapSlowMul

  const dirx = Math.cos(car.angle), diry = Math.sin(car.angle)
  let vf = car.vx * dirx + car.vy * diry
  let vlx = car.vx - dirx * vf, vly = car.vy - diry * vf

  if (spinning) {
    car.angle += 9 * car.spinDir * dt
    vf *= 1 - Math.min(1, 3 * dt)
  } else {
    const spdF = clamp(Math.abs(vf) / 120, 0, 1)
    car.angle += steer * tune.car.steerRate * spdF * (vf >= 0 ? 1 : -1) * dt
    const drifting = Math.abs(steer) > 0.7 && Math.abs(vf) > 220
    if (throttle > 0) {
      const a = tune.car.accel * (now < car.boostUntil ? 1.6 : 1)
      vf = Math.min(top, vf + throttle * a * dt)
    } else if (throttle < 0) {
      vf = Math.max(-tune.car.reverseTop, vf + throttle * tune.car.brakePow * dt)
    } else {
      vf *= 1 - Math.min(1, 0.6 * dt)
    }
    if (vf > top) vf = Math.max(top, vf - tune.car.brakePow * dt)
    const grip = tune.car.grip * gripMul * (off ? 0.7 : 1) * (drifting ? 0.45 : 1)
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

  // pit speed limit
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

  // walls: push back inside, scrub outward velocity
  const w = closestOnTrack(race.track, car.x, car.y)
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

  // item boxes
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

  // hazards
  for (const hz of race.hazards) {
    if (hz.until <= race.now) continue
    if (Math.hypot(car.x - hz.x, car.y - hz.y) < CAR_R + 13) hitHazard(race, car, hz)
  }

  // pit boxes: stop inside yours and the crew runs out (once per visit)
  if (car.pitState === 'none' && car.pitArmed && inPitBox(race.track, car.seat, car.x, car.y)) {
    if (Math.hypot(car.vx, car.vy) < 30) {
      car.pitHoldMs += dt * 1000
      if (car.pitHoldMs >= tune.pit.boxHoldMs) {
        car.pitState = 'crew'
        car.pitNeedleT = Math.random()
        car.pitAutoAt = race.now + 5000
        logEvent(race, 'pit', `🔧 Crew on ${car.name} — hit SPACE in the zone!`, car.seat)
      }
    } else {
      car.pitHoldMs = 0
    }
  } else if (car.pitState === 'none') {
    car.pitHoldMs = 0
    if (!inPitBox(race.track, car.seat, car.x, car.y)) car.pitArmed = true
  }
}

// The nitro-style timing release: press SPACE with the needle centered.
export function resolvePit(race, car, _via, auto = false) {
  const t = race.tune.pit
  const pos = (car.pitNeedleT % 1 + 1) % 1
  const err = Math.abs(pos - 0.5)
  let grade = 'slow'
  let extra = t.slowMs
  if (!auto && err <= t.perfectHalf) { grade = 'PERFECT'; extra = t.perfectMs }
  else if (!auto && err <= t.okHalf) { grade = 'ok'; extra = t.okMs }
  car.pitGrade = grade
  car.pitWorkMs = t.crewBaseMs + extra
  car.pitState = 'working'
  void _via
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
  const info = closestOnTrack(race.track, van.x, van.y)
  van.along = info.along
  // bump racers
  for (const car of race.cars) {
    if (car.finished) continue
    if (Math.hypot(car.x - van.x, car.y - van.y) < CAR_R + VAN_R) {
      const nx = (car.x - van.x) / (Math.hypot(car.x - van.x, car.y - van.y) || 1)
      const ny = (car.y - van.y) / (Math.hypot(car.x - van.x, car.y - van.y) || 1)
      car.x = van.x + nx * (CAR_R + VAN_R)
      car.y = van.y + ny * (CAR_R + VAN_R)
      car.vx *= 0.55
      car.vy *= 0.55
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
      along, side: i % 2 === 0 ? -1 : 1, wobbleUntil: 0,
    })
  }
  if (race.vans.length > want) race.vans.length = want
}

// Simple bot brain: chase the racing line, brake for big turns, pit when bald, spend items.
export function aiInput(race, car) {
  if (car.pitState !== 'none') return { steer: 0, throttle: 0 }
  const lookahead = 90 + Math.hypot(car.vx, car.vy) * 0.35
  let tx, ty
  let creep = false
  if (car.wear > 82) {
    const box = pitBoxFor(race.track, car.seat)
    const dBox = Math.hypot(box.x - car.x, box.y - car.y)
    if (dBox < 500 || inPitZone(race.track, car.x, car.y)) {
      tx = box.x
      ty = box.y
      creep = dBox < 60
    }
  }
  if (tx === undefined) {
    if (inPitZone(race.track, car.x, car.y)) {
      // just serviced (or cut through): rejoin at the pit exit, don't u-turn into the wall
      tx = 1060
      ty = 740
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
    // wedged facing away: back out while turning
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
  } else if (car.item === 'zap') {
    useItem(race, car)
  } else if ((car.item === 'oil' || car.item === 'crate') && race.now - car.itemHeldMs > 4000) {
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
      // bot crew auto-release with human-ish timing spread
      if (car.pitState === 'crew' && nowMs >= (car.pitAutoAt - 5000) + 600 + (car.seat * 137) % 900) {
        resolvePit(race, car, 'bot')
      }
      aiItems(race, car)
    }
    // crew timing press for humans is routed via pressPit() below
    stepCar(race, car, dt)
  }
  for (const van of race.vans) stepVan(race, van, dt)
  collideCars(race)

  // expiry
  race.hazards = race.hazards.filter(h => h.until > nowMs)

  // places
  const ranked = [...race.cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs
    if (a.finished !== b.finished) return a.finished ? -1 : 1
    return b.progress - a.progress
  })
  ranked.forEach((c, i) => { c.place = i + 1 })

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

// SPACE during the crew phase: the nitro-style timing release.
export function pressPit(race, car) {
  if (car.pitState === 'crew') {
    resolvePit(race, car, 'human')
    return true
  }
  return false
}

export function startCountdown(race, nowMs) {
  race.phase = 'countdown'
  race.countdownEndsAt = nowMs + race.tune.race.countdownMs
}
