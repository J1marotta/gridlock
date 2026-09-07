import { useEffect, useMemo, useRef, useState } from 'react'
import { ColyseusTransport, getColyseusEndpoint } from './multiplayer/colyseusTransport.js'
import { normalizeRoomCode, randomRoomCode } from './multiplayer/protocol.js'
import { SEAT_COLORS } from '../server/sim.js'
import { applyPatch, cloneTune } from './game/tune.js'
import { renderRace } from './game/raceCanvas.js'
import { GridAudio } from './game/audio.js'
import { LocalRace } from './game/localRace.js'
import AdminPanel from './game/AdminPanel.jsx'
import TrackStudio from './game/TrackStudio.jsx'

const ITEM_GLYPH = { boost: '🚀', oil: '🛢', crate: '📦', shield: '🛡', zap: '⚡' }

function useTransport() {
  const ref = useRef(null)
  if (!ref.current) ref.current = new ColyseusTransport()
  return ref.current
}

function adaptNetView(snapshot, privateState, tune) {
  if (!snapshot) return null
  const map = m => (m instanceof Map ? [...m.values()] : Object.values(m ?? {}))
  return {
    phase: snapshot.phase,
    roomCode: snapshot.roomCode,
    raceNo: snapshot.raceNo,
    laps: tune.race.laps,
    countdownEndsAt: snapshot.countdownEndsAt,
    winnerName: snapshot.winnerName,
    winnerSeat: snapshot.winnerSeat,
    localSeat: privateState?.seat ?? -1,
    pitZone: { perfectHalf: tune.pit.perfectHalf, okHalf: tune.pit.okHalf },
    players: map(snapshot.players),
    cars: map(snapshot.cars),
    hazards: map(snapshot.hazards),
    vans: map(snapshot.vans),
    boxes: map(snapshot.boxes),
    events: map(snapshot.events),
  }
}

