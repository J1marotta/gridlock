import { WORLD_H, WORLD_W, buildDecor, closestOnTrack } from './track.js'
import { DEFAULT_TRACK_ID, getTrack } from './tracks.js'
import { SEAT_COLORS } from '../../server/sim.js'

const TRACK = getTrack(DEFAULT_TRACK_ID)
const DECOR = buildDecor(TRACK, 7)
const decorCache = new WeakMap()
export function decorFor(track) {
  if (!track || track === TRACK) return DECOR
  if (!decorCache.has(track)) decorCache.set(track, buildDecor(track, 99))
  return decorCache.get(track)
}

export const ITEM_GLYPH = { boost: '🚀', oil: '🛢' }
export const ITEM_LABEL = { boost: 'BOOST', oil: 'OIL SPILL' }

export function renderRace(ctx, W, H, view, nowMs, track = TRACK, followSeat = -1) {
  const focus = (view?.cars ?? []).find(c => c.seat === followSeat)
  const s = Math.min(W / WORLD_W, H / WORLD_H) * (focus ? 2.35 : 1)
  const ox = focus ? W / 2 - focus.x * s : (W - WORLD_W * s) / 2
  const oy = focus ? H / 2 - focus.y * s : (H - WORLD_H * s) / 2
  ctx.save()
  ctx.fillStyle = '#0b0714'
  ctx.fillRect(0, 0, W, H)
  ctx.translate(ox, oy)
  ctx.scale(s, s)
  drawGround(ctx, decorFor(track))
  drawTrack(ctx, track)
  drawPit(ctx, track, nowMs)
  drawBoxes(ctx, view, track, nowMs)
  drawHazards(ctx, view, nowMs)
  drawVans(ctx, view, nowMs, false)
  const cars = [...(view?.cars ?? [])].sort((a, b) => (b.finished ? 1 : 0) - (a.finished ? 1 : 0))
  const drawLevel = level => {
    const group = cars.filter(car => ((car.level ?? 0) > 0) === level)
    group.sort((a, b) => Number(a.seat === view?.localSeat) - Number(b.seat === view?.localSeat))
    for (const car of group) drawCar(ctx, view, track, car, nowMs)
  }
  drawLevel(false)
  drawBridges(ctx, track)
  drawVans(ctx, view, nowMs, true)
  drawLevel(true)
  ctx.restore()
  renderOverlays(ctx, W, H, view)
}

