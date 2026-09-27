import { describe, expect, it } from 'vitest'
import { decodeTrackCode, encodeTrackCode } from './trackShare.js'

describe('track share codes', () => {
  it('round trips complete track data using a copyable URL-safe code', async () => {
    const data = {
      name: 'Weekend Circuit',
      points: Array.from({ length: 120 }, (_, i) => [200 + i * 3, 300 + (i % 9) * 12]),
      halfWidth: 46,
      pit: { cx: 400, cy: 500, angle: 0.2, length: 620, width: 96 },
    }
    const code = await encodeTrackCode(data)
    expect(code).toMatch(/^GL1[GJ]\./)
    expect(code).not.toMatch(/[+/=]/)
    expect(await decodeTrackCode(code)).toEqual(data)
  })

  it('rejects unsupported code versions', async () => {
    await expect(decodeTrackCode('nope')).rejects.toThrow(/Track code/)
  })
})
