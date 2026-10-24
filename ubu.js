/* Ubu DNA decoder. Preview implementation: appearance is not frozen yet. */
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
  const TEXTURES = ['metallic', 'glossy', 'matte', 'crystalline'];
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
    if (!(dna instanceof Uint8Array) || dna.length !== 32) throw new TypeError('DNA must contain exactly 32 bytes.');
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
    return value < 125 ? 'B' : value < 200 ? 'A' : value < 225 ? 'A+' : value < 240 ? 'S' : value < 251 ? 'S+' : 'S++';
  }
  function decode(dna) {
    checkDNA(dna);
    let nameSeed = 0n;
    for (let i = 0; i < 8; i++) nameSeed = (nameSeed << 8n) | BigInt(dna[i]);
    const attributes = {};
    for (let i = 0; i < 5; i++) {
      const start = 64 + 16 * i;
      const color = read(dna, start, 5);
      const flags = read(dna, start + 12, 4);
      const textureIndex = flags === 8 ? 0 : flags === 4 ? 1 : flags === 2 ? 2 : flags === 1 ? 3 : -1;
      attributes[PARTS[i]] = {
        color, name: PALETTE[color][0], hex: PALETTE[color][1], angle: read(dna, start + 5, 3) * 45,
        texture: read(dna, start + 8, 4) === 15 && textureIndex >= 0 ? TEXTURES[textureIndex] : null
      };
    }
    const top = read(dna, 144, 4) === 15;
    const bottom = read(dna, 148, 4) === 15;
    const paired = top || bottom;
    const corners = paired ? [top, top, bottom, bottom] : [152, 156, 160, 164].map(bit => read(dna, bit, 4) === 15);
    const rawMouth = [168, 178, 188, 198].map(bit => read(dna, bit, 10));
    const rawEyes = [208, 218].map(bit => read(dna, bit, 10));
    let dx = EYE_TRAVEL * curve(rawEyes[0]);
    let dy = EYE_TRAVEL * curve(rawEyes[1]);
    // Radial containment preserves tangency at single-axis extremes.
    const distance = Math.hypot(dx, dy);
    if (distance > EYE_TRAVEL) {
      dx *= EYE_TRAVEL / distance;
      dy *= EYE_TRAVEL / distance;
    }
    const flipX = read(dna, 228, 10) === 1023;
    const flipY = read(dna, 238, 10) === 1023;
    const rating = dna[31];
    return {
      dna: new Uint8Array(dna), nameSeed, parts: ubunym(nameSeed), attributes,
      mouth: {
        raw: rawMouth, corners, source: paired ? 'pairs' : 'individual',
        width: size(rawMouth[0], IRIS_RADIUS * 2, 151.915, 250.99),
        height: size(rawMouth[1], 26.50305, 53.0061, 79.50915),
        x: 179.995 + 12 * curve(rawMouth[2]), y: 254.0531 + 12 * curve(rawMouth[3])
      },
      eyes: { raw: rawEyes, dx, dy, flipX, flipY, leftX: dx === 0 ? 0 : flipX ? -dx : dx, leftY: dy === 0 ? 0 : flipY ? -dy : dy },
      rating, grade: grade(rating)
    };
  }
  function mouthPath(mouth) {
    const { width, height, corners: [tl, tr, bl, br] } = mouth;
    const x = mouth.x - width / 2, y = mouth.y - height / 2;
    const x2 = x + width, y2 = y + height;
    const cut = Math.min(height / 3, width / 2);
    const points = [[tl ? x + cut : x, y], [tr ? x2 - cut : x2, y]];
    if (tr) points.push([x2, y + cut]);
    points.push([x2, br ? y2 - cut : y2]);
    if (br) points.push([x2 - cut, y2]);
    points.push([bl ? x + cut : x, y2]);
    if (bl) points.push([x, y2 - cut]);
    points.push([x, tl ? y + cut : y]);
    return 'M' + points.map(point => point.join(' ')).join('L') + 'Z';
  }
  async function fromText(text) {
    return new Uint8Array(await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  }
  function randomDNA() {
    return root.crypto.getRandomValues(new Uint8Array(32));
  }
  function toCode(dna) {
    checkDNA(dna);
    return btoa(String.fromCharCode(...dna)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromCode(text) {
    if (/^[0-9a-fA-F]{64}$/.test(text)) return Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
    if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error('Use 43-character base64url DNA or 64 hexadecimal characters.');
    const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='), ch => ch.charCodeAt(0));
    if (toCode(bytes) !== text) throw new Error('DNA has noncanonical padding bits.');
    return bytes;
  }
  const api = { decode, fromText, randomDNA, toCode, fromCode, mouthPath, grade, curve, ubunym };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ubu = api;
})(globalThis);
