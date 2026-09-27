import { describe, expect, it, vi } from 'vitest'
import { resetActiveRoomCodesForTests, GridRoom } from './GridRoom.js'

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

    expect(cmd(room, guest, 'next-race', {}, room.state.raceNo).ok).toBe(false)
    expect(cmd(room, host, 'next-race', {}, room.state.raceNo).ok).toBe(true)
    expect(room.state.phase).toBe('lobby')
    expect(room.state.raceNo).toBe(2)
    expect(room.state.activePreset).toBe('drift')
    expect(room.tune.car.grip).toBe(6.5)
    expect(room.state.presetVotesJson).toBe('{}')
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
    expect(room.state.trackName).toBe('Speedway')

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
})
