// Remote smoke test against the deployed Fly.io room.
import { Client } from '@colyseus/sdk'
import { CLIENT_MESSAGE_TYPES, PROTOCOL_VERSION } from '../src/multiplayer/protocol.js'

const endpoint = process.env.COLYSEUS_URL || 'wss://gridlock-racer.fly.dev'
const roomCode = `SMOKE${Date.now().toString(36).toUpperCase()}`.replace(/[^A-Z0-9]/g, '').slice(-6).padStart(5, 'G')
const rooms = []

const waitFor = (predicate, timeoutMs = 20000, label = 'condition') => new Promise((resolve, reject) => {
  const startedAt = Date.now()
  const check = () => {
    let value
    try { value = predicate() } catch { value = false }
    if (value) return resolve(value)
    if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Remote smoke timed out: ${label}`))
    setTimeout(check, 100)
  }
  check()
})

const send = (room, type, payload, sequence) => room.send('command', {
  protocolVersion: PROTOCOL_VERSION,
  type,
  roomId: room.roomId,
  roundId: room.state.raceNo,
  sequence,
  payload,
})

try {
  const host = await new Client(endpoint).create('grid-room', {
    roomCode, playerName: 'Smoke Host', privacy: 'private',
  })
  rooms.push(host)
  const guest = await new Client(endpoint).joinById(roomCode, { playerName: 'Smoke Guest' })
  rooms.push(guest)
  await waitFor(() => host.state.players?.size === 2 && guest.state.players?.size === 2, 20000, 'roster sync')

  let hostSeat = null
  host.onMessage('private-state', v => { if (v?.seat !== undefined) hostSeat = v.seat })

  send(host, CLIENT_MESSAGE_TYPES.READY, { ready: true }, 1)
  send(guest, CLIENT_MESSAGE_TYPES.READY, { ready: true }, 1)
  await waitFor(() => [...host.state.players.values()].every(p => p.ready), 15000, 'ready sync')
  send(host, CLIENT_MESSAGE_TYPES.START, {}, 2)
  await waitFor(() => host.state.phase === 'countdown' && host.state.cars?.size === 12, 15000, 'countdown + grid')
  await waitFor(() => hostSeat !== null, 15000, 'seat assignment')
  await waitFor(() => host.state.phase === 'racing', 15000, 'green light')

  // host-only live tune applies mid-race
  send(host, CLIENT_MESSAGE_TYPES.TUNE, { patch: { 'traffic.count': 0 } }, 3)
  await waitFor(() => {
    try { return JSON.parse(host.state.tuneJson).traffic.count === 0 } catch { return false }
  }, 15000, 'live tune sync')

  send(host, CLIENT_MESSAGE_TYPES.INPUT, { steer: 0, throttle: 1 }, 4)
  await waitFor(() => [...host.state.cars.values()].some(c => c.speed > 20), 20000, 'movement sync')

  console.log(JSON.stringify({ ok: true, endpoint, roomCode, cars: host.state.cars.size, seat: hostSeat }))
} finally {
  for (const room of rooms.reverse()) {
    await Promise.race([room.leave(true).catch(() => {}), new Promise(r => setTimeout(r, 1000))])
  }
}
