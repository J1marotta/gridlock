import { Room } from '@colyseus/core'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  checkMessageOrder,
  createServerEnvelope,
  validateClientMessage,
} from '../src/multiplayer/protocol.js'
import { applyPatch, applyRacePreset, cloneTune, RACE_PRESETS } from '../src/game/tune.js'
import { DEFAULT_TRACK_ID, getTrack, getTrackData, getTrackVoteOptions, TRACKS } from '../src/game/tracks.js'
import { trackFromData } from '../src/game/track.js'
import { SEAT_COLORS, addCar, createRace, honk, pitProgressOf, pressPit, startCountdown, stepRace, useItem } from './sim.js'
import { BoxState, CarState, FeedEvent, GridState, HazardState, PlayerState, VanState } from './schema.js'
import { SERVER_TICK_MS } from './sim.js'

export const GRID_ROOM_NAME = 'grid-room'
export const GRID_SIZE = 12
export const ROOM_IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const RECONNECT_GRACE_SECONDS = 45

const BOT_NAMES = ['Vex', 'Turbo', 'Skidz', 'Octane', 'Drifty', 'Nitro', 'Sparks', 'Axel', 'Gear', 'Ruby', 'Max', 'Zed']
const cleanName = v => (typeof v === 'string' ? v.trim().slice(0, 16) : '') || 'Player'
const normalizeCode = v => (typeof v === 'string' ? v.trim().toUpperCase() : '').replace(/[^A-Z0-9]/g, '').slice(0, 6)
const activeCodes = new Set()
export function resetActiveRoomCodesForTests() { activeCodes.clear() }

export class GridRoom extends Room {
  maxClients = GRID_SIZE
  autoDispose = true
  playerIdBySession = new Map()
  lastSequenceByPlayerId = new Map()
  seatByPlayerId = new Map()
  inputByPlayerId = new Map()
  lastLapAt = new Map()
  lastLapSeen = new Map()
  lastEventIdx = 0
  eventSequence = 0
  winsAwarded = false
  lastActivityAt = Date.now()
  closing = false
  tune = cloneTune()
  race = null
  pendingTrackData = null
  presetVotes = new Map()
  trackVotes = new Map()
  messages = { command: (client, message) => this.handleCommand(client, message) }

  onCreate(options = {}) {
    const roomCode = normalizeCode(options.roomCode) || normalizeCode(this.roomId) || 'GRID'
    if (activeCodes.has(roomCode)) throw new Error('Room code is already in use')
    activeCodes.add(roomCode)
    this.roomId = roomCode
    this.lastActivityAt = Date.now()
    this.state = new GridState({
      roomCode,
      phase: 'lobby',
      privacy: options.privacy === 'private' ? 'private' : 'public',
      raceNo: 1,
      countdownEndsAt: 0,
      winnerName: '',
      winnerSeat: -1,
      winnerEventId: '',
      hostPlayerId: '',
      tuneJson: JSON.stringify(this.tune),
      trackJson: JSON.stringify(getTrackData(DEFAULT_TRACK_ID).data),
      trackName: getTrackData(DEFAULT_TRACK_ID).name,
      activePreset: 'balanced',
      presetVotesJson: '{}',
      activeTrackId: DEFAULT_TRACK_ID,
      trackVotesJson: '{}',
    })
    this.setSimulationInterval?.(deltaMs => this.advanceSimulation(deltaMs), SERVER_TICK_MS)
  }

  onJoin(client, options = {}) {
    if (this.state.phase !== 'lobby') throw new Error('Race in progress — wait for the next one')
    const isHost = this.state.players.size === 0
    const playerId = randomUUID()
    const name = cleanName(options.playerName)
    const taken = [...this.state.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())
    if (taken) throw new Error('Player name is not available')
    const player = new PlayerState({
      id: playerId, connectionId: client.sessionId, name,
      role: isHost ? 'host' : 'player', ready: false, connected: true, wins: 0, bestLapMs: 0,
    })
    this.playerIdBySession.set(client.sessionId, playerId)
    client.auth = { playerId }
    client.reconnectionToken = randomBytes(32).toString('base64url')
    this.state.players.set(playerId, player)
    if (isHost) this.state.hostPlayerId = playerId
  }

