export type GameSfx =
  | 'mine-start'
  | 'mine-complete'
  | 'forage'
  | 'plant'
  | 'water'
  | 'coin'
  | 'buy'
  | 'teleport'
  | 'unlock'
  | 'ready'
  | 'error'
  | 'footstep-grass'
  | 'footstep-stone'

let audioContext: AudioContext | null = null
let variation = 0

const authoredSounds: Partial<Record<GameSfx, string[]>> = {
  'mine-start': Array.from({ length: 5 }, (_, index) => `/assets/audio/sfx/impactMining_00${index}.ogg`),
  'mine-complete': ['/assets/audio/sfx/impactMining_002.ogg', '/assets/audio/sfx/impactMining_003.ogg', '/assets/audio/sfx/impactMining_004.ogg'],
  forage: ['/assets/audio/sfx/handleSmallLeather.ogg', '/assets/audio/sfx/handleSmallLeather2.ogg'],
  plant: ['/assets/audio/sfx/impactSoft_medium_002.ogg'],
  coin: ['/assets/audio/sfx/handleCoins.ogg'],
  buy: ['/assets/audio/sfx/handleCoins2.ogg'],
  unlock: ['/assets/audio/sfx/bookOpen.ogg'],
  error: ['/assets/audio/sfx/click5.ogg'],
  'footstep-grass': Array.from({ length: 5 }, (_, index) => `/assets/audio/sfx/footstep_grass_00${index}.ogg`),
  'footstep-stone': Array.from({ length: 5 }, (_, index) => `/assets/audio/sfx/footstep_concrete_00${index}.ogg`),
}

function context() {
  if (typeof window === 'undefined' || !window.AudioContext) return null
  audioContext ??= new window.AudioContext()
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

function tone(ctx: AudioContext, at: number, from: number, to: number, duration: number, volume: number, wave: OscillatorType = 'sine') {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = wave
  oscillator.frequency.setValueAtTime(from, at)
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + duration + 0.02)
}

export function playGameSfx(kind: GameSfx, volume = 0.5) {
  if (volume <= 0) return
  const authored = authoredSounds[kind]
  if (authored?.length && typeof Audio !== 'undefined') {
    const sound = new Audio(authored[variation++ % authored.length])
    sound.volume = Math.min(1, Math.max(0, volume)) * (kind.startsWith('footstep') ? 0.28 : 0.46)
    sound.playbackRate = 0.96 + (variation % 5) * 0.018
    void sound.play().catch(() => playSynth(kind, volume))
    return
  }
  playSynth(kind, volume)
}

function playSynth(kind: GameSfx, volume: number) {
  const ctx = context()
  if (!ctx) return
  const now = ctx.currentTime
  const level = Math.min(1, Math.max(0, volume)) * 0.13

  if (kind === 'mine-start' || kind === 'footstep-stone') {
    tone(ctx, now, 145, 92, 0.09, level * 0.72, 'square')
    tone(ctx, now + 0.025, 260, 155, 0.06, level * 0.32, 'triangle')
  } else if (kind === 'mine-complete') {
    tone(ctx, now, 118, 72, 0.15, level * 0.8, 'triangle')
    tone(ctx, now + 0.045, 310, 220, 0.12, level * 0.42, 'sine')
  } else if (kind === 'forage' || kind === 'footstep-grass') {
    tone(ctx, now, 390, 650, 0.12, level * 0.68, 'sine')
    tone(ctx, now + 0.055, 610, 830, 0.1, level * 0.38, 'triangle')
  } else if (kind === 'plant') {
    tone(ctx, now, 210, 126, 0.12, level * 0.55, 'triangle')
  } else if (kind === 'water') {
    tone(ctx, now, 730, 390, 0.13, level * 0.42, 'sine')
    tone(ctx, now + 0.07, 610, 350, 0.12, level * 0.3, 'sine')
  } else if (kind === 'coin' || kind === 'buy') {
    const direction = kind === 'coin' ? 1 : -1
    tone(ctx, now, direction > 0 ? 610 : 470, direction > 0 ? 880 : 350, 0.1, level * 0.55, 'sine')
    tone(ctx, now + 0.065, direction > 0 ? 820 : 390, direction > 0 ? 1120 : 290, 0.12, level * 0.4, 'triangle')
  } else if (kind === 'teleport') {
    tone(ctx, now, 230, 760, 0.26, level * 0.48, 'sine')
    tone(ctx, now + 0.04, 330, 980, 0.22, level * 0.28, 'triangle')
  } else if (kind === 'unlock') {
    ;[440, 610, 820].forEach((frequency, index) => tone(ctx, now + index * 0.075, frequency, frequency * 1.06, 0.18, level * (0.5 - index * 0.07), 'sine'))
  } else if (kind === 'ready') {
    tone(ctx, now, 570, 760, 0.18, level * 0.5, 'sine')
    tone(ctx, now + 0.1, 760, 980, 0.2, level * 0.38, 'sine')
  } else {
    tone(ctx, now, 150, 96, 0.14, level * 0.52, 'square')
  }
}
