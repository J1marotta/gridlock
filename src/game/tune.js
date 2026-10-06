// Live-tunable variables, read by the sim every tick.
export const TUNE_DEFAULTS = {
  race: { laps: 2, countdownMs: 2400, winnerGraceMs: 15000, timeLimitMs: 300000 },
  car: { topMul: 1, accel: 205, brakePow: 340, reverseTop: 70, steerRate: 3, grip: 9.4, offTopMul: 0.58, catchupPerPlace: 0.02, handbrakeTurn: 1.6 },
  tires: { wearRate: 0.82, offWearMul: 2, driftWearMul: 1.55, gripLoss: 0.34, topLoss: 0.26, baldCap: 0.5 },
  items: {
    boost: true, oil: true, shield: true,
    boxRespawnMs: 6000, boostTopMul: 1.55, boostMs: 1600,
    oilSpinMs: 1100, hazardLifeMs: 25000, shieldMs: 8000,
  },
  traffic: { count: 3, speed: 100 },
  pit: { speedLimit: 150, boxHoldMs: 400, crewBaseMs: 1000, pushMs: 300, perfectMs: 600, okMs: 1600, slowMs: 3000, perfectHalf: 0.06, okHalf: 0.18, needleSpeed: 1.7 },
}

export const RACE_PRESETS = [
  {
    id: 'balanced', name: 'Grip Hero', icon: '🛞', feel: 'Predictable turns • standard traffic',
    car: { topMul: 1, accel: 205, brakePow: 340, steerRate: 3, grip: 9.4 },
    tires: { wearRate: 0.82, driftWearMul: 1.55, gripLoss: 0.34, topLoss: 0.26 },
    items: { boxRespawnMs: 6000, boostTopMul: 1.55, boostMs: 1600, oilSpinMs: 1100 },
    traffic: { count: 5 },
  },
  {
    id: 'drift', name: 'Sideways', icon: '💨', feel: 'Loose turns • more item chaos',
    car: { topMul: 1.03, accel: 205, brakePow: 300, steerRate: 3.65, grip: 6.5 },
    tires: { wearRate: 0.98, driftWearMul: 1.25, gripLoss: 0.38, topLoss: 0.28 },
    items: { boxRespawnMs: 4800, boostTopMul: 1.55, boostMs: 1600, oilSpinMs: 1300 },
    traffic: { count: 5 },
  },
  {
    id: 'turbo', name: 'Redline', icon: '🚀', feel: 'High speed • bigger boosts • less traffic',
    car: { topMul: 1.14, accel: 235, brakePow: 300, steerRate: 3.25, grip: 7.2 },
    tires: { wearRate: 1.05, driftWearMul: 1.7, gripLoss: 0.42, topLoss: 0.32 },
    items: { boxRespawnMs: 4500, boostTopMul: 1.8, boostMs: 2000, oilSpinMs: 1100 },
    traffic: { count: 2 },
  },
]

export function applyRacePreset(tune, presetId) {
  const preset = RACE_PRESETS.find(item => item.id === presetId)
  if (!preset) return false
  Object.assign(tune.car, preset.car)
  Object.assign(tune.tires, preset.tires)
  Object.assign(tune.items, preset.items)
  Object.assign(tune.traffic, preset.traffic)
  return true
}