  authorizedPlayer(client) {
    const id = this.playerIdBySession.get(client.sessionId)
    return id ? this.state.players.get(id) : undefined
  }
  isHost(p) { return Boolean(p) && p.id === this.state.hostPlayerId }
  createEventId() { this.eventSequence += 1; return `${this.state.roomCode}:${this.state.raceNo}:${this.eventSequence}` }

  sendError(client, code, message) {
    client.send?.(SERVER_MESSAGE_TYPES.ERROR, createServerEnvelope(SERVER_MESSAGE_TYPES.ERROR, { code, message },
      { roomId: this.state.roomCode, roundId: this.state.raceNo, eventId: this.createEventId() }))
    return { ok: false, error: code }
  }

  handleCommand(client, raw) {
    const player = this.authorizedPlayer(client)
    if (!player) return this.sendError(client, 'unauthorized', 'Not bound to a player')
    const v = validateClientMessage(raw)
    if (!v.ok) return this.sendError(client, 'invalid-message', v.error)
    const msg = v.value
    if (msg.roomId !== this.state.roomCode) return this.sendError(client, 'wrong-room', 'Another room')
    const order = checkMessageOrder(msg, { roundId: this.state.raceNo, lastSequence: this.lastSequenceByPlayerId.get(player.id) ?? 0 })
    if (!order.ok) return this.sendError(client, 'invalid-order', order.error)
    let result = { ok: false, error: 'unsupported', message: 'Nope' }
    const P = msg.payload
    if (msg.type === CLIENT_MESSAGE_TYPES.RENAME) result = this.rename(player, P.nextPlayerName)
    else if (msg.type === CLIENT_MESSAGE_TYPES.SETTINGS) result = this.settings(player, P)
    else if (msg.type === CLIENT_MESSAGE_TYPES.READY) {
      if (this.state.phase !== 'lobby') result = { ok: false, error: 'wrong-phase', message: 'Not in lobby' }
      else { player.ready = P.ready; result = { ok: true } }
    }
    else if (msg.type === CLIENT_MESSAGE_TYPES.START) result = this.startRace(player)
    else if (msg.type === CLIENT_MESSAGE_TYPES.INPUT) result = this.drive(player, P)
    else if (msg.type === CLIENT_MESSAGE_TYPES.USE_ITEM) result = this.useItem(player)
    else if (msg.type === CLIENT_MESSAGE_TYPES.HORN) result = this.horn(player)
    else if (msg.type === CLIENT_MESSAGE_TYPES.PIT_PRESS) result = this.pitPress(player)
    else if (msg.type === CLIENT_MESSAGE_TYPES.VOTE_PRESET) result = this.votePreset(player, P.presetId)
    else if (msg.type === CLIENT_MESSAGE_TYPES.VOTE_TRACK) result = this.voteTrack(player, P.trackId)
    else if (msg.type === CLIENT_MESSAGE_TYPES.TUNE) result = this.tuneCmd(player, P.patch)
    else if (msg.type === CLIENT_MESSAGE_TYPES.SET_TRACK) result = this.setTrack(player, P.track)
    else if (msg.type === CLIENT_MESSAGE_TYPES.NEXT_RACE) result = this.nextRace(player)
    else if (msg.type === CLIENT_MESSAGE_TYPES.LEAVE) {
      const hl = this.removePlayer(client)
      if (hl) void this.closeRoom('host-left', 'Host left')
      result = { ok: true }
    }
    if (!result.ok) return this.sendError(client, result.error, result.message ?? result.error)
    this.lastSequenceByPlayerId.set(player.id, msg.sequence)
    this.lastActivityAt = Date.now()
    return result
  }

