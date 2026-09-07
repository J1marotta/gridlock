// Solo mode: the authoritative sim running locally. Same physics, bots, pits,
// items and live tune as multiplayer — no server needed.
import { SEAT_COLORS, addCar, createRace, pressPit, startCountdown, stepRace, useItem } from '../../server/sim.js'
import { cloneTune } from './tune.js'

const BOT_NAMES = ['Vex', 'Turbo', 'Skidz', 'Octane', 'Drifty', 'Nitro', 'Sparks', 'Axel', 'Gear', 'Ruby', 'Max']

export class LocalRace {
  constructor({ playerName = 'Racer', tune = null } = {}) {
    this.tune = tune ?? cloneTune()
    this.race = createRace(this.tune)
    addCar(this.race, { playerId: 'you', name: playerName, color: SEAT_COLORS[0], isNpc: false, seat: 0 })
    for (let seat = 1; seat < 12; seat += 1) {
      addCar(this.race, {
        playerId: `bot:${seat}`, name: BOT_NAMES[(seat - 1) % BOT_NAMES.length],
        color: SEAT_COLORS[seat % SEAT_COLORS.length], isNpc: true, seat,
      })
    }
    this.playerName = playerName
    this.localSeat = 0
  }

  start(nowMs = Date.now()) {
    startCountdown(this.race, nowMs)
  }

  setInput(steer, throttle) {
    const car = this.race.cars[0]
    if (car && !car.finished) car.input = { steer, throttle }
  }

  // SPACE does whatever matters right now: crew timing release, else item.
  pressSpace() {
    const car = this.race.cars[0]
    if (!car || this.race.phase !== 'racing') return false
    if (car.pitState === 'crew') return pressPit(this.race, car)
    if (car.item) return useItem(this.race, car)
    return false
  }

  tick(nowMs = Date.now(), dtMs = 50) {
    stepRace(this.race, dtMs / 1000, nowMs)
  }

  snapshot() {
    const r = this.race
    const now = r.now
    return {
      phase: r.phase,
      roomCode: 'LOCAL',
      raceNo: 1,
      laps: this.tune.race.laps,
      countdownEndsAt: r.countdownEndsAt,
      winnerName: r.winnerSeat !== -1 ? (r.cars.find(c => c.seat === r.winnerSeat)?.name ?? '') : '',
      winnerSeat: r.winnerSeat,
      localSeat: this.localSeat,
      pitZone: { perfectHalf: this.tune.pit.perfectHalf, okHalf: this.tune.pit.okHalf },
      players: [{ id: 'you', name: this.playerName, role: 'host', ready: true, wins: 0, bestLapMs: 0 }],
      cars: r.cars.map(c => ({
        seat: c.seat, playerId: c.playerId, name: c.playerName, colorIndex: SEAT_COLORS.indexOf(c.color),
        isNpc: c.isNpc, x: c.x, y: c.y, angle: c.angle, speed: Math.hypot(c.vx, c.vy),
        lap: Math.min(c.lap, this.tune.race.laps), place: c.place, item: c.item,
        wear: Math.round(Math.min(100, c.wear)), pit: c.pitState,
        needle: c.pitState === 'crew' ? ((c.pitNeedleT % 1 + 1) % 1) : 0,
        shielded: now < c.shieldUntil, boosting: now < c.boostUntil,
        spinning: now < c.spinUntil, zapped: now < c.zapUntil, finished: c.finished,
      })),
      hazards: r.hazards.map(h => ({ id: h.id, kind: h.kind, x: h.x, y: h.y })),
      vans: r.vans.map(v => ({ id: v.id, x: v.x, y: v.y, angle: v.angle, wobbling: now < v.wobbleUntil })),
      boxes: r.track.boxes.map((b, i) => ({ idx: i, available: now >= r.boxes[i] })),
      events: [...r.events],
    }
  }
}
