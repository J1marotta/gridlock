import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { pathToFileURL } from 'node:url'
import { GRID_ROOM_NAME, GridRoom } from './GridRoom.js'

export const DEFAULT_GAME_SERVER_PORT = 2567

export function createGameServer() {
  const transport = new WebSocketTransport({ maxPayload: 4096, pingInterval: 10000, pingMaxRetries: 2 })
  const gameServer = new Server({ transport })
  const app = transport.getExpressApp()
  app.get('/health', (_req, res) => { res.json({ ok: true, service: 'gridlock-colyseus' }) })
  gameServer.define(GRID_ROOM_NAME, GridRoom)
  return { app, gameServer, transport }
}

export async function startGameServer({ port = DEFAULT_GAME_SERVER_PORT } = {}) {
  const server = createGameServer()
  await server.gameServer.listen(port)
  return server
}

const launchedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (launchedDirectly) {
  const port = Number(process.env.PORT) || DEFAULT_GAME_SERVER_PORT
  await startGameServer({ port })
  console.log(`Gridlock Colyseus server listening on http://127.0.0.1:${port}`)
}
