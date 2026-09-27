export const PROTOCOL_VERSION = 1

export const CLIENT_MESSAGE_TYPES = Object.freeze({
  RENAME: 'rename',
  SETTINGS: 'settings',
  READY: 'ready',
  START: 'start',
  INPUT: 'input',
  USE_ITEM: 'use-item',
  PIT_PRESS: 'pit-press',
  VOTE_PRESET: 'vote-preset',
  TUNE: 'tune',
  SET_TRACK: 'set-track',
  NEXT_RACE: 'next-race',
  LEAVE: 'leave',
})

export const SERVER_MESSAGE_TYPES = Object.freeze({
  SNAPSHOT: 'snapshot',
  PRIVATE_STATE: 'private-state',
  EVENT: 'event',
  ERROR: 'error',
  CLOSED: 'closed',
})

export const ROOM_PRIVACY = Object.freeze(['public', 'private'])

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isIntegerAtLeast = (value, minimum) => Number.isInteger(value) && value >= minimum
const isNum = value => typeof value === 'number' && Number.isFinite(value)

const payloadValidators = {
  [CLIENT_MESSAGE_TYPES.RENAME]: p => isNonEmptyString(p.nextPlayerName),
  [CLIENT_MESSAGE_TYPES.SETTINGS]: p =>
    hasOwn(p, 'privacy') && ROOM_PRIVACY.includes(p.privacy),
  [CLIENT_MESSAGE_TYPES.READY]: p => typeof p.ready === 'boolean',
  [CLIENT_MESSAGE_TYPES.START]: () => true,
  [CLIENT_MESSAGE_TYPES.INPUT]: p =>
    isNum(p.steer) && p.steer >= -1 && p.steer <= 1 &&
    isNum(p.throttle) && p.throttle >= -1 && p.throttle <= 1,
  [CLIENT_MESSAGE_TYPES.USE_ITEM]: () => true,
  [CLIENT_MESSAGE_TYPES.PIT_PRESS]: () => true,
  [CLIENT_MESSAGE_TYPES.VOTE_PRESET]: p => ['balanced', 'drift', 'turbo'].includes(p.presetId),
  [CLIENT_MESSAGE_TYPES.TUNE]: p => isObject(p.patch),
  [CLIENT_MESSAGE_TYPES.SET_TRACK]: p => isObject(p.track) && Array.isArray(p.track.points),
  [CLIENT_MESSAGE_TYPES.NEXT_RACE]: () => true,
  [CLIENT_MESSAGE_TYPES.LEAVE]: () => true,
}

export function validateClientMessage(message) {
  if (!isObject(message)) return { ok: false, error: 'Message must be an object' }
  if (message.protocolVersion !== PROTOCOL_VERSION) return { ok: false, error: 'Unsupported protocol version' }
  if (!hasOwn(payloadValidators, message.type)) return { ok: false, error: 'Unknown message type' }
  if (!isNonEmptyString(message.roomId)) return { ok: false, error: 'Room id is required' }
  if (!isIntegerAtLeast(message.roundId, 0)) return { ok: false, error: 'Round id must be a non-negative integer' }
  if (!isIntegerAtLeast(message.sequence, 1)) return { ok: false, error: 'Sequence must be a positive integer' }
  const payload = message.payload ?? {}
  if (!isObject(payload) || !payloadValidators[message.type](payload)) {
    return { ok: false, error: `Invalid ${message.type} payload` }
  }
  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      type: message.type,
      roomId: message.roomId.trim(),
      roundId: message.roundId,
      sequence: message.sequence,
      payload,
    },
  }
}

export function checkMessageOrder(message, { roundId, lastSequence = 0 }) {
  if (message.roundId !== roundId) {
    return { ok: false, error: message.roundId < roundId ? 'Stale round' : 'Future round' }
  }
  if (message.sequence <= lastSequence) return { ok: false, error: 'Duplicate or out-of-order message' }
  return { ok: true }
}

export function createServerEnvelope(type, payload, context) {
  if (!Object.values(SERVER_MESSAGE_TYPES).includes(type)) {
    throw new Error(`Unknown server message type: ${type}`)
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    roomId: context.roomId,
    roundId: context.roundId,
    eventId: context.eventId,
    serverTime: context.serverTime ?? Date.now(),
    payload,
  }
}

export function normalizeRoomCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return code.replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function randomRoomCode(pick = Math.random) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 5; i += 1) out += chars[Math.floor(pick() * chars.length)]
  return out
}
