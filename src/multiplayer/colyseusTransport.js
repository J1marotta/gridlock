import { Client } from '@colyseus/sdk'
import { CLIENT_MESSAGE_TYPES, PROTOCOL_VERSION, SERVER_MESSAGE_TYPES } from './protocol.js'

export const DEFAULT_COLYSEUS_ENDPOINT = 'ws://127.0.0.1:2567'
export const PRODUCTION_COLYSEUS_ENDPOINT = 'wss://gridlock-racer.fly.dev'

export function getColyseusEndpoint() {
  return import.meta.env.VITE_COLYSEUS_URL || (import.meta.env.PROD
    ? PRODUCTION_COLYSEUS_ENDPOINT
    : DEFAULT_COLYSEUS_ENDPOINT)
}

export class ColyseusTransport {
  constructor({ endpoint = getColyseusEndpoint(), client = new Client(endpoint) } = {}) {
    this.client = client
    this.room = null
    this.roomId = ''
    this.roundId = 1
    this.sequence = 0
    this.closedIntentionally = false
    this.latestState = null
    this.privateState = null
    this.listeners = new Map()
  }

  subscribe(type, listener) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
    return () => set.delete(listener)
  }

  emit(type, payload) {
    for (const listener of this.listeners.get(type) ?? []) listener(payload)
  }

  async create({ roomCode, playerName, privacy = 'public' }) {
    const room = await this.client.create('grid-room', { roomCode, playerName, privacy })
    return this.attach(room)
  }

  async join({ roomCode, playerName }) {
    const room = await this.client.joinById(roomCode, { playerName })
    return this.attach(room)
  }

  attach(room) {
    this.room = room
    this.roomId = room.roomId
    this.closedIntentionally = false
    room.onStateChange(state => {
      const snapshot = state?.toJSON ? state.toJSON() : state
      const rawPlayers = snapshot?.players instanceof Map
        ? [...snapshot.players.values()]
        : Object.values(snapshot?.players ?? {})
      const local = rawPlayers.find(p => p.connectionId === room.sessionId)
      if (local) this.privateState = { ...this.privateState, playerId: local.id }
      this.roundId = snapshot?.raceNo ?? this.roundId
      this.latestState = snapshot
      this.emit('snapshot', snapshot)
    })
    room.onMessage(SERVER_MESSAGE_TYPES.PRIVATE_STATE, payload => {
      this.privateState = { ...this.privateState, ...payload }
      this.emit('private-state', this.privateState)
    })
    room.onMessage(SERVER_MESSAGE_TYPES.EVENT, envelope => this.emit('event', envelope))
    room.onMessage(SERVER_MESSAGE_TYPES.ERROR, envelope => this.emit('error', envelope))
    room.onMessage(SERVER_MESSAGE_TYPES.CLOSED, envelope => {
      this.closedIntentionally = true
      this.emit('closed', envelope.payload)
    })
    room.onLeave(() => this.emit('closed', { code: 'left' }))
    this.emit('status', 'connected')
    return room
  }

  command(type, payload = {}) {
    if (!this.room) throw new Error('Not connected to a room')
    this.sequence += 1
    this.room.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      type,
      roomId: this.roomId,
      roundId: this.roundId,
      sequence: this.sequence,
      payload,
    })
  }

  rename(nextPlayerName) { this.command(CLIENT_MESSAGE_TYPES.RENAME, { nextPlayerName }) }
  setReady(ready) { this.command(CLIENT_MESSAGE_TYPES.READY, { ready }) }
  updateSettings(s) { this.command(CLIENT_MESSAGE_TYPES.SETTINGS, s) }
  start() { this.command(CLIENT_MESSAGE_TYPES.START) }
  drive(steer, throttle) { this.command(CLIENT_MESSAGE_TYPES.INPUT, { steer, throttle }) }
  useItem() { this.command(CLIENT_MESSAGE_TYPES.USE_ITEM) }
  pitPress() { this.command(CLIENT_MESSAGE_TYPES.PIT_PRESS) }
  tune(patch) { this.command(CLIENT_MESSAGE_TYPES.TUNE, { patch }) }
  setTrack(track) { this.command(CLIENT_MESSAGE_TYPES.SET_TRACK, { track }) }
  nextRace() { this.command(CLIENT_MESSAGE_TYPES.NEXT_RACE) }

  async leave() {
    this.closedIntentionally = true
    if (this.room) {
      try { this.command(CLIENT_MESSAGE_TYPES.LEAVE) } catch { /* noop */ }
      await this.room.leave()
    }
    this.room = null
  }
}
