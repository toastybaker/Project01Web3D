import assert from 'node:assert/strict'
import { ambienceVolume, MUSIC_TRACKS, compensatedPeakDb, compensatedRmsDb, musicTrackFor, musicVolume } from '../src/game/audio'
import { collectionSfx } from '../src/game/sfx'

assert.equal(musicTrackFor('hub', false, 'mining', false), MUSIC_TRACKS.hub)
assert.equal(musicTrackFor('forage', false, 'farm', false), MUSIC_TRACKS.forage)
assert.equal(musicTrackFor('farm', true, 'farm', false), MUSIC_TRACKS.kitchenRush)
assert.equal(musicTrackFor('mine', true, 'mining', false), MUSIC_TRACKS.miningRush)
assert.equal(musicTrackFor('forage', true, 'forage', false), MUSIC_TRACKS.forageRace)
assert.equal(musicTrackFor('mine', true, 'mining', true), MUSIC_TRACKS.results)
assert.equal(musicTrackFor('mine', true, 'mining', true, false), MUSIC_TRACKS.hub, 'lobby must ignore stale zone/event/results state')

for (const [name, track] of Object.entries(MUSIC_TRACKS)) {
  assert(track.src.startsWith('/assets/audio/music/'), `${name} must use the supplied music directory`)
  assert(track.src.endsWith('.mp3'), `${name} must use a browser-supported MP3 recording`)
  assert(track.gain > 0 && track.gain <= 1, `${name} gain must attenuate without clipping`)
  assert(musicVolume(.55, .42, track) > 0 && musicVolume(.55, .42, track) <= 1, `${name} default volume is invalid`)
  assert(compensatedPeakDb(track) <= -4, `${name} compensated peak leaves insufficient headroom`)
}

const compensatedRms = Object.values(MUSIC_TRACKS).filter((track) => track !== MUSIC_TRACKS.results).map(compensatedRmsDb)
assert(Math.max(...compensatedRms) - Math.min(...compensatedRms) <= 2.5, 'zone/event music loudness spread exceeds 2.5dB')
assert(compensatedRmsDb(MUSIC_TRACKS.results) <= Math.min(...compensatedRms) + .2, 'results music should not jump louder than gameplay')

assert.equal(musicVolume(0, 1, MUSIC_TRACKS.hub), 0)
assert.equal(musicVolume(1, 0, MUSIC_TRACKS.hub), 0)
assert.equal(musicVolume(2, 2, MUSIC_TRACKS.farm), 1)
assert.equal(collectionSfx('forage', false, 'mining'), 'forage', 'stale minigame kind must not route forage to mining audio')
assert.equal(collectionSfx('farm', true, 'mining'), 'mine-complete', 'active mining event must use mining audio')
assert(ambienceVolume(.55, .38, false) < ambienceVolume(.55, .38, true) / 3, 'outdoor bird peaks are not sufficiently recessed')

console.log('Audio: zone, event, results routing and measured per-track gains passed.')
