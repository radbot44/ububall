/* 512-bit Ubu DNA decoder. See docs/dna.md. */
(function(root) {
  'use strict';
  const V = 'AEIOU';
  const C = 'BCDFGHJKLMNPQRSTVWXYZ';
  const BEFORE_X = 'HLNRSWYXZ';
  const C_NO_X = C.replace('X', '');
  const C_AFTER_VV = C.replace('Y', '');
  const VOWEL_PAIRS = [...V].flatMap(a => [...V].map(b => a + b));
  const PATTERNS = ['CVCVCV', 'CVCVVC', 'CVVCCV', 'CVVCVC', 'VCCVCV', 'VCCVVC', 'VCVCCV', 'VCVCVC'];
  const PAIRS = [C, C.replace(/[HWY]/g, '')].map(starters =>
    [...starters].flatMap(first => [...(BEFORE_X.includes(first) ? C : C_NO_X)].map(second => first + second)));
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
    'velvet', 'frosted', 'terrazzo', 'crackle', 'holographic', 'woodgrain', 'silken', 'lacquered', 'damascus', 'opalescent'];
  const MASK = 0xffffffffffffffffn;
  const EYE_RADIUS = 66.05;
  const IRIS_RADIUS = 30.7126;
  const EYE_TRAVEL = EYE_RADIUS - IRIS_RADIUS;

  function randomForState(state) {
    return () => {
      state = (state + 0x9e3779b97f4a7c15n) & MASK;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      return Number((z ^ (z >> 31n)) >> 11n) / 9007199254740992;
    };
  }
  function patternForLength(length, rand) {
    if (length === 6) return PATTERNS[rand(8)];
    let p = '';
    for (let i = 0; i < Math.floor(length / 2); i++) p += rand(2) === 0 ? 'CV' : 'VC';
    if (length % 2) p += p.endsWith('V') ? 'C' : 'V';
    return p;
  }
  function word(length, random) {
    const rand = n => Math.floor(random() * n);
    const p = patternForLength(length, rand);
    const letters = Array(length);
    for (let i = p.indexOf('VV'); i !== -1; i = p.indexOf('VV', i + 2)) {
      const pair = VOWEL_PAIRS[rand(25)];
      letters[i] = pair[0]; letters[i + 1] = pair[1];
    }
    for (let i = 0; i < length; i++) {
      if (p[i] !== 'V' || letters[i] !== undefined) continue;
      const allowY = i === 0 || i === length - 1 ||
        (p[i - 1] === 'C' && p[i + 1] === 'C' && p[i - 2] !== 'C' && p[i + 2] !== 'C');
      if (allowY) {
        const n = rand(16);
        letters[i] = n === 15 ? 'Y' : V[Math.floor(n / 3)];
      } else letters[i] = V[rand(5)];
    }
    for (let i = p.indexOf('CC'); i !== -1; i = p.indexOf('CC', i + 2)) {
      const pairs = PAIRS[p.slice(i - 2, i) === 'VV' ? 1 : 0];
      const pair = pairs[rand(pairs.length)];
      letters[i] = pair[0]; letters[i + 1] = pair[1];
    }
    for (let i = 0; i < length; i++) {
      if (letters[i] !== undefined) continue;
      const allowed = p.slice(i - 2, i) === 'VV' ? C_AFTER_VV : C;
      letters[i] = allowed[rand(allowed.length)];
    }
    const text = letters.join('');
    return text[0] + text.slice(1).toLowerCase();
  }
  function ubunym(state) {
    const random = randomForState(state);
    const nomen = word(6, random);
    const length = [2, 3, 4, 6][Math.floor(random() * 4)];
    const extra = word(length, random);
    const before = random() < 0.5;
    const opposite = length < 6 ? word(6 - length, random) : '';
    const praenomen = before ? extra : opposite;
    const cognomen = before ? opposite : extra;
    return { praenomen, nomen, cognomen, fullName: [praenomen, nomen, cognomen].filter(Boolean).join(' ') };
  }
  function checkDNA(dna) {
    if (!(dna instanceof Uint8Array) || dna.length !== 64) throw new TypeError('DNA must contain exactly 64 bytes.');
  }
  function read(dna, start, width) {
    let n = 0;
    for (let bit = start; bit < start + width; bit++) n = n * 2 + ((dna[bit >> 3] >> (7 - (bit & 7))) & 1);
    return n;
  }
  function curve(value) {
    const t = (value - 511) / (value <= 511 ? 511 : 512);
    return t * t * t;
  }
  function size(value, min, normal, max) {
    const c = curve(value);
    return normal + c * (c <= 0 ? normal - min : max - normal);
  }
  function grade(value) {
    return value < 300 ? 'C' : value < 600 ? 'B' : value < 750 ? 'A' : value < 900 ? 'S' : value < 1000 ? 'S+' : value < 1021 ? 'U' : 'UBU';
  }
  function pairRolls(dna, start) {
    const top = read(dna, start, 4) === 15, bottom = read(dna, start + 4, 4) === 15;
    const paired = top || bottom;
    return { active: paired ? [top, top, bottom, bottom] :
      [8, 12, 16, 20].map(offset => read(dna, start + offset, 4) === 15), source: paired ? 'pairs' : 'individual' };
  }
  function eyeGeometry(px, py, lids) {
    // Each lid keeps n·point <= distance. Eroding by the iris radius bounds its entire footprint.
    const planes = lids.map((lid, i) => {
      const angle = lid.angle * Math.PI / 180, side = i ? 1 : -1;
      return { nx: -side * Math.sin(angle), ny: side * Math.cos(angle), distance: EYE_RADIUS - lid.depth };
    }).filter((_, i) => lids[i].active);
    const length = Math.hypot(px, py);
    let travel = EYE_TRAVEL;
    if (length) for (const p of planes) {
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
      const textureIndex = read(dna, start + 14, 4);
      attributes[PARTS[i]] = {
        color, name: PALETTE[color][0], hex: PALETTE[color][1], angle: read(dna, start + 5, 3) * 45,
        texture: read(dna, start + 8, 6) === 63 ? TEXTURES[textureIndex] : null
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
    const makeLids = left => [0, 1].map(i => ({ active: lidRolls.active[i * 2 + (left ? 0 : 1)],
      angle: left && angleFlip ? -angles[i] : angles[i], depth: depths[left && depthFlip ? 1 - i : i] }));
    const right = eyeGeometry(px, py, makeLids(false));
    const left = eyeGeometry(flipX ? -px : px, flipY ? -py : py, makeLids(true));
    const rating = read(dna, 502, 10);
    const openingRaw = read(dna, 362, 10);
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
  async function fromText(text) {
    return new Uint8Array(await root.crypto.subtle.digest('SHA-512', new TextEncoder().encode(text)));
  }
  function randomDNA() {
    return root.crypto.getRandomValues(new Uint8Array(64));
  }
  function toCode(dna) {
    checkDNA(dna);
    return btoa(String.fromCharCode(...dna)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromCode(text) {
    if (/^[0-9a-fA-F]{128}$/.test(text)) return Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
    if (!/^[A-Za-z0-9_-]{86}$/.test(text)) throw new Error('Use 86-character base64url DNA or 128 hexadecimal characters.');
    const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '=='), ch => ch.charCodeAt(0));
    if (toCode(bytes) !== text) throw new Error('DNA has noncanonical padding bits.');
    return bytes;
  }
  const api = { decode, fromText, randomDNA, toCode, fromCode, mouthPath, eyePolygon, grade, curve, ubunym };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubu = api;
})(globalThis);
