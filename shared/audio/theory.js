/* Musical scales, phrase forms, and 64-bit Anthem voice decoding. */
'use strict';
const INSTRUMENTS = [
  'Soft Bell',      // 0: Rounded bell with a lingering inharmonic ring
  'Woodblock',      // 1: Dry, hollow wooden knock
  'Resonant Pluck', // 2: Resonant sawtooth filter sweep
  'Crystal Chime',  // 3: Glassy dual sine with shimmer
  'Square Chip',    // 4: Retro 8-bit square wave with vibrato
  'Pulse Pluck',    // 5: Narrow pulse with a crisp, closing filter
  'Warm Pad',       // 6: Soft sine swell with a quiet octave
  'Sub Pluck',      // 7: Deep punchy sine with transient
  'Kalimba',        // 8: Plucked tine with a brief, bright buzz
  'Marimba',        // 9: Hollow wooden mallet pop
  'Vibraphone',     // 10: Metallic mallet tone with tremolo
  'Brass Ping',     // 11: Sawtooth with envelope filter swell
  'Electric Piano', // 12: Bell transient + Rhodes tine warmth
  'Synth Bass',     // 13: Punchy filtered saw/square bite
  'Robot Vowel',    // 14: Hollow talking pulse with moving vowel resonances
  'Space Zap'       // 15: Retro arcade downward pitch drop
];

const SCALES = [
  { name: 'Major', degrees: [0, 2, 4, 5, 7, 9, 11, 12] },
  { name: 'Minor', degrees: [0, 2, 3, 5, 7, 8, 10, 12] },
  { name: 'Major Pentatonic', degrees: [0, 2, 4, 7, 9, 12, 14, 16] },
  { name: 'Minor Blues', degrees: [0, 3, 5, 7, 10, 12, 15, 17] },
  { name: 'Dorian', degrees: [0, 2, 3, 5, 7, 9, 10, 12] },
  { name: 'Insen', degrees: [0, 1, 5, 7, 10, 12, 13, 17] },
  { name: 'Synthwave', degrees: [0, 2, 4, 6, 7, 9, 11, 12] },
  { name: 'Retro Arcade', degrees: [0, 2, 4, 7, 11, 12, 14, 16] }
];