function drawGround(ctx, decor) {
  ctx.fillStyle = '#3da64b'
  ctx.fillRect(0, 0, WORLD_W, WORLD_H)
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

export function drawBridges(ctx, track) {
  const w = track.halfWidth * 2
  for (const run of levelRuns(track)) {
    if (run.level <= 0) continue
    const pts = track.points
    ctx.save()
    ctx.translate(10, 14)
    runPath(ctx, track, run)
    ctx.lineWidth = w + 18
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    ctx.stroke()
    ctx.restore()
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

function drawPit(ctx, track, nowMs) {
  const pit = track.pit
  const u = { x: Math.cos(pit.angle), y: Math.sin(pit.angle) }
  ctx.save()
  ctx.lineCap = 'round'
  for (const end of [-1, 1]) {
    const ex = pit.cx + u.x * pit.length / 2 * end
    const ey = pit.cy + u.y * pit.length / 2 * end
    const road = closestOnTrack(track, ex, ey)
    ctx.strokeStyle = '#55555f'
    ctx.lineWidth = Math.max(30, track.halfWidth * 1.18)
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(road.px, road.py); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.78)'
    ctx.lineWidth = 2
    ctx.setLineDash([12, 10])
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(road.px, road.py); ctx.stroke()
  }
  ctx.restore()
  ctx.save()
  ctx.translate(pit.cx, pit.cy)
  ctx.rotate(pit.angle)
  const L = pit.length, Wd = pit.width
  ctx.fillStyle = '#55555f'
  ctx.fillRect(-L / 2, -Wd / 2, L, Wd)
  ctx.strokeStyle = '#ffd23f'
  ctx.lineWidth = 4
  ctx.setLineDash([18, 12])
  ctx.lineDashOffset = -(nowMs / 40)
  ctx.strokeRect(-L / 2, -Wd / 2, L, Wd)
  ctx.setLineDash([])
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
  ctx.font = 'bold 22px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('PIT LANE — STOP & SERVICE', 0, -Wd / 2 + 28)
  const slide = (nowMs / 300) % 1
  ctx.fillStyle = '#22ff66'
  for (let i = 0; i < 3; i += 1) {
    const t = (slide + i / 3) % 1
    const x = -L / 2 - 90 + t * 80
    const s = 10 + t * 8
    ctx.beginPath()
    ctx.moveTo(x - s, -s * 0.7); ctx.lineTo(x + s * 0.4, 0); ctx.lineTo(x - s, s * 0.7)
    ctx.lineTo(x - s * 0.2, 0)
    ctx.closePath(); ctx.fill()
  }
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

function drawHazards(ctx, view, nowMs) {
  for (const hz of view?.hazards ?? []) {
    ctx.save()
    ctx.translate(hz.x, hz.y)
    if (hz.kind === 'oil') {
      const pulse = 0.75 + 0.25 * Math.sin(nowMs / 240)
      ctx.globalAlpha = pulse
      ctx.fillStyle = '#0a0a10'
      ctx.beginPath()
      ctx.ellipse(0, 0, 22, 14, 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#7a5cff'
      ctx.lineWidth = 2.5
      ctx.stroke()
      const sx = -14 + ((nowMs / 28) % 28)
      ctx.fillStyle = 'rgba(150,130,255,0.55)'
      ctx.beginPath()
      ctx.ellipse(sx, -3, 7, 4, 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = '#ffd23f'
      ctx.font = 'bold 15px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('!', 0, -20)
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

function drawCar(ctx, view, track, car, nowMs) {
  const isLocal = car.seat === view?.localSeat
  const color = SEAT_COLORS[(car.colorIndex ?? car.seat) % SEAT_COLORS.length]
  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.font = `${isLocal ? 'bold 17px' : '14px'} monospace`
  ctx.textAlign = 'center'
  ctx.fillStyle = isLocal ? '#fff' : 'rgba(255,255,255,0.9)'
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'
  ctx.lineWidth = 3
  const label = isLocal ? `YOU·P${car.place}` : `${(car.name || '').slice(0, 10)}·P${car.place}`
  const labelText = car.finished ? `🏁 ${label}` : label
  ctx.strokeText(labelText, 0, -28)
  ctx.fillText(labelText, 0, -28)
  if (car.item) {
    ctx.font = '15px monospace'
    ctx.strokeText(ITEM_GLYPH[car.item] ?? '?', 24, -26)
    ctx.fillText(ITEM_GLYPH[car.item] ?? '?', 24, -26)
  }
  ctx.rotate(car.angle + (car.spinning ? Math.sin(nowMs / 90) * 0.9 : 0))
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(-15, -9, 31, 21)
  ctx.fillStyle = '#1a1a22'
  ctx.fillRect(-19, -11, 5, 22)
  ctx.globalAlpha = isLocal ? 1 : 0.72
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(-15, -10, 31, 20, 5)
  ctx.fill()
  ctx.globalAlpha = 1
  if (!isLocal) {
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.lineWidth = 4
    ctx.stroke()
  }
  ctx.strokeStyle = isLocal ? '#fff' : '#101018'
  ctx.lineWidth = isLocal ? 4 : 2.5
  ctx.stroke()
  ctx.fillStyle = color
  ctx.globalAlpha = isLocal ? 1 : 0.72
  ctx.beginPath()
  ctx.moveTo(16, -7); ctx.lineTo(24, 0); ctx.lineTo(16, 7)
  ctx.closePath(); ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = 'rgba(10,14,24,0.9)'
  ctx.fillRect(0, -6, 8, 12)
  ctx.fillStyle = '#fff9c4'
  ctx.beginPath()
  ctx.arc(13, -6, 2.4, 0, Math.PI * 2)
  ctx.arc(13, 6, 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(-10, -2, 7, 4)
  if (car.boosting) {
    ctx.fillStyle = Math.floor(nowMs / 60) % 2 ? '#33ccff' : '#ff9f1c'
    ctx.beginPath()
    ctx.moveTo(-15, -8); ctx.lineTo(-32 - Math.random() * 10, 0); ctx.lineTo(-15, 8)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i += 1) {
      const ly = -14 + i * 14
      ctx.beginPath()
      ctx.moveTo(-20, ly); ctx.lineTo(-44, ly)
      ctx.stroke()
    }
  }
  ctx.restore()
  if (car.boosting && isLocal) {
    ctx.save()
    ctx.translate(car.x, car.y)
    ctx.fillStyle = '#22ff66'
    ctx.font = 'bold 16px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('🚀 BOOST!', 0, -48)
    ctx.restore()
  }
  if (isLocal && (car.wear ?? 0) >= 70 && track?.pit) {
    const pit = track.pit
    const ang = Math.atan2(pit.cy - car.y, pit.cx - car.x)
    const pulse = 0.6 + 0.4 * Math.sin(nowMs / 200)
    ctx.save()
    ctx.translate(car.x, car.y - 44)
    ctx.rotate(ang)
    ctx.globalAlpha = pulse
    ctx.fillStyle = (car.wear ?? 0) >= 100 ? '#ff3333' : '#ffd23f'
    ctx.beginPath()
    ctx.moveTo(34, 0); ctx.lineTo(14, -10); ctx.lineTo(14, -4); ctx.lineTo(0, -4)
    ctx.lineTo(0, 4); ctx.lineTo(14, 4); ctx.lineTo(14, 10)
    ctx.closePath(); ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = pulse
    ctx.fillStyle = (car.wear ?? 0) >= 100 ? '#ff3333' : '#ffd23f'
    ctx.font = 'bold 15px monospace'
    ctx.textAlign = 'center'
    ctx.fillText((car.wear ?? 0) >= 100 ? '🔧 PIT NOW!' : '🔧 TIRES — PIT SOON', car.x, car.y - 52)
    ctx.restore()
  }
  if ((car.pit === 'crew' || car.pit === 'working') && isLocal) {
    drawPitBar(ctx, car)
  }
}

function drawPitBar(ctx, car) {
  const w = 130, h = 14
  const x = car.x - w / 2, y = car.y - 64
  ctx.save()
  ctx.fillStyle = 'rgba(5,5,12,0.85)'
  ctx.fillRect(x - 2, y - 2, w + 4, h + 22)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 22)
  const zone = car.pitZone ?? { perfectHalf: 0.06, okHalf: 0.18 }
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = 'rgba(34,255,102,0.5)'
  const pw = w * zone.perfectHalf * 2
  ctx.fillRect(x + w / 2 - pw / 2, y, pw, h)
  const nx = x + w * (car.needle ?? 0.5)
  ctx.fillStyle = '#ffd23f'
  ctx.fillRect(nx - 2, y - 3, 4, h + 6)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 11px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(car.pit === 'crew' ? 'SPACE IN THE GREEN!' : 'CREW WORKING…', car.x, y + h + 15)
  ctx.restore()
}

function renderOverlays(ctx, W, H, view) {
  if (view?.phase === 'countdown' && view?.countdownEndsAt) {
    const remain = view.countdownEndsAt - Date.now()
    const label = remain > 2700 ? '3' : remain > 1800 ? '2' : remain > 900 ? '1' : 'GO!'
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
