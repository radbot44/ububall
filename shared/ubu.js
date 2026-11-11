/* 1024-bit Ubu DNA decoder. See docs/dna.md. */
(function(root) {
  'use strict';
  const V = 'AEIOU';
  const C = 'BCDFGHJKLMNPQRSTVWXYZ';
  const BEFORE_X = 'HLNRSWYXZ';
  const C_NO_X = C.replace('X', '');
  const weight = ch => (ch === 'X' || ch === 'Z' ? 1 : ch === 'Q' ? 2 : (ch === 'K' || ch === 'Y' ? 3 : 6));
  const C_POOL = [...C].flatMap(ch => Array(weight(ch)).fill(ch));
  const C_AFTER_VV_POOL = C_POOL.filter(ch => ch !== 'Y');
  const VOWEL_PAIRS = [...V].flatMap(a => [...V].map(b => a + b));
  const PAIRS = [C, C.replace(/[HWY]/g, '')].map(starters =>
    [...starters].flatMap(first => [...(BEFORE_X.includes(first) ? C : C_NO_X)].flatMap(second =>
      Array(weight(first) * weight(second)).fill(first + second))));
  const PALETTE = [
    ['Coral', '#FF7D69'], ['Sienna', '#A56C57'], ['Copper', '#CD7847'], ['Tangerine', '#FF9954'],
    ['Ochre', '#B68720'], ['Saffron', '#E8CA48'], ['Chartreuse', '#B4D858'], ['Olive', '#758C3D'],
    ['Emerald', '#42C66B'], ['Mint', '#B9ECCD'], ['Seafoam', '#89D8B5'], ['Forest', '#21845B'],
    ['Teal', '#138F99'], ['Turquoise', '#47C8DE'], ['Sky', '#76B9EF'], ['Volt', '#0066FF'],
    ['Cobalt', '#2659AC'], ['Cornflower', '#477AE7'], ['Indigo', '#4F5FC2'], ['Periwinkle', '#9E9EED'],
    ['Iris', '#C5A3FF'], ['Amethyst', '#AA54D3'], ['Aubergine', '#673C75'], ['Orchid', '#DA4DB5'],
    ['Mulberry', '#9D467A'], ['Burgundy', '#7C3349'], ['Rose', '#FF7197'], ['Vermilion', '#EE4455'],
    ['Alabaster', '#F8F6F2'], ['Slate', '#706D77'], ['Gunmetal', '#292E38'], ['Onyx', '#101217']
  ];
  const PARTS = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
  const TEXTURES = ['metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'marble',
    'velvet', 'frosted', 'terrazzo', 'crackle', 'holographic', 'woodgrain', 'plush', 'lacquered', 'damascus', 'opalescent',
    'satin', 'leather', 'denim', 'carbon-fiber', 'hammered-metal', 'granite', 'sandstone', 'obsidian',
    'liquid', 'bubbled', 'mosaic', 'circuitry', 'quartz', 'kintsugi', 'lava', 'starfield'];
  const MASK = 0xffffffffffffffffn;
  const EYE_RADIUS = 66.05;
  const IRIS_RADIUS = 30.7126;
  const EYE_TRAVEL = EYE_RADIUS - IRIS_RADIUS;

  class NameRandom {
    constructor(state) {
      state = (state + 0x9e3779b97f4a7c15n) & MASK;
      this.state = state;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      z ^= z >> 31n;
      const low = Number(z & 0xffffffffn);
      this.flags = low & 0xff;
      this.value = low >>> 8;
      this.range = 0x1000000;
      this.low = Number(z >> 32n);
      this.haveLow = true;
    }
    next32() {
      if (this.haveLow) { this.haveLow = false; return this.low; }
      let state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
      this.state = state;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      z ^= z >> 31n;
      this.low = Number(z & 0xffffffffn);
      this.haveLow = true;
      return Number(z >> 32n);
    }
    int(n) {
      // Before refill range < n <= 11,171; all pool arithmetic stays below 2^46.
      for (;;) {
        if (this.range < n) {
          this.value = this.value * 4294967296 + this.next32();
          this.range *= 4294967296;
        }
        const limit = this.range - (this.range % n);
        if (this.value < limit) {
          const result = this.value % n;
          this.value = (this.value - result) / n;
          this.range = limit / n;
          return result;
        }
        this.value -= limit;
        this.range -= limit;
      }
    }
  }
  // Weighted, pre-cased chunks; table order is part of the naming mapping.
  const VY_UP = [...V].flatMap(v => Array(6).fill(v)).concat('Y');
  const VY_LO = VY_UP.map(v => v.toLowerCase());
  const V5_LO = [...V].map(v => v.toLowerCase());
  const C0_UP = C_POOL;
  const C0_LO = C_POOL.map(c => c.toLowerCase());
  const C1_LO = C_AFTER_VV_POOL.map(c => c.toLowerCase());
  const VV_LO = VOWEL_PAIRS.map(vv => vv.toLowerCase());
  const CC0_LO = PAIRS[0].map(cc => cc.toLowerCase());
  const CC1_LO = PAIRS[1].map(cc => cc.toLowerCase());

  const CAP_CV = C0_UP.flatMap(c => VY_LO.map(v => c + v));     // 3,286
  const LOW_CV = C0_LO.flatMap(c => VY_LO.map(v => c + v));     // 3,286
  const CAP_VC = VY_UP.flatMap(v => C0_LO.map(c => v + c));     // 3,286
  const LOW_VC = VY_LO.flatMap(v => C0_LO.map(c => v + c));     // 3,286
  const WORD_2 = CAP_CV.concat(CAP_VC);                         // 6,572
  const CAP_CVV = C0_UP.flatMap(c => VV_LO.map(vv => c + vv));  // 2,650
  const LOW_VVC1 = VV_LO.flatMap(vv => C1_LO.map(c => vv + c)); // 2,575
  const LOW_C1V = C1_LO.flatMap(c => VY_LO.map(v => c + v));    // 3,193
  const LOW_V5C = V5_LO.flatMap(v => C0_LO.map(c => v + c));    // 530
  const VY_PAIR_HEAD = VY_UP.flatMap(v1 => VY_LO.map(() => v1));// 961
  const VY_PAIR_TAIL = VY_UP.flatMap(() => VY_LO);              // 961
  const V5_VY_HEAD = V5_LO.flatMap(v1 => VY_LO.map(() => v1));  // 155
  const V5_VY_TAIL = V5_LO.flatMap(() => VY_LO);                // 155

  function word6(random) {
    switch (random.int(8)) {
      case 0: return CAP_CV[random.int(3286)] + LOW_CV[random.int(3286)] + LOW_CV[random.int(3286)];
      case 1: return CAP_CV[random.int(3286)] + C0_LO[random.int(106)] + LOW_VVC1[random.int(2575)];
      case 2: return CAP_CVV[random.int(2650)] + CC1_LO[random.int(9581)] + VY_LO[random.int(31)];
      case 3: return CAP_CVV[random.int(2650)] + LOW_C1V[random.int(3193)] + C0_LO[random.int(106)];
      case 4: {
        const vv = random.int(961);
        return VY_PAIR_HEAD[vv] + CC0_LO[random.int(11171)] + LOW_V5C[random.int(530)] + VY_PAIR_TAIL[vv];
      }
      case 5: return VY_UP[random.int(31)] + CC0_LO[random.int(11171)] + LOW_VVC1[random.int(2575)];
      case 6: {
        const vv = random.int(155);
        return CAP_VC[random.int(3286)] + V5_VY_HEAD[vv] + CC0_LO[random.int(11171)] + V5_VY_TAIL[vv];
      }
      default: return CAP_VC[random.int(3286)] + LOW_VC[random.int(3286)] + LOW_VC[random.int(3286)];
    }
  }

  function word(length, random) {
    if (length === 6) return word6(random);
    if (length === 2) return WORD_2[random.int(6572)];
    if (length === 3) {
      return random.int(2) === 0
        ? CAP_CV[random.int(3286)] + C0_LO[random.int(106)]
        : CAP_VC[random.int(3286)] + VY_LO[random.int(31)];
    }
    switch (random.int(4)) {
      case 0: return CAP_CV[random.int(3286)] + LOW_CV[random.int(3286)];
      case 1: {
        const vv = random.int(961);
        return VY_PAIR_HEAD[vv] + CC0_LO[random.int(11171)] + VY_PAIR_TAIL[vv];
      }
      case 2: return CAP_CVV[random.int(2650)] + C1_LO[random.int(103)];
      default: return CAP_VC[random.int(3286)] + LOW_VC[random.int(3286)];
    }
  }
  function ubunym(state) {
    if (typeof state !== 'bigint' || state < 0n || state > MASK) {
      throw new RangeError('Seed must be an unsigned 64-bit BigInt.');
    }
    const random = new NameRandom(state);
    const nomen = word6(random);
    const length = [2, 3, 4, 6][random.flags & 3];
    const extra = word(length, random);
    const before = (random.flags & 4) === 0;
    const opposite = length < 6 ? word(6 - length, random) : '';
    // Visibility and placement use disjoint bits of the initial flags.
    const showPraenomen = (random.flags & 8) === 0;
    const showCognomen = (random.flags & 16) === 0;
    const praenomen = showPraenomen ? (before ? extra : opposite) : '';
    const cognomen = showCognomen ? (before ? opposite : extra) : '';
    const frontRoll = (random.flags & 224) === 0;
    const cognomenBeforeNomen = Boolean(cognomen) && frontRoll;
    const ordered = cognomenBeforeNomen ? [praenomen, cognomen, nomen] : [praenomen, nomen, cognomen];
    return { praenomen, nomen, cognomen, cognomenBeforeNomen, fullName: ordered.filter(Boolean).join(' ') };
  }
  function checkDNA(dna) {
    if (!(dna instanceof Uint8Array) || dna.length !== 128) throw new TypeError('DNA must contain exactly 128 bytes.');
  }
  function read(dna, start, width) {
    const i = start >> 3;
    const b2 = i + 2 < 128 ? dna[i + 2] : 0;
    return (((dna[i] << 16) | (dna[i + 1] << 8) | b2) >>> (24 - (start & 7) - width)) & ((1 << width) - 1);
  }
  function curve(value) {
    if (!Number.isInteger(value) || value < 0 || value > 1023) {
      throw new RangeError('Curve value must be an integer from 0 to 1023.');
    }
    const t = (value - 511) / (value <= 511 ? 511 : 512);
    return t * t * t;
  }
  function statMultiplier(raw) {
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
    return raw < 127 ? (2 / 3) ** ((127 - raw) / 127) : 1.5 ** ((raw - 127) / 128);
  }
  function size(value, min, normal, max) {
    const c = curve(value);
    return normal + c * (c <= 0 ? normal - min : max - normal);
  }
  function grade(value) {
    if (!Number.isInteger(value) || value < 0 || value > 1023) {
      throw new RangeError('Ubuquity rating must be an integer from 0 to 1023.');
    }
    return value < 300 ? 'C' : value < 600 ? 'B' : value < 750 ? 'A' : value < 900 ? 'S' : value < 1000 ? 'S+' : value < 1021 ? 'U' : 'UBU';
  }
  function pairRolls(dna, start) {
    const pairs = read(dna, start, 8);
    const top = (pairs >>> 4) === 15, bottom = (pairs & 15) === 15;
    if (top || bottom) return { active: [top, top, bottom, bottom], source: 'pairs' };
    const indiv = read(dna, start + 8, 16);
    return {
      active: [(indiv >>> 12) === 15, ((indiv >>> 8) & 15) === 15, ((indiv >>> 4) & 15) === 15, (indiv & 15) === 15],
      source: 'individual'
    };
  }
  function eyeGeometry(px, py, lids) {
    const planes = [];
    for (let i = 0; i < 2; i++) {
      const lid = lids[i];
      if (!lid.active) continue;
      const angle = lid.angle * Math.PI / 180, side = i ? 1 : -1;
      planes.push({ nx: -side * Math.sin(angle), ny: side * Math.cos(angle), distance: EYE_RADIUS - lid.depth });
    }
    const length = (px === 0 && py === 0) ? 0 : Math.hypot(px, py);
    let travel = EYE_TRAVEL;
    if (length) for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      const projection = (p.nx * px + p.ny * py) / length;
      if (projection > 0) travel = Math.min(travel, Math.max(0, p.distance - IRIS_RADIUS) / projection);
    }
    const scale = length ? travel * Math.min(1, length) / length : 0;
    return { dx: px === 0 ? 0 : px * scale, dy: py === 0 ? 0 : py * scale, lids, planes };
  }
  // Construct SVG clipping detail only when rendering, not when scoring mint inventory.
  function eyePolygon(eye) {
    let polygon = [[-EYE_RADIUS, -EYE_RADIUS], [EYE_RADIUS, -EYE_RADIUS],
      [EYE_RADIUS, EYE_RADIUS], [-EYE_RADIUS, EYE_RADIUS]];
    for (const p of eye.planes) {
      const clipped = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const da = p.nx * a[0] + p.ny * a[1] - p.distance;
        const db = p.nx * b[0] + p.ny * b[1] - p.distance;
        if (da <= 0) clipped.push(a);
        if ((da <= 0) !== (db <= 0)) {
          const t = da / (da - db);
          clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      polygon = clipped;
    }
    return polygon;
  }
  function decode(dna) {
    checkDNA(dna);
    let nameSeed = 0n;
    for (let i = 0; i < 8; i++) nameSeed = (nameSeed << 8n) | BigInt(dna[i]);
    const attributes = {};
    for (let i = 0; i < 5; i++) {
      const start = 64 + 18 * i;
      const color = read(dna, start, 5);
      const textureIndex = read(dna, start + 13, 5);
      attributes[PARTS[i]] = {
        color, name: PALETTE[color][0], hex: PALETTE[color][1], angle: read(dna, start + 5, 3) * 45,
        texture: read(dna, start + 8, 5) === 31 ? TEXTURES[textureIndex] : null
      };
    }
    const mouthRolls = pairRolls(dna, 154), lidRolls = pairRolls(dna, 258);
    const corners = mouthRolls.active;
    const rawMouth = [178, 188, 198, 208].map(bit => read(dna, bit, 10));
    const rawEyes = [218, 228].map(bit => read(dna, bit, 10));
    const px = curve(rawEyes[0]), py = curve(rawEyes[1]);
    const flipX = read(dna, 238, 10) === 1023, flipY = read(dna, 248, 10) === 1023;
    const rawLids = [282, 292, 302, 312].map(bit => read(dna, bit, 10));
    const angleFlip = read(dna, 322, 10) === 1023, depthFlip = read(dna, 332, 10) === 1023;
    const angles = [curve(rawLids[0]) * 30, curve(rawLids[2]) * 30];
    const depths = [rawLids[1], rawLids[3]].map(v => EYE_TRAVEL * v / 1023);
    // Mirror left-eye lid slopes by default; the rare angle flip cancels that mirroring.
    const makeLids = left => [0, 1].map(i => ({ active: lidRolls.active[i * 2 + (left ? 0 : 1)],
      angle: left && !angleFlip ? -angles[i] : angles[i], depth: depths[left && depthFlip ? 1 - i : i] }));
    const right = eyeGeometry(px, py, makeLids(false));
    const left = eyeGeometry(flipX ? -px : px, flipY ? -py : py, makeLids(true));
    const rating = read(dna, 1014, 10);
    const openingRaw = read(dna, 362, 10);
    const stats = {
      impulse: read(dna, 374, 8),
      traction: read(dna, 382, 8),
      spin: read(dna, 390, 8),
      curve: read(dna, 398, 8),
      size: read(dna, 406, 8),
      mass: read(dna, 414, 8),
      bounciness: read(dna, 422, 8),
      grip: read(dna, 430, 8),
      power: read(dna, 438, 8),
      reach: read(dna, 446, 8),
      strength: read(dna, 454, 8),
      stability: read(dna, 462, 8),
      efficiency: read(dna, 470, 8),
      synergy: read(dna, 478, 8),
      chemistry: read(dna, 486, 8)
    };
    const supers = [read(dna, 494, 4), read(dna, 498, 4), read(dna, 502, 4), read(dna, 506, 4)];
    const personality = {
      aggression: read(dna, 510, 6),
      creativity: read(dna, 516, 6),
      teamwork: read(dna, 522, 6),
      clutch: read(dna, 528, 6)
    };
    const voice = {
      instrument: read(dna, 534, 4),
      pitch: read(dna, 538, 6),
      decay: read(dna, 544, 4),
      timbreMod: read(dna, 548, 2),
      scale: read(dna, 550, 3),
      tempo: read(dna, 553, 3),
      notes: Array.from({ length: 8 }, (_, i) => {
        const raw = read(dna, 556 + i * 5, 5);
        return { degree: raw >> 2, duration: raw & 3 };
      }),
      groove: read(dna, 596, 2)
    };
    return {
      dna: new Uint8Array(dna), nameSeed, parts: ubunym(nameSeed), attributes,
      mouth: {
        raw: rawMouth, corners, source: mouthRolls.source,
        curved: corners.map((active, i) => active && read(dna, 342 + i * 2, 2) === 3),
        lipNotch: read(dna, 350, 6) === 63, horizontalCut: read(dna, 356, 6) === 63,
        notchCurved: read(dna, 350, 6) === 63 && read(dna, 372, 2) === 3,
        openingRaw, openingRatio: .1 + openingRaw / 1023,
        width: size(rawMouth[0], IRIS_RADIUS * 2, 151.915, 250.99),
        height: size(rawMouth[1], 26.50305, 53.0061, 79.50915),
        x: 179.995 + 12 * curve(rawMouth[2]), y: 254.0531 + 12 * curve(rawMouth[3])
      },
      eyes: { raw: rawEyes, dx: right.dx, dy: right.dy, flipX, flipY, leftX: left.dx, leftY: left.dy, left, right },
      eyelids: { raw: rawLids, active: lidRolls.active, source: lidRolls.source, angleFlip, depthFlip },
      stats, supers, personality, voice,
      rating, grade: grade(rating)
    };
  }
  function mouthPath(mouth) {
    const { width, height, corners: [tl, tr, bl, br], curved = [] } = mouth;
    const x = mouth.x - width / 2, y = mouth.y - height / 2;
    const x2 = x + width, y2 = y + height;
    const cut = Math.min(height / 3, width / 3);
    const turn = (i, cx, cy, ex, ey) => curved[i] ? `Q${cx} ${cy} ${ex} ${ey}` : `L${ex} ${ey}`;
    let path = `M${tl ? x + cut : x} ${y}`;
    if (mouth.lipNotch) {
      const c = mouth.x, d = Math.min(height / 4, width / 6);
      path += `L${c - d} ${y}`;
      path += mouth.notchCurved ? `Q${c} ${y + d} ${c + d} ${y}` : `L${c} ${y + d}L${c + d} ${y}`;
    }
    path += `L${tr ? x2 - cut : x2} ${y}`;
    if (tr) path += turn(1, x2, y, x2, y + cut);
    path += `L${x2} ${br ? y2 - cut : y2}`;
    if (br) path += turn(3, x2, y2, x2 - cut, y2);
    path += `L${bl ? x + cut : x} ${y2}`;
    if (bl) path += turn(2, x, y2, x, y2 - cut);
    path += `L${x} ${tl ? y + cut : y}`;
    if (tl) path += turn(0, x, y, x + cut, y);
    path += 'Z';
    if (mouth.horizontalCut) {
      // Saturate at the silhouette edges: oversized openings must not add fill outside it.
      const opening = width * Math.min(1, mouth.openingRatio);
      const a = mouth.x - opening / 2, b = mouth.x + opening / 2;
      const t = mouth.y - height / 8, btm = mouth.y + height / 8;
      path += `M${a} ${t}L${a} ${btm}L${b} ${btm}L${b} ${t}Z`;
    }
    return path;
  }
  const textEncoder = new TextEncoder();
  async function fromText(text) {
    if (typeof text !== 'string') throw new TypeError('Text seed must be a string.');
    const [h1, h2] = await Promise.all([
      root.crypto.subtle.digest('SHA-512', textEncoder.encode(text)),
      root.crypto.subtle.digest('SHA-512', textEncoder.encode(text + '\x01'))
    ]);
    const dna = new Uint8Array(128);
    dna.set(new Uint8Array(h1), 0);
    dna.set(new Uint8Array(h2), 64);
    return dna;
  }
  function randomDNA() {
    return root.crypto.getRandomValues(new Uint8Array(128));
  }
  function toCode(dna) {
    checkDNA(dna);
    return btoa(String.fromCharCode(...dna)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromCode(text) {
    if (typeof text !== 'string') throw new TypeError('DNA code must be a string.');
    if (/^[0-9a-fA-F]{256}$/.test(text)) return Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
    if (!/^[A-Za-z0-9_-]{171}$/.test(text)) throw new Error('Use 171-character base64url DNA or 256 hexadecimal characters.');
    const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='), ch => ch.charCodeAt(0));
    if (toCode(bytes) !== text) throw new Error('DNA has noncanonical padding bits.');
    return bytes;
  }
  const api = { decode, fromText, randomDNA, toCode, fromCode, mouthPath, eyePolygon, grade, curve, statMultiplier, ubunym };
  Object.freeze(api);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubu = api;
})(globalThis);
