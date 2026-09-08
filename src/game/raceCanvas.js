import { WORLD_H, WORLD_W, buildDecor, buildTrack } from './track.js'
import { SEAT_COLORS } from '../../server/sim.js'

const TRACK = buildTrack()
const DECOR = buildDecor(TRACK, 7)
const decorCache = new WeakMap()
export function decorFor(track) {
  if (!track || track === TRACK) return DECOR
  if (!decorCache.has(track)) decorCache.set(track, buildDecor(track, 99))
  return decorCache.get(track)
}

const ITEM_GLYPH = { boost: '🚀', oil: '🛢', crate: '📦', shield: '🛡', zap: '⚡' }
export const ITEM_LABEL = { boost: 'BOOST', oil: 'OIL', crate: 'CRATE', shield: 'SHIELD', zap: 'ZAP' }

export function renderRace(ctx, W, H, view, nowMs, track = TRACK) {
  const s = Math.min(W / WORLD_W, H / WORLD_H)
  const ox = (W - WORLD_W * s) / 2
  const oy = (H - WORLD_H * s) / 2
  ctx.save()
  ctx.fillStyle = '#0b0714'
  ctx.fillRect(0, 0, W, H)
  ctx.translate(ox, oy)
  ctx.scale(s, s)
  drawGround(ctx, decorFor(track))
  drawTrack(ctx, track)
  drawPit(ctx, track)
  drawBoxes(ctx, view, track, nowMs)
  drawHazards(ctx, view)
  // depth: ground traffic, bridge decks, then bridge traffic on top
  drawVans(ctx, view, nowMs, false)
  const cars = [...(view?.cars ?? [])].sort((a, b) => (b.finished ? 1 : 0) - (a.finished ? 1 : 0))
  for (const car of cars) if ((car.level ?? 0) <= 0) drawCar(ctx, view, car, nowMs)
  drawBridges(ctx, track)
  drawVans(ctx, view, nowMs, true)
  for (const car of cars) if ((car.level ?? 0) > 0) drawCar(ctx, view, car, nowMs)
  ctx.restore()
  renderOverlays(ctx, W, H, view, nowMs)
}

