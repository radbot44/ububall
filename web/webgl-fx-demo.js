/* Standalone interactive WebGL2 Effects Showcase (local bench server only). */
(async function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const P = ububallPhysics;
  const M = ububallMatch;
  const Pres = ububallPresentation;
  const {
    MATERIAL_STYLES,
    SUPER_AURA_THEMES,
    createEffectsState,
    createMaterialEmitters,
    heatColor,
    drawRinkSurface,
    drawBallFace
  } = Pres;

  const GLINT_MATERIALS = new Set([
    'starfield', 'holographic', 'quartz', 'opalescent', 'kintsugi', 'lava', 'frosted', 'iridescent', 'crystalline', 'metallic', 'circuitry'
  ]);

  const TOGGLE_DEFS = [
    { key: 'warp', label: 'Heat Devil Warp', desc: 'Tuned low ambient shimmer + brief full-strength impact flare' },
    { key: 'shockWarp', label: '#1 Shockwave & KO Warps', desc: 'Expanding radial space-warp rings on Shockwave, KO & Cannonball' },
    { key: 'chroma', label: '#2 Chromatic Dispersion', desc: 'Subtle 1-2px RGB split on peak impact & shockwave distortion' },
    { key: 'netWarp', label: '#3 Burning Net Shimmer', desc: 'Rising convective heat distortion over lit goal pocket' },
    { key: 'ghostWarp', label: '#4 Ghost Phase Ripple', desc: 'Cyan spectral ripple in sceneTex during Ghost pass-through' },
    { key: 'bloom', label: '#5 Multi-Pass Bloom', desc: 'Half/quarter-res emissive blur composited additively' },
    { key: 'conicShader', label: '#6 Shader Conic Auras', desc: 'Analytic rotating super rings + corona (no 2D canvas bake)' },
    { key: 'flameShader', label: '#12 Fireball Plume Shader', desc: 'Procedural turbulent flame tail & corona behind hot ball' },
    { key: 'trailShader', label: '#13 Feathered Motion Trails', desc: 'Soft-edged trails with animated speed & heat streaks' },
    { key: 'glintShader', label: '#14 Glinting Material Particles', desc: '4-point twinkling starburst glints on rare finishes' }
  ];

  const fxFlags = {
    warp: true,
    shockWarp: true,
    chroma: true,
    netWarp: true,
    ghostWarp: true,
    bloom: true,
    conicShader: true,
    flameShader: false,
    trailShader: true,
    glintShader: true,
    oldHeatMode: false
  };

  let bloomGain = 0.5;
  let ambientHeat = 0.20;
  let density = 1.5;
  let speedScale = 1.0;
  let paused = false;
  let activeScene = 'heat';

  // --- Shaders ---
  const BATCH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;
layout(location = 3) in vec4 a_ext;
layout(location = 4) in vec2 a_aux;
uniform vec4 u_view;
out vec2 v_fieldPos;
out vec2 v_uv;
out vec4 v_color;
out vec4 v_ext;
out vec2 v_aux;
void main() {
  v_fieldPos = a_pos;
  v_uv = a_uv;
  v_color = a_color;
  v_ext = a_ext;
  v_aux = a_aux;
  vec2 ndc = (a_pos - u_view.zw) / u_view.xy * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

  const BATCH_FRAG = `#version 300 es
precision highp float;
in vec2 v_fieldPos;
in vec2 v_uv;
in vec4 v_color;
in vec4 v_ext;
in vec2 v_aux;
uniform float u_pxScale;
uniform float u_time;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform sampler2D u_tex4;
uniform sampler2D u_tex5;
uniform sampler2D u_tex6;
uniform sampler2D u_tex7;
out vec4 outColor;

vec4 sampleSlot(int slot, vec2 uv) {
  switch (slot) {
    case 0: return texture(u_tex0, uv);
    case 1: return texture(u_tex1, uv);
    case 2: return texture(u_tex2, uv);
    case 3: return texture(u_tex3, uv);
    case 4: return texture(u_tex4, uv);
    case 5: return texture(u_tex5, uv);
    case 6: return texture(u_tex6, uv);
    default: return texture(u_tex7, uv);
  }
}

float rinkSignedDist(vec2 p) {
  vec2 rq = abs(p - vec2(500.0, 300.0)) - vec2(340.0, 140.0);
  return length(max(rq, 0.0)) + min(max(rq.x, rq.y), 0.0) - 100.0;
}

vec3 unpack6bitColor(float packed) {
  float ip = floor(packed + 0.5);
  float r = floor(ip / 4096.0);
  float rem = ip - r * 4096.0;
  float g = floor(rem / 64.0);
  float b = rem - g * 64.0;
  return vec3(r, g, b) / 63.0;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  return 0.58 * vnoise(p) + 0.29 * vnoise(p * 2.13 + 3.7) + 0.13 * vnoise(p * 4.41 - 1.9);
}

void main() {
  int clipMode = int(v_aux.x + 0.5);
  float clipMask = 1.0;
  if (clipMode > 0) {
    float dClip = rinkSignedDist(v_fieldPos);
    clipMask = 1.0 - smoothstep(-0.5 * u_pxScale, 0.5 * u_pxScale, dClip);
    if (clipMask <= 0.001) discard;
  }

  int mode = int(v_ext.x + 0.5);
  if (mode == 0) {
    outColor = v_color * clipMask;
    return;
  }

  if (mode == 1) {
    vec4 tex = sampleSlot(int(v_ext.y + 0.5), v_uv);
    float stun = v_ext.z;
    if (stun > 0.001) {
      float luma = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
      tex.rgb = mix(tex.rgb, vec3(luma), 0.8 * stun) * mix(1.0, 0.7, stun);
    }
    outColor = tex * v_color * clipMask;
    return;
  }

  if (mode == 2) {
    float dist = length(v_uv);
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(dist));
    float outerA = 1.0 - smoothstep(v_ext.z - aa, v_ext.z + aa, dist);
    float innerA = v_ext.y > 0.0 ? smoothstep(v_ext.y - aa, v_ext.y + aa, dist) : 1.0;
    float mask = outerA * innerA;
    if (v_ext.w > 0.0 && mask > 0.001) {
      float ang = atan(v_uv.y, v_uv.x);
      if (ang < 0.0) ang += 6.28318530718;
      float midR = max(1.0, 0.5 * (v_ext.y + v_ext.z));
      float period = v_ext.w;
      float dashLen = v_aux.y;
      float local = mod(ang * midR, period);
      float dashMask = local <= dashLen ? 1.0 : 0.0;
      mask *= dashMask;
    }
    if (mask <= 0.001) discard;
    outColor = v_color * (mask * clipMask);
    return;
  }

  if (mode == 4) {
    float segLen = v_ext.y;
    float halfW = v_ext.z;
    float cx = clamp(v_uv.x, 0.0, segLen);
    float d = v_ext.w < -0.5
      ? length(max(abs(vec2(v_uv.x - 0.5 * segLen, v_uv.y)) - vec2(0.5 * segLen, halfW), 0.0))
      : length(vec2(v_uv.x - cx, v_uv.y)) - halfW;
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(d));
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.001) discard;
    outColor = v_color * (mask * clipMask);
    return;
  }

  if (mode == 5) {
    float r = length(v_uv);
    if (r >= 1.0) discard;
    bool isBurn = v_ext.y > 0.5;
    float fade = clamp(v_ext.z, 0.0, 1.0);
    float s = 1.0 - r;
    float along = v_color.r;
    float pace = clamp(v_color.g, 0.0, 1.0);
    float intensity = clamp(v_color.b, 0.0, 1.0);
    float emberHeat = clamp(v_color.a, 0.0, 1.0);
    float nMacro = vnoise(v_fieldPos * 0.042);
    float nCoarse = vnoise(v_fieldPos * 0.105 + vec2(11.7, 5.3));
    float nMid = vnoise(v_fieldPos * 0.24 + vec2(17.3, 9.1));
    float nFine = vnoise(v_fieldPos * 0.54 + vec2(4.2, 23.7));
    float edgeNoise = (nMacro * 0.52 + nCoarse * 0.34 + nMid * 0.14) - 0.55;
    float edgeAmp = isBurn ? mix(0.08, 0.34, 1.0 - intensity) : mix(0.14, 0.38, intensity);
    float sWarp = clamp(s + edgeNoise * edgeAmp * smoothstep(0.0, 0.34, s), 0.0, 1.0);
    float prof = smoothstep(0.0, 0.94, sWarp) * (0.34 + 0.66 * smoothstep(0.06, 0.86, sWarp));
    float alpha;
    vec3 rgb;
    if (isBurn) {
      float mess = 1.0 - intensity;
      float mottleVar = mix(0.10, 0.46, mess);
      float mottle = (0.99 - mottleVar * 0.5) + mottleVar * (nMacro * 0.45 + nCoarse * 0.38 + nMid * 0.17);
      float grainVar = mix(0.04, 0.16, mess);
      float emberGrain = (1.0 - grainVar * 0.5) + grainVar * nFine;
      float nSpeckA = vnoise(v_fieldPos * 0.95 + vec2(31.4, 14.2));
      float nSpeckB = vnoise(v_fieldPos * 1.65 + vec2(7.8, 41.9));
      float speck = smoothstep(0.45, 0.68, nSpeckA * nSpeckB + (nCoarse - 0.5) * 0.10) * smoothstep(0.08, 0.56, sWarp) * mix(0.22, 1.15, mess);
      float paceAlpha = mix(0.92, 1.16, pace);
      float paceShade = mix(1.06, 0.78, pace);
      alpha = 0.357 * fade * prof * mottle * emberGrain * (1.0 + speck * 0.42) * paceAlpha;
      float charNoise = ((nCoarse - 0.5) * 0.28 + (nMid - 0.5) * 0.14) * mix(0.30, 1.15, mess);
      float charMix = clamp(smoothstep(0.12, 0.92, sWarp) + charNoise, 0.0, 1.0);
      rgb = mix(vec3(0.177, 0.071, 0.024), vec3(0.080, 0.033, 0.010), charMix) * paceShade;
      rgb = mix(rgb, vec3(0.012, 0.006, 0.003), min(1.0, speck * 0.88));
      if (emberHeat > 0.001) {
        float glowCurve = emberHeat * emberHeat;
        float fissure = (0.35 + 0.65 * nCoarse) * (0.40 + 0.60 * (1.0 - min(1.0, speck)));
        float emberGlow = glowCurve * smoothstep(0.20, 0.88, sWarp) * fissure;
        rgb = mix(rgb, vec3(0.64, 0.15, 0.025), clamp(emberGlow * 0.24, 0.0, 0.22));
        alpha += emberGlow * 0.03 * fade;

        float nGlintA = vnoise(v_fieldPos * 1.15 + vec2(43.1, 19.7));
        float nGlintB = vnoise(v_fieldPos * 1.95 + vec2(11.3, 57.9));
        float flicker = 0.70 + 0.30 * sin(u_time * 16.0 + nMacro * 14.0 + nCoarse * 9.0);
        float sparkDot = smoothstep(0.55, 0.72, nGlintA * nGlintB + (nFine - 0.5) * 0.14) * smoothstep(0.10, 0.68, sWarp);
        float sparkGlow = sparkDot * emberHeat * (0.45 + 0.55 * glowCurve) * flicker;
        rgb = mix(rgb, vec3(1.0, 0.60, 0.14), clamp(sparkGlow * 1.35, 0.0, 0.90));
        alpha += sparkGlow * 0.38 * fade;
      }
    } else {
      float tear = intensity;
      float nTrack = vnoise(vec2(along * 0.028 + nMacro * 0.55, r * 7.2 + nCoarse * 0.9));
      float nTrackFine = vnoise(vec2(along * 0.065 + nMid * 0.40, r * 13.5 + nCoarse * 0.7));
      float trackMix = nTrack * 0.65 + nTrackFine * 0.35;
      float striation = mix(0.80, 0.62, tear) + mix(0.38, 0.76, tear) * trackMix;
      float scrapeMix = nMacro * 0.35 + nMid * 0.35 + nFine * 0.30;
      float scrape = mix(0.90, 0.72, tear) + mix(0.20, 0.54, tear) * scrapeMix;
      alpha = mix(0.135, 0.215, tear) * fade * prof * striation * scrape;
      rgb = vec3(0.0);
    }
    float outA = clamp(alpha, 0.0, 1.0) * clipMask;
    if (outA <= 0.001) discard;
    outColor = vec4(rgb * outA, outA);
    return;
  }

  if (mode == 7) {
    // #6 Shader-Native Super Aura & Conic Ring
    // v_uv = offset, ext.y = ringR, ext.z = halfW, ext.w = level(1/2), color = c1, aux.y = packed c2
    float dist = length(v_uv);
    float ringR = v_ext.y;
    float halfW = v_ext.z;
    float level = v_ext.w;
    vec3 c1 = v_color.rgb;
    vec3 c2 = unpack6bitColor(v_aux.y);
    float ang = atan(v_uv.y, v_uv.x);
    float spin = u_time * (0.65 + level * 1.35);

    // Outer soft corona
    float coronaDist = abs(dist - ringR);
    float corona = exp(-coronaDist * coronaDist / (level > 1.5 ? 95.0 : 52.0)) * (level > 1.5 ? 0.42 : 0.22);
    vec3 colSum = mix(c1, c2, 0.5 + 0.5 * sin(ang * 2.0 - spin)) * corona;
    float aSum = corona * v_color.a;

    // Primary conic ring
    float phase1 = fract((ang - spin) / 6.28318530718);
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(dist));
    float ringMask = 1.0 - smoothstep(halfW - aa, halfW + aa, abs(dist - ringR));
    float sweep1 = smoothstep(0.08, 0.96, phase1);
    vec3 ringCol = mix(c2, c1, sweep1);
    float head1 = smoothstep(0.88, 1.0, phase1);
    ringCol = mix(ringCol, vec3(1.0), head1 * 0.72);
    float ringAlpha = ringMask * (0.18 + 0.82 * sweep1) * v_color.a;
    colSum += ringCol * ringAlpha;
    aSum = max(aSum, ringAlpha);

    // Counter-rotating secondary harmonic ring when armed/active
    if (level > 1.5) {
      float outerR = ringR + 5.2;
      float phase2 = fract((ang + spin * 1.15) / 6.28318530718);
      float ring2 = 1.0 - smoothstep(halfW * 0.72 - aa, halfW * 0.72 + aa, abs(dist - outerR));
      float sweep2 = smoothstep(0.15, 0.98, phase2);
      vec3 r2Col = mix(c1, c2, sweep2);
      r2Col = mix(r2Col, vec3(1.0), smoothstep(0.91, 1.0, phase2) * 0.65);
      float a2 = ring2 * (0.12 + 0.75 * sweep2) * v_color.a;
      colSum += r2Col * a2;
      aSum = max(aSum, a2);
    }

    if (aSum <= 0.002) discard;
    outColor = vec4(colSum * clipMask, aSum * clipMask);
    return;
  }

  if (mode == 8) {
    // #12 Procedural Fireball Plume & Corona
    // v_uv.x: 0 (ball center) -> 1 (tail tip), v_uv.y: -1..1 across
    float u = v_uv.x;
    float v = v_uv.y;
    float intensity = clamp(v_ext.y, 0.0, 1.5);
    float seed = v_ext.z;
    if (u < -0.25 || u > 1.0) discard;

    float headMask = exp(-((u * u) / 0.045 + (v * v) / 0.24));
    float taper = max(0.08, (1.0 - max(0.0, u)) * 0.92 + 0.08);
    float vNorm = abs(v) / taper;
    float turb = fbm(vec2(u * 5.2 - u_time * 10.5 + seed, v * 3.8 + u_time * 2.1));
    float turb2 = fbm(vec2(u * 9.5 - u_time * 16.0 - seed, v * 6.5));
    float flameShape = (1.0 - smoothstep(0.18, 0.96, vNorm + (turb - 0.45) * 0.65)) * (1.0 - smoothstep(0.12, 1.0, max(0.0, u)));
    float plume = max(headMask * 0.95, flameShape * (0.55 + 0.75 * turb2));
    plume *= intensity;
    if (plume <= 0.01) discard;

    vec3 cRed = vec3(0.95, 0.18, 0.04);
    vec3 cOrg = vec3(1.00, 0.48, 0.08);
    vec3 cGold = vec3(1.00, 0.84, 0.26);
    vec3 cCore = vec3(1.00, 0.97, 0.82);
    float temp = clamp(plume * (1.15 - u * 0.55), 0.0, 1.0);
    vec3 rgb = temp < 0.35
      ? mix(cRed, cOrg, temp / 0.35)
      : (temp < 0.72 ? mix(cOrg, cGold, (temp - 0.35) / 0.37) : mix(cGold, cCore, (temp - 0.72) / 0.28));
    float a = clamp(plume, 0.0, 1.0) * v_color.a * clipMask;
    outColor = vec4(rgb * a, a);
    return;
  }

  if (mode == 9) {
    // #13 Feathered & Turbulent Motion Trails
    // v_uv.x = alongU (0..1), v_uv.y = acrossV (-1..1), v_ext.y = heat
    float signedAcross = clamp(v_uv.y, -1.0, 1.0);
    float tail = 1.0 - clamp(v_uv.x, 0.0, 1.0);
    float heat = v_ext.y;
    float hot = clamp(heat / 1.5, 0.0, 1.35);
    float flowRate = mix(5.5, 13.5, clamp(hot, 0.0, 1.0));
    float turbMacro = vnoise(vec2(v_uv.x * 5.2 - u_time * flowRate, signedAcross * 2.4 + v_fieldPos.y * 0.015));
    float turbFine = vnoise(vec2(v_uv.x * 11.5 - u_time * (flowRate * 1.45), signedAcross * 4.8 + v_fieldPos.x * 0.02));
    float warpAmt = (0.09 + 0.22 * hot) * smoothstep(0.05, 0.85, tail);
    float acrossWarped = clamp(abs(signedAcross + (turbMacro - 0.5) * warpAmt * 2.0), 0.0, 1.0);
    float feather = pow(1.0 - smoothstep(0.0, 1.0, acrossWarped), mix(1.30, 1.55, clamp(hot, 0.0, 1.0)));
    float filaments = mix(0.84, 0.56, clamp(hot, 0.0, 1.0)) + mix(0.24, 0.72, clamp(hot, 0.0, 1.0)) * (turbMacro * 0.58 + turbFine * 0.42);
    float wispClip = heat > 1.0 ? smoothstep(0.08 * tail * hot, 0.35 + 0.25 * tail, turbFine * 0.65 + (1.0 - acrossWarped) * 0.55) : 1.0;
    float mask = feather * filaments * wispClip * clipMask;
    if (mask <= 0.002) discard;
    vec4 col = v_color * mask;
    if (heat > 1.4) {
      float coreHeat = smoothstep(1.4, 2.2, heat) * (1.0 - acrossWarped) * (0.65 + 0.55 * turbFine);
      col.rgb += vec3(0.40, 0.19, 0.04) * coreHeat * v_color.a * mask;
    }
    outColor = col;
    return;
  }

  if (mode == 10) {
    // #14 Geometric 4-point Diamond Starburst Glint
    // v_uv in [-1..1], v_ext.y = phase
    vec2 p = v_uv;
    float r = length(p);
    if (r >= 1.0) discard;
    float twinkle = 0.65 + 0.35 * sin(u_time * 10.0 + v_ext.y);
    vec2 ap = abs(p);
    // Crisp concave geometric 4-point diamond SDF
    float star = pow(ap.x, 0.58) + pow(ap.y, 0.58);
    float outer = 1.0 - smoothstep(0.76, 0.96, star);
    float inner = 1.0 - smoothstep(0.28, 0.48, star);
    float mask = outer * twinkle;
    if (mask <= 0.01) discard;
    vec3 rgb = mix(v_color.rgb, vec3(1.0), clamp(inner * 0.95, 0.0, 1.0));
    float a = mask * v_color.a * clipMask;
    outColor = vec4(rgb * a, a);
    return;
  }

  outColor = v_color * clipMask;
}`;

  const WARP_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_unit;
uniform vec4 u_quad;
out vec2 v_fieldPos;
void main() {
  vec2 pos = u_quad.xy + a_unit * u_quad.zw;
  v_fieldPos = pos;
  vec2 ndc = pos / vec2(1000.0, 600.0) * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

  const WARP_FRAG = `#version 300 es
precision highp float;
in vec2 v_fieldPos;
uniform sampler2D u_scene;
uniform int u_count;
uniform vec4 u_src[6];   // xy = center, z = radius, w = strength
uniform vec4 u_meta[6];  // x = time, y = kind (0=heat,1=shock,2=ghost), z = isImpact/sub, w = chromaWeight
uniform float u_enableChroma;
out vec4 outColor;

float rinkDomainDist(vec2 p) {
  vec2 rq = abs(p - vec2(500.0, 300.0)) - vec2(340.0, 140.0);
  float dRink = length(max(rq, 0.0)) + min(max(rq.x, rq.y), 0.0) - 100.0;
  vec2 gqL = abs(p - vec2(40.0, 300.0)) - vec2(38.0, 92.0);
  float dGoalL = length(max(gqL, 0.0)) + min(max(gqL.x, gqL.y), 0.0);
  vec2 gqR = abs(p - vec2(960.0, 300.0)) - vec2(38.0, 92.0);
  float dGoalR = length(max(gqR, 0.0)) + min(max(gqR.x, gqR.y), 0.0);
  return min(dRink, min(dGoalL, dGoalR));
}

void computeDisp(vec2 p, vec4 src, vec4 meta, out vec2 disp, out float chroma, out float cyanTint) {
  disp = vec2(0.0);
  chroma = 0.0;
  cyanTint = 0.0;
  vec2 rel = p - src.xy;
  float rMax = src.z;
  float strength = src.w;
  float t = meta.x;
  int kind = int(meta.y + 0.5);
  float sub = meta.z;
  float dist = length(rel);
  if (dist >= rMax * 1.24 || strength <= 0.001) return;

  vec2 radial = dist > 0.001 ? rel / dist : vec2(0.0, -1.0);

  if (kind == 1) {
    // #1 Shockwave / Knockout expanding radial space-warp wavefront
    float normR = dist / max(1.0, rMax);
    float wavePos = 0.14 + 0.76 * t;
    float delta = normR - wavePos;
    float bandW = sub > 0.5 ? 28.0 : 42.0; // tighter punch for KO, broader for Shockwave
    float ring = exp(-delta * delta * bandW);
    float env = (1.0 - smoothstep(0.75, 1.15, normR)) * ring;
    float push = (delta >= 0.0 ? -1.0 : 1.0) * 14.0 * env + sin(delta * 26.0) * 4.5 * env;
    disp = radial * (push - env * 9.5) * strength;
    chroma = env * strength * meta.w;
    return;
  }

  if (kind == 2) {
    // #4 Ghost phase-shift crisp geometric concentric spectral rings + ice/skater pinch
    float ringR = (0.14 + 0.86 * t) * rMax;
    float band = 1.0 - smoothstep(2.5, 9.5, abs(dist - ringR));
    float band2 = (1.0 - smoothstep(2.0, 7.5, abs(dist - ringR * 0.62))) * 0.72;
    float fade = 1.0 - smoothstep(0.62, 1.0, t);
    disp = radial * (band * 18.0 - band2 * 11.0) * fade * strength;
    cyanTint = (band * 0.85 + band2 * 0.55) * fade * strength;
    chroma = (band + band2) * fade * meta.w * 1.8;
    return;
  }

  // kind == 0: Heat Devil (normal ball shimmer, impact flare, or burning net shimmer)
  if (sub > 1.5) {
    // #3 Burning Net rising convective shimmer across mouth, crease, net frame & pocket
    vec2 boxRel = rel / vec2(max(1.0, rMax * 0.78), max(1.0, rMax));
    float bDist = length(boxRel);
    if (bDist >= 1.15) return;
    float env = 1.0 - smoothstep(0.25, 1.12, bDist);
    vec2 flow = vec2(
      sin(rel.y * 0.19 + t * 14.0 + sin(rel.x * 0.14 - t * 6.0)) * 1.15 + 0.48 * cos(rel.y * 0.34 + t * 21.0),
      cos(rel.x * 0.22 - t * 10.5) * 0.55
    );
    disp = flow * 11.5 * strength * env;
    disp.y += 4.2 * strength * env;
    chroma = env * strength * meta.w * 0.75;
    return;
  }

  float ang = atan(rel.y, rel.x);
  float lobe = 1.0 + 0.16 * sin(ang * 3.0 + t * 5.1) + 0.10 * cos(ang * 2.0 - t * 3.6);
  float effU = dist / max(1.0, rMax * lobe);
  if (effU >= 1.0) return;
  float env = 1.0 - smoothstep(0.24, 1.0, effU);
  bool isImpact = sub > 0.5;

  if (isImpact) {
    float ringPos = 0.25 + 0.58 * t;
    float ringDelta = (dist / max(1.0, rMax)) - ringPos;
    float shock = exp(-ringDelta * ringDelta * 24.0) * (1.0 - t * 0.65);
    float coreZoom = 0.20 * cos(t * 4.71238898);
    disp -= radial * (shock * 11.0 + dist * coreZoom * env) * strength;
  } else {
    float zoom = (0.20 + 0.08 * sin(t * 5.8)) * env;
    disp -= rel * zoom * strength;
    disp.y += (3.4 + 2.0 * sin(t * 5.5)) * env * strength;
  }

  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float swirlSpeed = isImpact ? 11.5 : 6.5;
    float dir = k == 0 ? 1.0 : -1.0;
    float orbitAng = fk * 3.14159265 + t * swirlSpeed * (k == 0 ? 1.0 : 0.82);
    float orbitR = rMax * (0.34 + 0.22 * sin(t * 5.2 + fk * 1.8));
    float updraft = isImpact ? 0.0 : (sin(t * 6.5 + fk * 2.0) * 0.18 - 0.09) * rMax;
    vec2 eddyPos = src.xy + vec2(cos(orbitAng) * orbitR, sin(orbitAng) * orbitR * 0.86 + updraft);
    float eddyR = rMax * (isImpact ? 0.40 + 0.12 * cos(t * 7.0 + fk) : 0.45 + 0.11 * sin(t * 4.5 + fk));
    vec2 eRel = p - eddyPos;
    float eDist = length(eRel);
    if (eDist < eddyR) {
      float eEnv = 1.0 - smoothstep(0.12, 1.0, eDist / max(1.0, eddyR));
      vec2 eTan = vec2(-eRel.y, eRel.x) / max(4.0, eDist) * dir;
      float eZoom = (isImpact ? 0.18 : 0.16) * (0.85 + 0.35 * sin(t * 6.8 + fk * 1.5));
      disp += (-eRel * eZoom + eTan * (isImpact ? 7.5 : 6.8)) * strength * eEnv;
    }
  }

  vec2 flow = vec2(
    sin(rel.y * 0.20 - t * 13.0 + sin(rel.x * 0.13 + t * 5.5)) + 0.55 * sin(rel.y * 0.36 - t * 18.5 + rel.x * 0.18),
    cos(rel.x * 0.18 - t * 10.5 + cos(rel.y * 0.14 - t * 7.0)) * 0.72
  );
  disp += flow * (isImpact ? 4.8 : 5.4) * strength * env;
  chroma = env * strength * meta.w;
}

void main() {
  float dHere = rinkDomainDist(v_fieldPos);
  float inDomain = 1.0 - smoothstep(-1.5, 0.5, dHere);
  vec2 totalDisp = vec2(0.0);
  float totalChroma = 0.0;
  float totalCyan = 0.0;

  if (inDomain > 0.001) {
    for (int i = 0; i < 6; i++) {
      if (i >= u_count) break;
      vec2 d; float ch; float cy;
      computeDisp(v_fieldPos, u_src[i], u_meta[i], d, ch, cy);
      totalDisp += d;
      totalChroma += ch;
      totalCyan += cy;
    }
    totalDisp *= inDomain;
  }

  vec2 samplePos = v_fieldPos + totalDisp;
  if (rinkDomainDist(samplePos) > -0.5) {
    samplePos = mix(v_fieldPos, samplePos, 0.25);
    if (rinkDomainDist(samplePos) > 0.0) samplePos = v_fieldPos;
  }

  vec2 uv = vec2(samplePos.x / 1000.0, 1.0 - samplePos.y / 600.0);
  uv = clamp(uv, vec2(0.0005), vec2(0.9995));

  if (u_enableChroma > 0.5 && totalChroma > 0.05) {
    vec2 delta = (samplePos - v_fieldPos) / vec2(1000.0, 600.0);
    float dLen = length(delta);
    vec2 dir = dLen > 0.00001 ? delta / dLen : vec2(1.0, 0.0);
    float split = min(0.0028, dLen * 0.22 * clamp(totalChroma, 0.0, 1.5));
    float r = texture(u_scene, clamp(uv + dir * split, vec2(0.0005), vec2(0.9995))).r;
    vec4 gSample = texture(u_scene, uv);
    float b = texture(u_scene, clamp(uv - dir * split, vec2(0.0005), vec2(0.9995))).b;
    outColor = vec4(r, gSample.g, b, gSample.a);
  } else {
    outColor = texture(u_scene, uv);
  }

  if (totalCyan > 0.005) {
    outColor.rgb += vec3(0.20, 0.90, 1.0) * min(0.58, totalCyan) * outColor.a;
  }
}`;

  const FULLSCREEN_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_unit;
out vec2 v_uv;
void main() {
  v_uv = a_unit;
  gl_Position = vec4(a_unit * 2.0 - 1.0, 0.0, 1.0);
}`;

  const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_dir;
out vec4 outColor;
void main() {
  vec2 step = u_texel * u_dir;
  vec4 c = texture(u_tex, v_uv) * 0.227027;
  c += texture(u_tex, v_uv + step * 1.384615) * 0.316216;
  c += texture(u_tex, v_uv - step * 1.384615) * 0.316216;
  c += texture(u_tex, v_uv + step * 3.230769) * 0.070270;
  c += texture(u_tex, v_uv - step * 3.230769) * 0.070270;
  outColor = c;
}`;

  const BLOOM_COMP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_bloom;
uniform float u_gain;
out vec4 outColor;
void main() {
  vec4 b = texture(u_bloom, v_uv);
  outColor = vec4(b.rgb * u_gain, 0.0);
}`;

  // --- Color parser ---
  const colorCache = new Map();
  function parseColor(str) {
    if (!str) return [1, 1, 1, 1];
    const hit = colorCache.get(str);
    if (hit) return hit;
    let out = [1, 1, 1, 1];
    const s = String(str).trim();
    if (s[0] === '#') {
      const hex = s.slice(1);
      if (hex.length === 6 || hex.length === 8) {
        out = [
          parseInt(hex.slice(0, 2), 16) / 255,
          parseInt(hex.slice(2, 4), 16) / 255,
          parseInt(hex.slice(4, 6), 16) / 255,
          hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
        ];
      }
    } else if (s.startsWith('rgb')) {
      const m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        out = [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255, m[3] != null ? Number(m[3]) : 1];
      }
    } else if (s.startsWith('hsl')) {
      const m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        const h = ((Number(m[0]) % 360) + 360) % 360 / 60;
        const sat = Number(m[1]) / 100, l = Number(m[2]) / 100;
        const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h % 2) - 1)), m0 = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 1) { r = c; g = x; }
        else if (h < 2) { r = x; g = c; }
        else if (h < 3) { g = c; b = x; }
        else if (h < 4) { g = x; b = c; }
        else if (h < 5) { r = x; b = c; }
        else { r = c; b = x; }
        out = [r + m0, g + m0, b + m0, m[3] != null ? Number(m[3]) : 1];
      }
    }
    colorCache.set(str, out);
    return out;
  }

  function pack6bit(hex) {
    const [r, g, b] = parseColor(hex);
    return Math.round(r * 63) * 4096 + Math.round(g * 63) * 64 + Math.round(b * 63);
  }

  // --- WebGL2 Showcase Renderer ---
  function createShowcaseGL(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 is unavailable on this browser.');

    function compile(vsSrc, fsSrc, uniforms) {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error('VS: ' + gl.getShaderInfoLog(vs));
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error('FS: ' + gl.getShaderInfoLog(fs));
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
      const u = {};
      for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
      return { p, u };
    }

    const batchProg = compile(BATCH_VERT, BATCH_FRAG, [
      'u_view', 'u_pxScale', 'u_time',
      'u_tex0', 'u_tex1', 'u_tex2', 'u_tex3', 'u_tex4', 'u_tex5', 'u_tex6', 'u_tex7'
    ]);
    const warpProg = compile(WARP_VERT, WARP_FRAG, [
      'u_quad', 'u_scene', 'u_count', 'u_enableChroma',
      ...Array.from({ length: 6 }, (_, i) => `u_src[${i}]`),
      ...Array.from({ length: 6 }, (_, i) => `u_meta[${i}]`)
    ]);
    const blurProg = compile(FULLSCREEN_VERT, BLUR_FRAG, ['u_tex', 'u_texel', 'u_dir']);
    const bloomCompProg = compile(FULLSCREEN_VERT, BLOOM_COMP_FRAG, ['u_bloom', 'u_gain']);

    const FLOATS = 14, MAX_VERTS = 24576;
    const verts = new Float32Array(MAX_VERTS * FLOATS);
    let vertCount = 0;
    const batchVao = gl.createVertexArray(), batchVbo = gl.createBuffer();
    gl.bindVertexArray(batchVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, batchVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0, off = 0, sizes = [2, 2, 4, 4, 2]; i < 5; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, sizes[i], gl.FLOAT, false, FLOATS * 4, off);
      off += sizes[i] * 4;
    }

    const quadVao = gl.createVertexArray(), quadVbo = gl.createBuffer();
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    gl.useProgram(batchProg.p);
    for (let i = 0; i < 8; i++) gl.uniform1i(batchProg.u['u_tex' + i], i);
    gl.useProgram(warpProg.p);
    gl.uniform1i(warpProg.u.u_scene, 0);
    gl.useProgram(blurProg.p);
    gl.uniform1i(blurProg.u.u_tex, 0);
    gl.useProgram(bloomCompProg.p);
    gl.uniform1i(bloomCompProg.u.u_bloom, 0);

    const whiteTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, whiteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

    function makeTarget() {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex, fbo: gl.createFramebuffer(), w: 0, h: 0 };
    }
    const sceneTgt = makeTarget();
    const emissiveTgt = makeTarget();
    const bloomATgt = makeTarget();
    const bloomBTgt = makeTarget();

    function ensureTarget(t, w, h) {
      if (t.w === w && t.h === h) return;
      t.w = w; t.h = h;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    }

    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    let pendingQueries = [], activeQuery = null, lastGpuMs = null;

    const texCache = new Map();
    const slots = [];
    let curW = 1500, curH = 900, curTime = 0, blendMode = 'normal', clipMode = 0, drawCalls = 0, lastDrawCalls = 0;
    let m0 = 1, m1 = 0, m2 = 0, m3 = 1, m4 = 0, m5 = 0;
    const matStack = [];

    function pushTransform() { matStack.push(m0, m1, m2, m3, m4, m5); }
    function popTransform() { m5 = matStack.pop(); m4 = matStack.pop(); m3 = matStack.pop(); m2 = matStack.pop(); m1 = matStack.pop(); m0 = matStack.pop(); }
    function resetTransform() { matStack.length = 0; m0 = 1; m1 = 0; m2 = 0; m3 = 1; m4 = 0; m5 = 0; }
    function translate(x, y) { m4 += m0 * x + m2 * y; m5 += m1 * x + m3 * y; }
    function rotate(r) {
      if (!r) return;
      const c = Math.cos(r), s = Math.sin(r), a0 = m0, a1 = m1, a2 = m2, a3 = m3;
      m0 = a0 * c + a2 * s; m1 = a1 * c + a3 * s; m2 = a0 * -s + a2 * c; m3 = a1 * -s + a3 * c;
    }

    function setBlend(mode) {
      if (mode !== blendMode) { flush(); blendMode = mode; }
    }
    function setClip(c) { clipMode = c | 0; }

    function flush() {
      if (!vertCount) { slots.length = 0; return; }
      gl.useProgram(batchProg.p);
      gl.uniform4f(batchProg.u.u_view, 1000, 600, 0, 0);
      gl.uniform1f(batchProg.u.u_pxScale, 1000 / Math.max(1, curW));
      gl.uniform1f(batchProg.u.u_time, curTime);
      for (let i = 0; i < 8; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, slots[i] || whiteTex);
      }
      gl.enable(gl.BLEND);
      if (blendMode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(batchVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, batchVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, vertCount * FLOATS));
      gl.drawArrays(gl.TRIANGLES, 0, vertCount);
      drawCalls++;
      vertCount = 0;
      slots.length = 0;
    }

    function ensure(n) { if (vertCount + n > MAX_VERTS) flush(); }
    function getTex(key, src, rev = 0) {
      if (!src) return null;
      let e = texCache.get(key);
      const w = src.naturalWidth || src.width || 0, h = src.naturalHeight || src.height || 0;
      if (!w || !h) return null;
      if (e && e.rev === rev && e.w === w && e.h === h) return e;
      if (!e) e = { tex: gl.createTexture(), w, h, rev };
      else if (slots.includes(e.tex)) flush();
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      e.w = w; e.h = h; e.rev = rev;
      texCache.set(key, e);
      return e;
    }
    function slotFor(tex) {
      let i = slots.indexOf(tex);
      if (i >= 0) return i;
      if (slots.length >= 8) flush();
      slots.push(tex);
      return slots.length - 1;
    }

    function pushV(x, y, u, v, r, g, b, a, mode, p1, p2, p3, clip, auxY) {
      const o = vertCount * FLOATS;
      verts[o] = m0 * x + m2 * y + m4;
      verts[o + 1] = m1 * x + m3 * y + m5;
      verts[o + 2] = u; verts[o + 3] = v;
      verts[o + 4] = r; verts[o + 5] = g; verts[o + 6] = b; verts[o + 7] = a;
      verts[o + 8] = mode; verts[o + 9] = p1; verts[o + 10] = p2; verts[o + 11] = p3;
      verts[o + 12] = clip; verts[o + 13] = auxY;
      vertCount++;
    }

    function premul(col, alpha = 1) {
      const rgba = Array.isArray(col) ? col : parseColor(col);
      const a = Math.max(0, Math.min(1, rgba[3] * alpha));
      return [rgba[0] * a, rgba[1] * a, rgba[2] * a, a];
    }

    function drawTexture(key, src, x, y, w, h, alpha = 1, stun = 0, rev = 0) {
      const e = getTex(key, src, rev);
      if (!e || alpha <= 0.001) return;
      ensure(6);
      const s = slotFor(e.tex), a = Math.max(0, Math.min(1, alpha));
      const x1 = x + w, y1 = y + h;
      pushV(x, y, 0, 0, a, a, a, a, 1, s, stun, 0, clipMode, 0);
      pushV(x1, y, 1, 0, a, a, a, a, 1, s, stun, 0, clipMode, 0);
      pushV(x, y1, 0, 1, a, a, a, a, 1, s, stun, 0, clipMode, 0);
      pushV(x, y1, 0, 1, a, a, a, a, 1, s, stun, 0, clipMode, 0);
      pushV(x1, y, 1, 0, a, a, a, a, 1, s, stun, 0, clipMode, 0);
      pushV(x1, y1, 1, 1, a, a, a, a, 1, s, stun, 0, clipMode, 0);
    }

    function fillRect(x, y, w, h, col, alpha = 1) {
      const [r, g, b, a] = premul(col, alpha);
      ensure(6);
      pushV(x, y, 0, 0, r, g, b, a, 0, 0, 0, 0, clipMode, 0);
      pushV(x + w, y, 0, 0, r, g, b, a, 0, 0, 0, 0, clipMode, 0);
      pushV(x, y + h, 0, 0, r, g, b, a, 0, 0, 0, 0, clipMode, 0);
      pushV(x, y + h, 0, 0, r, g, b, a, 0, 0, 0, 0, clipMode, 0);
      pushV(x + w, y, 0, 0, r, g, b, a, 0, 0, 0, 0, clipMode, 0);
      pushV(x + w, y + h, 0, 0, r, g, b, a, 0, 0, 0, 0, clipMode, 0);
    }

    function fillCircle(cx, cy, rad, col, alpha = 1) {
      if (rad <= 0 || alpha <= 0.001) return;
      const [r, g, b, a] = premul(col, alpha);
      ensure(6);
      const ext = rad + 1.5;
      pushV(cx - ext, cy - ext, -ext, -ext, r, g, b, a, 2, 0, rad, 0, clipMode, 0);
      pushV(cx + ext, cy - ext, ext, -ext, r, g, b, a, 2, 0, rad, 0, clipMode, 0);
      pushV(cx - ext, cy + ext, -ext, ext, r, g, b, a, 2, 0, rad, 0, clipMode, 0);
      pushV(cx - ext, cy + ext, -ext, ext, r, g, b, a, 2, 0, rad, 0, clipMode, 0);
      pushV(cx + ext, cy - ext, ext, -ext, r, g, b, a, 2, 0, rad, 0, clipMode, 0);
      pushV(cx + ext, cy + ext, ext, ext, r, g, b, a, 2, 0, rad, 0, clipMode, 0);
    }

    function strokeCircle(cx, cy, rad, col, lw = 2, alpha = 1) {
      if (rad <= 0 || lw <= 0 || alpha <= 0.001) return;
      const [r, g, b, a] = premul(col, alpha);
      ensure(6);
      const half = lw * 0.5, innerR = Math.max(0.001, rad - half), outerR = rad + half, ext = outerR + 1.5;
      pushV(cx - ext, cy - ext, -ext, -ext, r, g, b, a, 2, innerR, outerR, 0, clipMode, 0);
      pushV(cx + ext, cy - ext, ext, -ext, r, g, b, a, 2, innerR, outerR, 0, clipMode, 0);
      pushV(cx - ext, cy + ext, -ext, ext, r, g, b, a, 2, innerR, outerR, 0, clipMode, 0);
      pushV(cx - ext, cy + ext, -ext, ext, r, g, b, a, 2, innerR, outerR, 0, clipMode, 0);
      pushV(cx + ext, cy - ext, ext, -ext, r, g, b, a, 2, innerR, outerR, 0, clipMode, 0);
      pushV(cx + ext, cy + ext, ext, ext, r, g, b, a, 2, innerR, outerR, 0, clipMode, 0);
    }

    function strokeLine(x1, y1, x2, y2, col, lw = 2, alpha = 1) {
      if (lw <= 0 || alpha <= 0.001) return;
      const [r, g, b, a] = premul(col, alpha);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (len < 0.001) return fillCircle(x1, y1, lw * 0.5, col, alpha);
      ensure(6);
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, hw = lw * 0.5, pad = hw + 1.5, extW = hw + 1.5;
      const p0x = x1 - ux * pad, p0y = y1 - uy * pad, p1x = x2 + ux * pad, p1y = y2 + uy * pad;
      pushV(p0x + nx * extW, p0y + ny * extW, -pad, extW, r, g, b, a, 4, len, hw, 0, clipMode, 0);
      pushV(p1x + nx * extW, p1y + ny * extW, len + pad, extW, r, g, b, a, 4, len, hw, 0, clipMode, 0);
      pushV(p0x - nx * extW, p0y - ny * extW, -pad, -extW, r, g, b, a, 4, len, hw, 0, clipMode, 0);
      pushV(p0x - nx * extW, p0y - ny * extW, -pad, -extW, r, g, b, a, 4, len, hw, 0, clipMode, 0);
      pushV(p1x + nx * extW, p1y + ny * extW, len + pad, extW, r, g, b, a, 4, len, hw, 0, clipMode, 0);
      pushV(p1x - nx * extW, p1y - ny * extW, len + pad, -extW, r, g, b, a, 4, len, hw, 0, clipMode, 0);
    }

    function strokePolyline(pts, col, lw = 2, alpha = 1) {
      for (let i = 0; i < pts.length - 1; i++) strokeLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, col, lw, alpha);
    }

    function drawSuperAuraShader(cx, cy, ringR, lw, c1, c2, level, alpha = 1) {
      const rgb1 = parseColor(c1);
      const packed2 = pack6bit(c2);
      const ext = ringR + lw + 26;
      ensure(6);
      pushV(cx - ext, cy - ext, -ext, -ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, clipMode, packed2);
      pushV(cx + ext, cy - ext, ext, -ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, clipMode, packed2);
      pushV(cx - ext, cy + ext, -ext, ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, clipMode, packed2);
      pushV(cx - ext, cy + ext, -ext, ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, clipMode, packed2);
      pushV(cx + ext, cy - ext, ext, -ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, clipMode, packed2);
      pushV(cx + ext, cy + ext, ext, ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, clipMode, packed2);
    }

    function drawFirePlume(cx, cy, dirX, dirY, ballR, length, intensity, alpha = 1) {
      const ang = Math.atan2(dirY, dirX);
      pushTransform();
      translate(cx, cy);
      rotate(ang);
      ensure(6);
      const x0 = -ballR * 1.45, x1 = length, yHalf = ballR * 1.95;
      const u0 = x0 / length, u1 = 1.0;
      pushV(x0, -yHalf, u0, -1, 1, 1, 1, alpha, 8, intensity, 1.7, 0, clipMode, 0);
      pushV(x1, -yHalf, u1, -1, 1, 1, 1, alpha, 8, intensity, 1.7, 0, clipMode, 0);
      pushV(x0, yHalf, u0, 1, 1, 1, 1, alpha, 8, intensity, 1.7, 0, clipMode, 0);
      pushV(x0, yHalf, u0, 1, 1, 1, 1, alpha, 8, intensity, 1.7, 0, clipMode, 0);
      pushV(x1, -yHalf, u1, -1, 1, 1, 1, alpha, 8, intensity, 1.7, 0, clipMode, 0);
      pushV(x1, yHalf, u1, 1, 1, 1, 1, alpha, 8, intensity, 1.7, 0, clipMode, 0);
      popTransform();
    }

    function drawGlint(cx, cy, sz, col, alpha, phase) {
      const rgb = parseColor(col);
      ensure(6);
      pushV(cx - sz, cy - sz, -1, -1, rgb[0], rgb[1], rgb[2], alpha, 10, phase, 0, 0, clipMode, 0);
      pushV(cx + sz, cy - sz, 1, -1, rgb[0], rgb[1], rgb[2], alpha, 10, phase, 0, 0, clipMode, 0);
      pushV(cx - sz, cy + sz, -1, 1, rgb[0], rgb[1], rgb[2], alpha, 10, phase, 0, 0, clipMode, 0);
      pushV(cx - sz, cy + sz, -1, 1, rgb[0], rgb[1], rgb[2], alpha, 10, phase, 0, 0, clipMode, 0);
      pushV(cx + sz, cy - sz, 1, -1, rgb[0], rgb[1], rgb[2], alpha, 10, phase, 0, 0, clipMode, 0);
      pushV(cx + sz, cy + sz, 1, 1, rgb[0], rgb[1], rgb[2], alpha, 10, phase, 0, 0, clipMode, 0);
    }

    function drawSoftRibbon(points, widthAt, isBurn, fade, paceAt = null, speedAt = null, heatAt = null) {
      if (!points || !points.length || fade <= 0.005) return;
      const bFlag = isBurn ? 1 : 0;
      ububallWebGL.emitSoftRibbonTriangles(points, widthAt, poly => {
        if (poly.length < 3) return;
        ensure((poly.length - 2) * 3);
        const v0 = poly[0];
        for (let i = 1; i + 1 < poly.length; i++) {
          const v1 = poly[i], v2 = poly[i + 1];
          pushV(v0.x, v0.y, v0.u, v0.v, v0.s, v0.p, v0.sp, v0.h, 5, bFlag, fade, 0, clipMode, 0);
          pushV(v1.x, v1.y, v1.u, v1.v, v1.s, v1.p, v1.sp, v1.h, 5, bFlag, fade, 0, clipMode, 0);
          pushV(v2.x, v2.y, v2.u, v2.v, v2.s, v2.p, v2.sp, v2.h, 5, bFlag, fade, 0, clipMode, 0);
        }
      }, paceAt, speedAt, heatAt);
    }

    function drawTrails(trails, bodies, home, away, ballHeatFn, shaderMode) {
      const m = shaderMode ? 9 : 0;
      for (let i = 0; i < trails.length; i++) {
        const trail = trails[i], b = bodies[i];
        if (!trail || !trail.length || !b) continue;
        const baseCol = parseColor(b.team === -1 ? '#ffffff' : b.team === 0 ? home : away);
        const pts = trail.map((pt, j) => ({ ...pt, origIndex: j, isHead: false }));
        pts.push({ x: b.x, y: b.y, radius: b.radius, life: 0.24, duration: 0.24, heat: b.team === -1 ? ballHeatFn(b) : 0, origIndex: trail.length, isHead: true });
        if (pts.length < 2) continue;
        const L = [], R = [], C = [], H = [];
        for (let k = 0; k < pts.length; k++) {
          const pt = pts[k];
          let dx, dy;
          if (k === 0) { dx = pts[1].x - pts[0].x; dy = pts[1].y - pts[0].y; }
          else if (k === pts.length - 1) { dx = pts[k].x - pts[k - 1].x; dy = pts[k].y - pts[k - 1].y; }
          else { dx = pts[k + 1].x - pts[k - 1].x; dy = pts[k + 1].y - pts[k - 1].y; }
          const d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
          const fade = pt.isHead ? 1 : Math.max(0, pt.life / pt.duration);
          const w = b.radius * fade * (shaderMode ? 1.15 : 1.0);
          L.push({ x: pt.x + nx * w, y: pt.y + ny * w });
          R.push({ x: pt.x - nx * w, y: pt.y - ny * w });
          const f = k === 0 ? 0 : fade;
          const h = pt.heat || 0;
          H.push(h);
          if (b.team === -1) {
            const base = 0.23 + Math.min(2, h) * 0.05 + Math.max(0, h - 2) * 0.3;
            const a = f <= 0 ? 0 : 1 - Math.pow(1 - Math.min(0.99, base * f), 18 * f);
            const hc = parseColor(heatColor(h, 1));
            C.push([hc[0] * a, hc[1] * a, hc[2] * a, a]);
          } else {
            const a = f <= 0 ? 0 : 1 - Math.pow(1 - 0.23 * f, 18 * f);
            C.push([baseCol[0] * a, baseCol[1] * a, baseCol[2] * a, a]);
          }
        }
        ensure((pts.length - 1) * 6);
        for (let k = 0; k < pts.length - 1; k++) {
          const u0 = k / (pts.length - 1), u1 = (k + 1) / (pts.length - 1);
          const c0 = C[k], c1 = C[k + 1];
          pushV(L[k].x, L[k].y, u0, 1, c0[0], c0[1], c0[2], c0[3], m, H[k], 0, 0, clipMode, 0);
          pushV(L[k + 1].x, L[k + 1].y, u1, 1, c1[0], c1[1], c1[2], c1[3], m, H[k + 1], 0, 0, clipMode, 0);
          pushV(R[k].x, R[k].y, u0, -1, c0[0], c0[1], c0[2], c0[3], m, H[k], 0, 0, clipMode, 0);
          pushV(R[k].x, R[k].y, u0, -1, c0[0], c0[1], c0[2], c0[3], m, H[k], 0, 0, clipMode, 0);
          pushV(L[k + 1].x, L[k + 1].y, u1, 1, c1[0], c1[1], c1[2], c1[3], m, H[k + 1], 0, 0, clipMode, 0);
          pushV(R[k + 1].x, R[k + 1].y, u1, -1, c1[0], c1[1], c1[2], c1[3], m, H[k + 1], 0, 0, clipMode, 0);
        }
      }
    }

    function pollTimer() {
      if (!timerExt || !pendingQueries.length) return;
      const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
      while (pendingQueries.length) {
        const q = pendingQueries[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !disjoint) break;
        pendingQueries.shift();
        if (!disjoint) lastGpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
      }
    }

    function beginScene(w, h, timeSec, bgColor) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      curW = w; curH = h; curTime = timeSec; drawCalls = 0; vertCount = 0; slots.length = 0; blendMode = 'normal'; clipMode = 0;
      resetTransform();
      pollTimer();
      if (timerExt && pendingQueries.length < 4 && !activeQuery) {
        activeQuery = gl.createQuery();
        if (activeQuery) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, activeQuery);
      }
      ensureTarget(sceneTgt, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTgt.fbo);
      gl.viewport(0, 0, w, h);
      const [br, bg, bb] = parseColor(bgColor);
      gl.clearColor(br, bg, bb, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    function beginEmissive() {
      flush();
      const ew = Math.max(64, Math.floor(curW * 0.5)), eh = Math.max(64, Math.floor(curH * 0.5));
      ensureTarget(emissiveTgt, ew, eh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, emissiveTgt.fbo);
      gl.viewport(0, 0, ew, eh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      blendMode = 'add';
      clipMode = 0;
      resetTransform();
    }

    function finishComposite(warps, useBloom, bloomStrength, enableChroma, drawOverlayFn) {
      flush();
      // Multi-pass separable quarter-res bloom
      if (useBloom && bloomStrength > 0.01) {
        const bw = Math.max(32, Math.floor(curW * 0.25)), bh = Math.max(32, Math.floor(curH * 0.25));
        ensureTarget(bloomATgt, bw, bh);
        ensureTarget(bloomBTgt, bw, bh);
        gl.disable(gl.BLEND);
        gl.useProgram(blurProg.p);
        gl.bindVertexArray(quadVao);
        // Pass 1 H: emissive -> bloomA
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomATgt.fbo);
        gl.viewport(0, 0, bw, bh);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, emissiveTgt.tex);
        gl.uniform2f(blurProg.u.u_texel, 1 / emissiveTgt.w, 1 / emissiveTgt.h);
        gl.uniform2f(blurProg.u.u_dir, 1.35, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // Pass 1 V: bloomA -> bloomB
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomBTgt.fbo);
        gl.bindTexture(gl.TEXTURE_2D, bloomATgt.tex);
        gl.uniform2f(blurProg.u.u_texel, 1 / bw, 1 / bh);
        gl.uniform2f(blurProg.u.u_dir, 0, 1.35);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // Pass 2 wider H/V for lush optical halo
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomATgt.fbo);
        gl.bindTexture(gl.TEXTURE_2D, bloomBTgt.tex);
        gl.uniform2f(blurProg.u.u_dir, 2.2, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomBTgt.fbo);
        gl.bindTexture(gl.TEXTURE_2D, bloomATgt.tex);
        gl.uniform2f(blurProg.u.u_dir, 0, 2.2);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        drawCalls += 4;
      }

      // Blit crisp sceneFbo -> screen
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneTgt.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, curW, curH, 0, 0, curW, curH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, curW, curH);

      // Apply local space-warp / refraction quads
      const valid = (warps || []).filter(s => s && s.strength > 0.01 && s.radius > 1).slice(0, 6);
      if (valid.length) {
        let minX = 1000, minY = 600, maxX = 0, maxY = 0;
        for (const s of valid) {
          const pad = s.radius * 1.26 + 4;
          minX = Math.min(minX, s.x - pad); minY = Math.min(minY, s.y - pad);
          maxX = Math.max(maxX, s.x + pad); maxY = Math.max(maxY, s.y + pad);
        }
        minX = Math.max(0, minX); minY = Math.max(0, minY);
        maxX = Math.min(1000, maxX); maxY = Math.min(600, maxY);
        if (maxX > minX && maxY > minY) {
          gl.disable(gl.BLEND);
          gl.useProgram(warpProg.p);
          gl.uniform4f(warpProg.u.u_quad, minX, minY, maxX - minX, maxY - minY);
          gl.uniform1i(warpProg.u.u_count, valid.length);
          gl.uniform1f(warpProg.u.u_enableChroma, enableChroma ? 1 : 0);
          for (let i = 0; i < valid.length; i++) {
            const s = valid[i];
            gl.uniform4f(warpProg.u[`u_src[${i}]`], s.x, s.y, s.radius, s.strength);
            gl.uniform4f(warpProg.u[`u_meta[${i}]`], s.time || 0, s.kind || 0, s.sub || 0, s.chroma ?? 0);
          }
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sceneTgt.tex);
          gl.bindVertexArray(quadVao);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          drawCalls++;
        }
      }

      // Additive bloom composite
      if (useBloom && bloomStrength > 0.01) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(bloomCompProg.p);
        gl.uniform1f(bloomCompProg.u.u_gain, bloomStrength);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bloomBTgt.tex);
        gl.bindVertexArray(quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        drawCalls++;
      }

      // Post-refraction overlays
      blendMode = 'normal';
      clipMode = 0;
      resetTransform();
      drawOverlayFn?.();
      flush();

      if (activeQuery && timerExt) {
        gl.endQuery(timerExt.TIME_ELAPSED_EXT);
        pendingQueries.push(activeQuery);
        activeQuery = null;
      }
      lastDrawCalls = drawCalls;
      gl.flush();
    }

    return {
      get lastGpuMs() { return lastGpuMs; },
      get lastDrawCalls() { return lastDrawCalls; },
      beginScene, beginEmissive, finishComposite,
      pushTransform, popTransform, translate, rotate, setBlend, setClip,
      drawTexture, fillRect, fillCircle, strokeCircle, strokeLine, strokePolyline,
      drawSuperAuraShader, drawFirePlume, drawGlint, drawSoftRibbon, drawTrails
    };
  }

  // --- Build 6 deterministic ubus with rare materials ---
  const entries = [];
  let seed = 1041;
  const nextByte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 24) & 0xff; };
  const desiredMats = ['starfield', 'holographic', 'quartz', 'circuitry', 'lava', 'iridescent'];
  for (let i = 0; i < 6; i++) {
    let bytes, model;
    for (let tries = 0; tries < 2000; tries++) {
      bytes = Uint8Array.from({ length: 128 }, nextByte);
      model = ubu.decode(bytes);
      const mats = Object.values(model.attributes || {}).map(a => a?.texture);
      if (mats.includes(desiredMats[i]) || (tries > 1400 && mats.some(m => GLINT_MATERIALS.has(m)))) break;
    }
    const superIds = [6, 1, 3, 7, 4, 0]; // shockwave, knockout, cannonball, ghost, magnet, stalwart
    const superObj = P.SUPERS[superIds[i]];
    entries.push({
      key: 'fx-' + i,
      dna: ubu.toCode(bytes),
      label: model.parts.fullName,
      model,
      equippedSuper: { ...superObj, ...P.superMastery(model.supers, superObj.id) }
    });
  }
  const stats = entries.map(e => ({ ...e.model.stats }));
  async function bakeEntrySprite(model) {
    const url = await ubuRender.sprite(model, 256);
    if (!url) return null;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        c.getContext('2d').drawImage(img, 0, 0, 256, 256);
        resolve(c);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  const bakedSprites = await Promise.all(entries.map(e => bakeEntrySprite(e.model)));
  const rinkLogo = new Image();
  rinkLogo.onload = () => { rinkCacheKey = ''; if (paused) render(); };
  rinkLogo.src = 'assets/ububall-logo.svg';
  const ballMark = new Image();
  ballMark.onload = () => { if (paused) render(); };
  ballMark.src = 'assets/uburoom-oomark-brand.svg';
  const ballFaces = new Map();
  function getBallFaceCanvas(hot, teamCol) {
    const key = hot ? teamCol : 'normal';
    let c = ballFaces.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.translate(32, 32);
    drawBallFace(g, 56, hot ? teamCol : '#F8F7F4', hot ? teamCol : '#FF7197');
    ballFaces.set(key, c);
    return c;
  }

  const colors = {
    primary: '#ff7197',
    text: '#f2efe9',
    home: '#4ca6ff',
    away: '#ff6e59',
    border: '#323f4f',
    surface: '#161d26',
    background: '#0e1217'
  };

  // --- Shared Sim + Extra Demo VFX State ---
  const canvas = $('fx-canvas');
  const glx = createShowcaseGL(canvas);
  const fx = createEffectsState(entries, MATERIAL_STYLES);
  let simBodies = P.kickoff();
  let play = M.newPlay();
  let tally = M.newTally();
  let elapsed = 0, clockMs = 1000, acc = 0, lastFrameAt = 0, lastStatsAt = 0;
  let rinkCanvas = null, rinkCacheKey = '';
  let ballImpactFlare = 0; // 0..1 brief flare on ball itself on impacts
  let spaceWarps = [];     // #1 shock/ko & #4 ghost ripples
  const submitSamples = [];

  function addWarp(x, y, maxRadius, duration, kind, sub = 0, chroma = 1.0, strength = 1.0) {
    spaceWarps.push({ x, y, maxRadius, life: duration, duration, kind, sub, chroma, strength });
    if (spaceWarps.length > 8) spaceWarps.shift();
  }

  function triggerFireImpact(x, y, nx = -1, ny = 0) {
    fx.fireWarp = { x, y, nx, ny, life: 0.30, duration: 0.30 };
    ballImpactFlare = 1.0;
    fx.ballFlare = 1.0;
  }

  function triggerShockwaveBurst(x, y, team = 0, radius = 140) {
    addWarp(x, y, radius * 1.45, 0.42, 1, 0, 1.15, 1.0);
    fx.shockwaves.push({ x, y, currentRadius: 14, maxRadius: radius, team, color: '#ff7197', life: 0.42, duration: 0.42, width: 10 });
    fx.shockwaves.push({ x, y, currentRadius: 8, maxRadius: radius * 0.85, team, color: '#ffc2d6', life: 0.34, duration: 0.34, width: 6 });
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2, spd = 220 + Math.random() * 190, life = 0.24 + Math.random() * 0.14;
      fx.particles.push({
        x: x + Math.cos(a) * 16, y: y + Math.sin(a) * 16, px: x, py: y,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, team,
        color: k % 2 ? '#ff7197' : '#ffffff', life, duration: life, materialShape: 'streak', angle: a, size: 5.2, snap: true
      });
    }
  }

  function triggerKoBurst(x, y, team = 0) {
    addWarp(x, y, 125, 0.30, 1, 1, 1.25, 1.0);
    fx.shockwaves.push({ x, y, currentRadius: 12, maxRadius: 84, team, color: '#ee2b47', life: 0.30, duration: 0.30, width: 7 });
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, spd = 160 + Math.random() * 200, life = 0.20 + Math.random() * 0.12;
      fx.particles.push({
        x, y, px: x, py: y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, team,
        color: k % 3 === 0 ? '#ffffff' : '#ee2b47', life, duration: life, materialShape: 'streak', angle: a, size: 4.5, snap: true
      });
    }
  }

  function triggerGhostRipple(x, y) {
    addWarp(x, y, 138, 0.78, 2, 0, 1.5, 1.25);
    fx.shockwaves.push({ x, y, currentRadius: 18, maxRadius: 108, team: 1, color: '#33e0ff', life: 0.66, duration: 0.66, width: 5.5 });
    fx.shockwaves.push({ x, y, currentRadius: 10, maxRadius: 72, team: 1, color: '#f8f6f2', life: 0.52, duration: 0.52, width: 3.5 });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, spd = 100 + Math.random() * 120, life = 0.36 + Math.random() * 0.16;
      fx.particles.push({
        x, y, px: x, py: y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, team: 1,
        color: k % 2 ? '#33e0ff' : '#f8f6f2', life, duration: life, glint: true, phase: k * 0.7, size: 7.5 + Math.random() * 4.5
      });
    }
  }

  function resetScenario(name = activeScene) {
    activeScene = name;
    simBodies = P.kickoff();
    play = M.newPlay();
    tally = M.newTally();
    elapsed = 0;
    acc = 0;
    lastGhostPair = 0;
    ballImpactFlare = 0;
    spaceWarps.length = 0;
    fx.trails.forEach(t => { t.length = 0; });
    fx.particles.length = fx.fireworks.length = fx.shockwaves.length = 0;
    fx.skids.length = fx.burns.length = fx.ripples.length = fx.pings.length = 0;
    fx.burnState = {};
    fx.fireWarp = null;
    fx.netFire = null;
    fx.goalSweep = null;
    fx.fireTime = 0;

    simBodies.slice(0, 6).forEach((b, i) => {
      M.applyStats(P, b, stats[i], 'standard');
      b.equippedSuper = entries[i].equippedSuper;
      b.meter = 100;
      b.name = entries[i].label;
    });

    const ball = simBodies[6];
    if (name === 'heat') {
      $('scene-title').textContent = 'Scenario: Heat Devil (Weak Ambient + Impact Flare-Up) & Fireball Plume';
      const coords = [[210, 290], [280, 170], [280, 430], [565, 292], [750, 200], [750, 400]];
      coords.forEach(([x, y], i) => { simBodies[i].x = x; simBodies[i].y = y; });
      simBodies[3].mass = 5.5;
      ball.x = 240; ball.y = 290; ball.vx = 780; ball.vy = -55; ball.omega = 14;
      ball.onFire = true; ball.fireTicks = 900; ball.pace = 940; ball.strikerTeam = 0;
    } else if (name === 'shock') {
      $('scene-title').textContent = 'Scenario: #1 Shockwave & Knockout Space-Warp Ripples + #2 Chromatic Dispersion';
      const coords = [[420, 295], [320, 210], [250, 390], [515, 295], [630, 215], [760, 310]];
      coords.forEach(([x, y], i) => { simBodies[i].x = x; simBodies[i].y = y; });
      simBodies[0].vx = 320; simBodies[0].vy = 0; simBodies[0].superActive = 'shockwave';
      simBodies[1].vx = 520; simBodies[1].vy = 20; simBodies[1].superActive = 'knockout';
      simBodies[4].vx = -120; simBodies[4].vy = 0;
      ball.x = 465; ball.y = 385; ball.vx = 420; ball.vy = -60; ball.onFire = true; ball.fireTicks = 600; ball.pace = 900;
    } else if (name === 'net') {
      $('scene-title').textContent = 'Scenario: #3 Burning Net Heat Shimmer + #5 Multi-Pass Bloom & Fireworks';
      const coords = [[340, 280], [270, 175], [270, 425], [780, 185], [790, 415], [840, 200]];
      coords.forEach(([x, y], i) => { simBodies[i].x = x; simBodies[i].y = y; });
      ball.x = 640; ball.y = 300; ball.vx = 980; ball.vy = 0; ball.omega = 0;
      ball.onFire = true; ball.fireTicks = 900; ball.pace = 980; ball.strikerTeam = 0;
    } else if (name === 'ghost') {
      $('scene-title').textContent = 'Scenario: #4 Ghost Phase Ripple + #6 Shader Conic Auras + #14 Material Glints';
      // Place opponents [0, 1, 2] directly along Ghost [3]'s horizontal patrol path so Ghost phases repeatedly
      const coords = [[395, 300], [520, 300], [645, 300], [250, 300], [675, 435], [360, 165]];
      coords.forEach(([x, y], i) => { simBodies[i].x = x; simBodies[i].y = y; });
      simBodies[0].superArm = true; simBodies[1].superArm = true; simBodies[2].superArm = true;
      simBodies[3].superActive = 'ghost'; simBodies[3].vx = 430; simBodies[3].vy = 0;
      simBodies[0].vx = 25; simBodies[1].vx = -25; simBodies[2].vx = 25;
      simBodies[4].vx = -240; simBodies[5].vx = 240;
      ball.x = 460; ball.y = 465; ball.vx = 340; ball.vy = -25;
      triggerGhostRipple(265, 300);
    } else {
      $('scene-title').textContent = 'Scenario: Full 3v3 Chaos (All Effects Active)';
      const coords = [[290, 235], [330, 360], [235, 300], [705, 245], [665, 355], [760, 300]];
      coords.forEach(([x, y], i) => { simBodies[i].x = x; simBodies[i].y = y; });
      const plans = [
        { angle: 0.14, power: 1, spin: 0.9, guard: false, superArm: true },
        { angle: -0.22, power: 0.95, spin: -0.85, guard: false, superArm: true },
        { angle: 0.04, power: 0.9, spin: 0.75, guard: false, superArm: false },
        { angle: Math.PI - 0.14, power: 1, spin: -0.9, guard: false, superArm: true },
        { angle: Math.PI + 0.2, power: 0.9, spin: 0.8, guard: false, superArm: false },
        { angle: Math.PI, power: 0.85, spin: 0, guard: true, superArm: false }
      ];
      P.startTurn(simBodies, plans, (key, stage, body) => {
        if (key === 'shockwave' && stage === 'impact') triggerShockwaveBurst(body.x, body.y, body.team, 140);
      });
      ball.x = 410; ball.y = 295; ball.vx = 840; ball.vy = -210; ball.omega = 18;
      ball.onFire = true; ball.fireTicks = 900; ball.pace = 960; ball.strikerTeam = 0;
      triggerFireImpact(ball.x, ball.y, -1, 0.25);
    }
  }

  let lastGhostPair = 0;
  let shockScheduled = false, koScheduled = false;

  function stepWorld(dt) {
    if (dt <= 0) return;
    const sdt = dt * speedScale;
    clockMs += sdt * 1000;
    elapsed += sdt;
    acc += sdt;

    const fxHooks = {
      collide: c => {
        const isBall = c.a.team === -1 || c.b.team === -1;
        const ball = c.a.team === -1 ? c.a : c.b;
        const other = c.a.team === -1 ? c.b : c.a;
        const dist = Math.hypot(ball.x - other.x, ball.y - other.y) || 1;
        const x = (c.a.x + c.b.x) * 0.5, y = (c.a.y + c.b.y) * 0.5;
        if (isBall && P.ballOnFire(ball)) {
          triggerFireImpact(x, y, (ball.x - other.x) / dist, (ball.y - other.y) / dist);
          for (let k = 0; k < 14 && fx.particles.length < 400; k++) {
            const ang = Math.random() * Math.PI * 2, spd = 120 + Math.random() * 220, life = 0.2 + Math.random() * 0.15;
            fx.particles.push({ x, y, px: x, py: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, team: -1, color: k % 2 ? '#ffc43d' : '#ff7a1a', life, duration: life, materialShape: 'streak', angle: ang, size: 3.4, snap: true });
          }
        }
      },
      wall: (body, vel, wType, nx, ny) => {
        const cx = body.x + nx * body.radius, cy = body.y + ny * body.radius;
        if (body.team === -1 && P.ballOnFire(body) && vel >= 60) {
          triggerFireImpact(cx, cy, nx, ny);
          for (let k = 0; k < 10 && fx.particles.length < 400; k++) {
            const ang = Math.atan2(-ny, -nx) + (Math.random() - 0.5) * 1.6, spd = 110 + Math.random() * 190, life = 0.18 + Math.random() * 0.14;
            fx.particles.push({ x: cx, y: cy, px: cx, py: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, team: -1, color: k % 2 ? '#fff3b0' : '#ff7a1a', life, duration: life, materialShape: 'streak', angle: ang, size: 3.5, snap: true });
          }
        }
      },
      shockwave: (src, rad) => triggerShockwaveBurst(src.x, src.y, src.team, rad),
      super: (key, stage, body, target) => {
        if (stage === 'impact' && target) {
          const x = (body.x + target.x) * 0.5, y = (body.y + target.y) * 0.5;
          if (key === 'knockout') triggerKoBurst(x, y, body.team);
          if (key === 'cannonball') triggerFireImpact(x, y, 1, 0);
        }
      }
    };

    let goalScored = null;
    while (acc >= P.DT) {
      acc -= P.DT;
      const tick = M.playTick(P, simBodies, play, fxHooks, tally);
      // Record trails
      simBodies.forEach((b, i) => {
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > 20) {
          const tr = fx.trails[i], last = tr[tr.length - 1];
          if (!last || Math.hypot(b.x - last.x, b.y - last.y) >= 3) {
            tr.push({ x: b.x, y: b.y, life: 0.28, duration: 0.28, heat: b.team === -1 ? (P.ballOnFire(b) ? 3 : 1.5) : 0 });
            if (tr.length > 26) tr.shift();
          }
        }
      });
      if (tick.goal !== null) { goalScored = tick.goal; break; }
    }

    if (activeScene === 'heat' || activeScene === 'net' || activeScene === 'chaos') {
      simBodies[6].onFire = true;
      simBodies[6].fireTicks = Math.max(simBodies[6].fireTicks || 0, 300);
      simBodies[6].pace = Math.max(simBodies[6].pace || 0, 920);
    }

    // Scenario scripted beats
    if (activeScene === 'shock') {
      if (!shockScheduled && elapsed > 0.25) { shockScheduled = true; triggerShockwaveBurst(440, 295, 0, 155); }
      if (!koScheduled && elapsed > 0.65) { koScheduled = true; triggerKoBurst(545, 225, 0); }
    }
    if (activeScene === 'ghost') {
      const ghost = simBodies[3];
      ghost.superActive = 'ghost';
      // Ping-pong Ghost along y=300 right through opponents [0, 1, 2], and keep other skaters moving smoothly for #14 glints
      if (ghost.x > 740 && ghost.vx > 0) ghost.vx = -420;
      else if (ghost.x < 250 && ghost.vx < 0) ghost.vx = 420;
      else if (Math.abs(ghost.vx) < 340) ghost.vx = (ghost.vx >= 0 ? 1 : -1) * 400;
      ghost.vy += (300 - ghost.y) * 4.0 * sdt;
      for (let i = 0; i < 6; i++) {
        if (i === 3) continue;
        const b = simBodies[i];
        const sp = Math.hypot(b.vx, b.vy);
        if (sp < 150) {
          const a = elapsed * 1.4 + i * 1.1;
          b.vx += Math.cos(a) * 180 * sdt;
          b.vy += Math.sin(a) * 180 * sdt;
        }
      }
      for (const idx of [0, 1, 2]) {
        const d = Math.hypot(ghost.x - simBodies[idx].x, ghost.y - simBodies[idx].y);
        if (d < ghost.radius + simBodies[idx].radius + 14 && clockMs - lastGhostPair > 300) {
          lastGhostPair = clockMs;
          triggerGhostRipple((ghost.x + simBodies[idx].x) * 0.5, (ghost.y + simBodies[idx].y) * 0.5);
        }
      }
    }
    if (goalScored !== null) {
      fx.goalSweep = { team: goalScored, p: 0 };
      if (P.ballOnFire(simBodies[6])) fx.netFire = { mouth: goalScored ? P.rink.left : P.rink.right, lit: true };
      if (activeScene === 'net') {
        const b = simBodies[6];
        b.vx = 0; b.vy = 0; b.omega = 0;
        b.x = goalScored === 0 ? P.rink.right + 18 : P.rink.left - 18;
        b.y = 300;
      }
      for (let i = 0; i < 8; i++) {
        fx.fireworks.push({
          x: goalScored === 0 ? 580 + Math.random() * 310 : 110 + Math.random() * 310,
          y: 550, vx: (Math.random() - 0.5) * 60, vy: -(420 + Math.random() * 140),
          fuse: 0.52 + Math.random() * 0.25, delay: 0.08 + i * 0.14, team: goalScored
        });
      }
    }

    // Burn ice & flame dots
    const ball = simBodies[6];
    const spawnCount = amt => (amt > 0 ? Math.floor(amt) + (Math.random() < (amt % 1) ? 1 : 0) : 0);
    if (P.ballOnFire(ball) && !fx.netFire?.lit) {
      fx.fireTime += sdt;
      if (!fx.burnState.path) {
        fx.burnState.path = { points: [], width: ball.radius * 1.3, age: 0 };
        fx.burns.push(fx.burnState.path); if (fx.burns.length > 24) fx.burns.shift();
      }
      const pts = fx.burnState.path.points, prev = pts[pts.length - 1];
      const depth = 0.2 + 0.8 * Math.min(1, fx.fireTime / 0.5);
      if (!prev || Math.hypot(ball.x - prev.x, ball.y - prev.y) >= 3) pts.push({ x: ball.x, y: ball.y, depth });
      if (!fxFlags.flameShader) {
        for (let k = spawnCount(sdt * 110); k > 0 && fx.particles.length < 400; k--) {
          const life = 0.18 + Math.random() * 0.2;
          fx.particles.push({
            x: ball.x + (Math.random() - 0.5) * 18, y: ball.y + (Math.random() - 0.5) * 18,
            px: ball.x, py: ball.y, vx: -ball.vx * 0.12 + (Math.random() - 0.5) * 50, vy: -ball.vy * 0.12 + (Math.random() - 0.5) * 50,
            team: -1, color: ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'][Math.floor(Math.random() * 4)],
            life, duration: life, flame: 10 + Math.random() * 12
          });
        }
      }
    }
    if (fx.netFire?.lit) {
      const mouth = fx.netFire.mouth, back = mouth < 500 ? mouth - P.rink.goalDepth : mouth + P.rink.goalDepth;
      const midX = (mouth + back) * 0.5, midY = 300;
      for (let k = spawnCount(sdt * 170); k > 0 && fx.particles.length < 450; k--) {
        const life = 0.2 + Math.random() * 0.22;
        fx.particles.push({
          x: midX + (Math.random() - 0.5) * P.rink.goalDepth, y: midY + (Math.random() - 0.5) * 130,
          px: midX, py: midY, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
          team: -1, color: ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'][Math.floor(Math.random() * 4)],
          life, duration: life, flame: 11 + Math.random() * 11
        });
      }
    }

    // Material emitters (#14)
    fx.materialEmitters.forEach((em, i) => {
      const b = simBodies[i];
      if (!b || (!em.styles.length) || Math.hypot(b.vx, b.vy) < 15) return;
      em.time += sdt;
      const rate = activeScene === 'ghost' ? 1 / 16 : 1 / 20;
      if (em.time < rate) return;
      em.time %= rate;
      for (const eff of em.styles) {
        if (fx.particles.length >= 380) break;
        const col = eff.color === 'rainbow' ? `hsl(${Math.floor(Math.random() * 360)} 92% 76%)` : (eff.color || '#ffffff');
        const life = 0.42 + Math.random() * 0.34;
        const isGlint = eff.shape === 'spark' || eff.shape === 'shard' || activeScene === 'ghost';
        const ang = Math.random() * Math.PI * 2;
        const ringR = b.radius * (0.7 + Math.random() * 0.55);
        fx.particles.push({
          x: b.x + Math.cos(ang) * ringR,
          y: b.y + Math.sin(ang) * ringR,
          px: b.x, py: b.y,
          vx: -b.vx * 0.1 + Math.cos(ang) * 28,
          vy: -b.vy * 0.1 + Math.sin(ang) * 28,
          team: b.team, color: col, life, duration: life,
          glint: isGlint, phase: Math.random() * 6.28, size: isGlint ? 7.5 + Math.random() * 5.0 : 2.6
        });
      }
    });

    // Update particles, trails, fireworks, warps
    for (const tr of fx.trails) {
      for (const pt of tr) pt.life -= sdt;
      while (tr.length && tr[0].life <= 0) tr.shift();
    }
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i]; p.life -= sdt;
      if (p.life <= 0) { fx.particles.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y; p.x += p.vx * sdt; p.y += p.vy * sdt;
    }
    for (let i = fx.fireworks.length - 1; i >= 0; i--) {
      const f = fx.fireworks[i];
      if ((f.delay || 0) > 0) { f.delay -= sdt; continue; }
      f.fuse -= sdt; f.x += f.vx * sdt; f.y += f.vy * sdt; f.vy += 260 * sdt;
      if (f.fuse <= 0) {
        const col = f.team === 0 ? colors.home : colors.away;
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2, spd = 90 + Math.random() * 170, life = 0.55 + Math.random() * 0.35;
          fx.particles.push({
            x: f.x, y: f.y, px: f.x, py: f.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
            team: f.team, color: k % 4 === 0 ? '#ffd76b' : col, life, duration: life, glint: true, size: 5.5, phase: k
          });
        }
        fx.fireworks.splice(i, 1);
      }
    }
    for (let i = fx.shockwaves.length - 1; i >= 0; i--) {
      if ((fx.shockwaves[i].life -= sdt) <= 0) fx.shockwaves.splice(i, 1);
    }
    for (let i = spaceWarps.length - 1; i >= 0; i--) {
      if ((spaceWarps[i].life -= sdt) <= 0) spaceWarps.splice(i, 1);
    }
    fx.burns.forEach(b => { b.age += sdt; });
    if (fx.fireWarp && (fx.fireWarp.life -= sdt) <= 0) fx.fireWarp = null;
    if (fx.goalSweep && (fx.goalSweep.p += sdt / 1.5) >= 1) fx.goalSweep = null;
    fx.ballFlare = Math.max(0, fx.ballFlare - sdt / 0.8);
    ballImpactFlare = Math.max(0, ballImpactFlare - sdt / 0.32);

    const loopLen = activeScene === 'net' ? 4.4 : activeScene === 'heat' ? 3.8 : 4.8;
    if (elapsed > loopLen) {
      shockScheduled = koScheduled = false;
      resetScenario(activeScene);
    }
  }

  function render() {
    const w = Math.round(1000 * density), h = Math.round(600 * density);
    const timeSec = clockMs / 1000;
    const t0 = performance.now();

    const rKey = `${w}x${h}:${rinkLogo.complete && rinkLogo.naturalWidth ? 1 : 0}`;
    if (rinkCacheKey !== rKey) {
      rinkCanvas ||= document.createElement('canvas');
      rinkCanvas.width = w; rinkCanvas.height = h;
      const ctx = rinkCanvas.getContext('2d');
      ctx.setTransform(w / 1000, 0, 0, h / 600, 0, 0);
      ctx.clearRect(0, 0, 1000, 600);
      drawRinkSurface(ctx, P, M, colors, rinkLogo);
      rinkCacheKey = rKey;
    }

    glx.beginScene(w, h, timeSec, colors.background);
    glx.drawTexture('rink', rinkCanvas, 0, 0, 1000, 600, 1);

    // Burns
    glx.setClip(1);
    for (const s of fx.burns) {
      const fade = 1 - Math.min(1, s.age / 20);
      if (s.points && s.points.length >= 2) glx.drawSoftRibbon(s.points, p => s.width * (0.5 + 0.5 * p.depth), true, fade);
    }
    glx.setClip(0);

    // #13 Motion Trails
    glx.drawTrails(fx.trails, simBodies, colors.home, colors.away, b => (P.ballOnFire(b) ? 3 : 1.5), fxFlags.trailShader);

    // Shockwaves
    for (const s of fx.shockwaves) {
      const p = 1 - s.life / s.duration, exp = 1 - (1 - p) ** 2.5, fade = (1 - p) ** 1.2;
      const r = s.currentRadius + (s.maxRadius - s.currentRadius) * exp;
      glx.strokeCircle(s.x, s.y, r, s.color, Math.max(1.2, (s.width || 5) * fade), fade * 0.9);
    }

    // Skaters + #6 Shader-Native Conic Super Auras
    simBodies.slice(0, 6).forEach((b, i) => {
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      const key = b.superActive || b.equippedSuper?.key || 'stalwart';
      const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
      const level = b.superActive || b.superArm ? 2 : 1;
      if (fxFlags.conicShader) {
        glx.drawSuperAuraShader(b.x, b.y, reachR + 7 + level * 2, level === 2 ? 3.8 : 2.8, c1, c2, level, level === 2 ? 0.96 : 0.72);
      } else {
        glx.strokeCircle(b.x, b.y, reachR + 7 + level * 2, c1, level === 2 ? 3 : 2, 0.75);
      }
      glx.strokeCircle(b.x, b.y, reachR + 2, i < 3 ? colors.home : colors.away, 4, 1);
      const sz = b.radius * 2;
      glx.pushTransform();
      glx.translate(b.x, b.y);
      glx.rotate(b.rotation);
      glx.drawTexture('ubu:' + i, bakedSprites[i], -sz / 2, -sz / 2, sz, sz, b.superActive === 'ghost' ? 0.48 : 1);
      glx.popTransform();
    });

    // Ball + #12 Procedural Fireball Plume
    const ball = simBodies[6];
    const hot = P.ballOnFire(ball);
    if (hot && fxFlags.flameShader) {
      const spd = Math.hypot(ball.vx, ball.vy) || 1;
      const backX = -ball.vx / spd, backY = -ball.vy / spd;
      const tailLen = Math.min(92, 46 + spd * 0.045);
      const heatBoost = 0.85 + ballImpactFlare * 0.45;
      glx.setBlend('add');
      glx.drawFirePlume(ball.x, ball.y, backX, backY, ball.radius, tailLen, heatBoost, 0.96);
      glx.setBlend('normal');
    } else if (hot) {
      glx.strokeCircle(ball.x, ball.y, ball.radius + 4, '#ffb347', 2.4, 0.82);
    }
    glx.fillCircle(ball.x, ball.y, ball.radius, colors.background, 1);
    glx.strokeCircle(ball.x, ball.y, ball.radius, colors.text, 2, 1);
    if (hot) glx.fillCircle(ball.x, ball.y, ball.radius, '#ff461e', 0.55 + ballImpactFlare * 0.3);
    {
      const fSize = ball.radius * 1.7 * (64 / 56);
      glx.pushTransform();
      glx.translate(ball.x, ball.y);
      glx.rotate(ball.rotation);
      if (!hot && ballMark.complete && ballMark.naturalWidth) {
        const bSz = ball.radius * 1.7;
        glx.drawTexture('ballMark', ballMark, -bSz / 2, -bSz / 2, bSz, bSz, 1);
      } else {
        const tc = ball.strikerTeam === 1 ? colors.away : colors.home;
        glx.drawTexture('ballFace:' + (hot ? tc : 'norm'), getBallFaceCanvas(hot, tc), -fSize / 2, -fSize / 2, fSize, fSize, 1);
      }
      glx.popTransform();
    }

    if (fx.netFire?.lit) {
      const mouth = fx.netFire.mouth;
      const back = mouth < 500 ? mouth - P.rink.goalDepth : mouth + P.rink.goalDepth;
      const pulse = 0.72 + 0.28 * Math.sin(timeSec * 14);
      glx.setBlend('add');
      glx.strokeLine(mouth, 230, back, 230, '#ff7a1a', 3.5, 0.85 * pulse);
      glx.strokeLine(back, 230, back, 370, '#ffc43d', 3.5, 0.85 * pulse);
      glx.strokeLine(back, 370, mouth, 370, '#ff7a1a', 3.5, 0.85 * pulse);
      glx.strokeCircle(mouth, 300, 68, '#ff7a1a', 2.4, 0.38 * pulse);
      glx.setBlend('normal');
    }

    // Scene particles (#14 glints & flames)
    for (const p of fx.particles) {
      const fade = Math.max(0, p.life / p.duration);
      if (p.flame) {
        glx.setBlend('add');
        glx.fillCircle(p.x, p.y, p.flame * 0.45 * (0.4 + 0.6 * fade), p.color, Math.min(1, fade * 2) * 0.75);
        glx.setBlend('normal');
      } else if (p.glint && fxFlags.glintShader) {
        glx.setBlend('add');
        glx.drawGlint(p.x, p.y, (p.size || 6) * (0.6 + 0.4 * fade), p.color, Math.min(1, fade * 2) * 0.95, p.phase || 0);
        glx.setBlend('normal');
      } else {
        glx.strokeLine(p.px, p.py, p.x, p.y, p.color, p.snap ? 2.4 : 1.5, Math.min(1, fade * 2));
      }
    }

    // Emissive Pass for #5 Multi-Pass Bloom
    if (fxFlags.bloom) {
      glx.beginEmissive();
      glx.setBlend('add');
      if (hot) {
        const spd = Math.hypot(ball.vx, ball.vy) || 1;
        if (fxFlags.flameShader) glx.drawFirePlume(ball.x, ball.y, -ball.vx / spd, -ball.vy / spd, ball.radius * 1.15, 76, 0.9 + ballImpactFlare * 0.5, 0.85);
        glx.fillCircle(ball.x, ball.y, ball.radius * (1.25 + ballImpactFlare * 0.4), '#ff7a1a', 0.8);
      }
      for (const s of fx.shockwaves) {
        const p = 1 - s.life / s.duration, exp = 1 - (1 - p) ** 2.5, fade = (1 - p) ** 1.2;
        const r = s.currentRadius + (s.maxRadius - s.currentRadius) * exp;
        glx.strokeCircle(s.x, s.y, r, s.color, (s.width || 5) * 1.3 * fade, fade * 0.65);
      }
      simBodies.slice(0, 6).forEach(b => {
        const key = b.superActive || b.equippedSuper?.key || 'stalwart';
        const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
        if (b.superActive || b.superArm) glx.drawSuperAuraShader(b.x, b.y, Math.max(b.radius, 18) + 11, 5.2, c1, c2, 2, 0.42);
      });
      for (const p of fx.particles) {
        const fade = Math.max(0, p.life / p.duration);
        if (p.flame) glx.fillCircle(p.x, p.y, p.flame * 0.55 * fade, p.color, fade * 0.72);
        else if (p.glint && fxFlags.glintShader) glx.drawGlint(p.x, p.y, (p.size || 6) * 1.25, p.color, fade * 0.75, p.phase || 0);
        else glx.fillCircle(p.x, p.y, 2.5, p.color, fade * 0.6);
      }
      for (const f of fx.fireworks) {
        if ((f.delay || 0) <= 0) glx.fillCircle(f.x, f.y, 7, f.team === 0 ? colors.home : colors.away, 0.9);
      }
      if (fx.goalSweep) {
        const sColor = fx.goalSweep.team ? colors.away : colors.home;
        const sx = fx.goalSweep.team ? 60 + fx.goalSweep.p * 880 : 940 - fx.goalSweep.p * 880;
        glx.fillRect(sx - 28, 60, 56, 480, sColor, (1 - fx.goalSweep.p * 0.5) * 0.38);
      }
    }

    // Collect active warps
    const warps = [];
    if (fxFlags.warp) {
      if (fx.fireWarp && fx.fireWarp.life > 0) {
        const wp = 1 - fx.fireWarp.life / fx.fireWarp.duration;
        const fade = (1 - wp) ** 1.15;
        warps.push({ x: fx.fireWarp.x, y: fx.fireWarp.y, radius: 46 + wp * 44, strength: fade, time: wp, kind: 0, sub: 1, chroma: 1.0 });
      }
      if (hot && !fx.netFire?.lit) {
        const baseStrength = fxFlags.oldHeatMode ? 0.75 : ambientHeat;
        const curStrength = fxFlags.oldHeatMode ? 0.75 : Math.max(baseStrength, baseStrength + (0.95 - baseStrength) * ballImpactFlare);
        const rad = fxFlags.oldHeatMode ? 42 : (34 + ballImpactFlare * 16);
        warps.push({ x: ball.x, y: ball.y, radius: rad, strength: curStrength, time: timeSec, kind: 0, sub: 0, chroma: ballImpactFlare });
      }
    }
    if (fxFlags.netWarp && fx.netFire?.lit) {
      const mx = fx.netFire.mouth < 500 ? 55 : 945;
      warps.push({ x: mx, y: 300, radius: 128, strength: 0.85, time: timeSec, kind: 0, sub: 2, chroma: 0.75 });
    }
    for (const sw of spaceWarps) {
      if (sw.kind === 1 && !fxFlags.shockWarp) continue;
      if (sw.kind === 2 && !fxFlags.ghostWarp) continue;
      const p = 1 - sw.life / sw.duration;
      const fade = (1 - p) ** 1.1;
      warps.push({ x: sw.x, y: sw.y, radius: sw.maxRadius, strength: sw.strength * fade, time: p, kind: sw.kind, sub: sw.sub, chroma: sw.chroma * fade });
    }

    glx.finishComposite(warps, fxFlags.bloom, bloomGain, fxFlags.chroma, () => {
      if (fx.goalSweep) {
        const sColor = fx.goalSweep.team ? colors.away : colors.home;
        const sx = fx.goalSweep.team ? 60 + fx.goalSweep.p * 880 : 940 - fx.goalSweep.p * 880;
        glx.setClip(1);
        glx.setBlend('add');
        glx.fillRect(sx - 18, 60, 36, 480, sColor, (1 - fx.goalSweep.p * 0.5) * 0.35);
        glx.setBlend('normal');
        glx.setClip(0);
      }
      for (const f of fx.fireworks) {
        if ((f.delay || 0) <= 0) {
          glx.strokeLine(f.x - f.vx * 0.03, f.y - f.vy * 0.03, f.x, f.y, '#ffe9b0', 2.8, 0.95);
          glx.fillCircle(f.x, f.y, 2.2, '#ffffff', 1);
        }
      }
    });

    submitSamples.push(performance.now() - t0);
    if (submitSamples.length > 180) submitSamples.shift();

    const curBallHeat = hot ? (fxFlags.oldHeatMode ? 0.75 : Math.max(ambientHeat, ambientHeat + (0.95 - ambientHeat) * ballImpactFlare)) : 0;
    $('heat-readout').textContent = fxFlags.oldHeatMode
      ? `Heat Devil: OLD constant 0.75 | Active Warps: ${warps.length}`
      : `Ball Heat: ${curBallHeat.toFixed(2)} (Ambient ${ambientHeat.toFixed(2)} + Flare ${ballImpactFlare.toFixed(2)}) | Warps: ${warps.length}`;
  }

  function updateStats() {
    const sorted = submitSamples.slice().sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)].toFixed(2) : '-';
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)].toFixed(2) : '-';
    const gpuStr = glx.lastGpuMs != null ? ` | GPU timer ${glx.lastGpuMs.toFixed(2)} ms` : '';
    $('stats').textContent = `CPU submit p50 ${p50} ms (p95 ${p95} ms)${gpuStr} | ${glx.lastDrawCalls} draws | ${canvas.width}x${canvas.height} | WebGL2`;
  }

  // Build effect toggles panel safely (no innerHTML)
  const togglesEl = $('toggles');
  for (const def of TOGGLE_DEFS) {
    const label = document.createElement('label');
    label.className = 'fx-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = fxFlags[def.key];
    cb.onchange = () => { fxFlags[def.key] = cb.checked; if (paused) render(); };
    const textWrap = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = def.label;
    const span = document.createElement('span');
    span.textContent = def.desc;
    textWrap.append(strong, span);
    label.append(cb, textWrap);
    togglesEl.append(label);
  }

  // Scenario buttons
  const sceneButtons = document.querySelectorAll('#scenario-bar button[data-scene]');
  sceneButtons.forEach(btn => {
    btn.onclick = () => {
      sceneButtons.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      shockScheduled = koScheduled = false;
      resetScenario(btn.dataset.scene);
      if (paused) render();
    };
  });

  $('pause').onclick = () => {
    paused = !paused;
    $('pause').textContent = paused ? 'Resume' : 'Pause';
    lastFrameAt = 0;
    if (!paused) requestAnimationFrame(loop);
  };
  $('step').onclick = () => { paused = true; $('pause').textContent = 'Resume'; stepWorld(1 / 60); render(); updateStats(); };
  $('restart').onclick = () => { shockScheduled = koScheduled = false; resetScenario(activeScene); if (paused) render(); };
  $('speed').onclick = () => {
    speedScale = speedScale === 1.0 ? 0.5 : speedScale === 0.5 ? 0.25 : 1.0;
    $('speed').textContent = `Speed: ${speedScale.toFixed(speedScale === 0.25 ? 2 : 1)}x`;
  };
  $('heat-mode').onclick = () => {
    fxFlags.oldHeatMode = !fxFlags.oldHeatMode;
    $('heat-mode').setAttribute('aria-pressed', String(!fxFlags.oldHeatMode));
    $('heat-mode').textContent = fxFlags.oldHeatMode ? 'Heat Devil: Old (0.75 Constant)' : 'Heat Devil: New (0.20 + Flare)';
    if (paused) render();
  };

  $('bloom-amt').oninput = () => {
    bloomGain = Number($('bloom-amt').value);
    $('bloom-val').textContent = bloomGain.toFixed(1) + 'x';
    if (paused) render();
  };
  $('ambient-heat').oninput = () => {
    ambientHeat = Number($('ambient-heat').value);
    $('ambient-val').textContent = ambientHeat.toFixed(2);
    if (paused) render();
  };
  $('resolution').oninput = () => {
    density = Number($('resolution').value);
    $('res-val').textContent = density + 'x';
    submitSamples.length = 0;
    if (paused) render();
  };

  $('trig-impact').onclick = () => { triggerFireImpact(simBodies[6].x, simBodies[6].y, -1, 0); if (paused) render(); };
  $('trig-shock').onclick = () => { triggerShockwaveBurst(simBodies[0].x, simBodies[0].y, 0, 155); if (paused) render(); };
  $('trig-ko').onclick = () => { triggerKoBurst(simBodies[4].x, simBodies[4].y, 0); if (paused) render(); };
  $('trig-ghost').onclick = () => { triggerGhostRipple(simBodies[3].x, simBodies[3].y); if (paused) render(); };

  function loop(now) {
    if (paused) return;
    const dt = lastFrameAt ? Math.min(0.05, (now - lastFrameAt) / 1000) : (1 / 60);
    lastFrameAt = now;
    stepWorld(dt);
    render();
    if (now - lastStatsAt > 350) { updateStats(); lastStatsAt = now; }
    requestAnimationFrame(loop);
  }

  resetScenario('heat');
  render();
  updateStats();
  $('status').textContent = 'Ready · Toggle any effect or switch scenarios to review.';
  requestAnimationFrame(loop);
})();
