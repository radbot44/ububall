'use strict';
/* Procedural Ubu audio engine, Goal Anthem sequencer, and spatial arena SFX. */
const {
  INSTRUMENTS, SCALES, TEMPOS, GROOVES, PHRASE_FORMS, BACKING_TEXTURES, DRUM_BASS_GROOVES,
  HARMONY_PROGS, LEAD_EXPRESSIONS, ACOUSTIC_STAGES, SIGNATURE_DROPS, SIGNATURE_GATE_ACTIVE,
  NOTE_NAMES, midiNote, noteFrequency, noteName, decaySeconds, scaleDegreeSemitones, parseVoiceInfo
} = require('./audio/theory.js');
const {
  getAudioContext, setupAudioBuses, setSoundVolume, getSoundVolume, setMusicVolume,
  getMusicVolume, setAudioMode, getAudioMode, isStereo, setOrientation, isPortrait,
  panFromField, shareMasterChain, stopMotion, stopAll
} = require('./audio/buses.js');
const { playVoice, playCollision, playBallHit, playCoin, playPack, playUnwrap, playSizzle } = require('./audio/pack-sfx.js');
const { playUbuMove, playSpin, playPuckSlide, playAimScrape, playCarve, playSlipstream, playSpinStrike, playSpinTwirl } = require('./audio/skating-sfx.js');
const { playWallHit, playFireImpact, playSave, playFirework, playGoalHit, playSuper, playGuardToggle, playGuardHit, playIronSave, playFoul, playGameStart } = require('./audio/impact-sfx.js');
const { scalePitches, chordFor, loopVariations, playFanfare } = require('./audio/anthem.js');

const api = Object.freeze({
  INSTRUMENTS, SCALES, TEMPOS, GROOVES, PHRASE_FORMS, BACKING_TEXTURES, DRUM_BASS_GROOVES,
  HARMONY_PROGS, LEAD_EXPRESSIONS, ACOUSTIC_STAGES, SIGNATURE_DROPS, SIGNATURE_GATE_ACTIVE,
  NOTE_NAMES, midiNote, noteFrequency, noteName, decaySeconds, scaleDegreeSemitones, parseVoiceInfo,
  getAudioContext, setupAudioBuses, setSoundVolume, getSoundVolume, setMusicVolume, getMusicVolume,
  setAudioMode, getAudioMode, isStereo, setOrientation, isPortrait, panFromField, shareMasterChain,
  playVoice, playCollision, playBallHit, playCoin, playPack, playUnwrap, playUbuMove, playSpin,
  playPuckSlide, playAimScrape, playCarve, playSlipstream, playSpinStrike, playSpinTwirl, playWallHit,
  playFireImpact, playSave, playFirework, playSizzle, playGoalHit, playFoul, playGuardToggle, playGuardHit, playIronSave,
  playSuper, playGameStart, playFanfare, scalePitches, chordFor, loopVariations, stopMotion, stop: stopAll
});

if (typeof globalThis !== 'undefined') globalThis.ubuAudio = api;
if (typeof window !== 'undefined') window.ubuAudio = api;
if (typeof module === 'object' && module.exports) module.exports = api;