export const TUNE_META = {
  'race.laps': { label: 'Laps', min: 1, max: 9, step: 1 },
  'race.countdownMs': { label: 'Countdown (ms)', min: 1000, max: 10000, step: 500 },
  'race.winnerGraceMs': { label: 'Winner grace (ms)', min: 5000, max: 120000, step: 1000 },
  'race.timeLimitMs': { label: 'Race time limit (ms)', min: 60000, max: 600000, step: 5000 },
  'car.topMul': { label: 'Top speed ×', min: 0.4, max: 2, step: 0.05 },
  'car.accel': { label: 'Acceleration', min: 60, max: 400, step: 5 },
  'car.brakePow': { label: 'Brakes', min: 100, max: 600, step: 10 },
  'car.reverseTop': { label: 'Reverse top', min: 20, max: 200, step: 5 },
  'car.steerRate': { label: 'Steering', min: 1, max: 5, step: 0.1 },
  'car.grip': { label: 'Grip', min: 2, max: 14, step: 0.5 },
  'car.offTopMul': { label: 'Grass top ×', min: 0.2, max: 1, step: 0.05 },
  'car.handbrakeTurn': { label: 'Handbrake turn ×', min: 1, max: 4, step: 0.1 },
  'car.catchupPerPlace': { label: 'Catch-up ×/place', min: 0, max: 0.08, step: 0.005 },
  'tires.wearRate': { label: 'Tire wear /s', min: 0, max: 5, step: 0.05 },
  'tires.driftWearMul': { label: 'Drift wear ×', min: 1, max: 5, step: 0.1 },
  'tires.offWearMul': { label: 'Off-track wear ×', min: 1, max: 5, step: 0.1 },
  'tires.gripLoss': { label: 'Worn grip loss', min: 0, max: 0.9, step: 0.05 },
  'tires.topLoss': { label: 'Worn top loss', min: 0, max: 0.9, step: 0.05 },
  'tires.baldCap': { label: 'Bald top cap ×', min: 0.2, max: 1, step: 0.05 },
  'items.boost': { label: 'Boost enabled', type: 'bool' },
  'items.oil': { label: 'Oil enabled', type: 'bool' },
  'items.shield': { label: 'Shield enabled', type: 'bool' },
  'items.boxRespawnMs': { label: 'Box respawn (ms)', min: 1000, max: 20000, step: 500 },
  'items.boostTopMul': { label: 'Boost top ×', min: 1, max: 2.5, step: 0.05 },
  'items.boostMs': { label: 'Boost time (ms)', min: 500, max: 5000, step: 100 },
  'items.oilSpinMs': { label: 'Oil spin (ms)', min: 300, max: 3000, step: 100 },
  'items.shieldMs': { label: 'Shield time (ms)', min: 2000, max: 20000, step: 500 },
  'items.hazardLifeMs': { label: 'Hazard life (ms)', min: 5000, max: 60000, step: 1000 },
  'traffic.count': { label: 'Traffic vans', type: 'select', options: [0, 2, 3, 5, 8] },
  'traffic.speed': { label: 'Van speed', min: 40, max: 220, step: 5 },
  'pit.speedLimit': { label: 'Pit speed limit', min: 60, max: 400, step: 10 },
  'pit.boxHoldMs': { label: 'Box hold (ms)', min: 0, max: 2000, step: 100 },
  'pit.crewBaseMs': { label: 'Crew base (ms)', min: 0, max: 4000, step: 100 },
  'pit.pushMs': { label: 'Mash bonus (ms)', min: 0, max: 1000, step: 50 },
  'pit.perfectMs': { label: 'Perfect bonus (ms)', min: 0, max: 2000, step: 100 },
  'pit.okMs': { label: 'Ok bonus (ms)', min: 0, max: 3000, step: 100 },
  'pit.slowMs': { label: 'Slow penalty (ms)', min: 0, max: 6000, step: 100 },
  'pit.needleSpeed': { label: 'Pit needle speed', min: 0.5, max: 4, step: 0.1 },
  'pit.perfectHalf': { label: 'Pit perfect ±', min: 0.02, max: 0.2, step: 0.01 },
  'pit.okHalf': { label: 'Pit ok ±', min: 0.05, max: 0.4, step: 0.01 },
}

export function cloneTune() {
  return JSON.parse(JSON.stringify(TUNE_DEFAULTS))
}

export function getByPath(tune, path) {
  const [a, b] = path.split('.')
  return tune?.[a]?.[b]
}

export function setByPath(tune, path, value) {
  const meta = TUNE_META[path]
  if (!meta) return false
  const [a, b] = path.split('.')
  if (!tune[a]) return false
  if (meta.type === 'bool') tune[a][b] = Boolean(value)
  else if (meta.type === 'select') {
    if (!meta.options.includes(Number(value))) return false
    tune[a][b] = Number(value)
  } else {
    const n = Number(value)
    if (!Number.isFinite(n)) return false
    tune[a][b] = Math.min(meta.max, Math.max(meta.min, n))
  }
  return true
}

export function applyPatch(tune, patch) {
  let applied = 0
  for (const [path, value] of Object.entries(patch ?? {})) {
    if (setByPath(tune, path, value)) applied += 1
  }
  return applied
}