function drawGround(ctx, decor) {
  ctx.fillStyle = '#3da64b'
  ctx.fillRect(0, 0, WORLD_W, WORLD_H)
  // mowed stripes
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let y = 0; y < WORLD_H; y += 80) ctx.fillRect(0, y, WORLD_W, 40)
  if (!decor) return
  for (const f of decor.fields) {
    ctx.fillStyle = '#c9a13b'
    ctx.fillRect(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h)
    ctx.strokeStyle = '#8a6d1f'
    ctx.lineWidth = 3
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath()
      ctx.moveTo(f.x - f.w / 2, f.y - f.h / 2 + (f.h / 4) * i)
      ctx.lineTo(f.x + f.w / 2, f.y - f.h / 2 + (f.h / 4) * i)
      ctx.stroke()
    }
  }
  for (const h of decor.houses) {
    ctx.save()
    ctx.translate(h.x, h.y)
    ctx.rotate(h.rot)
    ctx.fillStyle = '#9aa0a6'
    ctx.fillRect(-h.w / 2, -h.h / 2, h.w, h.h)
    ctx.fillStyle = '#7a4a3a'
    ctx.fillRect(-h.w / 2, -h.h / 2, h.w, 12)
    ctx.restore()
  }
  for (const t of decor.trees) {
    ctx.fillStyle = '#1e6b2e'
    ctx.beginPath()
    ctx.arc(t.x, t.y, t.s, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#2fae4e'
    ctx.beginPath()
    ctx.arc(t.x - t.s * 0.25, t.y - t.s * 0.25, t.s * 0.55, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawTrack(ctx, track) {
  const pts = track.points
  const hw = track.halfWidth
  const w = hw * 2
  // white base, red dashed curb, asphalt, center dashes
  trackPath(ctx, pts)
  ctx.lineWidth = w + 18
  ctx.strokeStyle = '#f5f5f5'
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  ctx.stroke()
  trackPath(ctx, pts)
  ctx.lineWidth = w + 10
  ctx.strokeStyle = '#d63a3a'
  ctx.setLineDash([26, 20])
  ctx.stroke()
  trackPath(ctx, pts)
  ctx.lineWidth = w
  ctx.strokeStyle = '#3a3a44'
  ctx.setLineDash([])
  ctx.stroke()
  trackPath(ctx, pts)
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(245,245,245,0.6)'
  ctx.setLineDash([24, 30])
  ctx.stroke()
  ctx.setLineDash([])
  // tunnel tubes: dark cutaway over the base ribbon + portal rings
  for (const run of levelRuns(track)) {
    if (run.level >= 0) continue
    runPath(ctx, track, run)
    ctx.lineWidth = w + 6
    ctx.strokeStyle = '#14141c'
    ctx.setLineDash([])
    ctx.stroke()
    for (const end of [run.from, (run.to + 1) % pts.length]) {
      const p = pts[end]
      ctx.strokeStyle = '#ffd23f'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(p[0], p[1], w / 2 + 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  // start/finish checker across the track at the start point
  ctx.save()
  ctx.translate(track.start.x, track.start.y)
  ctx.rotate(track.start.angle)
  for (let r = 0; r < 2; r += 1) {
    for (let i = 0; i < 10; i += 1) {
      ctx.fillStyle = (r + i) % 2 ? '#111' : '#fff'
      ctx.fillRect(r * 8 - 8, -hw + i * ((hw * 2) / 10), 8, (hw * 2) / 10)
    }
  }
  ctx.restore()
}

// Consecutive segment runs sharing a level (for decks and tubes).
export function levelRuns(track) {
  const n = track.points.length
  const runs = []
  let start = 0
  let lvl = track.levels?.[0] ?? 0
  for (let i = 1; i <= n; i += 1) {
    const l = track.levels?.[i % n] ?? 0
    if (l !== lvl || i === n) {
      runs.push({ level: lvl, from: start, to: i - 1 })
      start = i
      lvl = l
    }
  }
  return runs
}

export function runPath(ctx, track, run) {
  const pts = track.points
  const n = pts.length
  ctx.beginPath()
  ctx.moveTo(pts[run.from][0], pts[run.from][1])
  for (let i = run.from + 1; i <= run.to + 1; i += 1) {
    const p = pts[i % n]
    ctx.lineTo(p[0], p[1])
  }
}

// Bridge decks render after ground traffic so cars underneath stay hidden.
export function drawBridges(ctx, track) {
  const w = track.halfWidth * 2
  for (const run of levelRuns(track)) {
    if (run.level <= 0) continue
    const pts = track.points
    // shadow
    ctx.save()
    ctx.translate(10, 14)
    runPath(ctx, track, run)
    ctx.lineWidth = w + 18
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    ctx.stroke()
    ctx.restore()
    // deck + rails
    runPath(ctx, track, run)
    ctx.lineWidth = w + 10
    ctx.strokeStyle = '#4a4a56'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    ctx.stroke()
    runPath(ctx, track, run)
    ctx.lineWidth = w
    ctx.strokeStyle = '#3a3a44'
    ctx.stroke()
    runPath(ctx, track, run)
    ctx.lineWidth = 3
    ctx.strokeStyle = '#ffd23f'
    ctx.setLineDash([18, 22])
    ctx.stroke()
    ctx.setLineDash([])
    // support pillars every ~140px
    ctx.fillStyle = '#2a2a34'
    let acc = 0
    for (let i = run.from; i <= run.to; i += 1) {
      const a = pts[i % pts.length]
      const b = pts[(i + 1) % pts.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      acc += len
      if (acc >= 140) {
        acc = 0
        ctx.fillRect(a[0] - 7, a[1] - 2, 14, 22)
      }
    }
  }
}

export function trackPath(ctx, points) {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
}

function drawPit(ctx, track) {
  // Oriented lane along the track. Two rows of generous slots — anyone
  // stopped anywhere in the lane gets serviced, no assigned boxes.
  const pit = track.pit
  ctx.save()
  ctx.translate(pit.cx, pit.cy)
  ctx.rotate(pit.angle)
  const L = pit.length, Wd = pit.width
  ctx.fillStyle = '#55555f'
  ctx.fillRect(-L / 2, -Wd / 2, L, Wd)
  ctx.strokeStyle = '#ffd23f'
  ctx.lineWidth = 3
  ctx.strokeRect(-L / 2, -Wd / 2, L, Wd)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  for (let row = 0; row < 2; row += 1) {
    const y = -Wd / 4 + row * (Wd / 2)
    for (let i = 0; i < 6; i += 1) {
      const x = -L / 2 + 50 + (i * (L - 100)) / 5
      ctx.strokeRect(x - 27, y - 36, 54, 72)
    }
  }
  ctx.fillStyle = '#9be9ff'
  ctx.font = 'bold 18px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('PIT — STOP ANYWHERE', 0, -Wd / 2 + 24)
  ctx.restore()
}

function drawBoxes(ctx, view, track, nowMs) {
  for (const b of view?.boxes ?? []) {
    const pos = track.boxes[b.idx]
    if (!pos) continue
    ctx.save()
    ctx.translate(pos.x, pos.y)
    if (!b.available) {
      ctx.globalAlpha = 0.25
    } else if (Math.floor(nowMs / 400) % 2 === 0) {
      ctx.shadowColor = '#33ccff'
      ctx.shadowBlur = 12
    }
    ctx.fillStyle = b.available ? '#123' : '#222'
    ctx.strokeStyle = '#33ccff'
    ctx.lineWidth = 3
    const s = 26
    ctx.beginPath()
    ctx.roundRect(-s / 2, -s / 2, s, s, 6)
    ctx.fill()
    ctx.stroke()
    if (b.available) {
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 17px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('?', 0, 6)
    }
    ctx.restore()
  }
}

function drawHazards(ctx, view) {
  for (const hz of view?.hazards ?? []) {
    ctx.save()
    ctx.translate(hz.x, hz.y)
    if (hz.kind === 'oil') {
      ctx.fillStyle = 'rgba(10,10,14,0.9)'
      ctx.beginPath()
      ctx.ellipse(0, 0, 15, 10, 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(80,60,180,0.5)'
      ctx.beginPath()
      ctx.ellipse(-3, -2, 6, 4, 0.4, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = '#8a5a2b'
      ctx.strokeStyle = '#4a2f14'
      ctx.lineWidth = 2
      ctx.fillRect(-10, -10, 20, 20)
      ctx.strokeRect(-10, -10, 20, 20)
      ctx.fillStyle = '#ffd23f'
      ctx.font = 'bold 12px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('!', 0, 4)
    }
    ctx.restore()
  }
}

function drawVans(ctx, view, nowMs, onlyBridge) {
  for (const van of view?.vans ?? []) {
    if (((van.level ?? 0) > 0) !== onlyBridge) continue
    ctx.save()
    ctx.translate(van.x, van.y)
    ctx.rotate(van.angle + (van.wobbling ? Math.sin(nowMs / 60) * 0.08 : 0))
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(-22, -12, 44, 28)
    ctx.fillStyle = '#d8d8de'
    ctx.fillRect(-24, -14, 48, 28)
    ctx.fillStyle = '#334'
    ctx.fillRect(6, -11, 14, 22)
    ctx.fillStyle = '#ffd23f'
    ctx.font = 'bold 11px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('🚐', 0, 4)
    ctx.restore()
  }
}

function drawCar(ctx, view, car, nowMs) {
  const isLocal = car.seat === view?.localSeat
  const color = SEAT_COLORS[(car.colorIndex ?? car.seat) % SEAT_COLORS.length]
  ctx.save()
  ctx.translate(car.x, car.y)
  // name + place
  ctx.font = `${isLocal ? 'bold 17px' : '14px'} monospace`
  ctx.textAlign = 'center'
  ctx.fillStyle = isLocal ? '#fff' : 'rgba(255,255,255,0.9)'
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'
  ctx.lineWidth = 3
  const label = isLocal ? `YOU·P${car.place}` : `${(car.name || '').slice(0, 10)}·P${car.place}`
  const labelText = car.finished ? `🏁 ${label}` : label
  ctx.strokeText(labelText, 0, -28)
  ctx.fillText(labelText, 0, -28)
  // held item chip
  if (car.item) {
    ctx.font = '15px monospace'
    ctx.strokeText(ITEM_GLYPH[car.item] ?? '?', 24, -26)
    ctx.fillText(ITEM_GLYPH[car.item] ?? '?', 24, -26)
  }
  ctx.rotate(car.angle + (car.spinning ? Math.sin(nowMs / 90) * 0.9 : 0))
  // shadow + body (slightly larger than the physics radius reads clearly)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(-15, -9, 31, 21)
  ctx.fillStyle = color
  ctx.strokeStyle = isLocal ? '#fff' : 'rgba(0,0,0,0.6)'
  ctx.lineWidth = isLocal ? 3 : 2
  ctx.beginPath()
  ctx.roundRect(-15, -10, 31, 20, 5)
  ctx.fill()
  ctx.stroke()
  // windshield + stripe
  ctx.fillStyle = 'rgba(10,14,24,0.9)'
  ctx.fillRect(2, -7, 8, 14)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(-10, -2, 7, 4)
  // boost flames
  if (car.boosting) {
    ctx.fillStyle = Math.floor(nowMs / 60) % 2 ? '#33ccff' : '#ff9f1c'
    ctx.beginPath()
    ctx.moveTo(-15, -7); ctx.lineTo(-28 - Math.random() * 8, 0); ctx.lineTo(-15, 7)
    ctx.closePath(); ctx.fill()
  }
  // shield ring
  if (car.shielded) {
    ctx.strokeStyle = 'rgba(51,204,255,0.9)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(0, 0, 22, 0, Math.PI * 2)
    ctx.stroke()
  }
  // zap flash
  if (car.zapped) {
    ctx.strokeStyle = '#ffee33'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 25 + Math.sin(nowMs / 70) * 3, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  // nitro-style pit timing bar above a car being serviced
  if ((car.pit === 'crew' || car.pit === 'working') && isLocal) {
    drawPitBar(ctx, car, nowMs)
  }
}

function drawPitBar(ctx, car, nowMs) {
  void nowMs
  const w = 130, h = 14
  const x = car.x - w / 2, y = car.y - 64
  ctx.save()
  ctx.fillStyle = 'rgba(5,5,12,0.85)'
  ctx.fillRect(x - 2, y - 2, w + 4, h + 22)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 22)
  // zones (match server perfectHalf/okHalf defaults; live values arrive via tune)
  const zone = car.pitZone ?? { perfectHalf: 0.06, okHalf: 0.18 }
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = 'rgba(34,255,102,0.5)'
  const pw = w * zone.perfectHalf * 2
  ctx.fillRect(x + w / 2 - pw / 2, y, pw, h)
  // needle (server-synced)
  const nx = x + w * (car.needle ?? 0.5)
  ctx.fillStyle = '#ffd23f'
  ctx.fillRect(nx - 2, y - 3, 4, h + 6)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 11px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(car.pit === 'crew' ? 'SPACE IN THE GREEN!' : 'CREW WORKING…', car.x, y + h + 15)
  ctx.restore()
}

function renderOverlays(ctx, W, H, view, nowMs) {
  if (view?.phase === 'countdown' && view?.countdownEndsAt) {
    const remain = view.countdownEndsAt - Date.now()
    const label = remain > 2700 ? '3' : remain > 1800 ? '2' : remain > 900 ? '1' : 'GO!'
    void nowMs
    ctx.save()
    ctx.textAlign = 'center'
    ctx.font = `900 ${Math.round(Math.min(W, H) * 0.12)}px monospace`
    ctx.fillStyle = label === 'GO!' ? '#22ff66' : '#ffd23f'
    ctx.fillText(label, W / 2, H / 2)
    ctx.restore()
    return
  }
  if (view?.phase === 'finished' && view?.winnerName) {
    const cars = [...(view.cars ?? [])].sort((a, b) => (a.place || 99) - (b.place || 99))
    ctx.save()
    ctx.fillStyle = 'rgba(5,5,20,0.66)'
    ctx.fillRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#9be9ff'
    ctx.font = `900 ${Math.round(W * 0.028)}px monospace`
    ctx.fillText('— RACE RESULT —', W / 2, H * 0.3)
    ctx.fillStyle = '#ffd23f'
    ctx.font = `900 ${Math.round(W * 0.055)}px monospace`
    ctx.fillText(`🏁 ${(view.winnerName || '').slice(0, 18)} WINS!`, W / 2, H * 0.44)
    ctx.font = `${Math.round(W * 0.02)}px monospace`
    cars.slice(0, 4).forEach((c, i) => {
      ctx.fillStyle = c.seat === view.localSeat ? '#fff' : '#cfe9ff'
      const medal = ['🥇', '🥈', '🥉', '4.'][i]
      ctx.fillText(`${medal} ${(c.name || '').slice(0, 14)}`, W / 2, H * 0.52 + i * H * 0.055)
    })
    ctx.restore()
  }
}