  rename(player, name) {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'wrong-phase', message: 'Lobby only' }
    const next = cleanName(name)
    if ([...this.state.players.values()].some(o => o.id !== player.id && o.name.toLowerCase() === next.toLowerCase())) {
      return { ok: false, error: 'name-taken', message: 'Name taken' }
    }
    player.name = next
    return { ok: true }
  }

  settings(player, s) {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'wrong-phase', message: 'Lobby only' }
    if (!this.isHost(player)) return { ok: false, error: 'host-only', message: 'Host only' }
    if (s.privacy) this.state.privacy = s.privacy
    return { ok: true }
  }

  tuneCmd(player, patch) {
    if (!this.isHost(player)) return { ok: false, error: 'host-only', message: 'Only the host tunes a live race' }
    const applied = applyPatch(this.tune, patch)
    if (!applied) return { ok: false, error: 'invalid', message: 'No tunable matched' }
    this.state.tuneJson = JSON.stringify(this.tune)
    return { ok: true, applied }
  }

  setTrack(player, track) {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'wrong-phase', message: 'Lobby only' }
    if (!this.isHost(player)) return { ok: false, error: 'host-only', message: 'Only the host picks the track' }
    const verify = trackFromData(track)
    if (!verify.ok) return { ok: false, error: 'invalid', message: verify.error }
    const builtIn = TRACKS.find(t => t.name === String(track.name || '').slice(0, 24))
    this.pendingTrackData = builtIn ? null : {
      name: String(track.name || 'Custom Loop').slice(0, 24),
      points: verify.track.points,
      halfWidth: verify.track.halfWidth,
      pit: verify.track.pit,
      levels: verify.track.levels,
      boxes: verify.track.boxes,
      start: verify.track.start,
    }
    this.state.activeTrackId = builtIn?.id ?? ''
    this.state.trackJson = JSON.stringify(builtIn?.data ?? this.pendingTrackData)
    this.state.trackName = builtIn?.name ?? this.pendingTrackData.name
    return { ok: true }
  }

  carOf(playerId) {
    const seat = this.seatByPlayerId.get(playerId)
    return seat === undefined ? null : this.race?.cars.find(c => c.seat === seat) ?? null
  }

  drive(player, { steer, throttle, handbrake }) {
    if (!this.race || !['countdown', 'racing'].includes(this.state.phase)) {
      return { ok: false, error: 'wrong-phase', message: 'Not racing' }
    }
    this.inputByPlayerId.set(player.id, { steer, throttle, handbrake: Boolean(handbrake) })
    return { ok: true }
  }

  useItem(player) {
    const car = this.carOf(player.id)
    if (!car || this.state.phase !== 'racing') return { ok: false, error: 'wrong-phase', message: 'Not racing' }
    return useItem(this.race, car) ? { ok: true } : { ok: false, error: 'no-item', message: 'No item held' }
  }

  horn(player) {
    const car = this.carOf(player.id)
    if (!car || this.state.phase !== 'racing') return { ok: false, error: 'wrong-phase', message: 'Not racing' }
    return honk(this.race, car) ? { ok: true } : { ok: false, error: 'cooldown', message: 'Horn is cooling down' }
  }

  pitPress(player) {
    const car = this.carOf(player.id)
    if (!car || this.state.phase !== 'racing') return { ok: false, error: 'wrong-phase', message: 'Not racing' }
    return pressPit(this.race, car) ? { ok: true } : { ok: false, error: 'pit-unavailable', message: 'Enter the pit lane with worn tyres to stop for service' }
  }

  startRace(player) {
    if (this.state.phase !== 'lobby') return { ok: false, error: 'wrong-phase', message: 'Lobby only' }
    if (!this.isHost(player)) return { ok: false, error: 'host-only', message: 'Host only' }
    const humans = [...this.state.players.values()].filter(p => p.connected)
    if (!humans.length || humans.some(p => !p.ready)) {
      return { ok: false, error: 'not-ready', message: 'Everyone must ready up' }
    }
    this.race = createRace(this.tune, this.selectedTrack())
    this.seatByPlayerId.clear()
    this.inputByPlayerId.clear()
    this.lastLapAt.clear()
    this.lastLapSeen.clear()
    this.state.cars.clear()
    this.state.hazards.clear()
    this.state.vans.clear()
    this.state.boxes.clear()
    this.state.events.clear()
    this.lastEventIdx = 0
    this.winsAwarded = false
    humans.slice(0, GRID_SIZE).forEach((p, i) => {
      addCar(this.race, { playerId: p.id, name: p.name, color: SEAT_COLORS[i % SEAT_COLORS.length], isNpc: false, seat: i })
      this.seatByPlayerId.set(p.id, i)
      this.sendPrivate(p.id, i)
    })
    for (let seat = humans.length; seat < GRID_SIZE; seat += 1) {
      addCar(this.race, {
        playerId: `bot:${seat}`, name: BOT_NAMES[seat % BOT_NAMES.length],
        color: SEAT_COLORS[seat % SEAT_COLORS.length], isNpc: true, seat,
      })
    }
    const now = Date.now()
    startCountdown(this.race, now)
    this.state.countdownEndsAt = this.race.countdownEndsAt
    this.state.winnerName = ''
    this.state.winnerSeat = -1
    this.state.tuneJson = JSON.stringify(this.tune)
    this.state.trackJson = JSON.stringify(this.pendingTrackData ?? getTrackData(this.state.activeTrackId || DEFAULT_TRACK_ID).data)
    this.state.trackName = this.pendingTrackData?.name ?? getTrackData(this.state.activeTrackId || DEFAULT_TRACK_ID).name
    this.state.phase = 'countdown'
    this.syncWorld(now)
    return { ok: true }
  }

  selectedTrack() {
    if (this.pendingTrackData) {
      const verify = trackFromData(this.pendingTrackData)
      if (verify.ok) return verify.track
    }
    return getTrack(this.state.activeTrackId || DEFAULT_TRACK_ID)
  }

  sendPrivate(playerId, seat) {
    const client = this.clients?.find(c => this.playerIdBySession.get(c.sessionId) === playerId)
    client?.send?.(SERVER_MESSAGE_TYPES.PRIVATE_STATE, { playerId, seat })
  }

  nextRace(player) {
    if (this.state.phase !== 'finished') return { ok: false, error: 'wrong-phase', message: 'Race not over' }
    if (!this.isHost(player)) return { ok: false, error: 'host-only', message: 'Host only' }
    const counts = Object.fromEntries(RACE_PRESETS.map(p => [p.id, 0]))
    for (const presetId of this.presetVotes.values()) counts[presetId] = (counts[presetId] ?? 0) + 1
    const high = Math.max(...Object.values(counts))
    const tied = RACE_PRESETS.filter(p => counts[p.id] === high)
    const winner = tied.find(p => p.id === this.state.activePreset) ?? tied.find(p => p.id === 'balanced') ?? tied[0]
    applyRacePreset(this.tune, winner.id)
    this.state.activePreset = winner.id
    this.state.tuneJson = JSON.stringify(this.tune)
    this.presetVotes.clear()
    this.state.presetVotesJson = '{}'
    const trackOptions = getTrackVoteOptions(this.state.activeTrackId, this.state.raceNo)
    if (this.trackVotes.size) {
      const trackCounts = Object.fromEntries(trackOptions.map(t => [t.id, 0]))
      for (const trackId of this.trackVotes.values()) trackCounts[trackId] = (trackCounts[trackId] ?? 0) + 1
      const maxTrackVotes = Math.max(...Object.values(trackCounts))
      const selected = trackOptions.find(t => trackCounts[t.id] === maxTrackVotes)
      if (selected) {
        this.pendingTrackData = null
        this.state.activeTrackId = selected.id
        this.state.trackJson = JSON.stringify(selected.data)
        this.state.trackName = selected.name
      }
    }
    this.trackVotes.clear()
    this.state.trackVotesJson = '{}'
    this.state.raceNo += 1
    this.state.phase = 'lobby'
    for (const p of this.state.players.values()) if (p.connected) p.ready = false
    return { ok: true }
  }

  votePreset(player, presetId) {
    if (this.state.phase !== 'finished') return { ok: false, error: 'wrong-phase', message: 'Vote after the race finishes' }
    if (!RACE_PRESETS.some(p => p.id === presetId)) return { ok: false, error: 'invalid-preset', message: 'Choose one of the listed race feels' }
    this.presetVotes.set(player.id, presetId)
    this.state.presetVotesJson = JSON.stringify(Object.fromEntries(this.presetVotes))
    return { ok: true }
  }

  voteTrack(player, trackId) {
    if (this.state.phase !== 'finished') return { ok: false, error: 'wrong-phase', message: 'Vote after the race finishes' }
    const choices = getTrackVoteOptions(this.state.activeTrackId, this.state.raceNo)
    if (!choices.some(t => t.id === trackId)) return { ok: false, error: 'invalid-track', message: 'Choose one of the three listed circuits' }
    this.trackVotes.set(player.id, trackId)
    this.state.trackVotesJson = JSON.stringify(Object.fromEntries(this.trackVotes))
    return { ok: true }
  }

  syncWorld(nowMs) {
    if (!this.race) return
    for (const car of this.race.cars) {
      let s = this.state.cars.get(String(car.seat))
      if (!s) {
        s = new CarState({})
        this.state.cars.set(String(car.seat), s)
      }
      s.seat = car.seat
      s.playerId = car.playerId
      s.name = car.name
      s.colorIndex = SEAT_COLORS.indexOf(car.color)
      s.isNpc = car.isNpc
      s.x = Math.round(car.x * 10) / 10
      s.y = Math.round(car.y * 10) / 10
      s.angle = Math.round(car.angle * 1000) / 1000
      s.speed = Math.round(Math.hypot(car.vx, car.vy))
      s.level = car.level ?? 0
      s.lap = Math.min(car.lap, this.tune.race.laps)
      s.place = car.place
      s.progress = Math.round(car.progress)
      s.item = car.item
      s.wear = Math.round(Math.min(100, car.wear))
      s.pit = car.pitState
      s.needle = car.pitState === 'crew' ? ((car.pitNeedleT % 1 + 1) % 1) : 0
      s.pitProgress = pitProgressOf(car)
      s.pitPushes = car.pitPushes ?? 0
      s.boosting = nowMs < car.boostUntil
      s.spinning = nowMs < car.spinUntil
      s.hb = Boolean(car.input.handbrake)
      s.shielding = nowMs < car.shieldUntil
      s.finished = car.finished
    }
    const hzIds = new Set()
    for (const hz of this.race.hazards) {
      hzIds.add(String(hz.id))
      let s = this.state.hazards.get(String(hz.id))
      if (!s) {
        s = new HazardState({})
        this.state.hazards.set(String(hz.id), s)
      }
      s.id = hz.id
      s.kind = hz.kind
      s.x = Math.round(hz.x)
      s.y = Math.round(hz.y)
    }
    for (const key of this.state.hazards.keys()) {
      if (!hzIds.has(key)) this.state.hazards.delete(key)
    }
    const vanIds = new Set()
    for (const van of this.race.vans) {
      vanIds.add(String(van.id))
      let s = this.state.vans.get(String(van.id))
      if (!s) {
        s = new VanState({})
        this.state.vans.set(String(van.id), s)
      }
      s.id = van.id
      s.x = Math.round(van.x)
      s.y = Math.round(van.y)
      s.angle = Math.round(van.angle * 1000) / 1000
      s.level = van.level ?? 0
      s.wobbling = nowMs < van.wobbleUntil
    }
    for (const key of this.state.vans.keys()) {
      if (!vanIds.has(key)) this.state.vans.delete(key)
    }
    this.race.track.boxes.forEach((b, i) => {
      let s = this.state.boxes.get(String(i))
      if (!s) {
        s = new BoxState({})
        this.state.boxes.set(String(i), s)
      }
      s.idx = i
      s.available = nowMs >= this.race.boxes[i]
    })
  }

  advanceSimulation(deltaMs, nowMs = Date.now()) {
    if (!this.closing && nowMs - this.lastActivityAt >= ROOM_IDLE_TIMEOUT_MS) {
      void this.closeRoom('idle-expired', 'Room idle too long')
      return
    }
    if (!this.race || !['countdown', 'racing'].includes(this.state.phase)) return
    for (const [playerId, input] of this.inputByPlayerId) {
      const car = this.carOf(playerId)
      if (car && !car.finished) car.input = { steer: input.steer, throttle: input.throttle, handbrake: Boolean(input.handbrake) }
    }
    stepRace(this.race, deltaMs / 1000, nowMs)
    this.state.phase = this.race.phase
    for (const car of this.race.cars) {
      const seen = this.lastLapSeen.get(car.seat) ?? 1
      if (car.lap > seen) {
        const at = this.lastLapAt.get(car.seat)
        if (at !== undefined && !car.isNpc) {
          const ms = nowMs - at
          const player = this.state.players.get(car.playerId)
          if (player && (!player.bestLapMs || ms < player.bestLapMs)) player.bestLapMs = Math.round(ms)
        }
        this.lastLapAt.set(car.seat, nowMs)
        this.lastLapSeen.set(car.seat, car.lap)
      } else if (!this.lastLapAt.has(car.seat)) {
        this.lastLapAt.set(car.seat, nowMs)
      }
    }
    this.syncWorld(nowMs)
    if (this.race.winnerSeat !== -1) {
      const w = this.race.cars.find(c => c.seat === this.race.winnerSeat)
      this.state.winnerSeat = this.race.winnerSeat
      this.state.winnerName = w?.name ?? ''
      this.state.winnerEventId = this.state.winnerEventId || this.createEventId()
      const owner = w && !w.isNpc ? this.state.players.get(w.playerId) : null
      if (owner && !this.winsAwarded) {
        this.winsAwarded = true
        owner.wins += 1
      }
    }
    if (this.race.events.length > this.lastEventIdx) {
      for (const e of this.race.events.slice(this.lastEventIdx)) {
        const id = this.createEventId()
        this.state.events.set(id, new FeedEvent({ eventId: id, kind: e.kind, text: e.text, seat: e.seat }))
      }
      this.lastEventIdx = this.race.events.length
      while (this.state.events.size > 24) {
        const first = this.state.events.keys().next().value
        if (!first) break
        this.state.events.delete(first)
      }
    }
  }

  markDisconnected(client) {
    const p = this.authorizedPlayer(client)
    if (p) { p.connected = false; p.ready = false }
    return p
  }

  async onLeave(client) {
    const left = this.playerIdBySession.get(client.sessionId)
    const hostLeft = left && left === this.state.hostPlayerId
    this.playerIdBySession.delete(client.sessionId)
    this.lastSequenceByPlayerId.delete(left)
    this.inputByPlayerId.delete(left)
    if (left) this.state.players.delete(left)
    if (hostLeft) await this.closeRoom('host-left', 'Host left')
    else if (this.state.players.size === 0) await this.closeRoom('empty', 'Room empty')
  }

  async onDrop(client) {
    const player = this.markDisconnected(client)
    if (!player) return
    try {
      await this.allowReconnection(client, RECONNECT_GRACE_SECONDS)
      player.connected = true
    } catch {
      await this.onLeave(client)
    }
  }

  removePlayer(client) {
    const playerId = this.playerIdBySession.get(client.sessionId)
    if (!playerId) return false
    const hostLeft = this.state.hostPlayerId === playerId
    this.playerIdBySession.delete(client.sessionId)
    this.lastSequenceByPlayerId.delete(playerId)
    this.inputByPlayerId.delete(playerId)
    this.seatByPlayerId.delete(playerId)
    this.state.players.delete(playerId)
    if (hostLeft) this.state.hostPlayerId = ''
    return hostLeft
  }

  async closeRoom(reason, message) {
    if (this.closing) return
    this.closing = true
    try { this.state.phase = 'closed' } catch { /* noop */ }
    this.broadcast?.(SERVER_MESSAGE_TYPES.CLOSED, createServerEnvelope(SERVER_MESSAGE_TYPES.CLOSED,
      { reason, message }, { roomId: this.state.roomCode, roundId: this.state.raceNo, eventId: this.createEventId() }))
    await this.disconnect()
  }

  onDispose() {
    activeCodes.delete(this.state?.roomCode)
    this.playerIdBySession.clear()
    this.lastSequenceByPlayerId.clear()
    this.seatByPlayerId.clear()
    this.inputByPlayerId.clear()
  }
}
