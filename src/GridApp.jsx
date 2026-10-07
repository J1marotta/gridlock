import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ColyseusTransport, getColyseusEndpoint } from './multiplayer/colyseusTransport.js'
import { normalizeRoomCode, randomRoomCode } from './multiplayer/protocol.js'
import { SEAT_COLORS } from '../server/sim.js'
import { applyPatch, cloneTune, RACE_PRESETS } from './game/tune.js'
import { renderRace, ITEM_GLYPH, ITEM_LABEL } from './game/raceCanvas.js'
import { GridAudio } from './game/audio.js'
import { LocalRace } from './game/localRace.js'
import AdminPanel from './game/AdminPanel.jsx'
import TrackStudio, { STUDIO_SLOTS } from './game/TrackStudio.jsx'
import { DEFAULT_TRACK_ID, TRACKS, getTrackData, getTrackVoteOptions } from './game/tracks.js'
import { inPitZone, trackFromData } from './game/track.js'
import { decodeTrackCode } from './game/trackShare.js'

function useTransport() {
  const ref = useRef(null)
  if (!ref.current) ref.current = new ColyseusTransport()
  return ref.current
}

function adaptNetView(snapshot, privateState, tune) {
  if (!snapshot) return null
  const map = m => (m instanceof Map ? [...m.values()] : Object.values(m ?? {}))
  let presetVotes = {}
  let trackVotes = {}
  try { presetVotes = JSON.parse(snapshot.presetVotesJson || '{}') } catch { /* ignore malformed vote state */ }
  try { trackVotes = JSON.parse(snapshot.trackVotesJson || '{}') } catch { /* ignore malformed vote state */ }
  return {
    phase: snapshot.phase,
    roomCode: snapshot.roomCode,
    raceNo: snapshot.raceNo,
    laps: tune.race.laps,
    trackName: snapshot.trackName ?? 'Switchback Park',
    countdownEndsAt: snapshot.countdownEndsAt,
    winnerName: snapshot.winnerName,
    winnerSeat: snapshot.winnerSeat,
    activePreset: snapshot.activePreset || 'balanced',
    presetVotes,
    activeTrackId: snapshot.activeTrackId || DEFAULT_TRACK_ID,
    trackVotes,
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
  const [code, setCode] = useState(() => normalizeRoomCode(new URLSearchParams(window.location.search).get('room') || ''))
  const [shareOpen, setShareOpen] = useState(false)
  const [shareQr, setShareQr] = useState('')
  const [trackNotice, setTrackNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [closedMsg, setClosedMsg] = useState('')
  const [muted, setMuted] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [soloTrack, setSoloTrack] = useState(() => localStorage.getItem('gridlock-track') || 'silverstone')
  const [hostTrack, setHostTrack] = useState(DEFAULT_TRACK_ID)
  const localRef = useRef(null)
  const localTuneRef = useRef(null)
  const [localVersion, setLocalVersion] = useState(0)
  const [netTune, setNetTune] = useState(() => cloneTune())
  const keysRef = useRef({ up: false, down: false, left: false, right: false, hb: false })
  const [mobilePlay, setMobilePlay] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
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

  const netTrackJson = mode === 'net' ? snapshot?.trackJson : null
  const netTrack = useMemo(() => {
    if (!netTrackJson) return undefined
    try {
      const data = JSON.parse(netTrackJson)
      const v = trackFromData(data)
      return v.ok ? v.track : undefined
    } catch { return undefined }
  }, [netTrackJson])

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
    const media = window.matchMedia?.('(pointer: coarse)')
    if (!media) return undefined
    const update = () => setMobilePlay(media.matches)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (!mobilePlay || (screen !== 'countdown' && screen !== 'racing')) return
    keysRef.current.up = true
    sendDrive()
    return () => {
      keysRef.current.up = false
      keysRef.current.left = false
      keysRef.current.right = false
      keysRef.current.down = false
      sendDrive()
    }
  }, [mobilePlay, screen, mode])

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

  useEffect(() => {
    let active = true
    transport.resume().then(room => {
      if (active && room) setMode('net')
    })
    return () => { active = false }
  }, [transport])

  useEffect(() => {
    const sharedCode = new URLSearchParams(window.location.search).get('track')
    if (!sharedCode) return undefined
    let active = true
    decodeTrackCode(sharedCode).then(data => {
      const verified = trackFromData(data)
      if (!verified.ok) throw new Error(verified.error)
      localStorage.setItem(STUDIO_SLOTS[0], JSON.stringify(data))
      if (active) {
        setSoloTrack('slot:0')
        setHostTrack('slot:0')
        setTrackNotice(`Loaded “${data.name || 'Shared track'}” into Track Studio slot 1.`)
      }
    }).catch(err => {
      if (active) setError(`Could not load shared track: ${err?.message || 'Invalid track code'}`)
    }).finally(() => {
      if (!active) return
      const url = new URL(window.location.href)
      url.searchParams.delete('track')
      window.history.replaceState({}, '', url)
    })
    return () => { active = false }
  }, [])

  const inviteUrl = useMemo(() => {
    if (!view?.roomCode) return ''
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('room', view.roomCode)
    return url.toString()
  }, [view?.roomCode])

  useEffect(() => {
    if (!shareOpen || !inviteUrl) return
    let active = true
    QRCode.toDataURL(inviteUrl, { margin: 1, width: 220, color: { dark: '#101018', light: '#ffffff' } })
      .then(data => { if (active) setShareQr(data) })
      .catch(() => { if (active) setShareQr('') })
    return () => { active = false }
  }, [shareOpen, inviteUrl])

  useEffect(() => {
    if (snapshot?.phase === 'lobby' && snapshot.activeTrackId) setHostTrack(snapshot.activeTrackId)
  }, [snapshot?.phase, snapshot?.activeTrackId])

  function updateRoomLink(roomCode) {
    setCode(roomCode)
    const url = new URL(window.location.href)
    url.search = ''
    if (roomCode) url.searchParams.set('room', roomCode)
    window.history.replaceState({}, '', url)
  }

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
    const handbrake = Boolean(k.hb)
    const sig = `${steer},${throttle},${handbrake ? 1 : 0}`
    if (sig === lastInputSent.current) return
    lastInputSent.current = sig
    if (mode === 'local') localRef.current?.setInput(steer, throttle, handbrake)
    else try { transport.drive(steer, throttle, handbrake) } catch { /* noop */ }
  }

  function pressSpace() {
    audioRef.current.ensure()
    if (mode === 'local') {
      const car = localRef.current?.race.cars[0]
      if (car?.item) audioRef.current.pickup()
      localRef.current?.pressSpace()
    } else {
      if (localCar?.item) audioRef.current.pickup()
      try { transport.useItem() } catch { /* noop */ }
    }
  }

  const [pitDeny, setPitDeny] = useState('')
  const denyTimer = useRef(0)
  function denyPit(msg) {
    setPitDeny(msg)
    clearTimeout(denyTimer.current)
    denyTimer.current = setTimeout(() => setPitDeny(''), 1400)
  }

  function pressPit() {
    audioRef.current.ensure()
    if (mode === 'local') {
      const car = localRef.current?.race.cars[0]
      const r = localRef.current?.race
      if (!car || r?.phase !== 'racing') return
      if (car.pitState === 'working' || car.pitState === 'none') {
        if (car.pitState === 'none') {
          if (!inPitZone(r.track, car.x, car.y)) { denyPit('GET IN THE PIT LANE'); return }
          if (car.wear < 10) { denyPit('TYRES STILL FRESH'); return }
        }
        if (localRef.current?.pitPress()) audioRef.current.pit()
      }
    } else if (localCar && view?.phase === 'racing') {
      const okZone = localCar.pit !== 'none' || !netTrack || inPitZone(netTrack, localCar.x, localCar.y)
      const okWear = localCar.pit !== 'none' || (localCar.wear ?? 0) >= 10
      if (!okZone) { denyPit('GET IN THE PIT LANE'); return }
      if (!okWear) { denyPit('TYRES STILL FRESH'); return }
      try { transport.pitPress(); audioRef.current.pit() } catch { /* noop */ }
    }
  }

  function honkHorn() {
    audioRef.current.ensure()
    audioRef.current.horn()
    if (mode === 'local') localRef.current?.honkHorn()
    else try { transport.horn() } catch { /* noop */ }
  }

  function rematchKey() {
    if (screen !== 'finished') return
    if (mode === 'local') soloRematch()
    else if (isHost()) try { transport.nextRace() } catch { /* noop */ }
  }

  useEffect(() => {
    const racing = screen === 'countdown' || screen === 'racing'
    const down = e => {
      if (e.code === 'Backquote') {
        e.preventDefault()
        setAdminOpen(o => !o)
        return
      }
      if (e.target.matches('input, textarea, select')) return
      if (e.code === 'KeyH' && (racing || screen === 'finished')) {
        e.preventDefault()
        if (!e.repeat) honkHorn()
        return
      }
      if (e.code === 'KeyR' && screen === 'finished') {
        e.preventDefault()
        if (!e.repeat) rematchKey()
        return
      }
      if (!racing) return
      const k = keysRef.current
      let handled = true
      if (e.code === 'ArrowUp' || e.code === 'KeyW') k.up = true
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') k.down = true
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') k.left = true
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') k.right = true
      else if (e.code === 'Space') { if (!e.repeat) pressSpace() }
      else if (e.code === 'KeyZ') { pressPit() }
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { k.hb = true }
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
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') k.hb = false
      else return
      e.preventDefault()
      sendDrive()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, mode, snapshot, privateState])

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
      if (hostTrack.startsWith('slot:')) transport.setTrack(resolveTrackData(hostTrack))
      updateRoomLink(roomCode)
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
      const roomCode = normalizeRoomCode(code)
      await transport.join({ roomCode, playerName: name.trim() || 'Racer' })
      updateRoomLink(roomCode)
      setMode('net')
      setScreen('lobby')
    } catch (err) { setError(err?.message || 'Join failed — check code') }
    finally { setBusy(false) }
  }

  function studioSlots() {
    return STUDIO_SLOTS.map((key, i) => {
      try {
        const text = localStorage.getItem(key)
        if (!text) return null
        const data = JSON.parse(text)
        return data?.points ? { value: `slot:${i}`, label: `${data.name || 'Studio'} (slot ${i + 1})`, data } : null
      } catch { return null }
    })
  }

  function resolveTrackData(ref) {
    if (ref?.startsWith('slot:')) {
      const slot = studioSlots()[Number(ref.split(':')[1])]
      if (slot) return slot.data
    }
    return getTrackData(ref).data
  }

  function launchSolo(trackData, { freshTune = false } = {}) {
    audioRef.current.ensure()
    localStorage.setItem('gridlock-name', name)
    if (freshTune || !localTuneRef.current) localTuneRef.current = cloneTune()
    localRef.current = new LocalRace({ playerName: name.trim() || 'Racer', tune: localTuneRef.current, trackData })
    localRef.current.soloTrackData = trackData
    localRef.current.start()
    keysRef.current = { up: false, down: false, left: false, right: false, hb: false }
    lastInputSent.current = ''
    setMode('local')
    setError('')
    setScreen('countdown')
  }

  function startSolo() {
    const data = resolveTrackData(soloTrack)
    localStorage.setItem('gridlock-track', soloTrack)
    localTuneRef.current = cloneTune()
    launchSolo(data)
  }

  function soloRematch() {
    launchSolo(localRef.current?.soloTrackData ?? null)
  }

  function testDrive(trackData) {
    launchSolo(trackData)
  }

  async function doLeave() {
    if (mode === 'local') {
      localRef.current = null
      setMode('net')
    } else {
      try { await transport.leave() } catch { /* noop */ }
    }
    keysRef.current = { up: false, down: false, left: false, right: false, hb: false }
    setSnapshot(null); setPrivateState(null); setScreen('menu'); updateRoomLink('')
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
  const activeTrack = mode === 'local' && localRef.current ? localRef.current.race.track : netTrack

  return (
    <div className="grid-shell">
      <TopStrip
        view={view} muted={muted}
        onMute={() => { const m = !muted; setMuted(m); audioRef.current.ensure(); audioRef.current.setMuted(m) }}
        onLeave={doLeave} onAdmin={() => setAdminOpen(o => !o)} onShare={() => setShareOpen(true)} onHorn={honkHorn} inRoom={screen !== 'menu'}
      />
      <div className="grid-layout">
        {error && <div className="grid-card grid-err">⚠ {error}</div>}
        {screen === 'menu' && (
          <div className="menu-grid">
            <div className="grid-card">
              <h2>GRIDLOCK</h2>
              {trackNotice && <p className="grid-notice">🛣 {trackNotice}</p>}
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
              <div className="nitro-row" style={{ marginTop: 8 }}>
                <label className="dim small">SOLO TRACK
                  <TrackSelect
                    value={soloTrack} onChange={setSoloTrack} slots={studioSlots()}
                  />
                </label>
              </div>
              <p className="dim small">
                ↑ gas · ↓ brake · ← → steer · Space item · Z pit (mash!) · Shift handbrake · H horn · R rematch · <kbd>~</kbd> live tune panel.
                Tires wear — the pit crew runs out when you box. Endpoint: {getColyseusEndpoint()}
              </p>
            </div>
            <div className="grid-card">
              <h2>HOUSE RULES</h2>
              <ul className="rules">
                <li>🎁 Item boxes respawn — 🚀 boost, 🛢 oil, 🛡 shield. Odds favor the back</li>
                <li>🚐 Traffic vans cruise the line. Tag one, lose speed</li>
                <li>🔧 Bald tires (red dot) halve your top speed — box for fresh rubber</li>
                <li>⏱ 2 laps, bots fill the 12-car grid · H to honk</li>
              </ul>
            </div>
          </div>
        )}

        {screen === 'lobby' && view && (
          <div className="grid-card">
            <h2>LOBBY — {view.roomCode}</h2>
            <p className="dim">TRACK: <b>{view.trackName || 'Switchback Park'}</b></p>
            <p className="dim">NEXT RACE FEEL: <b>{RACE_PRESETS.find(p => p.id === view.activePreset)?.name ?? 'Grip Hero'}</b></p>
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
              {isHost() && (
                <button
                  className="nitro-btn go"
                  style={view.players.length > 0 && view.players.every(p => p.ready) ? { borderColor: '#22ff66', boxShadow: '0 0 12px #22ff66' } : undefined}
                  onClick={() => transport.start()}
                >{view.players.length > 0 && view.players.every(p => p.ready) ? 'START RACE ✓' : 'START RACE'}</button>
              )}
              <button className="nitro-btn" onClick={() => { try { navigator.clipboard?.writeText(view.roomCode) } catch { /* noop */ } }}>⧉ CODE</button>
              <button className="nitro-btn" onClick={() => setAdminOpen(true)}>🔧 TUNE (host)</button>
            </div>
            {mode === 'net' && isHost() && (
              <div className="nitro-row" style={{ marginTop: 8 }}>
                <label className="dim small">TRACK
                  <TrackSelect
                    value={hostTrack}
                    onChange={v => {
                      setHostTrack(v)
                      try { transport.setTrack(resolveTrackData(v)) } catch { /* noop */ }
                    }}
                    slots={studioSlots()}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {screen === 'studio' && (
          <TrackStudio onTestDrive={testDrive} onExit={() => setScreen('menu')} />
        )}

        {(screen === 'countdown' || screen === 'racing' || screen === 'finished') && view && (
          <>
            <div className="race-screen">
              <RaceCanvas
                view={view} audio={audioRef.current} mySeat={mySeat} mobilePlay={mobilePlay}
                track={activeTrack} pitDeny={pitDeny}
              />
              {mobilePlay && screen !== 'finished' && <TouchControls
                view={view}
                onSteer={(side, pressed) => { keysRef.current[side] = pressed; sendDrive() }}
                onAction={pressSpace}
                onPit={pressPit}
                onHb={pressed => { keysRef.current.hb = pressed; sendDrive() }}
                track={activeTrack}
              />}
            </div>
            {screen === 'finished' && (
              <div className="grid-card" ref={resultRef}>
                <div className="winner-banner">🏁 {view.winnerName} WINS 🏁</div>
                {mode === 'net' && <PresetVote
                  activePreset={view.activePreset}
                  votes={view.presetVotes}
                  playerId={privateState?.playerId}
                  onVote={presetId => { try { transport.votePreset(presetId) } catch { /* noop */ } }}
                />}
                {mode === 'net' && <TrackVote
                  currentTrackId={view.activeTrackId}
                  raceNo={view.raceNo}
                  votes={view.trackVotes}
                  playerId={privateState?.playerId}
                  onVote={trackId => { try { transport.voteTrack(trackId) } catch { /* noop */ } }}
                />}
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
                    <button className="nitro-btn go" onClick={soloRematch}>REMATCH (R) →</button>
                  ) : isHost() ? (
                    <button className="nitro-btn go" onClick={() => transport.nextRace()}>APPLY VOTES & NEXT RACE (R) →</button>
                  ) : <span className="dim">Waiting for host… (H to honk)</span>}
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
        onClose={() => setAdminOpen(false)} onPatch={onPatch}
      />
      {shareOpen && <div className="share-overlay" onClick={() => setShareOpen(false)}>
        <section className="share-card" role="dialog" aria-modal="true" aria-label="Share race invite" onClick={e => e.stopPropagation()}>
          <button className="share-close nitro-btn small" onClick={() => setShareOpen(false)}>CLOSE</button>
          <h2>INVITE RACERS</h2>
          <p className="dim">Scan the code or share the link. It opens with room {view?.roomCode} filled in.</p>
          {shareQr && <img src={shareQr} alt="QR code for this race invite" />}
          <input className="g-input share-url" readOnly value={inviteUrl} onFocus={e => e.target.select()} />
          <div className="nitro-row">
            <button className="nitro-btn primary" onClick={() => navigator.clipboard?.writeText(inviteUrl)}>COPY LINK</button>
            <button className="nitro-btn" onClick={() => navigator.share?.({ title: 'Join my Gridlock race', text: `Race code ${view?.roomCode}`, url: inviteUrl })}>SHARE…</button>
          </div>
        </section>
      </div>}
    </div>
  )
}

function TrackSelect({ value, onChange, slots }) {
  return (
    <select className="g-input" value={value} onChange={e => onChange(e.target.value)} style={{ marginLeft: 6 }}>
      {TRACKS.map(t => <option key={t.id} value={t.id}>{t.name} — {t.blurb}</option>)}
      {slots.map(s => s && <option key={s.value} value={s.value}>🎨 {s.label}</option>)}
    </select>
  )
}

function PresetVote({ activePreset, votes = {}, playerId, onVote }) {
  const currentVote = playerId ? votes[playerId] : ''
  const counts = Object.values(votes).reduce((all, id) => ({ ...all, [id]: (all[id] ?? 0) + 1 }), {})
  return <section className="preset-votes" aria-labelledby="preset-vote-title">
    <div className="preset-vote-head">
      <div>
        <h3 id="preset-vote-title">Vote the next race feel</h3>
        <p className="dim small">Current feel: {RACE_PRESETS.find(p => p.id === activePreset)?.name ?? 'Grip Hero'}. Host applies the vote when starting the next round.</p>
      </div>
      <span className="vote-total">{Object.keys(votes).length} vote{Object.keys(votes).length === 1 ? '' : 's'}</span>
    </div>
    <div className="preset-options" role="group" aria-label="Choose next round handling preset">
      {RACE_PRESETS.map(preset => <button
        key={preset.id}
        type="button"
        className={`preset-choice ${currentVote === preset.id ? 'selected' : ''}`}
        aria-pressed={currentVote === preset.id}
        onClick={() => onVote(preset.id)}
      >
        <span className="preset-name">{preset.icon} {preset.name}</span>
        <span className="preset-feel">{preset.feel}</span>
        <span className="preset-count" aria-label={`${counts[preset.id] ?? 0} votes`}>{counts[preset.id] ?? 0} votes</span>
      </button>)}
    </div>
  </section>
}

function TrackVote({ currentTrackId, raceNo, votes = {}, playerId, onVote }) {
  const choices = getTrackVoteOptions(currentTrackId, raceNo)
  const currentVote = playerId ? votes[playerId] : ''
  const counts = Object.values(votes).reduce((all, id) => ({ ...all, [id]: (all[id] ?? 0) + 1 }), {})
  return <section className="preset-votes track-votes" aria-labelledby="track-vote-title">
    <div className="preset-vote-head">
      <div>
        <h3 id="track-vote-title">Pick the next circuit</h3>
        <p className="dim small">Choose one of three tracks. The host applies the result with the handling vote; ties go to the first card.</p>
      </div>
      <span className="vote-total">{Object.keys(votes).length} vote{Object.keys(votes).length === 1 ? '' : 's'}</span>
    </div>
    <div className="preset-options" role="group" aria-label="Choose the next circuit">
      {choices.map(track => <button
        key={track.id}
        type="button"
        className={`preset-choice track-choice ${currentVote === track.id ? 'selected' : ''}`}
        aria-pressed={currentVote === track.id}
        onClick={() => onVote(track.id)}
      >
        <span className="preset-name">🏁 {track.name}</span>
        <span className="preset-feel">{track.blurb}</span>
        <span className="preset-count" aria-label={`${counts[track.id] ?? 0} votes`}>{counts[track.id] ?? 0} votes</span>
      </button>)}
    </div>
  </section>
}

function TopStrip({ view, muted, onMute, onLeave, onAdmin, onShare, onHorn, inRoom }) {
  return (
    <div className="topstrip">
      <div className="logo">GRIDLOCK</div>
      <div className="nitro-row">
        {view && <span className="roompill">ROOM {view.roomCode}{view.raceNo > 1 ? ` · R${view.raceNo}` : ''}</span>}
        {view && <button className="nitro-btn small" onClick={onShare} title="Share room invite">↗ INVITE</button>}
        {inRoom && <button className="nitro-btn small" onClick={onHorn} title="Honk (H)">📯</button>}
        {inRoom && <button className="nitro-btn small" onClick={onAdmin} title="Live tune (~)">🔧</button>}
        <button className="nitro-btn small" onClick={onMute}>{muted ? '🔇' : '🔊'}</button>
        {inRoom && <button className="nitro-btn small" onClick={onLeave}>LEAVE</button>}
      </div>
    </div>
  )
}

function RaceHud({ view, mySeat }) {
  const cars = [...(view?.cars ?? [])].sort((a, b) => (a.place || 99) - (b.place || 99))
  if (!cars.length) return null
  const lead = Math.max(...cars.map(c => c.progress ?? 0))
  const gapOf = c => {
    if (c.place === 1) return 'LEADER'
    const d = lead - (c.progress ?? 0)
    return d > 0 ? `+${(d / 340).toFixed(1)}` : ''
  }
  const me = cars.find(c => c.seat === mySeat)
  const wear = me ? Math.max(0, 100 - Math.round(me.wear ?? 0)) : 0
  const tyreState = !me || wear >= 30 ? 'fresh' : wear > 0 ? 'worn' : 'bald'
  const tyreText = !me ? '' : tyreState === 'fresh' ? 'FRESH RUBBER' : tyreState === 'worn' ? 'WORN — PIT SOON' : 'BALD — PIT NOW!'
  return (<>
    <div className="race-hud-tower" aria-label="Standings">
      {cars.map(c => (
        <div key={c.seat} className={`hud-row ${c.seat === mySeat ? 'me' : ''}`}>
          <span className="hud-pos">P{c.place || '–'}</span>
          <span className="dot" style={{ background: SEAT_COLORS[(c.colorIndex ?? c.seat) % SEAT_COLORS.length] }} />
          <span className="hud-name">{c.seat === mySeat ? 'YOU' : (c.name || '').slice(0, 10)}</span>
          <span className="hud-gap">{gapOf(c)}</span>
          <span className="hud-item" title={c.item ? ITEM_LABEL[c.item] : ''}>{c.item ? (ITEM_GLYPH[c.item] ?? '?') : ''}{c.shielding ? '🛡' : ''}</span>
          <span className={`tire ${(c.wear ?? 0) >= 100 ? 'bald' : (c.wear ?? 0) >= 70 ? 'worn' : ''}`} title="tire life">●</span>
          {c.pit !== 'none' && c.pit ? <span>🔧</span> : null}
        </div>
      ))}
    </div>
    <div className="hud-badge" aria-label="Your position">
      <span className="hud-big">P{me?.place ?? '–'}</span>
      <span className="hud-sub">LAP {me?.lap ?? '–'}/{view?.laps ?? 2}</span>
    </div>
    {me && (
      <div className="hud-player" aria-label="Your tyres">
        <div className="hud-player-head"><span>YOU · P{me.place}</span><span>{me.item ? (ITEM_GLYPH[me.item] ?? '?') : ''}{me.shielding ? '🛡' : ''}</span></div>
        <div className="hud-tyre-label"><span>TYRES</span><span>{wear}%</span></div>
        <div className="hud-tyre-bar"><div className={`hud-tyre-fill ${tyreState}`} style={{ width: `${wear}%` }} /></div>
        <div className={`hud-tyre-state ${tyreState}`}>{tyreText}</div>
        <div className="hud-player-foot"><span>SPD {Math.round(me.speed ?? 0)}</span><span>{me.pit !== 'none' && me.pit ? '🔧 PITTING' : ''}</span></div>
      </div>
    )}
  </>)
}

function RaceCanvas({ view, audio, mySeat, track, mobilePlay, pitDeny }) {
  const canvasRef = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const trackRef = useRef(track)
  trackRef.current = track
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let raf = 0
    let wasBoosting = false
    let wasSpinning = false
    let lastItem = ''
    const loop = () => {
      renderRace(ctx, canvas.width, canvas.height, viewRef.current, performance.now(), trackRef.current, mobilePlay ? mySeat : -1)
      const local = viewRef.current?.cars.find(c => c.seat === (viewRef.current?.localSeat ?? mySeat))
      if (local) {
        audio.engine(local.speed, viewRef.current.phase === 'racing')
        if (local.boosting && !wasBoosting) audio.boost()
        wasBoosting = local.boosting
        if (local.spinning && !wasSpinning) audio.spin()
        wasSpinning = local.spinning
        if (local.item && local.item !== lastItem) audio.pickup()
        lastItem = local.item
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, mobilePlay, mySeat])
  return (
    <div className="road-wrap scanlines">
      <canvas ref={canvasRef} width={1280} height={720} />
      {mobilePlay && <RaceMiniMap view={view} track={track} />}
      <RaceHud view={view} mySeat={mySeat} />
      {pitDeny && <div className="hud-deny">{pitDeny}</div>}
      <div className="race-feed">
        {(view?.events ?? []).slice(-3).map((e, i) => <span key={i} className={e.kind}>{e.text}</span>)}
      </div>
    </div>
  )
}

function TouchControls({ view, onSteer, onAction, onPit, onHb, track }) {
  const car = view?.cars.find(c => c.seat === view.localSeat)
  const canPit = Boolean(track && car && car.pit === 'none' && car.wear >= 10 && inPitZone(track, car.x, car.y))
  const mashing = car?.pit === 'working'
  const hold = (side, pressed) => e => {
    e.preventDefault()
    if (pressed) e.currentTarget.setPointerCapture?.(e.pointerId)
    onSteer(side, pressed)
  }
  const holdHb = pressed => e => {
    e.preventDefault()
    if (pressed) e.currentTarget.setPointerCapture?.(e.pointerId)
    onHb(pressed)
  }
  return <div className="touch-controls" aria-label="Driving controls">
    <button className="touch-steer" aria-label="Steer left" onPointerDown={hold('left', true)} onPointerUp={hold('left', false)} onPointerCancel={hold('left', false)} onLostPointerCapture={hold('left', false)}>◀</button>
    <div className="touch-hint">AUTO<br />GAS</div>
    <button className="touch-steer" aria-label="Steer right" onPointerDown={hold('right', true)} onPointerUp={hold('right', false)} onPointerCancel={hold('right', false)} onLostPointerCapture={hold('right', false)}>▶</button>
    <button className="touch-action" onClick={onAction} disabled={!car?.item}>{car?.item ? `USE ${ITEM_LABEL[car.item] ?? 'ITEM'}` : 'NO ITEM'}</button>
    <button className="touch-action" aria-label="Handbrake" onPointerDown={holdHb(true)} onPointerUp={holdHb(false)} onPointerCancel={holdHb(false)} onLostPointerCapture={holdHb(false)}>HB</button>
    <button className="touch-pit" onClick={onPit} disabled={!(canPit || mashing)} aria-label="Pit for fresh tyres">{mashing ? 'MASH!' : canPit ? 'PIT FOR TYRES' : 'PIT'}</button>
  </div>
}

function RaceMiniMap({ view, track }) {
  if (!track?.points?.length) return null
  const path = track.points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x / 10} ${y / 10}`).join(' ') + ' Z'
  return <svg className="race-minimap" viewBox="0 0 160 90" aria-label="Track positions">
    <path d={path} />
    {(view?.cars ?? []).map(c => <circle key={c.seat} cx={c.x / 10} cy={c.y / 10} r={c.seat === view.localSeat ? 2.8 : 1.8} className={c.seat === view.localSeat ? 'you' : ''} />)}
  </svg>
}
