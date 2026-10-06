import { describe, expect, it, vi } from 'vitest'
import { resetActiveRoomCodesForTests, GridRoom } from './GridRoom.js'
import { getTrackVoteOptions } from '../src/game/tracks.js'

const mockClient = sessionId => ({ sessionId, auth: {}, send: vi.fn() })
let seq = 0
const cmd = (room, client, type, payload = {}, roundId = 1) => {
  seq += 1
  return room.handleCommand(client, { protocolVersion: 1, type, roomId: room.state.roomCode, roundId, sequence: seq, payload })
}

describe('GridRoom race flow', () => {
  it('lobby -> countdown -> racing -> finished -> next race, with live tune', () => {
    resetActiveRoomCodesForTests()
    seq = 0
    const room = new GridRoom()
    room.onCreate({ roomCode: 'GRID1' })
    const host = mockClient('s-host')
    const guest = mockClient('s-guest')
    room.onJoin(host, { playerName: 'Alf' })
    room.onJoin(guest, { playerName: 'Bob' })

    expect(cmd(room, host, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, guest, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, guest, 'start').ok).toBe(false)
    expect(cmd(room, host, 'start').ok).toBe(true)
    expect(room.state.phase).toBe('countdown')
    expect(room.state.cars.size).toBe(12)
    expect(cmd(room, guest, 'tune', { patch: { 'car.grip': 3 } }).ok).toBe(false)
    expect(cmd(room, host, 'tune', { patch: { 'car.grip': 3 } }).ok).toBe(true)
    expect(room.tune.car.grip).toBe(3)
    expect(JSON.parse(room.state.tuneJson).car.grip).toBe(3)
    expect(cmd(room, host, 'tune', { patch: { 'bogus.x': 1 } }).ok).toBe(false)

    room.advanceSimulation(50, room.state.countdownEndsAt + 100)
    expect(room.state.phase).toBe('racing')
    expect(cmd(room, host, 'input', { steer: 0.2, throttle: 1 }).ok).toBe(true)
    expect(cmd(room, host, 'use-item').ok).toBe(false)
    expect(cmd(room, host, 'vote-preset', { presetId: 'drift' }).ok).toBe(false)

    // drive a little: someone should move
    for (let t = 0; t < 2000; t += 50) room.advanceSimulation(50, Date.now() + t)
    const moved = [...room.state.cars.values()].some(c => c.speed > 0)
    expect(moved).toBe(true)

    // force the finish: all cars across the line
    const now = Date.now() + 60000
    for (const car of room.race.cars) {
      car.finished = true
      car.finishTimeMs = now
    }
    room.advanceSimulation(50, now)
    expect(room.state.phase).toBe('finished')
    expect(room.state.winnerSeat).toBeGreaterThanOrEqual(0)
    expect(cmd(room, guest, 'vote-preset', { presetId: 'drift' }).ok).toBe(true)
    expect(cmd(room, host, 'vote-preset', { presetId: 'drift' }).ok).toBe(true)
    expect(JSON.parse(room.state.presetVotesJson)).toEqual({ [room.playerIdBySession.get('s-guest')]: 'drift', [room.playerIdBySession.get('s-host')]: 'drift' })
    const nextTrack = getTrackVoteOptions(room.state.activeTrackId, room.state.raceNo)[0]
    expect(cmd(room, host, 'vote-track', { trackId: room.state.activeTrackId }).ok).toBe(false)
    expect(cmd(room, guest, 'vote-track', { trackId: nextTrack.id }).ok).toBe(true)
    expect(cmd(room, host, 'vote-track', { trackId: nextTrack.id }).ok).toBe(true)

    expect(cmd(room, guest, 'next-race', {}, room.state.raceNo).ok).toBe(false)
    expect(cmd(room, host, 'next-race', {}, room.state.raceNo).ok).toBe(true)
    expect(room.state.phase).toBe('lobby')
    expect(room.state.raceNo).toBe(2)
    expect(room.state.activePreset).toBe('drift')
    expect(room.tune.car.grip).toBe(6.5)
    expect(room.state.presetVotesJson).toBe('{}')
    expect(room.state.activeTrackId).toBe(nextTrack.id)
    expect(room.state.trackName).toBe(nextTrack.name)
    expect(room.state.trackVotesJson).toBe('{}')
  })

  it('host picks premade or studio tracks in the lobby', async () => {
    resetActiveRoomCodesForTests()
    seq = 0
    const room = new GridRoom()
    room.onCreate({ roomCode: 'GRID2' })
    const host = mockClient('s-h2')
    const guest = mockClient('s-g2')
    room.onJoin(host, { playerName: 'Alf' })
    room.onJoin(guest, { playerName: 'Bob' })
    expect(room.state.trackName).toBe('Switchback Park')

    // guest cannot pick, junk is rejected
    expect(cmd(room, guest, 'set-track', { track: { points: [] } }).ok).toBe(false)
    expect(cmd(room, host, 'set-track', { track: { points: [[0, 0]] } }).ok).toBe(false)

    // host uploads a studio-style loop
    const pts = []
    for (let i = 0; i < 40; i += 1) {
      const a = (i / 40) * Math.PI * 2
      pts.push([800 + Math.cos(a) * 420, 450 + Math.sin(a) * 300])
    }
    const { finalizeTrack } = await import('../src/game/trackEdit.js')
    const res = finalizeTrack(pts, { name: 'Host Oval' })
    expect(res.ok).toBe(true)
    expect(cmd(room, host, 'set-track', { track: res.data }).ok).toBe(true)
    expect(room.state.trackName).toBe('Host Oval')

    // the uploaded loop is what gets raced
    expect(cmd(room, host, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, guest, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, host, 'start').ok).toBe(true)
    expect(room.race.track.points.length).toBe(res.data.points.length)
    expect(room.race.track.pit.cx).toBe(res.data.pit.cx)
  })

  it('horns honk mid-race, then cool down', () => {
    resetActiveRoomCodesForTests()
    seq = 0
    const room = new GridRoom()
    room.onCreate({ roomCode: 'GRID3' })
    const host = mockClient('s-h3')
    const guest = mockClient('s-g3')
    room.onJoin(host, { playerName: 'Alf' })
    room.onJoin(guest, { playerName: 'Bob' })
    expect(cmd(room, host, 'horn', {}).ok).toBe(false)
    expect(cmd(room, host, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, guest, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, host, 'start').ok).toBe(true)
    room.advanceSimulation(50, room.state.countdownEndsAt + 100)
    expect(room.state.phase).toBe('racing')
    expect(cmd(room, host, 'horn', {}).ok).toBe(true)
    expect(cmd(room, host, 'horn', {}).ok).toBe(false)
    expect(room.race.events.some(e => e.kind === 'horn')).toBe(true)
  })

  it('handbrake input reaches the car', () => {
    resetActiveRoomCodesForTests()
    seq = 0
    const room = new GridRoom()
    room.onCreate({ roomCode: 'GRID4' })
    const host = mockClient('s-h4')
    const guest = mockClient('s-g4')
    room.onJoin(host, { playerName: 'Alf' })
    room.onJoin(guest, { playerName: 'Bob' })
    expect(cmd(room, host, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, guest, 'ready', { ready: true }).ok).toBe(true)
    expect(cmd(room, host, 'start').ok).toBe(true)
    room.advanceSimulation(50, room.state.countdownEndsAt + 100)
    expect(cmd(room, host, 'input', { steer: 0.5, throttle: 1, handbrake: true }).ok).toBe(true)
    room.advanceSimulation(50, Date.now())
    expect(room.carOf(room.playerIdBySession.get('s-h4')).input.handbrake).toBe(true)
  })
})