const TEMPOS = [84, 96, 108, 120, 132, 144, 156, 168];
const GROOVES = ['Straight', 'Light Swing', 'Shuffle', 'Staccato'];
const PHRASE_FORMS = [
  'Call & Response',   // 0: Bar A -> Bar B verbatim
  'Resolved Answer',   // 1: Bar A -> Bar B with final sounding note resolved to tonic
  'Rhythmic Rhyme',    // 2: Bar A -> Bar B pitches on Bar A's rhythm, resolved cadence
  'Hook & Turnaround', // 3: Bar A -> A[0..3] hook repeat + B[4..7] turnaround
  'Rising Sequence',   // 4: Bar A -> A[0..3] stepped up a 3rd + B[4..7] cadence
  'Octave Chorus',     // 5: Bar A -> Bar B lifted one octave
  'Mirror Answer',     // 6: Bar A -> inverted B[0..3] contour + resolved B[4..7]
  'Double Finale'      // 7: Bar A -> punchy pickup Bar B + extended quarter arrival
];
const BACKING_TEXTURES = [
  'Warm Strings',  // 0: Detuned triangle pad + brass endpoint accents
  'Rink Organ',    // 1: Drawbar stadium organ with rotary shimmer
  'Chip Arp',      // 2: Fast 16th-note retro chord arpeggiator
  'Brass Section', // 3: Ensemble sawtooth brass swell
  'Power Fifths',  // 4: Driving root-fifth-octave power chords
  'Glassy Choir',  // 5: Dual-formant vowel choir pad
  'Electric Comp', // 6: Rhythmic Rhodes tine chord stabs
  'FM Pluck Grid'  // 7: Eighth-note resonant synth pluck chords
];
const DRUM_BASS_GROOVES = [
  'Beat Pulse',       // 0: Sine beat bass + soft quarter hat + accent kicks
  'Arena Stomp-Clap', // 1: Stadium boom-boom-clap + heavy root bass
  'Four-on-Floor',    // 2: Kick on every beat, offbeat hat + octave disco bass
  'Breakbeat',        // 3: Syncopated kick/snare break + rolling sub
  '8-Bit Chiptune',   // 4: Retro pitch-drop chip kick, noise snare + triangle bass
  'Marching Snare',   // 5: Rudimental 16th snare cadence + root-fifth tuba bass
  'Halftime Boom',    // 6: Sustained 808 sub glide + halftime snare + rapid hats
  'Synthwave Drive',  // 7: Pumping 8th saw bass + gated snare + bar-end tom fill
  'Walking Rink',     // 8: Walking scale bassline + ride shimmer + rim backbeat
  'Funk Slap',        // 9: Syncopated 16th plucked bass + tight ghost-note snare
  'Polka Bounce',     // 10: Upbeat oom-pah root/fifth bass + offbeat sizzle
  'Double-Time Punk', // 11: Fast driving 8th kick/snare sprint + 8th bass chug
  'Tribal Toms',      // 12: Pitched stadium floor-tom pattern + sub pulse
  'Electro Arp Bass', // 13: 16th octave-jumping synth bass + electro clap
  'Anthem Tympani',   // 14: Orchestral timpani rolls on chord changes + pedal sub
  'Drumless Anthem'   // 15: Pure pad/organ/choir swell + warm sustained bass, no drums
];
const HARMONY_PROGS = [
  'Heroic',        // 0: I-IV-V preference
  'Anthemic',      // 1: I-V-vi-IV stadium preference
  'Dark Drive',    // 2: vi-IV-VII minor-leaning drive
  'Rink Pedal',    // 3: Moving upper triads over locked tonic pedal bass
  'Quartal Synth', // 4: Stacked 4th/sus stadium voicings
  'Blues Turn',    // 5: IV-V-I turnaround pull
  'Modal Float',   // 6: ii-IV-vi modal movement
  'Stepwise Lift'  // 7: Beat-ascending chord preference
];
const LEAD_EXPRESSIONS = [
  'Clean',            // 0: Unadorned lead with alternating stereo width
  'Portamento Glide', // 1: Smooth pitch slide from previous sounding note
  'Twin-Lead 3rds',   // 2: Harmonized diatonic 3rd twin lead panned opposite
  'Octave Stack',     // 3: Upper/lower octave unison lead layer
  'Brass Scoop',      // 4: Upward horn pitch scoop on held notes
  'Dotted Echo',      // 5: Stereo-flipped dotted-8th delay tap
  'Held Trill',       // 6: Upper-neighbor diatonic trill on quarter notes
  'Vibrato Swell'     // 7: Lush dual-detuned chorus lead
];
const ACOUSTIC_STAGES = [
  'Studio Room',    // 0: Balanced 1.4s room
  'Ice Rink PA',    // 1: Arena slapback + bright PA air
  'Arcade Cab',     // 2: Tight 0.32s dry wooden cabinet
  'Stadium Hall',   // 3: Wide 2.3s arena reverb
  'Gated 80s',      // 4: Dense nonlinear gated drum/synth room
  'Jumbotron',      // 5: Bandpass stadium speaker projection
  'Shimmer Hall',   // 6: Bright 2.1s hall tail
  'Wide Ping-Pong'  // 7: Stereo-bouncing arena reflections
];
const SIGNATURE_DROPS = [
  'Goal Horn',   // 0: Dual-detuned brass arena foghorn blast
  'Air Siren',   // 1: Rising octave arena siren sweep
  'Crowd Chant', // 2: Rhythmic 3-count stadium clap-hey swell
  'Synth Riser'  // 3: Fast 8-step upward scale sweep
];
const SIGNATURE_GATE_ACTIVE = 31;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 6-bit pitch (0-63) maps to MIDI note 36 (C2, ~65.4 Hz) to 99 (D#7, ~2489 Hz)
function midiNote(pitchIndex) {
  const clamped = Math.max(0, Math.min(63, pitchIndex | 0));
  return 36 + clamped;
}

function noteFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteName(midi) {
  const semitone = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[semitone]}${octave}`;
}

function decaySeconds(decayIndex) {
  const clamped = Math.max(0, Math.min(15, decayIndex | 0));
  return 0.12 + clamped * 0.06;
}

function scaleDegreeSemitones(scaleIndex, degree) {
  const scale = SCALES[(scaleIndex | 0) & 7];
  return scale.degrees[(degree | 0) & 7];
}

function beatsForDuration(duration) {
  return duration === 0 ? 0.25 : duration === 1 ? 0.5 : duration === 2 ? 1.0 : 0.5;
}

function parseNoteArray(list, scaleIdx, rootMidi) {
  return list.map((n, i) => {
    const degree = (n?.degree | 0) & 7;
    const duration = (n?.duration | 0) & 3;
    const isRest = duration === 3;
    let midi = null, freq = null, name = 'Rest', semi = null;
    if (!isRest) {
      semi = scaleDegreeSemitones(scaleIdx, degree);
      midi = rootMidi + semi;
      freq = noteFrequency(midi);
      name = noteName(midi);
    }
    return { index: i, degree, duration, isRest, midi, freq, name, beats: beatsForDuration(duration), semi };
  });
}

function buildAnswerNote(semi, duration, index, scaleIdx, rootMidi, fallbackDegree = 0) {
  const dur = (duration | 0) & 3;
  if (dur === 3 || semi === null || semi === undefined) {
    return { index, degree: fallbackDegree & 7, duration: 3, isRest: true, midi: null, freq: null, name: 'Rest', beats: 0.5, semi: null };
  }
  const degrees = SCALES[scaleIdx].degrees;
  let bestDeg = fallbackDegree & 7, bestDist = Infinity;
  for (let d = 0; d < degrees.length; d++) {
    const dist = Math.abs(degrees[d] - semi);
    if (dist < bestDist) { bestDist = dist; bestDeg = d; }
  }
  const midi = rootMidi + semi;
  return {
    index,
    degree: bestDeg,
    duration: dur,
    isRest: false,
    midi,
    freq: noteFrequency(midi),
    name: noteName(midi),
    beats: beatsForDuration(dur),
    semi
  };
}

function resolveAnswerBar(barA, rawBarB, phraseFormIdx, scaleIdx, rootMidi) {
  if (!rawBarB.length) return [];
  const scaleDegs = SCALES[scaleIdx].degrees;
  const distinct = [...new Set(scaleDegs.map(s => s % 12))].sort((a, b) => a - b);
  const stepOf = semi => {
    const pc = ((semi % 12) + 12) % 12;
    const idx = distinct.indexOf(pc);
    return (idx >= 0 ? idx : 0) + distinct.length * Math.floor(semi / 12);
  };
  const semiAtStep = step => {
    const n = distinct.length;
    return distinct[((step % n) + n) % n] + 12 * Math.floor(step / n);
  };
  const snapTonic = semi => (semi >= 6 ? 12 : 0);
  const snapCadence = semi => {
    const fifth = distinct.includes(7) ? 7 : distinct[Math.min(distinct.length - 1, 3)];
    const candidates = [0, fifth, 12];
    return candidates.reduce((best, c) => Math.abs(c - semi) < Math.abs(best - semi) ? c : best, 0);
  };

  let shaped = rawBarB.map(n => ({ ...n }));
  switch (phraseFormIdx & 7) {
    case 0: // Call & Response: verbatim Bar B
      break;
    case 1: { // Resolved Answer: final sounding note lands on tonic
      const lastIdx = shaped.findLastIndex(n => !n.isRest);
      if (lastIdx >= 0) {
        const s = snapTonic(shaped[lastIdx].semi);
        shaped[lastIdx] = buildAnswerNote(s, shaped[lastIdx].duration, lastIdx, scaleIdx, rootMidi, s === 12 ? 7 : 0);
      }
      break;
    }
    case 2: { // Rhythmic Rhyme: Bar B degrees on Bar A rhythm + cadence
      shaped = shaped.map((bNote, i) => {
        const aDur = i < barA.length ? barA[i].duration : bNote.duration;
        if (aDur === 3) return buildAnswerNote(null, 3, i, scaleIdx, rootMidi, bNote.degree);
        const semi = bNote.isRest ? scaleDegreeSemitones(scaleIdx, bNote.degree) : bNote.semi;
        return buildAnswerNote(semi, aDur, i, scaleIdx, rootMidi, bNote.degree);
      });
      const lastIdx = shaped.findLastIndex(n => !n.isRest);
      if (lastIdx >= 0) {
        const s = snapCadence(shaped[lastIdx].semi);
        shaped[lastIdx] = buildAnswerNote(s, shaped[lastIdx].duration, lastIdx, scaleIdx, rootMidi, shaped[lastIdx].degree);
      }
      break;
    }
    case 3: { // Hook & Turnaround: A[0..3] + B[4..7]
      shaped = shaped.map((bNote, i) => {
        if (i < 4 && i < barA.length) return { ...barA[i], index: i };
        return bNote;
      });
      const lastIdx = shaped.findLastIndex(n => !n.isRest);
      if (lastIdx >= 4) {
        const s = snapCadence(shaped[lastIdx].semi);
        shaped[lastIdx] = buildAnswerNote(s, shaped[lastIdx].duration, lastIdx, scaleIdx, rootMidi, shaped[lastIdx].degree);
      }
      break;
    }
    case 4: { // Rising Sequence: A[0..3] shifted +2 scale steps + B[4..7]
      shaped = shaped.map((bNote, i) => {
        if (i < 4 && i < barA.length) {
          const a = barA[i];
          if (a.isRest) return { ...a, index: i };
          const s = semiAtStep(stepOf(a.semi) + 2);
          return buildAnswerNote(s, a.duration, i, scaleIdx, rootMidi, (a.degree + 2) & 7);
        }
        return bNote;
      });
      break;
    }
    case 5: { // Octave Chorus: Bar B lifted +12 semitones
      shaped = shaped.map((bNote, i) => bNote.isRest ? bNote : buildAnswerNote(bNote.semi + 12, bNote.duration, i, scaleIdx, rootMidi, bNote.degree));
      break;
    }
    case 6: { // Mirror Answer: inverted first half around pivot + resolved tail
      const firstSounding = barA.find(n => !n.isRest) || shaped.find(n => !n.isRest);
      const pivot = firstSounding ? stepOf(firstSounding.semi) : 0;
      shaped = shaped.map((bNote, i) => {
        if (i < 4 && !bNote.isRest) {
          const s = Math.max(-12, Math.min(24, semiAtStep(2 * pivot - stepOf(bNote.semi))));
          return buildAnswerNote(s, bNote.duration, i, scaleIdx, rootMidi, bNote.degree);
        }
        return bNote;
      });
      const lastIdx = shaped.findLastIndex(n => !n.isRest);
      if (lastIdx >= 0) {
        const s = snapTonic(shaped[lastIdx].semi);
        shaped[lastIdx] = buildAnswerNote(s, shaped[lastIdx].duration, lastIdx, scaleIdx, rootMidi, s === 12 ? 7 : 0);
      }
      break;
    }
    case 7: { // Double Finale: snappy 16th pickups + held quarter cadence
      const lastIdx = shaped.findLastIndex(n => !n.isRest);
      shaped = shaped.map((bNote, i) => {
        if (bNote.isRest) return bNote;
        if (i === lastIdx) return buildAnswerNote(snapTonic(bNote.semi), 2, i, scaleIdx, rootMidi, bNote.degree);
        const dur = i < 6 && bNote.duration === 1 ? 0 : bNote.duration;
        return buildAnswerNote(bNote.semi, dur, i, scaleIdx, rootMidi, bNote.degree);
      });
      break;
    }
  }
  return shaped;
}

function parseVoiceInfo(voice) {
  voice = voice || {};
  const instIdx = (voice.instrument | 0) & 15;
  const pitchIdx = Math.max(0, Math.min(63, voice.pitch | 0));
  const scaleIdx = (voice.scale | 0) & 7;
  const tempoIdx = (voice.tempo | 0) & 7;
  const grooveIdx = (voice.groove | 0) & 3;
  const phraseFormIdx = (voice.phraseForm | 0) & 7;
  const backingIdx = (voice.backingTexture | 0) & 7;
  const drumBassIdx = (voice.drumBass | 0) & 15;
  const harmonyIdx = (voice.harmonyProg | 0) & 7;
  const leadExprIdx = (voice.leadExpr | 0) & 7;
  const stageIdx = (voice.acousticStage | 0) & 7;
  const sigGate = Math.max(0, Math.min(31, voice.signatureGate | 0));
  const hasSignatureDrop = sigGate === SIGNATURE_GATE_ACTIVE;
  const sigDropIdx = phraseFormIdx & 3;
  const decaySec = decaySeconds(voice.decay);
  const rootMidi = midiNote(pitchIdx);
  const rootFreq = noteFrequency(rootMidi);
  const rootName = noteName(rootMidi);

  const notes = Array.isArray(voice.notes) ? voice.notes : [];
  const parsedNotes = parseNoteArray(notes, scaleIdx, rootMidi);
  const hasAnthem = Array.isArray(voice.answerNotes) && voice.answerNotes.length > 0;
  const rawAnswerNotes = hasAnthem ? parseNoteArray(voice.answerNotes, scaleIdx, rootMidi) : [];
  const effectiveAnswerNotes = hasAnthem ? resolveAnswerBar(parsedNotes, rawAnswerNotes, phraseFormIdx, scaleIdx, rootMidi) : [];
  const anthemNotes = hasAnthem
    ? [
        ...parsedNotes.map((n, i) => ({ ...n, index: i, bar: 0 })),
        ...effectiveAnswerNotes.map((n, i) => ({ ...n, index: parsedNotes.length + i, bar: 1 }))
      ]
    : parsedNotes.map((n, i) => ({ ...n, index: i, bar: 0 }));

  return {
    instrument: INSTRUMENTS[instIdx],
    instrumentIndex: instIdx,
    pitchIndex: pitchIdx,
    rootMidi,
    rootFreq,
    rootName,
    decaySeconds: decaySec,
    timbreMod: (voice.timbreMod | 0) & 3,
    scale: SCALES[scaleIdx].name,
    scaleIndex: scaleIdx,
    tempoBpm: TEMPOS[tempoIdx],
    tempoIndex: tempoIdx,
    groove: GROOVES[grooveIdx],
    grooveIndex: grooveIdx,
    phraseForm: PHRASE_FORMS[phraseFormIdx],
    phraseFormIndex: phraseFormIdx,
    backingTexture: BACKING_TEXTURES[backingIdx],
    backingTextureIndex: backingIdx,
    drumBass: DRUM_BASS_GROOVES[drumBassIdx],
    drumBassIndex: drumBassIdx,
    harmonyProg: HARMONY_PROGS[harmonyIdx],
    harmonyProgIndex: harmonyIdx,
    leadExpr: LEAD_EXPRESSIONS[leadExprIdx],
    leadExprIndex: leadExprIdx,
    acousticStage: ACOUSTIC_STAGES[stageIdx],
    acousticStageIndex: stageIdx,
    signatureGate: sigGate,
    hasSignatureDrop,
    signatureDropIndex: sigDropIdx,
    signatureDrop: hasSignatureDrop ? SIGNATURE_DROPS[sigDropIdx] : null,
    hasAnthem,
    notes: parsedNotes,
    answerNotes: rawAnswerNotes,
    effectiveAnswerNotes,
    anthemNotes
  };
}

// Audio synthesis engine

module.exports = {
  INSTRUMENTS, SCALES, TEMPOS, GROOVES, PHRASE_FORMS, BACKING_TEXTURES, DRUM_BASS_GROOVES, HARMONY_PROGS, LEAD_EXPRESSIONS, ACOUSTIC_STAGES, SIGNATURE_DROPS, SIGNATURE_GATE_ACTIVE, NOTE_NAMES, midiNote, noteFrequency, noteName, decaySeconds, scaleDegreeSemitones, beatsForDuration, parseNoteArray, buildAnswerNote, resolveAnswerBar, parseVoiceInfo
};
