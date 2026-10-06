import { MapSchema, schema } from '@colyseus/schema'

export const PlayerState = schema({
  id: 'string',
  connectionId: 'string',
  name: 'string',
  role: 'string',
  ready: 'boolean',
  connected: 'boolean',
  wins: 'number',
  bestLapMs: 'number',
})

export const CarState = schema({
  seat: 'number',
  playerId: 'string',
  name: 'string',
  colorIndex: 'number',
  isNpc: 'boolean',
  x: 'number',
  y: 'number',
  angle: 'number',
  speed: 'number',
  lap: 'number',
  place: 'number',
  progress: 'number',
  level: 'number',
  item: 'string',
  wear: 'number',
  pit: 'string',
  needle: 'number',
  pitProgress: 'number',
  boosting: 'boolean',
  spinning: 'boolean',
  shielding: 'boolean',
  finished: 'boolean',
})

export const HazardState = schema({
  id: 'number',
  kind: 'string',
  x: 'number',
  y: 'number',
})

export const VanState = schema({
  id: 'number',
  x: 'number',
  y: 'number',
  angle: 'number',
  level: 'number',
  wobbling: 'boolean',
})

export const BoxState = schema({
  idx: 'number',
  available: 'boolean',
})

export const FeedEvent = schema({
  eventId: 'string',
  kind: 'string',
  text: 'string',
  seat: 'number',
})

export const GridState = schema({
  roomCode: 'string',
  phase: 'string',
  privacy: 'string',
  raceNo: 'number',
  countdownEndsAt: 'number',
  winnerName: 'string',
  winnerSeat: 'number',
  winnerEventId: 'string',
  hostPlayerId: 'string',
  tuneJson: 'string',
  trackJson: 'string',
  trackName: 'string',
  activeTrackId: 'string',
  trackVotesJson: 'string',
  activePreset: 'string',
  presetVotesJson: 'string',
  players: { map: PlayerState, default: new MapSchema() },
  cars: { map: CarState, default: new MapSchema() },
  hazards: { map: HazardState, default: new MapSchema() },
  vans: { map: VanState, default: new MapSchema() },
  boxes: { map: BoxState, default: new MapSchema() },
  events: { map: FeedEvent, default: new MapSchema() },
})
