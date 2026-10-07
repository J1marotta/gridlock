import { describe, expect, it } from 'vitest'
import { drawCar } from './raceCanvas.js'
import { buildTrack } from './track.js'

function stubCtx() {
  const calls = []
  const ctx = new Proxy({}, {
    get: (_t, k) => (...args) => { calls.push([k, ...args]) },
    set: () => true,
  })
  return { calls, ctx }
}

const textsOf = calls => calls.filter(([k]) => k === 'fillText').map(([, s]) => String(s))

function testCar(over = {}) {
  return {
    seat: 0, place: 3, name: 'Tester', colorIndex: 0, item: '',
    level: 0, x: 800, y: 700, angle: 0, speed: 200,
    wear: 50, pit: 'none', pitProgress: 0, pitPushes: 0,
    boosting: false, spinning: false, shielding: false, hb: false,
    finished: false, ...over,
  }
}

const view = { localSeat: 0, phase: 'racing' }

describe('pit visuals', () => {
  it('draws the mash panel with a Z keycap while being serviced', () => {
    const { calls, ctx } = stubCtx()
    drawCar(ctx, view, buildTrack(), testCar({ pit: 'working', pitProgress: 0.4, pitPushes: 2 }), 1000)
    const texts = textsOf(calls)
    expect(texts.some(t => t.includes('MASH'))).toBe(true)
    expect(texts).toContain('Z')
  })

  it('prompts PRESS Z when service is available', () => {
    const track = buildTrack()
    const { calls, ctx } = stubCtx()
    drawCar(ctx, view, track, testCar({ x: track.pit.cx, y: track.pit.cy }), 1000)
    const texts = textsOf(calls)
    expect(texts.some(t => t.includes('PRESS'))).toBe(true)
    expect(texts).toContain('Z')
  })

  it('stays quiet with fresh tyres', () => {
    const track = buildTrack()
    const { calls, ctx } = stubCtx()
    drawCar(ctx, view, track, testCar({ x: track.pit.cx, y: track.pit.cy, wear: 5 }), 1000)
    const texts = textsOf(calls)
    expect(texts.some(t => t.includes('PRESS') || t.includes('MASH'))).toBe(false)
  })
})
