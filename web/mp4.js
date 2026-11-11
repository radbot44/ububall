/* A minimal MP4 (ISO BMFF) writer for one H.264 video track and an optional AAC or Opus audio track,
   with the movie box first so the file plays while it loads. Encoded samples come from WebCodecs. */
(function(root) {
  'use strict';
  const ascii = text => Uint8Array.from(text, c => c.charCodeAt(0));
  // Big-endian fields: [bits, value] pairs, or raw byte arrays.
  function bytes(...fields) {
    const parts = fields.map(f => {
      if (f instanceof Uint8Array) return f;
      const [bits, value] = f;
      if (!Number.isFinite(value)) throw new RangeError('Invalid MP4 numeric field.');
      const out = new Uint8Array(bits / 8);
      for (let i = out.length - 1, v = BigInt(Math.round(value)) & ((1n << BigInt(bits)) - 1n); i >= 0; i--, v >>= 8n) out[i] = Number(v & 255n);
      return out;
    });
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  const box = (type, ...content) => { const body = bytes(...content); return bytes([32, body.length + 8], ascii(type), body); };
  const full = (type, version, flags, ...content) => box(type, [8, version], [24, flags], ...content);
  const MATRIX = bytes(...[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(v => [32, v]));
  // Run-length sample durations.
  function stts(samples) {
    const runs = [];
    for (const s of samples) {
      const last = runs.at(-1);
      if (last && last[1] === s.duration) last[0]++; else runs.push([1, s.duration]);
    }
    return full('stts', 0, 0, [32, runs.length], ...runs.flatMap(([n, d]) => [[32, n], [32, d]]));
  }
  // Optional composition-time offsets (for B-frame streams where PTS != DTS).
  function ctts(samples) {
    const cto = s => s.cto ?? s.ctsOffset ?? 0;
    if (!samples.some(s => cto(s) !== 0)) return [];
    const signed = samples.some(s => cto(s) < 0), runs = [];
    for (const s of samples) {
      const off = Math.round(cto(s)), last = runs.at(-1);
      if (last && last[1] === off) last[0]++; else runs.push([1, off]);
    }
    return [full('ctts', signed ? 1 : 0, 0, [32, runs.length], ...runs.flatMap(([n, c]) => [[32, n], [32, c]]))];
  }
  // Each track's samples form one chunk at `offset` in the file.
  function trak(id, track, offset, sampleEntry, handler, header) {
    const duration = track.samples.reduce((n, s) => n + s.duration, 0);
    const trackMovieDuration = Math.round(duration / track.timescale * 1000);
    const video = handler === 'vide';
    const stbl = box('stbl', full('stsd', 0, 0, [32, 1], sampleEntry), stts(track.samples),
      ...(video ? ctts(track.samples) : []),
      ...(video ? [full('stss', 0, 0, [32, track.samples.filter(s => s.key).length], ...track.samples.flatMap((s, i) => s.key ? [[32, i + 1]] : []))] : []),
      full('stsc', 0, 0, [32, 1], [32, 1], [32, track.samples.length], [32, 1]),
      full('stsz', 0, 0, [32, 0], [32, track.samples.length], ...track.samples.map(s => [32, s.data.length])),
      full('stco', 0, 0, [32, 1], [32, offset]));
    return box('trak',
      full('tkhd', 0, 3, [32, 0], [32, 0], [32, id], [32, 0], [32, trackMovieDuration], [64, 0], [16, 0], [16, video ? 0 : 1], [16, video ? 0 : 0x100], [16, 0],
        MATRIX, [32, (track.width || 0) * 0x10000], [32, (track.height || 0) * 0x10000]),
      box('mdia',
        full('mdhd', 0, 0, [32, 0], [32, 0], [32, track.timescale], [32, duration], [16, 0x55c4], [16, 0]),
        full('hdlr', 0, 0, [32, 0], ascii(handler), [32, 0], [32, 0], [32, 0], ascii(video ? 'VideoHandler\0' : 'SoundHandler\0')),
        box('minf', header, box('dinf', full('dref', 0, 0, [32, 1], full('url ', 0, 1))), stbl)));
  }
  function avc1(v) {
    return box('avc1', [48, 0], [16, 1], [16, 0], [16, 0], [32, 0], [32, 0], [32, 0], [16, v.width], [16, v.height],
      [32, 0x480000], [32, 0x480000], [32, 0], [16, 1], new Uint8Array(32), [16, 0x18], [16, 0xffff], box('avcC', v.description));
  }
  // ISO 14496-1 descriptor: tag, then its length in four 7-bit bytes.
  const descriptor = (tag, body) => bytes([8, tag], [8, 0x80 | body.length >> 21 & 127], [8, 0x80 | body.length >> 14 & 127], [8, 0x80 | body.length >> 7 & 127], [8, body.length & 127], body);
  function audioEntry(a) {
    const common = [[48, 0], [16, 1], [32, 0], [32, 0], [16, a.channels], [16, 16], [16, 0], [16, 0], [32, Math.min(65535, a.sampleRate) * 0x10000]];
    if (a.codec === 'opus') {
      // dOps (Opus in ISO BMFF): big-endian, unlike the OpusHead it is read from.
      return box('Opus', ...common, box('dOps', [8, 0], [8, a.channels], [16, a.preSkip ?? 312], [32, a.sampleRate], [16, 0], [8, 0]));
    }
    const config = descriptor(4, bytes([8, 0x40], [8, 0x15], [24, 0], [32, a.bitrate || 0], [32, a.bitrate || 0], descriptor(5, a.description)));
    return box('mp4a', ...common, full('esds', 0, 0, descriptor(3, bytes([16, 2], [8, 0], config, descriptor(6, bytes([8, 2]))))));
  }
  // Returns the file as parts for a Blob: the header, then each sample's data.
  function write(video, audio = null) {
    if (!video || !Array.isArray(video.samples) || !video.samples.length || !(video.timescale > 0) ||
        !(video.description instanceof Uint8Array) || !video.description.length) {
      throw new Error('Invalid video track.');
    }
    if (audio && (!Array.isArray(audio.samples) || !audio.samples.length || !(audio.timescale > 0) ||
        !(audio.channels > 0) || !(audio.sampleRate > 0) ||
        (audio.codec !== 'opus' && (!(audio.description instanceof Uint8Array) || !audio.description.length)))) {
      throw new Error('Invalid audio track.');
    }
    const tracks = [video, ...(audio ? [audio] : [])];
    const seconds = Math.max(...tracks.map(t => t.samples.reduce((n, s) => n + s.duration, 0) / t.timescale));
    const movieDuration = Math.round(seconds * 1000);
    const ftyp = box('ftyp', ascii('isom'), [32, 0x200], ascii('isomiso2avc1mp41'));
    const moov = start => {
      const videoSize = video.samples.reduce((n, s) => n + s.data.length, 0);
      return box('moov',
        full('mvhd', 0, 0, [32, 0], [32, 0], [32, 1000], [32, movieDuration], [32, 0x10000], [16, 0x100], [16, 0], [64, 0], MATRIX, new Uint8Array(24), [32, tracks.length + 1]),
        trak(1, video, start, avc1(video), 'vide', full('vmhd', 0, 1, [64, 0])),
        ...(audio ? [trak(2, audio, start + videoSize, audioEntry(audio), 'soun', full('smhd', 0, 0, [32, 0]))] : []));
    };
    const mdatSize = tracks.reduce((n, t) => n + t.samples.reduce((m, s) => m + s.data.length, 0), 0) + 8;
    // Offsets depend on the movie box's size, which does not depend on them.
    const head = ftyp.length + moov(0).length + 8;
    if (head - 8 + mdatSize > 0xffffffff) throw new Error('The video is too long to save.');
    return [ftyp, moov(head), bytes([32, mdatSize], ascii('mdat')), ...tracks.flatMap(t => t.samples.map(s => s.data))];
  }
  // OpusHead (from an Opus encoder's description) gives the pre-skip.
  function opusPreSkip(head) {
    const u8 = head instanceof Uint8Array ? head
      : ArrayBuffer.isView(head) ? new Uint8Array(head.buffer, head.byteOffset, head.byteLength)
      : head instanceof ArrayBuffer ? new Uint8Array(head) : null;
    if (!u8 || u8.length < 12) return 312;
    for (let i = 0; i < 8; i++) if (u8[i] !== 'OpusHead'.charCodeAt(i)) return 312;
    return u8[10] | u8[11] << 8;
  }
  const api = { write, opusPreSkip };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallMP4 = api;
})(globalThis);
