export type MusicZone = 'hub' | 'forage' | 'farm' | 'mine'
export type MusicEvent = 'mining' | 'farm' | 'forage'

export type MusicTrack = {
  src: string
  gain: number
  measuredRmsDb: number
  measuredPeakDb: number
}

// Gains compensate the integrated loudness of the supplied recordings against
// Haggstrom, the quietest source. Dynamics remain intact; louder masters are
// attenuated instead of compressing the recordings into one flat waveform.
export const MUSIC_TRACKS = {
  hub: { src: '/assets/audio/music/Sicilienne.mp3', gain: 0.9, measuredRmsDb: -26.2, measuredPeakDb: -4.8 },
  forage: { src: '/assets/audio/music/Aerie.mp3', gain: 0.45, measuredRmsDb: -20, measuredPeakDb: -0.1 },
  farm: { src: '/assets/audio/music/Haggstrom.mp3', gain: 1, measuredRmsDb: -27.9, measuredPeakDb: -7 },
  mine: { src: '/assets/audio/music/Dead_Voxel.mp3', gain: 0.41, measuredRmsDb: -18.4, measuredPeakDb: -0.2 },
  miningRush: { src: '/assets/audio/music/Aria_Math.mp3', gain: 0.26, measuredRmsDb: -15.2, measuredPeakDb: 0 },
  kitchenRush: { src: '/assets/audio/music/Cat.mp3', gain: 0.36, measuredRmsDb: -16.8, measuredPeakDb: -1 },
  forageRace: { src: '/assets/audio/music/otherside.mp3', gain: 0.19, measuredRmsDb: -11.7, measuredPeakDb: 1.9 },
  results: { src: '/assets/audio/music/Alpha.mp3', gain: 0.25, measuredRmsDb: -16.1, measuredPeakDb: 0 },
} satisfies Record<string, MusicTrack>

export function compensatedRmsDb(track: MusicTrack) {
  return track.measuredRmsDb + 20 * Math.log10(track.gain)
}

export function compensatedPeakDb(track: MusicTrack) {
  return track.measuredPeakDb + 20 * Math.log10(track.gain)
}

export function musicTrackFor(zone: MusicZone, minigameOpen: boolean, minigameKind: MusicEvent, sessionComplete: boolean, sessionStarted = true): MusicTrack {
  if (!sessionStarted) return MUSIC_TRACKS.hub
  if (sessionComplete) return MUSIC_TRACKS.results
  if (minigameOpen) {
    if (minigameKind === 'mining') return MUSIC_TRACKS.miningRush
    if (minigameKind === 'farm') return MUSIC_TRACKS.kitchenRush
    return MUSIC_TRACKS.forageRace
  }
  return MUSIC_TRACKS[zone]
}

export function musicVolume(master: number, music: number, track: MusicTrack) {
  return Math.min(1, Math.max(0, master * music * track.gain))
}

export function ambienceVolume(master: number, ambience: number, cave: boolean) {
  // The forest recording contains prominent bird calls. Its bed sits at half
  // the cave recording's gain so those calls do not dominate the music or SFX.
  return Math.min(1, Math.max(0, master * ambience * (cave ? .38 : .19)))
}
