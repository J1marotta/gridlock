import { describe, expect, it } from 'vitest'
import { CLIENT_MESSAGE_TYPES, checkMessageOrder, validateClientMessage } from './protocol.js'

const msg = (type, payload, sequence = 1, roundId = 1) => ({
  protocolVersion: 1, type, roomId: 'ABCDE', roundId, sequence, payload,
})

describe('gridlock protocol', () => {
  it('accepts driving inputs and tune patches', () => {
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.INPUT, { steer: 0.5, throttle: 1 })).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.USE_ITEM, {})).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.PIT_PRESS, {})).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.VOTE_PRESET, { presetId: 'drift' })).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.VOTE_TRACK, { trackId: 'esses' })).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.TUNE, { patch: { 'car.grip': 5 } })).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.HORN, {})).ok).toBe(true)
  })

  it('rejects out-of-range inputs and unknown tune shapes', () => {
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.INPUT, { steer: 9, throttle: 1 })).ok).toBe(false)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.TUNE, { patch: 42 })).ok).toBe(false)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.VOTE_PRESET, { presetId: 'chaos' })).ok).toBe(false)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.VOTE_TRACK, { trackId: 'custom' })).ok).toBe(false)
    expect(checkMessageOrder({ roundId: 1, sequence: 2 }, { roundId: 1, lastSequence: 2 }).ok).toBe(false)
  })

  it('settings requires a known privacy value', () => {
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.SETTINGS, { privacy: 'public' })).ok).toBe(true)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.SETTINGS, {})).ok).toBe(false)
    expect(validateClientMessage(msg(CLIENT_MESSAGE_TYPES.SETTINGS, { privacy: 'galaxy' })).ok).toBe(false)
  })
})
