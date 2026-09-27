import { describe, expect, it } from 'vitest'
import { TUNE_DEFAULTS, TUNE_META, RACE_PRESETS, applyPatch, applyRacePreset, cloneTune, getByPath, setByPath } from './tune.js'

describe('tune system', () => {
  it('offers three distinct, valid handling presets', () => {
    expect(RACE_PRESETS.map(p => p.id)).toEqual(['balanced', 'drift', 'turbo'])
    const t = cloneTune()
    expect(applyRacePreset(t, 'drift')).toBe(true)
    expect(t.car.grip).toBe(6.5)
    expect(t.car.steerRate).toBeGreaterThan(TUNE_DEFAULTS.car.steerRate)
    expect(applyRacePreset(t, 'unknown')).toBe(false)
  })

  it('defaults are sane', () => {
    expect(TUNE_DEFAULTS.race.laps).toBe(3)
    expect(TUNE_DEFAULTS.items.boost).toBe(true)
    expect(TUNE_DEFAULTS.traffic.count).toBe(5)
  })

  it('every default is covered by panel metadata', () => {
    const walk = (obj, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object') walk(v, path)
        else expect(TUNE_META[path], path).toBeTruthy()
      }
    }
    walk(TUNE_DEFAULTS)
  })

  it('numbers clamp, bools coerce, selects validate', () => {
    const t = cloneTune()
    expect(setByPath(t, 'race.laps', 99)).toBe(true)
    expect(t.race.laps).toBe(9)
    expect(setByPath(t, 'race.laps', -5)).toBe(true)
    expect(t.race.laps).toBe(1)
    expect(setByPath(t, 'items.boost', 0)).toBe(true)
    expect(t.items.boost).toBe(false)
    expect(setByPath(t, 'traffic.count', 7)).toBe(false)
    expect(t.traffic.count).toBe(5)
    expect(setByPath(t, 'traffic.count', 8)).toBe(true)
    expect(t.traffic.count).toBe(8)
    expect(setByPath(t, 'nope.nope', 1)).toBe(false)
    expect(getByPath(t, 'car.grip')).toBe(t.car.grip)
  })

  it('patch applies many at once and counts', () => {
    const t = cloneTune()
    expect(applyPatch(t, { 'car.grip': 3, 'items.oil': false, 'bogus.x': 1 })).toBe(2)
    expect(t.car.grip).toBe(3)
    expect(t.items.oil).toBe(false)
  })

  it('clones are independent', () => {
    const a = cloneTune()
    const b = cloneTune()
    a.car.grip = 1
    expect(b.car.grip).toBe(TUNE_DEFAULTS.car.grip)
  })
})
