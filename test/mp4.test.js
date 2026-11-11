const test = require('node:test');
const assert = require('node:assert/strict');
const MP4 = require('../web/mp4.js');

// Boxes as { type, start, end, children } for the container types this writer uses.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);
function parse(file, start = 0, end = file.length) {
  const view = new DataView(file.buffer, file.byteOffset), boxes = [];
  for (let at = start; at < end;) {
    const size = view.getUint32(at), type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= end, `${type} fits its parent`);
    boxes.push({ type, start: at, end: at + size, children: CONTAINERS.has(type) ? parse(file, at + 8, at + size) : [] });
    at += size;
  }
  return boxes;
}
const find = (boxes, ...path) => path.reduce((list, type) => list.find(b => b.type === type)?.children ?? list.find(b => b.type === type), boxes);

test('the MP4 writer lays out a playable file with its movie box first', async () => {
  const sample = (n, fill, extra = {}) => ({ data: new Uint8Array(n).fill(fill), ...extra });
  const video = { width: 1920, height: 1080, timescale: 90000, description: Uint8Array.of(1, 100, 0, 42, 255, 225),
    samples: [sample(50, 1, { duration: 1500, key: true }), sample(20, 2, { duration: 1500 }), sample(30, 3, { duration: 1500, key: true })] };
  const audio = { codec: 'mp4a', channels: 2, sampleRate: 48000, timescale: 48000, bitrate: 128000, description: Uint8Array.of(17, 144),
    samples: [sample(7, 9, { duration: 1024 }), sample(8, 8, { duration: 1024 })] };
  const file = new Uint8Array(await new Blob(MP4.write(video, audio)).arrayBuffer());
  const top = parse(file);
  assert.deepEqual(top.map(b => b.type), ['ftyp', 'moov', 'mdat']);
  const view = new DataView(file.buffer);
  const tracks = find(top, 'moov').filter(b => b.type === 'trak');
  assert.equal(tracks.length, 2);
  const expected = [video, audio];
  tracks.forEach((trak, i) => {
    const stbl = find(trak.children, 'mdia', 'minf', 'stbl');
    const stco = stbl.find(b => b.type === 'stco'), stsz = stbl.find(b => b.type === 'stsz');
    const offset = view.getUint32(stco.start + 16), count = view.getUint32(stsz.start + 16);
    assert.equal(count, expected[i].samples.length);
    // The chunk offset points at the track's first sample, and its samples follow back to back.
    let at = offset;
    expected[i].samples.forEach((s, k) => {
      assert.equal(view.getUint32(stsz.start + 20 + 4 * k), s.data.length);
      assert.deepEqual(file.subarray(at, at + s.data.length), s.data); at += s.data.length;
    });
  });
  const stss = find(tracks[0].children, 'mdia', 'minf', 'stbl').find(b => b.type === 'stss');
  assert.deepEqual([view.getUint32(stss.start + 12), view.getUint32(stss.start + 16), view.getUint32(stss.start + 20)], [2, 1, 3]);
  const mvhd = find(top, 'moov').find(b => b.type === 'mvhd');
  assert.equal(view.getUint32(mvhd.start + 24), 50, 'movie duration in ms');
  const opus = new Uint8Array(await new Blob(MP4.write(video, { ...audio, codec: 'opus', preSkip: MP4.opusPreSkip(Uint8Array.of(...Buffer.from('OpusHead'), 1, 2, 0x38, 1)) })).arrayBuffer());
  assert.ok(Buffer.from(opus).includes(Buffer.from('dOps')));
  assert.ok(Buffer.from(opus).includes(Buffer.from([0x64, 0x4f, 0x70, 0x73, 0, 2, 1, 0x38])), 'dOps carries the channels and pre-skip big-endian');
});

test('MP4 writer handles ctts composition offsets, per-track tkhd durations, non-312 Opus pre-skip, and invalid inputs', async () => {
  const head = Uint8Array.of(...Buffer.from('OpusHead'), 1, 2, 0xee, 0x02, 0, 0, 0, 0, 0);
  assert.equal(MP4.opusPreSkip(head), 750, 'reads non-default little-endian pre-skip from Uint8Array');
  assert.equal(MP4.opusPreSkip(head.buffer), 750, 'reads pre-skip from raw ArrayBuffer');
  assert.equal(MP4.opusPreSkip(new DataView(head.buffer, 0, head.byteLength)), 750, 'reads pre-skip from DataView');
  assert.equal(MP4.opusPreSkip(Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 1, 2, 0xee, 0x02)), 312, 'rejects non-OpusHead magic');

  const sample = (n, fill, extra = {}) => ({ data: new Uint8Array(n).fill(fill), ...extra });
  const videoV0 = {
    width: 1280, height: 720, timescale: 90000, description: Uint8Array.of(1, 100, 0, 42, 255, 225),
    samples: [
      sample(32, 1, { duration: 6000, key: true, ctsOffset: 3000 }),
      sample(24, 2, { duration: 6000, ctsOffset: 3000 }),
      sample(28, 3, { duration: 6000, ctsOffset: 0 })
    ]
  };
  const audio = {
    codec: 'mp4a', channels: 2, sampleRate: 48000, timescale: 48000, bitrate: 128000, description: Uint8Array.of(17, 144),
    samples: [sample(12, 9, { duration: 4800 })]
  };
  const bytesV0 = new Uint8Array(await new Blob(MP4.write(videoV0, audio)).arrayBuffer());
  const topV0 = parse(bytesV0);
  const viewV0 = new DataView(bytesV0.buffer);
  const traksV0 = find(topV0, 'moov').filter(b => b.type === 'trak');
  const tkhdVideo = traksV0[0].children.find(b => b.type === 'tkhd');
  const tkhdAudio = traksV0[1].children.find(b => b.type === 'tkhd');
  assert.equal(viewV0.getUint32(tkhdVideo.start + 28), 200, 'video tkhd duration is 200 ms');
  assert.equal(viewV0.getUint32(tkhdAudio.start + 28), 100, 'shorter audio tkhd duration is 100 ms');
  const cttsV0 = find(traksV0[0].children, 'mdia', 'minf', 'stbl').find(b => b.type === 'ctts');
  assert.ok(cttsV0, 'ctts box is written when composition offsets are non-zero');
  assert.equal(bytesV0[cttsV0.start + 8], 0, 'positive ctsOffsets use ctts version 0');
  assert.equal(viewV0.getUint32(cttsV0.start + 12), 2, 'identical adjacent ctsOffsets run-length compress');

  const videoV1 = {
    ...videoV0,
    samples: [
      sample(32, 1, { duration: 6000, key: true, ctsOffset: -1500 }),
      sample(24, 2, { duration: 6000, ctsOffset: 1500 })
    ]
  };
  const bytesV1 = new Uint8Array(await new Blob(MP4.write(videoV1)).arrayBuffer());
  const topV1 = parse(bytesV1);
  const cttsV1 = find(find(topV1, 'moov').find(b => b.type === 'trak').children, 'mdia', 'minf', 'stbl').find(b => b.type === 'ctts');
  const viewV1 = new DataView(bytesV1.buffer);
  assert.equal(bytesV1[cttsV1.start + 8], 1, 'negative ctsOffsets switch ctts to version 1');
  assert.equal(viewV1.getInt32(cttsV1.start + 20), -1500);

  assert.throws(() => MP4.write(null), /Invalid video track/);
  assert.throws(() => MP4.write({ ...videoV0, samples: [] }), /Invalid video track/);
  assert.throws(() => MP4.write({ ...videoV0, description: new Uint8Array(0) }), /Invalid video track/);
});
