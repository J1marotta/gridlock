import { useEffect, useRef, useState } from 'react'
import { WORLD_H, WORLD_W, trackFromData } from './track.js'
import { finalizeTrack, rawLength, resampleClosed, smoothClosed, validateLoop } from './trackEdit.js'

const SCALE = 0.55 // 1600x900 -> 880x495 canvas
const SLOTS = ['gridlock-track-a', 'gridlock-track-b', 'gridlock-track-c']

function toWorld(e, canvas) {
  const r = canvas.getBoundingClientRect()
  return [
    ((e.clientX - r.left) / r.width) * WORLD_W,
    ((e.clientY - r.top) / r.height) * WORLD_H,
  ]
}

// Paint the centerline with a brush. Close the loop, get pits/boxes/gates
// generated, test-drive it, export the JSON.
export default function TrackStudio({ onTestDrive, onExit }) {
  const canvasRef = useRef(null)
  const [raw, setRaw] = useState([])
  const [painting, setPainting] = useState(false)
  const [width, setWidth] = useState(46)
  const [trackName, setTrackName] = useState('Custom Loop')
  const [result, setResult] = useState(null) // { ok, data?, errors, warnings }
  const [importText, setImportText] = useState('')
  const [msg, setMsg] = useState('')
  const rawRef = useRef(raw)
  rawRef.current = raw

  const smoothed = raw.length > 3 ? resampleClosed(smoothClosed(raw, 2), 18) : []
  const check = raw.length > 3
    ? validateLoop(smoothed, width)
    : { errors: [], warnings: [], total: 0, pinches: [] }
  const nearStart = raw.length > 1 &&
    Math.hypot(raw[raw.length - 1][0] - raw[0][0], raw[raw.length - 1][1] - raw[0][1]) < 70 &&
    rawLength(raw) > 900

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let raf = 0
    const loop = () => {
      const W = canvas.width, H = canvas.height
      ctx.fillStyle = '#1d5c2e'
      ctx.fillRect(0, 0, W, H)
      ctx.save()
      ctx.scale(SCALE, SCALE)
      // finalized preview ribbon
      if (result?.ok && result.preview) {
        const pts = result.preview
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
        ctx.closePath()
        ctx.lineWidth = width * 2 + 14
        ctx.strokeStyle = '#f5f5f5'
        ctx.stroke()
        ctx.lineWidth = width * 2
        ctx.strokeStyle = '#3a3a44'
        ctx.stroke()
        // pit + boxes
        const d = result.data
        ctx.strokeStyle = '#ffd23f'
        ctx.lineWidth = 3
        ctx.strokeRect(d.pit.x0, d.pit.y0, d.pit.x1 - d.pit.x0, d.pit.y1 - d.pit.y0)
        ctx.fillStyle = '#33ccff'
        for (const b of d.boxes) {
          ctx.fillRect(b.x - 10, b.y - 10, 20, 20)
        }
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 22px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('🏁', d.start.x, d.start.y - 20)
      } else if (smoothed.length > 1) {
        // live brush ribbon
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(smoothed[0][0], smoothed[0][1])
        for (let i = 1; i < smoothed.length; i += 1) ctx.lineTo(smoothed[i][0], smoothed[i][1])
        if (result) ctx.closePath()
        ctx.lineWidth = width * 2
        ctx.strokeStyle = 'rgba(58,58,68,0.9)'
        ctx.stroke()
        // raw stroke dots
        ctx.fillStyle = '#ffd23f'
        for (const [x, y] of rawRef.current) {
          ctx.beginPath()
          ctx.arc(x, y, 6, 0, Math.PI * 2)
          ctx.fill()
        }
        // start marker + snap ring
        const [sx, sy] = rawRef.current[0]
        ctx.strokeStyle = nearStart ? '#22ff66' : '#fff'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(sx, sy, nearStart ? 26 : 16, 0, Math.PI * 2)
        ctx.stroke()
      } else if (rawRef.current.length) {
        ctx.fillStyle = '#ffd23f'
        const [sx, sy] = rawRef.current[0]
        ctx.beginPath()
        ctx.arc(sx, sy, 14, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.font = '28px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('Paint one big loop with the brush', (WORLD_W / 2), WORLD_H / 2 - 10)
        ctx.fillText('finish near the white ring, then CLOSE LOOP', (WORLD_W / 2), WORLD_H / 2 + 26)
      }
      // pinch warnings
      ctx.fillStyle = '#ff5555'
      ctx.font = 'bold 26px monospace'
      ctx.textAlign = 'center'
      for (const p of check.pinches) ctx.fillText('⚠', p.x, p.y)
      ctx.restore()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  })

  function paint(e) {
    const canvas = canvasRef.current
    const [x, y] = toWorld(e, canvas)
    setRaw(prev => {
      const last = prev[prev.length - 1]
      if (last && Math.hypot(x - last[0], y - last[1]) < 9) return prev
      return [...prev, [Math.round(x), Math.round(y)]]
    })
  }

  function closeLoop() {
    const res = finalizeTrack(rawRef.current, { name: trackName.trim() || 'Custom Loop', halfWidth: width })
    if (res.ok) {
      const verify = trackFromData(res.data)
      if (!verify.ok) {
        setResult({ ok: false, errors: [verify.error], warnings: [] })
        return
      }
      setResult({ ...res, preview: res.data.points })
      setMsg(`Loop closed: ${Math.round(res.total)}px, ${res.data.points.length} pts${res.warnings.length ? ' — ' + res.warnings.join(' · ') : ''}`)
    } else {
      setResult(res)
      setMsg(res.errors.join(' · '))
    }
  }

  function exportJson() {
    if (!result?.ok) return
    const text = JSON.stringify(result.data, null, 2)
    const blob = new Blob([text], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${result.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.gridlock.json`
    a.click()
    URL.revokeObjectURL(a.href)
    navigator.clipboard?.writeText(text).catch(() => {})
    setMsg('Downloaded + copied to clipboard')
  }

  function importJson(text) {
    try {
      const data = JSON.parse(text)
      const verify = trackFromData(data)
      if (!verify.ok) {
        setMsg(`Import rejected: ${verify.error}`)
        return
      }
      setTrackName(data.name || 'Imported Loop')
      setWidth(data.halfWidth || 46)
      setResult({ ok: true, data, warnings: [], preview: data.points })
      setRaw(data.points.filter((_, i) => i % 4 === 0))
      setMsg(`Imported "${data.name || 'loop'}" — TEST DRIVE when ready`)
    } catch {
      setMsg('Import rejected: not valid JSON')
    }
  }

  function saveSlot(i) {
    if (!result?.ok) return
    try {
      localStorage.setItem(SLOTS[i], JSON.stringify(result.data))
      setMsg(`Saved to slot ${i + 1}`)
    } catch { setMsg('Save failed (storage full?)') }
  }

  function loadSlot(i) {
    try {
      const text = localStorage.getItem(SLOTS[i])
      if (!text) {
        setMsg(`Slot ${i + 1} is empty`)
        return
      }
      importJson(text)
    } catch { setMsg('Load failed') }
  }

  return (
    <div className="grid-card">
      <h2>🎨 TRACK STUDIO</h2>
      <p className="dim small">Paint the centerline — the ribbon preview follows your brush. Close the loop to generate pits, boxes, gates and grid.</p>
      <div className="studio-wrap">
        <canvas
          ref={canvasRef} width={Math.round(WORLD_W * SCALE)} height={Math.round(WORLD_H * SCALE)}
          className="studio-canvas"
          onPointerDown={e => { e.preventDefault(); setResult(null); setPainting(true); paint(e) }}
          onPointerMove={e => { if (painting) paint(e) }}
          onPointerUp={() => setPainting(false)}
          onPointerLeave={() => setPainting(false)}
        />
      </div>
      <div className="nitro-row" style={{ marginTop: 8 }}>
        <label className="dim small">Width
          <input type="range" min={30} max={70} step={2} value={width} onChange={e => setWidth(Number(e.target.value))} />
          {width}
        </label>
        <input className="g-input" value={trackName} onChange={e => setTrackName(e.target.value)} maxLength={24} style={{ width: 170 }} placeholder="Track name" />
        <button className="nitro-btn" onClick={() => { setRaw([]); setResult(null); setMsg('') }}>CLEAR</button>
        <button className="nitro-btn go" disabled={raw.length < 8} onClick={closeLoop}>CLOSE LOOP{nearStart ? ' ✓' : ''}</button>
      </div>
      {check.warnings.map((w, i) => <p key={i} className="dim small">⚠ {w}</p>)}
      {msg && <p className="dim small">{msg}</p>}
      {result?.ok && (
        <>
          <div className="nitro-row" style={{ marginTop: 8 }}>
            <button className="nitro-btn primary" onClick={() => onTestDrive(result.data)}>🏁 TEST DRIVE</button>
            <button className="nitro-btn" onClick={exportJson}>⬇ EXPORT JSON</button>
            {[0, 1, 2].map(i => (
              <span key={i} className="nitro-row">
                <button className="nitro-btn small" onClick={() => saveSlot(i)}>SAVE {i + 1}</button>
                <button className="nitro-btn small" onClick={() => loadSlot(i)}>LOAD {i + 1}</button>
              </span>
            ))}
          </div>
          <div className="nitro-row" style={{ marginTop: 8 }}>
            <input
              className="g-input" style={{ flex: 1 }} placeholder='Paste track JSON to import…'
              value={importText} onChange={e => setImportText(e.target.value)}
            />
            <button className="nitro-btn small" onClick={() => importJson(importText)}>IMPORT</button>
          </div>
        </>
      )}
      <div className="nitro-row" style={{ marginTop: 8 }}>
        <button className="nitro-btn" onClick={onExit}>← BACK</button>
      </div>
    </div>
  )
}