export default function GridApp() {
  const transport = useTransport()
  const audioRef = useRef(null)
  if (!audioRef.current) audioRef.current = new GridAudio()
  const [snapshot, setSnapshot] = useState(null)
  const [privateState, setPrivateState] = useState(null)
  const [screen, setScreen] = useState('menu')
  const [mode, setMode] = useState('net')
  const [name, setName] = useState(() => localStorage.getItem('gridlock-name') || 'Racer1')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [closedMsg, setClosedMsg] = useState('')
  const [muted, setMuted] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  // solo state
  const localRef = useRef(null)
  const localTuneRef = useRef(null)
  const [localVersion, setLocalVersion] = useState(0)
  const [netTune, setNetTune] = useState(() => cloneTune())
  // driving keys
  const keysRef = useRef({ up: false, down: false, left: false, right: false })
  const lastInputSent = useRef('')
  const lastCount = useRef(-1)
  const lastResultKey = useRef('')
  const resultRef = useRef(null)

  const tune = mode === 'local' ? (localTuneRef.current ?? cloneTune()) : netTune
  const canTune = mode === 'local' || isHost()
  const view = useMemo(() => {
    if (mode === 'local' && localRef.current) return localRef.current.snapshot()
    return adaptNetView(snapshot, privateState, netTune)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, privateState, netTune, mode, localVersion])

  function isHost() {
    if (mode === 'local') return true
    const players = snapshot?.players instanceof Map
      ? [...snapshot.players.values()]
      : Object.values(snapshot?.players ?? {})
    return players.find(p => p.id === privateState?.playerId)?.role === 'host'
  }
  const mySeat = mode === 'local' ? 0 : (privateState?.seat ?? -1)
  const localCar = view?.cars.find(c => c.seat === mySeat)

  useEffect(() => {
    const off1 = transport.subscribe('snapshot', snap => {
      setSnapshot(snap)
      try {
        const t = JSON.parse(snap?.tuneJson ?? '{}')
        if (t?.race) setNetTune(prev => (JSON.stringify(prev) === snap.tuneJson ? prev : { ...cloneTune(), ...t }))
      } catch { /* keep previous tune */ }
      if (snap?.phase && snap.phase !== 'closed') setScreen(snap.phase)
    })
    const off2 = transport.subscribe('private-state', setPrivateState)
    const off3 = transport.subscribe('error', env => {
      setError(env?.payload?.message || env?.message || 'Network error')
    })
    const off4 = transport.subscribe('closed', payload => {
      setClosedMsg(payload?.message || 'Room closed')
      setScreen('closed')
      setSnapshot(null)
    })
    return () => { off1(); off2(); off3(); off4() }
  }, [transport])

  // countdown beeps + finish fanfare
  useEffect(() => {
    if (!view) return
    if (view.phase === 'countdown' && view.countdownEndsAt) {
      const remain = view.countdownEndsAt - Date.now()
      const stage = remain > 2700 ? 3 : remain > 1800 ? 2 : remain > 900 ? 1 : 0
      if (stage !== lastCount.current) {
        lastCount.current = stage
        audioRef.current.ensure()
        audioRef.current.countdown(stage)
      }
    }
    if (view.phase === 'finished' && view.winnerName) {
      const key = `${view.roomCode}:${view.raceNo}:${view.winnerName}`
      if (lastResultKey.current !== key) {
        lastResultKey.current = key
        audioRef.current.ensure()
        audioRef.current.fanfare()
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [view, localVersion])

  function sendDrive() {
    const k = keysRef.current
    const steer = (k.left ? -1 : 0) + (k.right ? 1 : 0)
    const throttle = (k.up ? 1 : 0) + (k.down ? -0.7 : 0)
    const sig = `${steer},${throttle}`
    if (sig === lastInputSent.current) return
    lastInputSent.current = sig
    if (mode === 'local') localRef.current?.setInput(steer, throttle)
    else try { transport.drive(steer, throttle) } catch { /* noop */ }
  }

  function pressSpace() {
    audioRef.current.ensure()
    if (mode === 'local') {
      const car = localRef.current?.race.cars[0]
      if (car?.pitState === 'crew') audioRef.current.pit()
      else if (car?.item) audioRef.current.pickup()
      localRef.current?.pressSpace(Date.now())
    } else {
      if (localCar?.pit === 'crew') {
        audioRef.current.pit()
        try { transport.pitPress() } catch { /* noop */ }
      } else {
        audioRef.current.pickup()
        try { transport.useItem() } catch { /* noop */ }
      }
    }
  }

  // keys: arrows/WASD drive, Space item/pit, `~` admin
  useEffect(() => {
    const racing = screen === 'countdown' || screen === 'racing'
    const down = e => {
      if (e.code === 'Backquote') {
        e.preventDefault()
        setAdminOpen(o => !o)
        return
      }
      if (e.target.matches('input, textarea, select')) return
      if (!racing) return
      const k = keysRef.current
      let handled = true
      if (e.code === 'ArrowUp' || e.code === 'KeyW') k.up = true
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') k.down = true
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') k.left = true
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') k.right = true
      else if (e.code === 'Space') { if (!e.repeat) pressSpace() }
      else handled = false
      if (handled) {
        e.preventDefault()
        audioRef.current.ensure()
        sendDrive()
      }
    }
    const up = e => {
      const k = keysRef.current
      if (e.code === 'ArrowUp' || e.code === 'KeyW') k.up = false
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') k.down = false
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') k.left = false
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') k.right = false
      else return
      e.preventDefault()
      sendDrive()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, mode, snapshot, privateState])

  // solo 20Hz loop
  useEffect(() => {
    if (mode !== 'local' || !localRef.current) return undefined
    const id = setInterval(() => {
      const r = localRef.current
      if (!r) return
      r.tick(Date.now(), 50)
      const v = r.snapshot()
      setScreen(v.phase === 'finished' ? 'finished' : v.phase === 'racing' ? 'racing' : v.phase)
      setLocalVersion(x => x + 1)
    }, 50)
    return () => clearInterval(id)
  }, [mode])

  async function doCreate() {
    setBusy(true); setError('')
    try {
      audioRef.current.ensure()
      localStorage.setItem('gridlock-name', name)
      const roomCode = normalizeRoomCode(code) || randomRoomCode()
      await transport.create({ roomCode, playerName: name.trim() || 'Racer', privacy: 'public' })
      setMode('net')
      setScreen('lobby')
    } catch (err) { setError(err?.message || 'Create failed') }
    finally { setBusy(false) }
  }

  async function doJoin() {
    setBusy(true); setError('')
    try {
      audioRef.current.ensure()
      localStorage.setItem('gridlock-name', name)
      await transport.join({ roomCode: normalizeRoomCode(code), playerName: name.trim() || 'Racer' })
      setMode('net')
      setScreen('lobby')
    } catch (err) { setError(err?.message || 'Join failed — check code') }
    finally { setBusy(false) }
  }

  function startSolo() {
    audioRef.current.ensure()
    localStorage.setItem('gridlock-name', name)
    localTuneRef.current = cloneTune()
    localRef.current = new LocalRace({ playerName: name.trim() || 'Racer', tune: localTuneRef.current })
    localRef.current.start()
    keysRef.current = { up: false, down: false, left: false, right: false }
    lastInputSent.current = ''
    setMode('local')
    setError('')
    setScreen('countdown')
  }

  function soloRematch() {
    const t = localTuneRef.current ?? cloneTune()
    const custom = localRef.current?.customTrack ?? null
    localRef.current = new LocalRace({ playerName: name.trim() || 'Racer', tune: t, trackData: custom })
    localRef.current.start()
    setScreen('countdown')
  }

  function testDrive(trackData) {
    audioRef.current.ensure()
    localStorage.setItem('gridlock-name', name)
    const t = localTuneRef.current ?? cloneTune()
    localTuneRef.current = t
    localRef.current = new LocalRace({ playerName: name.trim() || 'Racer', tune: t, trackData })
    localRef.current.customTrack = trackData
    localRef.current.start()
    keysRef.current = { up: false, down: false, left: false, right: false }
    lastInputSent.current = ''
    setMode('local')
    setError('')
    setScreen('countdown')
  }

  async function doLeave() {
    if (mode === 'local') {
      localRef.current = null
      setMode('net')
    } else {
      try { await transport.leave() } catch { /* noop */ }
    }
    keysRef.current = { up: false, down: false, left: false, right: false }
    setSnapshot(null); setPrivateState(null); setScreen('menu')
  }

  function onPatch(patch) {
    if (mode === 'local') {
      if (localTuneRef.current) {
        applyPatch(localTuneRef.current, patch)
        setLocalVersion(x => x + 1)
      }
    } else {
      try { transport.tune(patch) } catch { /* noop */ }
    }
  }

  const chips = [...(view?.cars ?? [])].sort((a, b) => (a.place || 99) - (b.place || 99))

  return (
    <div className="grid-shell">
      <TopStrip
        view={view} chips={chips} mySeat={mySeat} muted={muted}
        onMute={() => { const m = !muted; setMuted(m); audioRef.current.ensure(); audioRef.current.setMuted(m) }}
        onLeave={doLeave} onAdmin={() => setAdminOpen(o => !o)} inRoom={screen !== 'menu'}
      />
      <div className="grid-layout">
        {error && <div className="grid-card grid-err">⚠ {error}</div>}
        {screen === 'menu' && (
          <div className="menu-grid">
            <div className="grid-card">
              <h2>GRIDLOCK</h2>
              <p className="dim">Top-down traffic racer. Whole track, all rivals, always visible.</p>
              <div className="nitro-row">
                <input className="g-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={16} style={{ width: 150 }} />
                <input className="g-input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6} style={{ width: 150 }} />
              </div>
              <div className="nitro-row" style={{ marginTop: 8 }}>
                <button className="nitro-btn primary" disabled={busy} onClick={doJoin}>JOIN A RACE</button>
                <button className="nitro-btn" disabled={busy} onClick={doCreate}>HOST A RACE</button>
                <button className="nitro-btn go" onClick={startSolo}>SOLO TEST (VS CPU)</button>
                <button className="nitro-btn" onClick={() => setScreen('studio')}>🎨 TRACK STUDIO</button>
              </div>
              <p className="dim small">
                ↑ gas · ↓ brake · ← → steer · Space item / pit timing · <kbd>~</kbd> live tune panel.
                Tires wear — the pit crew runs out when you box. Endpoint: {getColyseusEndpoint()}
              </p>
            </div>
            <div className="grid-card">
              <h2>HOUSE RULES</h2>
              <ul className="rules">
                <li>🎁 Item boxes respawn — hold one item, odds favor the back</li>
                <li>🚐 Traffic vans cruise the line. Tag one, lose speed</li>
                <li>🔧 Bald tires (red dot) halve your top speed — box for fresh rubber</li>
                <li>⏱ 3 laps, bots fill the 12-car grid</li>
              </ul>
            </div>
          </div>
        )}

        {screen === 'lobby' && view && (
          <div className="grid-card">
            <h2>LOBBY — {view.roomCode}</h2>
            <ul className="nitro-players">
              {view.players.map(p => (
                <li key={p.id}>
                  <span>{p.name} {p.role === 'host' ? '★HOST' : ''} · 🏆{p.wins}</span>
                  <span className={p.ready ? 'nitro-ready' : 'nitro-notready'}>{p.ready ? 'READY' : 'NOT READY'}</span>
                </li>
              ))}
            </ul>
            <div className="nitro-row">
              <button className="nitro-btn" onClick={() => transport.setReady(!(view.players.find(p => p.id === privateState?.playerId)?.ready))}>
                {view.players.find(p => p.id === privateState?.playerId)?.ready ? 'UNREADY' : 'READY UP'}
              </button>
              {isHost() && <button className="nitro-btn go" onClick={() => transport.start()}>START RACE</button>}
              <button className="nitro-btn" onClick={() => setAdminOpen(true)}>🔧 TUNE (host)</button>
            </div>
          </div>
        )}

        {screen === 'studio' && (
          <TrackStudio onTestDrive={testDrive} onExit={() => setScreen('menu')} />
        )}

        {(screen === 'countdown' || screen === 'racing' || screen === 'finished') && view && (
          <>
            <RaceCanvas
              view={view} audio={audioRef.current} mySeat={mySeat}
              track={mode === 'local' && localRef.current ? localRef.current.race.track : undefined}
            />
            {screen === 'finished' && (
              <div className="grid-card" ref={resultRef}>
                <div className="winner-banner">🏁 {view.winnerName} WINS 🏁</div>
                <table className="standings">
                  <thead><tr><th>POS</th><th>RACER</th><th>BEST LAP</th><th>WINS</th></tr></thead>
                  <tbody>
                    {chips.map(c => {
                      const p = view.players.find(x => x.name === c.name)
                      return (
                        <tr key={c.seat}>
                          <td>P{c.place || '–'}</td>
                          <td>{c.seat === mySeat ? 'YOU · ' : ''}{c.name}{c.isNpc ? ' (CPU)' : ''}</td>
                          <td>{p?.bestLapMs ? `${(p.bestLapMs / 1000).toFixed(2)}s` : '–'}</td>
                          <td>🏆{p?.wins ?? 0}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="nitro-row" style={{ marginTop: 8 }}>
                  {mode === 'local' ? (
                    <button className="nitro-btn go" onClick={soloRematch}>REMATCH →</button>
                  ) : isHost() ? (
                    <button className="nitro-btn go" onClick={() => transport.nextRace()}>NEXT RACE →</button>
                  ) : <span className="dim">Waiting for host…</span>}
                </div>
              </div>
            )}
          </>
        )}

        {screen === 'closed' && (
          <div className="grid-card">
            <h2>ROOM CLOSED</h2>
            <p>{closedMsg}</p>
            <button className="nitro-btn" onClick={() => setScreen('menu')}>BACK TO MENU</button>
          </div>
        )}
      </div>
      <AdminPanel
        tune={tune} open={adminOpen} canEdit={canTune}
        onClose={() => setAdminOpen(false)} onPatch={onPatch} onReset={onPatch}
      />
    </div>
  )
}

function TopStrip({ view, chips, mySeat, muted, onMute, onLeave, onAdmin, inRoom }) {
  return (
    <div className="topstrip">
      <div className="logo">GRIDLOCK</div>
      <div className="chips-row">
        {(chips.length ? chips : [{ seat: -1, name: '—', place: 0 }]).slice(0, 12).map(c => (
          <div key={c.seat} className={`chip ${c.seat === mySeat ? 'me' : ''} ${c.seat === chips[0]?.seat && chips.length ? 'leader' : ''}`}>
            <span className="dot" style={{ background: SEAT_COLORS[(c.colorIndex ?? c.seat) % SEAT_COLORS.length] }} />
            <span className="chip-name">{c.seat === mySeat ? 'YOU' : (c.name || '').slice(0, 10)}</span>
            <span className="chip-lap">L{c.lap ?? '–'}/{view?.laps ?? 3}</span>
            <span className="chip-item">{c.item ? (ITEM_GLYPH[c.item] ?? '?') : ''}</span>
            <span className={`tire ${(c.wear ?? 0) >= 100 ? 'bald' : (c.wear ?? 0) >= 70 ? 'worn' : ''}`} title={`tires ${c.wear ?? 0}%`}>●</span>
            {c.pit !== 'none' && c.pit ? <span>🔧</span> : null}
          </div>
        ))}
      </div>
      <div className="nitro-row">
        {view && <span className="roompill">ROOM {view.roomCode}{view.raceNo > 1 ? ` · R${view.raceNo}` : ''}</span>}
        {inRoom && <button className="nitro-btn small" onClick={onAdmin} title="Live tune (~)">🔧</button>}
        <button className="nitro-btn small" onClick={onMute}>{muted ? '🔇' : '🔊'}</button>
        {inRoom && <button className="nitro-btn small" onClick={onLeave}>LEAVE</button>}
      </div>
    </div>
  )
}

function RaceCanvas({ view, audio, mySeat, track }) {
  const canvasRef = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const trackRef = useRef(track)
  trackRef.current = track
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let raf = 0
    const loop = () => {
      renderRace(ctx, canvas.width, canvas.height, viewRef.current, performance.now(), trackRef.current)
      const local = viewRef.current?.cars.find(c => c.seat === (viewRef.current?.localSeat ?? mySeat))
      if (local) {
        audio.engine(local.speed, viewRef.current.phase === 'racing')
        if (local.boosting && !loop._b) audio.boost()
        loop._b = local.boosting
        if (local.spinning && !loop._s) audio.spin()
        loop._s = local.spinning
        if (local.item && !loop._i) audio.pickup()
        loop._i = local.item
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio])
  return (
    <div className="road-wrap scanlines">
      <canvas ref={canvasRef} width={1280} height={720} />
      <div className="race-feed">
        {(view?.events ?? []).slice(-3).map((e, i) => <span key={i} className={e.kind}>{e.text}</span>)}
      </div>
    </div>
  )
}
