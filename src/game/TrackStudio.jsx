import { useEffect, useRef, useState } from 'react'
import { WORLD_H, WORLD_W, trackFromData } from './track.js'
import { levelRuns } from './raceCanvas.js'
import {
  clearanceAt, finalizeTrack, placePitAt, rawLength, resampleClosed,
  smoothClosed, snapToLoop, validateLoop,
} from './trackEdit.js'

const SCALE = 0.55
export const STUDIO_SLOTS = ['gridlock-track-a', 'gridlock-track-b', 'gridlock-track-c']

function toWorld(e, canvas) {
  const r = canvas.getBoundingClientRect()
  return [
    ((e.clientX - r.left) / r.width) * WORLD_W,
    ((e.clientY - r.top) / r.height) * WORLD_H,
  ]
}

export default function TrackStudio({ onTestDrive, onExit }) {
  const canvasRef = useRef(null)
  const [raw, setRaw] = useState([])
  const [painting, setPainting] = useState(false)
  const [width, setWidth] = useState(46)
  const [trackName, setTrackName] = useState('Custom Loop')
  const [result, setResult] = useState(null)
  const [tool, setTool] = useState('paint')
  const [pitSide, setPitSide] = useState(1)
  const [spanKind, setSpanKind] = useState(1)
  const [spanA, setSpanA] = useState(null)
  const [reverseStart, setReverseStart] = useState(false)
  const [importText, setImportText] = useState('')
  const [msg, setMsg] = useState('')
  const rawRef = useRef(raw)
  rawRef.current = raw
  const resultRef = useRef(result)
  resultRef.current = result

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
      const res = resultRef.current
      ctx.fillStyle = '#1d5c2e'
      ctx.fillRect(0, 0, W, H)
      ctx.save()
      ctx.scale(SCALE, SCALE)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (res?.ok && res.preview) {
        const pts = res.preview
        const d = res.data
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
        const lvls = d.levels ?? []
        if (lvls.some(l => l !== 0)) {
          const fake = { points: pts, levels: lvls }
          for (const run of levelRuns(fake)) {
            if (run.level === 0) continue
            ctx.beginPath()
            ctx.moveTo(pts[run.from][0], pts[run.from][1])
            for (let i = run.from + 1; i <= run.to + 1; i += 1) {
              const p = pts[i % pts.length]
              ctx.lineTo(p[0], p[1])
            }
            ctx.lineWidth = width * 2
            ctx.strokeStyle = run.level > 0 ? 'rgba(255,159,28,0.75)' : 'rgba(51,120,255,0.75)'
            ctx.stroke()
          }
        }
        const pit = d.pit
        ctx.save()
        ctx.translate(pit.cx, pit.cy)
        ctx.rotate(pit.angle)
        ctx.fillStyle = 'rgba(85,85,95,0.9)'
        ctx.fillRect(-pit.length / 2, -pit.width / 2, pit.length, pit.width)
        ctx.strokeStyle = '#ffd23f'
        ctx.lineWidth = 3
        ctx.strokeRect(-pit.length / 2, -pit.width / 2, pit.length, pit.width)
        ctx.restore()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 26px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('🏁', d.start.x, d.start.y - 24)
        ctx.fillStyle = '#33ccff'
        for (const b of d.boxes) ctx.fillRect(b.x - 10, b.y - 10, 20, 20)
      } else if (smoothed.length > 1) {
        ctx.beginPath()
        ctx.moveTo(smoothed[0][0], smoothed[0][1])
        for (let i = 1; i < smoothed.length; i += 1) ctx.lineTo(smoothed[i][0], smoothed[i][1])
        ctx.lineWidth = width * 2
        ctx.strokeStyle = 'rgba(58,58,68,0.9)'
        ctx.stroke()
        ctx.fillStyle = '#ffd23f'
        for (const [x, y] of rawRef.current) {
          ctx.beginPath()
          ctx.arc(x, y, 6, 0, Math.PI * 2)
          ctx.fill()
        }
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

  function withData(mut, note) {
    if (!result?.ok) return
    const data = mut({ ...result.data })
    const verify = trackFromData(data)
    if (!verify.ok) {
      setMsg(`Rejected: ${verify.error}`)
      return
    }
    setResult({ ...result, data })
    if (note) setMsg(note)
  }

  function onCanvasDown(e) {
    e.preventDefault()
    if (tool === 'paint' || !result?.ok) {
      if (tool !== 'paint') setTool('paint')
      setResult(null)
      setPainting(true)
      paint(e)
      return
    }
    const [x, y] = toWorld(e, canvasRef.current)
    const pts = result.preview
    if (tool === 'pit') {
      const snap = snapToLoop(pts, x, y)
      const pit = placePitAt(snap, width, pitSide)
      const clear = clearanceAt(pts, width, pit.cx, pit.cy)
      withData(d => ({ ...d, pit }),
        `Pit placed ${pitSide > 0 ? 'right' : 'left'} of the track` +
        (clear < width + 20 ? ' — ⚠ close to the ribbon' : ''))
    } else if (tool === 'start') {
      const snap = snapToLoop(pts, x, y)
      const angle = reverseStart ? snap.angle + Math.PI : snap.angle
      withData(d => ({ ...d, start: { x: Math.round(snap.x), y: Math.round(snap.y), angle } }),
        'Start line moved — grid follows it')
    } else if (tool === 'span') {
      const snap = snapToLoop(pts, x, y)
      if (spanA === null) {
        setSpanA(snap.seg)
        setMsg(`Span starts at seg ${snap.seg} — click where it ends`)
      } else {
        applySpan(spanA, snap.seg)
        setSpanA(null)
      }
    }
  }

  function applySpan(a, b) {
    if (!result?.ok) return
    const n = result.preview.length
    const fwd = ((b - a) % n + n) % n
    if (fwd < 4) {
      setMsg('Span too short — pick points further apart along the loop')
      return
    }
    if (fwd > n - 4) {
      setMsg('That covers nearly the whole loop — pick a shorter span')
      return
    }
    const levels = [...(result.data.levels ?? result.preview.map(() => 0))]
    for (let k = 0; k < fwd; k += 1) levels[(a + k) % n] = spanKind
    withData(d => ({ ...d, levels }),
      `${spanKind > 0 ? 'Bridge' : 'Tunnel'} span set (${fwd} segs)`)
  }

  function closeLoop() {
    const res = finalizeTrack(raw, { name: trackName.trim() || 'Custom Loop', halfWidth: width })
    if (res.ok) {
      setResult({ ...res, preview: res.data.points })
      setMsg(`Loop closed: ${Math.round(res.total)}px${res.warnings.length ? ' — ' + res.warnings.join(' · ') : ''}. Place pit/start or add spans.`)
      setTool('pit')
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
      setTool('pit')
      setMsg(`Imported "${data.name || 'loop'}" — TEST DRIVE when ready`)
    } catch {
      setMsg('Import rejected: not valid JSON')
    }
  }

  function saveSlot(i) {
    if (!result?.ok) return
    try {
      localStorage.setItem(STUDIO_SLOTS[i], JSON.stringify(result.data))
      setMsg(`Saved to slot ${i + 1}`)
    } catch { setMsg('Save failed (storage full?)') }
  }

  function loadSlot(i) {
    try {
      const text = localStorage.getItem(STUDIO_SLOTS[i])
      if (!text) {
        setMsg(`Slot ${i + 1} is empty`)
        return
      }
      importJson(text)
    } catch { setMsg('Load failed') }
  }

  const tools = [
    ['paint', '🖌 PAINT'],
    ['pit', '🔧 PIT'],
    ['start', '🏁 START'],
    ['span', spanKind > 0 ? '🌉 BRIDGE' : '🚇 TUNNEL'],
  ]

  return (
    <div className="grid-card">
      <h2>🎨 TRACK STUDIO</h2>
      <p className="dim small">Paint the centerline, close the loop, then place the pit lane, start line and bridge/tunnel spans.</p>
      <div className="nitro-row" style={{ marginBottom: 8 }}>
        {tools.map(([id, label]) => (
          <button
            key={id} className="nitro-btn small"
            style={tool === id ? { borderColor: '#ffd23f' } : undefined}
            disabled={id !== 'paint' && !result?.ok}
            onClick={() => { setTool(id); setSpanA(null) }}
          >{label}</button>
        ))}
        {tool === 'pit' && (
          <button className="nitro-btn small" onClick={() => setPitSide(s => -s)}>
            SIDE: {pitSide > 0 ? 'RIGHT →' : '← LEFT'}
          </button>
        )}
        {tool === 'start' && (
          <button className="nitro-btn small" onClick={() => setReverseStart(r => !r)}>
            DIR: {reverseStart ? '↩ REVERSED' : 'FORWARD ↪'}
          </button>
        )}
        {tool === 'span' && (
          <button className="nitro-btn small" onClick={() => { setSpanKind(k => -k); setSpanA(null) }}>
            {spanKind > 0 ? '🌉 BRIDGE (click 2 pts)' : '🚇 TUNNEL (click 2 pts)'}
          </button>
        )}
        {tool === 'span' && result?.ok && (
          <button
            className="nitro-btn small"
            onClick={() => withData(d => ({ ...d, levels: d.points.map(() => 0) }), 'Levels cleared')}
          >CLEAR LEVELS</button>
        )}
      </div>
      <div className="studio-wrap">
        <canvas
          ref={canvasRef} width={Math.round(WORLD_W * SCALE)} height={Math.round(WORLD_H * SCALE)}
          className="studio-canvas"
          onPointerDown={onCanvasDown}
          onPointerMove={e => { if (painting && tool === 'paint') paint(e) }}
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
        <button className="nitro-btn" onClick={() => { setRaw([]); setResult(null); setMsg(''); setTool('paint') }}>CLEAR</button>
        <button className="nitro-btn go" disabled={raw.length < 8} onClick={closeLoop}>CLOSE LOOP{nearStart ? ' ✓' : ''}</button>
      </div>
      {spanA !== null && <p className="dim small">Span starts at seg {spanA} — click where it ends (≥4 segs along).</p>}
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
              className="g-input" style={{ flex: 1 }} placeholder="Paste track JSON to import…"
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
