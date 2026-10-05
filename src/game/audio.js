export class GridAudio {
  constructor() {
    this.ctx = null
    this.master = null
    this.engineOsc = null
    this.engineGain = null
    this.engineFilter = null
    this.muted = false
    this.volume = 0.4
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    this.master.connect(this.ctx.destination)
    this.engineOsc = this.ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 60
    this.engineFilter = this.ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 700
    this.engineGain = this.ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc.connect(this.engineFilter)
    this.engineFilter.connect(this.engineGain)
    this.engineGain.connect(this.master)
    this.engineOsc.start()
  }

  setMuted(m) {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02)
  }

  engine(speed, active) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.engineOsc.frequency.setTargetAtTime(50 + Math.min(400, speed) * 0.5, t, 0.05)
    this.engineGain.gain.setTargetAtTime(active ? 0.07 : 0, t, 0.08)
  }

  blip(freq = 440, dur = 0.09, type = 'square', vol = 0.1) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + dur + 0.02)
  }

  countdown(n) { this.blip(n <= 0 ? 880 : 440, n <= 0 ? 0.35 : 0.12) }
  horn() { this.blip(370, 0.14, 'square', 0.12); setTimeout(() => this.blip(466, 0.18, 'square', 0.12), 90) }
  pickup() { this.blip(740, 0.08); setTimeout(() => this.blip(1108, 0.1), 60) }
  boost() { this.blip(220, 0.3, 'sawtooth', 0.12) }
  spin() { this.blip(300, 0.3, 'sawtooth', 0.12); setTimeout(() => this.blip(180, 0.3, 'sawtooth', 0.1), 120) }
  pit() { this.blip(520, 0.1); setTimeout(() => this.blip(780, 0.14), 100) }
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'square', 0.1), i * 110))
  }
}
