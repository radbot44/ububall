/* Production WebGL2 rink scene renderer: multi-texture sprite & SDF batching,
   feathered umber/skid ribbons, GPU scene-to-texture heat refraction, and context recovery. */
(function (root) {
  'use strict';

  const FLOATS_PER_VERT = 14;
  const MAX_VERTS = 24576; // Multiple of 6; ~1.37 MB reusable Float32Array
  const MAX_SLOTS = 8;
  const MAX_TEXTURES = 160;

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
uniform float u_portraitLen;
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

float rinkSignedDist(vec2 p, int clipMode) {
  if (clipMode == 3) {
    float halfH = max(0.0, (u_portraitLen - 120.0) * 0.5 - 100.0);
    vec2 pq = abs(p - vec2(300.0, u_portraitLen * 0.5)) - vec2(140.0, halfH);
    return length(max(pq, 0.0)) + min(max(pq.x, pq.y), 0.0) - 100.0;
  }
  vec2 rq = abs(p - vec2(500.0, 300.0)) - vec2(340.0, 140.0);
  float dRink = length(max(rq, 0.0)) + min(max(rq.x, rq.y), 0.0) - 100.0;
  if (clipMode == 2) {
    vec2 gqL = abs(p - vec2(41.0, 300.0)) - vec2(19.0, 70.0);
    float dGoalL = length(max(gqL, 0.0)) + min(max(gqL.x, gqL.y), 0.0);
    vec2 gqR = abs(p - vec2(959.0, 300.0)) - vec2(19.0, 70.0);
    float dGoalR = length(max(gqR, 0.0)) + min(max(gqR.x, gqR.y), 0.0);
    return min(dRink, min(dGoalL, dGoalR));
  }
  return dRink;
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

vec3 unpack6bitColor(float p) {
  float r = floor(p / 4096.0);
  float rem = p - r * 4096.0;
  float g = floor(rem / 64.0);
  float b = rem - g * 64.0;
  return vec3(r, g, b) / 63.0;
}

void main() {
  int clipMode = int(v_aux.x + 0.5);
  float clipMask = 1.0;
  if (clipMode > 0) {
    float dClip = rinkSignedDist(v_fieldPos, clipMode);
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
    // Analytic disc / ring / dashed ring: v_uv = local offset in field units
    float dist = length(v_uv);
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(dist));
    float outerA = 1.0 - smoothstep(v_ext.z - aa, v_ext.z + aa, dist);
    float innerA = v_ext.y > 0.0 ? smoothstep(v_ext.y - aa, v_ext.y + aa, dist) : 1.0;
    float mask = outerA * innerA;
    if (v_ext.w > 0.0 && mask > 0.001) {
      float ang = atan(v_uv.y, v_uv.x);
      if (ang < 0.0) ang += 6.28318530718;
      float midR = max(1.0, 0.5 * (v_ext.y + v_ext.z));
      float arcPos = ang * midR;
      float period = v_ext.w;
      float dashLen = v_aux.y;
      float local = mod(arcPos, period);
      float dDash = min(local, period - local);
      float inside = step(local, dashLen);
      float edgeDist = min(abs(local - dashLen), dDash);
      float dashMask = inside > 0.5
        ? smoothstep(0.0, aa, min(local, dashLen - local) + 0.5 * aa)
        : 1.0 - smoothstep(0.0, aa, edgeDist + 0.5 * aa);
      mask *= clamp(dashMask, 0.0, 1.0);
    }
    if (mask <= 0.001) discard;
    outColor = v_color * (mask * clipMask);
    return;
  }

  if (mode == 3) {
    // Analytic circular arc: v_uv = local offset, y=midR, z=halfW, w=midAng, aux.y=signed halfSpan
    float ca = cos(v_ext.w), sa = sin(v_ext.w);
    vec2 p = vec2(ca * v_uv.x + sa * v_uv.y, -sa * v_uv.x + ca * v_uv.y);
    p.y = abs(p.y);
    float hs = abs(v_aux.y);
    float scx = cos(hs), scy = sin(hs);
    float dArc;
    if (hs < 3.1415 && scx * p.y > scy * p.x) {
      if (v_aux.y < 0.0) {
        float angErr = atan(p.y, p.x) - hs;
        dArc = max(abs(length(p) - v_ext.y) - v_ext.z, angErr * v_ext.y);
      } else {
        dArc = length(p - vec2(scx, scy) * v_ext.y) - v_ext.z;
      }
    } else {
      dArc = abs(length(p) - v_ext.y) - v_ext.z;
    }
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(dArc));
    float mask = 1.0 - smoothstep(-aa, aa, dArc);
    if (mask <= 0.001) discard;
    outColor = v_color * (mask * clipMask);
    return;
  }

  if (mode == 4) {
    // Analytic line / dashed segment: v_uv = (along, perp), y=segLen, z=halfW, w=capAndDashFlag, aux.y=dashPacked
    float segLen = v_ext.y;
    float halfW = v_ext.z;
    float d;
    if (v_ext.w < -0.5) {
      // Butt cap segment
      vec2 bq = abs(vec2(v_uv.x - 0.5 * segLen, v_uv.y)) - vec2(0.5 * segLen, halfW);
      d = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0);
    } else {
      // Round cap segment
      float cx = clamp(v_uv.x, 0.0, segLen);
      d = length(vec2(v_uv.x - cx, v_uv.y)) - halfW;
    }
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(d));
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (v_ext.w > 0.5 && mask > 0.001) {
      // Dashed segment: v_ext.w = period, v_aux.y = dashLen + phaseOffset * 1024.0
      float period = v_ext.w;
      float phaseOff = floor(v_aux.y / 1024.0) * 0.25;
      float dashLen = v_aux.y - floor(v_aux.y / 1024.0) * 1024.0;
      float local = mod(max(0.0, v_uv.x) + phaseOff, period);
      float dashMask = 1.0 - smoothstep(dashLen - aa, dashLen + aa, local);
      dashMask = max(dashMask, smoothstep(period - aa, period + aa, local));
      mask *= clamp(dashMask, 0.0, 1.0);
    }
    if (mask <= 0.001) discard;
    outColor = v_color * (mask * clipMask);
    return;
  }

  if (mode == 5) {
    // Soft feathered skid & warm umber-to-soot burn ribbon: v_uv in [-1..1]
    float r = length(v_uv);
    if (r >= 1.0) discard;
    bool isBurn = v_ext.y > 0.5;
    float fade = clamp(v_ext.z, 0.0, 1.0);
    bool hardEdge = v_ext.w > 0.5;
    float alpha;
    vec3 rgb;
    if (hardEdge) {
      float aa = max(0.03, fwidth(r));
      float prof = 1.0 - smoothstep(0.667 - aa, 0.667 + aa, r);
      alpha = (isBurn ? 0.42 : 0.20) * fade * prof;
      rgb = isBurn ? vec3(0.11, 0.045, 0.015) : vec3(0.0);
    } else {
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
      // Continuous cumulative feather matching the darker reddish-brown profile shared with impact scorches
      float prof = smoothstep(0.0, 0.94, sWarp) * (0.34 + 0.66 * smoothstep(0.06, 0.86, sWarp));
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
        alpha = 0.520 * fade * prof * mottle * emberGrain * (1.0 + speck * 0.42) * paceAlpha;
        float charNoise = ((nCoarse - 0.5) * 0.28 + (nMid - 0.5) * 0.14) * mix(0.30, 1.15, mess);
        float charMix = clamp(smoothstep(0.05, 0.78, sWarp) + charNoise, 0.0, 1.0);
        rgb = mix(vec3(0.220, 0.082, 0.024), vec3(0.098, 0.033, 0.010), charMix) * paceShade;
        rgb = mix(rgb, vec3(0.012, 0.006, 0.003), min(1.0, speck * 0.88));
        if (emberHeat > 0.001) {
          float glowCurve = emberHeat * emberHeat;
          float fissure = (0.35 + 0.65 * nCoarse) * (0.40 + 0.60 * (1.0 - min(1.0, speck)));
          float emberGlow = glowCurve * smoothstep(0.20, 0.88, sWarp) * fissure;
          rgb = mix(rgb, vec3(0.64, 0.15, 0.025), clamp(emberGlow * 0.24, 0.0, 0.22));
          alpha += emberGlow * 0.03 * fade;

          // Subtle pinpoint glowing sparks lingering briefly inside the fresh scorch path
          float nGlintA = vnoise(v_fieldPos * 1.15 + vec2(43.1, 19.7));
          float nGlintB = vnoise(v_fieldPos * 1.95 + vec2(11.3, 57.9));
          float flicker = 0.70 + 0.30 * sin(u_time * 16.0 + nMacro * 14.0 + nCoarse * 9.0);
          float sparkDot = smoothstep(0.55, 0.72, nGlintA * nGlintB + (nFine - 0.5) * 0.14) * smoothstep(0.10, 0.68, sWarp);
          float sparkGlow = sparkDot * emberHeat * (0.45 + 0.55 * glowCurve) * flicker;
          rgb = mix(rgb, vec3(1.0, 0.60, 0.14), clamp(sparkGlow * 1.35, 0.0, 0.90));
          alpha += sparkGlow * 0.38 * fade;
        }
      } else {
        // Striated along the direction of travel (along), scaled by skate cut/brake tear intensity
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
      alpha = clamp(alpha, 0.0, 1.0);
    }
    float outA = alpha * clipMask;
    if (outA <= 0.001) discard;
    outColor = vec4(rgb * outA, outA);
    return;
  }

  if (mode == 6) {
    // Analytic rounded-rect fill or stroke: v_uv = offset from center, y=halfW, z=halfH, w=cornerR, aux.y=strokeHalfW (0 = fill)
    float cr = min(v_ext.w, min(v_ext.y, v_ext.z));
    vec2 q = abs(v_uv) - vec2(v_ext.y - cr, v_ext.z - cr);
    float dRect = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cr;
    float d = v_aux.y > 0.0 ? abs(dRect) - v_aux.y : dRect;
    float aa = max(0.55 * u_pxScale, 0.65 * fwidth(d));
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.001) discard;
    outColor = v_color * (mask * clipMask);
    return;
  }

  if (mode == 7) {
    // #6 Shader-Native Conic Super Aura + Soft Corona
    // v_uv = local offset, v_ext.y = ringR, v_ext.z = halfW, v_ext.w = level, v_aux.y = packed c2
    float dist = length(v_uv);
    float ringR = v_ext.y;
    float halfW = v_ext.z;
    float level = v_ext.w;
    vec3 c1 = v_color.rgb;
    vec3 c2 = unpack6bitColor(v_aux.y);
    float ang = atan(v_uv.y, v_uv.x);
    float spin = u_time * (0.65 + level * 1.35);

    float coronaDist = abs(dist - ringR);
    float corona = exp(-coronaDist * coronaDist / (level > 1.5 ? 95.0 : 52.0)) * (level > 1.5 ? 0.42 : 0.22);
    vec3 colSum = mix(c1, c2, 0.5 + 0.5 * sin(ang * 2.0 - spin)) * corona;
    float aSum = corona * v_color.a;

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

  if (mode == 9) {
    // #13 Feathered & Turbulent Motion Trails: v_uv.x = alongU (0..1), v_uv.y = signed across offset, v_ext.y = heat, v_ext.z = halfWidth
    float signedAcross = v_ext.z > 0.0001 ? clamp(v_uv.y / v_ext.z, -1.0, 1.0) : clamp(v_uv.y, -1.0, 1.0);
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
    float tpdf = hash21(gl_FragCoord.xy) + hash21(gl_FragCoord.xy + vec2(17.3, 31.7)) - 1.0;
    float dither = tpdf * (1.25 / 255.0) * smoothstep(0.0, 0.04, col.a);
    col.rgb = max(vec3(0.0), col.rgb + dither);
    outColor = col;
    return;
  }

  outColor = v_color * clipMask;
}`;

  const WARP_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_unit;
uniform vec4 u_quad;
uniform vec4 u_view;
out vec2 v_fieldPos;
void main() {
  vec2 pos = u_quad.xy + a_unit * u_quad.zw;
  v_fieldPos = pos;
  vec2 ndc = (pos - u_view.zw) / u_view.xy * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

  const WARP_FRAG = `#version 300 es
precision highp float;
in vec2 v_fieldPos;
uniform sampler2D u_scene;
uniform vec4 u_view;
uniform int u_heatCount;
uniform vec4 u_heat[6];
uniform vec4 u_heatMeta[6];
uniform float u_enableChroma;
out vec4 outColor;

float rinkDomainDist(vec2 p) {
  vec2 rq = abs(p - vec2(500.0, 300.0)) - vec2(340.0, 140.0);
  float dRink = length(max(rq, 0.0)) + min(max(rq.x, rq.y), 0.0) - 100.0;
  vec2 gqL = abs(p - vec2(41.0, 300.0)) - vec2(19.0, 70.0);
  float dGoalL = length(max(gqL, 0.0)) + min(max(gqL.x, gqL.y), 0.0);
  vec2 gqR = abs(p - vec2(959.0, 300.0)) - vec2(19.0, 70.0);
  float dGoalR = length(max(gqR, 0.0)) + min(max(gqR.x, gqR.y), 0.0);
  return min(dRink, min(dGoalL, dGoalR));
}

void computeWarpDisp(vec2 p, vec4 h, vec4 meta, out vec2 disp, out float chroma, out float cyanTint) {
  disp = vec2(0.0);
  chroma = 0.0;
  cyanTint = 0.0;
  vec2 center = h.xy;
  float mirageR = h.z;
  float strength = h.w;
  float t = meta.x;
  int kind = int(meta.y + 0.5);
  float sub = meta.z;
  vec2 rel = p - center;
  float dist = length(rel);
  if (dist >= mirageR * 1.24 || strength <= 0.001) return;

  vec2 radial = dist > 0.001 ? rel / dist : vec2(0.0, -1.0);

  if (kind == 1) {
    // #1 Shockwave / Knockout / Cannonball expanding radial space-warp wavefront
    float normR = dist / max(1.0, mirageR);
    float wavePos = 0.14 + 0.76 * t;
    float delta = normR - wavePos;
    float bandW = sub > 0.5 ? 28.0 : 42.0;
    float ring = exp(-delta * delta * bandW);
    float env = (1.0 - smoothstep(0.75, 1.15, normR)) * ring;
    float push = (delta >= 0.0 ? -1.0 : 1.0) * 14.0 * env + sin(delta * 26.0) * 4.5 * env;
    disp = radial * (push - env * 9.5) * strength;
    chroma = env * strength * meta.w;
    return;
  }

  if (kind == 2) {
    // #4 Ghost phase-shift crisp geometric concentric spectral rings + ice/skater pinch
    float ringR = (0.14 + 0.86 * t) * mirageR;
    float band = 1.0 - smoothstep(2.5, 9.5, abs(dist - ringR));
    float band2 = (1.0 - smoothstep(2.0, 7.5, abs(dist - ringR * 0.62))) * 0.72;
    float fade = 1.0 - smoothstep(0.62, 1.0, t);
    disp = radial * (band * 18.0 - band2 * 11.0) * fade * strength;
    cyanTint = (band * 0.85 + band2 * 0.55) * fade * strength;
    chroma = (band + band2) * fade * meta.w * 1.8;
    return;
  }

  // kind == 0: Heat Devil (weak cruising shimmer + brief full impact flare)
  bool isImpact = sub > 0.5;
  float ang = atan(rel.y, rel.x);
  float lobe = 1.0 + 0.16 * sin(ang * 3.0 + t * 5.1) + 0.10 * cos(ang * 2.0 - t * 3.6);
  float effU = dist / max(1.0, mirageR * lobe);
  if (effU >= 1.0) return;

  float env = 1.0 - smoothstep(0.24, 1.0, effU);

  if (isImpact) {
    float ringPos = 0.25 + 0.58 * t;
    float ringDelta = (dist / max(1.0, mirageR)) - ringPos;
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
    float orbitR = mirageR * (0.34 + 0.22 * sin(t * 5.2 + fk * 1.8));
    float updraft = isImpact ? 0.0 : (sin(t * 6.5 + fk * 2.0) * 0.18 - 0.09) * mirageR;
    vec2 eddyPos = center + vec2(cos(orbitAng) * orbitR, sin(orbitAng) * orbitR * 0.86 + updraft);
    float eddyR = mirageR * (isImpact ? 0.40 + 0.12 * cos(t * 7.0 + fk) : 0.45 + 0.11 * sin(t * 4.5 + fk));
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
  chroma = env * strength * meta.w * (isImpact ? 1.1 : 0.45);
}

void main() {
  float dHere = rinkDomainDist(v_fieldPos);
  float inDomain = 1.0 - smoothstep(-1.5, 0.5, dHere);
  vec2 totalDisp = vec2(0.0);
  float totalChroma = 0.0;
  float totalCyan = 0.0;
  if (inDomain > 0.001) {
    for (int i = 0; i < 6; i++) {
      if (i >= u_heatCount) break;
      vec2 d; float ch; float cy;
      computeWarpDisp(v_fieldPos, u_heat[i], u_heatMeta[i], d, ch, cy);
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
  vec2 uv = vec2((samplePos.x - u_view.z) / u_view.x, 1.0 - (samplePos.y - u_view.w) / u_view.y);
  uv = clamp(uv, vec2(0.0005), vec2(0.9995));
  if (u_enableChroma > 0.5 && totalChroma > 0.05) {
    vec2 delta = (samplePos - v_fieldPos) / vec2(u_view.x, u_view.y);
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

  const BLOOM_QUAD_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_unit;
out vec2 v_uv;
void main() {
  v_uv = a_unit;
  gl_Position = vec4(a_unit * 2.0 - 1.0, 0.0, 1.0);
}`;

  const BLOOM_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_dir;
out vec4 outColor;
void main() {
  vec2 stepUv = u_texel * u_dir;
  vec4 c = texture(u_tex, v_uv) * 0.227027;
  c += texture(u_tex, v_uv + stepUv * 1.384615) * 0.316216;
  c += texture(u_tex, v_uv - stepUv * 1.384615) * 0.316216;
  c += texture(u_tex, v_uv + stepUv * 3.230769) * 0.070270;
  c += texture(u_tex, v_uv - stepUv * 3.230769) * 0.070270;
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

  const colorParseCache = new Map();
  function parseColor(str) {
    if (!str) return [1, 1, 1, 1];
    let hit = colorParseCache.get(str);
    if (hit) return hit;
    let out = [1, 1, 1, 1];
    const s = String(str).trim();
    if (s.charCodeAt(0) === 35) { // '#'
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16) / 255;
        const g = parseInt(hex[1] + hex[1], 16) / 255;
        const b = parseInt(hex[2] + hex[2], 16) / 255;
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
        out = [r, g, b, a];
      } else if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        out = [r, g, b, a];
      }
    } else if (s.startsWith('rgb')) {
      const m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        out = [
          Math.min(1, Number(m[0]) / 255),
          Math.min(1, Number(m[1]) / 255),
          Math.min(1, Number(m[2]) / 255),
          m.length >= 4 ? Math.max(0, Math.min(1, Number(m[3]))) : 1
        ];
      }
    } else if (s.startsWith('hsl')) {
      const m = s.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        const h = ((Number(m[0]) % 360) + 360) % 360 / 60;
        const sat = Math.max(0, Math.min(1, Number(m[1]) / 100));
        const l = Math.max(0, Math.min(1, Number(m[2]) / 100));
        const c = (1 - Math.abs(2 * l - 1)) * sat;
        const x = c * (1 - Math.abs((h % 2) - 1));
        const m0 = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 1) { r = c; g = x; }
        else if (h < 2) { r = x; g = c; }
        else if (h < 3) { g = c; b = x; }
        else if (h < 4) { g = x; b = c; }
        else if (h < 5) { r = x; b = c; }
        else { r = c; b = x; }
        out = [r + m0, g + m0, b + m0, m.length >= 4 ? Number(m[3]) : 1];
      }
    } else if (s === 'transparent') {
      out = [0, 0, 0, 0];
    }
    if (colorParseCache.size > 512) colorParseCache.delete(colorParseCache.keys().next().value);
    colorParseCache.set(str, out);
    return out;
  }

  // Clip a convex ribbon polygon [{ x, y, u, v, s, p }, ...] to half-plane (p - o) · n >= 0.
  function clipRibbonPoly(poly, ox, oy, nx, ny) {
    if (poly.length < 3) return [];
    const out = [];
    let prev = poly[poly.length - 1];
    let prevD = (prev.x - ox) * nx + (prev.y - oy) * ny;
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const curD = (cur.x - ox) * nx + (cur.y - oy) * ny;
      if (curD >= -1e-6) {
        if (prevD < -1e-6) {
          const t = prevD / (prevD - curD);
          out.push({
            x: prev.x + t * (cur.x - prev.x),
            y: prev.y + t * (cur.y - prev.y),
            u: prev.u + t * (cur.u - prev.u),
            v: prev.v + t * (cur.v - prev.v),
            s: prev.s + t * (cur.s - prev.s),
            p: prev.p + t * (cur.p - prev.p),
            sp: prev.sp + t * (cur.sp - prev.sp),
            h: prev.h + t * (cur.h - prev.h)
          });
        }
        out.push(cur);
      } else if (prevD >= -1e-6) {
        const t = prevD / (prevD - curD);
        out.push({
          x: prev.x + t * (cur.x - prev.x),
          y: prev.y + t * (cur.y - prev.y),
          u: prev.u + t * (cur.u - prev.u),
          v: prev.v + t * (cur.v - prev.v),
          s: prev.s + t * (cur.s - prev.s),
          p: prev.p + t * (cur.p - prev.p),
          sp: prev.sp + t * (cur.sp - prev.sp),
          h: prev.h + t * (cur.h - prev.h)
        });
      }
      prev = cur;
      prevD = curD;
    }
    return out;
  }

  // Apply Voronoi bisector planes, guarding each non-adjacent cut to the finite neighbor segment's slab.
  function applyRibbonSlabs(polys, planes) {
    let cur = polys;
    for (let pIdx = 0; pIdx < planes.length; pIdx++) {
      const pl = planes[pIdx];
      const next = [];
      for (let k = 0; k < cur.length; k++) {
        const p = cur[k];
        if (p.length < 3) continue;
        const s0 = pl.s0, s1 = pl.s1;
        const out0 = clipRibbonPoly(p, s0.x, s0.y, -pl.tx, -pl.ty);
        if (out0.length >= 3) next.push(out0);
        const in0 = clipRibbonPoly(p, s0.x, s0.y, pl.tx, pl.ty);
        if (in0.length >= 3) {
          const out1 = clipRibbonPoly(in0, s1.x, s1.y, pl.tx, pl.ty);
          if (out1.length >= 3) next.push(out1);
          const inside = clipRibbonPoly(in0, s1.x, s1.y, -pl.tx, -pl.ty);
          if (inside.length >= 3) {
            const cp = clipRibbonPoly(inside, pl.ox, pl.oy, pl.bx, pl.by);
            if (cp.length >= 3) next.push(cp);
          }
        }
      }
      cur = next;
    }
    return cur;
  }

  // Compute the line-intersection bisector plane separating segment i and segment j (pointing from i toward j).
  function ribbonSegBisector(clean, tx, ty, i, j) {
    const ai = clean[i], bi = clean[i + 1], aj = clean[j], bj = clean[j + 1];
    const mxI = (ai.x + bi.x) * 0.5, myI = (ai.y + bi.y) * 0.5;
    const mxJ = (aj.x + bj.x) * 0.5, myJ = (aj.y + bj.y) * 0.5;
    const tix = tx[i], tiy = ty[i], tjx = tx[j], tjy = ty[j];
    const cross = tix * tjy - tiy * tjx;
    const dot = tix * tjx + tiy * tjy;
    if (Math.abs(cross) > 1e-4) {
      const dx = aj.x - ai.x, dy = aj.y - ai.y;
      const s = (dx * tjy - dy * tjx) / cross;
      const qx = ai.x + s * tix, qy = ai.y + s * tiy;
      for (const sign of [1, -1]) {
        let bx = tix + sign * tjx, by = tiy + sign * tjy;
        const bl = Math.hypot(bx, by);
        if (bl > 1e-5) {
          bx /= bl; by /= bl;
          const dI = (mxI - qx) * bx + (myI - qy) * by;
          const dJ = (mxJ - qx) * bx + (myJ - qy) * by;
          if (dI * dJ <= 1e-6) {
            return dJ >= dI
              ? { ox: qx, oy: qy, bx, by }
              : { ox: qx, oy: qy, bx: -bx, by: -by };
          }
        }
      }
      return null;
    }
    if (dot < -0.9) {
      const dx = mxJ - mxI, dy = myJ - myI;
      const proj = dx * tix + dy * tiy;
      const px = dx - proj * tix, py = dy - proj * tiy;
      const pl = Math.hypot(px, py);
      if (pl > 1e-4) {
        return { ox: (mxI + mxJ) * 0.5, oy: (myI + myJ) * 0.5, bx: px / pl, by: py / pl };
      }
    }
    return null;
  }

  /**
   * Tessellates a feathered polyline ribbon into non-overlapping triangles with round caps,
   * outer round joins, and Voronoi-clipped inner corners so tight curves and sharp bounces
   * never twist, pinch, or double-darken.
   */
  function emitSoftRibbonTriangles(points, widthAt, emitPoly, paceAt = null, speedAt = null, heatAt = null) {
    if (!points || !points.length) return;
    const paceVal = pt => paceAt ? paceAt(pt) : (pt.pace ?? 0.35);
    const speedVal = pt => speedAt ? speedAt(pt) : (pt.speed ?? 0.35);
    const heatVal = pt => heatAt ? heatAt(pt) : (pt.heat ?? 0);
    const raw = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = raw[raw.length - 1], cur = points[i];
      const d2 = (cur.x - prev.x) ** 2 + (cur.y - prev.y) ** 2;
      if (d2 >= 0.64 || i === points.length - 1) {
        if (d2 >= 0.04) raw.push(cur);
      }
    }
    if (raw.length === 1) {
      const p0 = raw[0], r0 = Math.max(0.5, widthAt(p0) * 0.5 * 1.5), pv = paceVal(p0), sv = speedVal(p0), hv = heatVal(p0), discSteps = 20;
      for (let s = 0; s < discSteps; s++) {
        const a0 = (s / discSteps) * Math.PI * 2, a1 = ((s + 1) / discSteps) * Math.PI * 2;
        emitPoly([
          { x: p0.x, y: p0.y, u: 0, v: 0, s: 0, p: pv, sp: sv, h: hv },
          { x: p0.x + Math.cos(a0) * r0, y: p0.y + Math.sin(a0) * r0, u: Math.cos(a0), v: Math.sin(a0), s: 0, p: pv, sp: sv, h: hv },
          { x: p0.x + Math.cos(a1) * r0, y: p0.y + Math.sin(a1) * r0, u: Math.cos(a1), v: Math.sin(a1), s: 0, p: pv, sp: sv, h: hv }
        ]);
      }
      return;
    }

    // Collapse nearly-collinear micro-steps while preserving corners, curves, and width tapers
    const clean = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
      const a = clean[clean.length - 1], b = raw[i], c = raw[i + 1];
      const acx = c.x - a.x, acy = c.y - a.y, acl = Math.hypot(acx, acy) || 1;
      const perp = Math.abs((b.x - a.x) * acy - (b.y - a.y) * acx) / acl;
      const along = ((b.x - a.x) * acx + (b.y - a.y) * acy) / (acl * acl);
      const dw = Math.abs(widthAt(b) - (widthAt(a) + widthAt(c)) * 0.5);
      const dp = Math.abs(paceVal(b) - (paceVal(a) + paceVal(c)) * 0.5);
      const dsp = Math.abs(speedVal(b) - (speedVal(a) + speedVal(c)) * 0.5);
      const dh = Math.abs(heatVal(b) - (heatVal(a) + heatVal(c)) * 0.5);
      if (perp < 0.35 && along > 0 && along < 1 && acl < 30 && dw < 0.8 && dp < 0.08 && dsp < 0.08 && dh < 0.08) continue;
      clean.push(b);
    }
    clean.push(raw[raw.length - 1]);
    const n = clean.length;
    if (n < 2) return;

    const m = n - 1;
    const halfs = new Array(n);
    const paces = new Array(n);
    const speeds = new Array(n);
    const heats = new Array(n);
    let maxR = 0.5;
    for (let k = 0; k < n; k++) {
      const r = Math.max(0.5, widthAt(clean[k]) * 0.5 * 1.5); // 1.5x outer feather extent
      halfs[k] = r;
      paces[k] = paceVal(clean[k]);
      speeds[k] = speedVal(clean[k]);
      heats[k] = heatVal(clean[k]);
      if (r > maxR) maxR = r;
    }

    const tx = new Array(m), ty = new Array(m), nx = new Array(m), ny = new Array(m);
    const cumLen = new Array(n);
    cumLen[0] = 0;
    for (let i = 0; i < m; i++) {
      const dx = clean[i + 1].x - clean[i].x, dy = clean[i + 1].y - clean[i].y;
      const l = Math.hypot(dx, dy) || 1;
      tx[i] = dx / l; ty[i] = dy / l;
      nx[i] = -ty[i]; ny[i] = tx[i];
      cumLen[i + 1] = cumLen[i] + l;
    }

    const joints = new Array(n).fill(null);
    for (let k = 1; k < n - 1; k++) {
      const dot = tx[k - 1] * tx[k] + ty[k - 1] * ty[k];
      const cross = tx[k - 1] * ty[k] - ty[k - 1] * tx[k];
      const sIn = cross > 1e-6 ? 1 : cross < -1e-6 ? -1 : (dot < 0 ? 1 : 0);
      let bx = tx[k - 1] + tx[k], by = ty[k - 1] + ty[k], bl = Math.hypot(bx, by);
      if (bl < 1e-5) { bx = -tx[k - 1]; by = -ty[k - 1]; bl = 1; }
      joints[k] = { dot, cross, sIn, bx: bx / bl, by: by / bl };
    }

    const capSteps = 10;
    {
      const p0 = clean[0], r0 = halfs[0], pv0 = paces[0], sv0 = speeds[0], hv0 = heats[0], baseAng = Math.atan2(ny[0], nx[0]);
      for (let s = 0; s < capSteps; s++) {
        const a0 = (s / capSteps) * Math.PI, a1 = ((s + 1) / capSteps) * Math.PI;
        emitPoly([
          { x: p0.x, y: p0.y, u: 0, v: 0, s: 0, p: pv0, sp: sv0, h: hv0 },
          { x: p0.x + Math.cos(baseAng + a0) * r0, y: p0.y + Math.sin(baseAng + a0) * r0, u: Math.cos(a0), v: Math.sin(a0), s: 0, p: pv0, sp: sv0, h: hv0 },
          { x: p0.x + Math.cos(baseAng + a1) * r0, y: p0.y + Math.sin(baseAng + a1) * r0, u: Math.cos(a1), v: Math.sin(a1), s: 0, p: pv0, sp: sv0, h: hv0 }
        ]);
      }
    }

    const searchDist = maxR * 3.0;
    for (let i = 0; i < m; i++) {
      const p0 = clean[i], p1 = clean[i + 1], r0 = halfs[i], r1 = halfs[i + 1];
      const s0 = cumLen[i], s1 = cumLen[i + 1], pv0 = paces[i], pv1 = paces[i + 1], sv0 = speeds[i], sv1 = speeds[i + 1], hv0 = heats[i], hv1 = heats[i + 1];
      const nxi = nx[i], nyi = ny[i];
      const extraPlanes = [];
      for (let j = i - 2; j >= 0 && cumLen[i] - cumLen[j + 1] <= searchDist; j--) {
        if (tx[i] * tx[j] + ty[i] * ty[j] > 0.65) continue;
        const b = ribbonSegBisector(clean, tx, ty, j, i);
        if (b && (p0.x - b.ox) * b.bx + (p0.y - b.oy) * b.by >= -1e-4 && (p1.x - b.ox) * b.bx + (p1.y - b.oy) * b.by >= -1e-4) {
          extraPlanes.push({ j, ox: b.ox, oy: b.oy, bx: b.bx, by: b.by, s0: clean[j], s1: clean[j + 1], tx: tx[j], ty: ty[j] });
        }
      }
      for (let j = i + 2; j < m && cumLen[j] - cumLen[i + 1] <= searchDist; j++) {
        if (tx[i] * tx[j] + ty[i] * ty[j] > 0.65) continue;
        const b = ribbonSegBisector(clean, tx, ty, i, j);
        if (b && (p0.x - b.ox) * (-b.bx) + (p0.y - b.oy) * (-b.by) >= -1e-4 && (p1.x - b.ox) * (-b.bx) + (p1.y - b.oy) * (-b.by) >= -1e-4) {
          extraPlanes.push({ j, ox: b.ox, oy: b.oy, bx: -b.bx, by: -b.by, s0: clean[j], s1: clean[j + 1], tx: tx[j], ty: ty[j] });
        }
      }

      for (const side of [1, -1]) {
        let poly = [
          { x: p0.x, y: p0.y, u: 0, v: 0, s: s0, p: pv0, sp: sv0, h: hv0 },
          { x: p1.x, y: p1.y, u: 0, v: 0, s: s1, p: pv1, sp: sv1, h: hv1 },
          { x: p1.x + side * nxi * r1, y: p1.y + side * nyi * r1, u: side, v: 0, s: s1, p: pv1, sp: sv1, h: hv1 },
          { x: p0.x + side * nxi * r0, y: p0.y + side * nyi * r0, u: side, v: 0, s: s0, p: pv0, sp: sv0, h: hv0 }
        ];
        if (joints[i] && joints[i].sIn === side) poly = clipRibbonPoly(poly, p0.x, p0.y, joints[i].bx, joints[i].by);
        if (joints[i + 1] && joints[i + 1].sIn === side) poly = clipRibbonPoly(poly, p1.x, p1.y, -joints[i + 1].bx, -joints[i + 1].by);
        const clipped = applyRibbonSlabs([poly], extraPlanes);
        for (let k = 0; k < clipped.length; k++) emitPoly(clipped[k]);
      }

      if (i + 1 < n - 1 && joints[i + 1] && joints[i + 1].sIn !== 0) {
        const sOut = -joints[i + 1].sIn;
        const ox0 = sOut * nx[i], oy0 = sOut * ny[i], ox1 = sOut * nx[i + 1], oy1 = sOut * ny[i + 1];
        const ang0 = Math.atan2(oy0, ox0);
        let dAng = Math.atan2(ox0 * oy1 - oy0 * ox1, ox0 * ox1 + oy0 * oy1);
        if (Math.abs(dAng) < 1e-4 && ox0 * ox1 + oy0 * oy1 < -0.9999) dAng = -sOut * Math.PI;
        if (Math.abs(dAng) > 1e-3) {
          const steps = Math.max(1, Math.ceil(Math.abs(dAng) / (Math.PI / 10)));
          const pk = clean[i + 1], rk = halfs[i + 1], pvk = paces[i + 1], svk = speeds[i + 1], hvk = heats[i + 1];
          const fanPlanes = extraPlanes.filter(pl => (pl.j <= i - 2 || pl.j >= i + 3) && (pk.x - pl.ox) * pl.bx + (pk.y - pl.oy) * pl.by > 2.0);
          for (let s = 0; s < steps; s++) {
            const a0 = ang0 + (s / steps) * dAng, a1 = ang0 + ((s + 1) / steps) * dAng;
            const tri = [
              { x: pk.x, y: pk.y, u: 0, v: 0, s: s1, p: pvk, sp: svk, h: hvk },
              { x: pk.x + Math.cos(a0) * rk, y: pk.y + Math.sin(a0) * rk, u: Math.cos((s / steps) * Math.abs(dAng)), v: Math.sin((s / steps) * Math.abs(dAng)), s: s1, p: pvk, sp: svk, h: hvk },
              { x: pk.x + Math.cos(a1) * rk, y: pk.y + Math.sin(a1) * rk, u: Math.cos(((s + 1) / steps) * Math.abs(dAng)), v: Math.sin(((s + 1) / steps) * Math.abs(dAng)), s: s1, p: pvk, sp: svk, h: hvk }
            ];
            const clipped = fanPlanes.length ? applyRibbonSlabs([tri], fanPlanes) : [tri];
            for (let k = 0; k < clipped.length; k++) emitPoly(clipped[k]);
          }
        }
      }
    }

    {
      const pm = clean[n - 1], rm = halfs[n - 1], sm = cumLen[n - 1], pvm = paces[n - 1], svm = speeds[n - 1], hvm = heats[n - 1];
      const baseAng = Math.atan2(-ny[m - 1], -nx[m - 1]);
      for (let s = 0; s < capSteps; s++) {
        const a0 = (s / capSteps) * Math.PI, a1 = ((s + 1) / capSteps) * Math.PI;
        emitPoly([
          { x: pm.x, y: pm.y, u: 0, v: 0, s: sm, p: pvm, sp: svm, h: hvm },
          { x: pm.x + Math.cos(baseAng + a0) * rm, y: pm.y + Math.sin(baseAng + a0) * rm, u: -Math.cos(a0), v: Math.sin(a0), s: sm, p: pvm, sp: svm, h: hvm },
          { x: pm.x + Math.cos(baseAng + a1) * rm, y: pm.y + Math.sin(baseAng + a1) * rm, u: -Math.cos(a1), v: Math.sin(a1), s: sm, p: pvm, sp: svm, h: hvm }
        ]);
      }
    }
  }

  let nextSourceId = 1;
  const sourceIds = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function idForSource(src) {
    if (!src || (typeof src !== 'object' && typeof src !== 'function')) return 'null';
    if (sourceIds) {
      let id = sourceIds.get(src);
      if (!id) { id = nextSourceId++; sourceIds.set(src, id); }
      return 's' + id;
    }
    return 's' + (src._glSrcId ||= nextSourceId++);
  }

  function createSceneRenderer(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const gl = canvas.getContext('webgl2', {
      alpha: options.alpha !== false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer),
      powerPreference: 'high-performance'
    });
    if (!gl || typeof gl.createProgram !== 'function' || typeof gl.createVertexArray !== 'function') return null;

    let disposed = false;
    let contextLost = Boolean(gl.isContextLost && gl.isContextLost());
    let maxTexSize = 4096;

    // GPU resource handles (rebuilt on webglcontextrestored)
    let batchProg = null;
    let warpProg = null;
    let blurProg = null;
    let bloomCompProg = null;
    let batchVao = null;
    let batchVbo = null;
    let warpVao = null;
    let warpVbo = null;
    let whiteTex = null;
    let sceneTex = null;
    let sceneFbo = null;
    let fboW = 0, fboH = 0;
    let emissiveTex = null, emissiveFbo = null, emW = 0, emH = 0;
    let bloomTexA = null, bloomFboA = null, bloomTexB = null, bloomFboB = null, blW = 0, blH = 0;

    // Optional non-blocking GPU timer query telemetry (EXT_disjoint_timer_query_webgl2)
    let timerExt = null;
    let pendingQueries = [];
    let activeQuery = null;
    let lastGpuMs = null;

    // Texture cache: key -> { tex, width, height, rev, frameStamp }
    const texCache = new Map();
    let frameStamp = 0;
    let drawCallCount = 0;
    let lastFrameDrawCalls = 0;

    // Dynamic vertex batch state
    const verts = new Float32Array(MAX_VERTS * FLOATS_PER_VERT);
    let vertCount = 0;
    const boundTexSlots = [];
    let currentBlend = 'normal';
    let currentClip = 0;
    let logicalW = 1000, logicalH = 600, viewOffX = 0, viewOffY = 0;
    let portraitLen = 1000;
    let curW = 0, curH = 0;
    let curTime = 0;
    let usingSceneFbo = false;
    let usingEmissiveFbo = false;

    // 2D affine matrix stack [a, b, c, d, tx, ty]
    let m0 = 1, m1 = 0, m2 = 0, m3 = 1, m4 = 0, m5 = 0;
    const matStack = [];

    function compileProgram(vsSrc, fsSrc, uniformNames) {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSrc);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(vs);
        gl.deleteShader(vs);
        throw new Error('WebGL2 vertex shader error: ' + log);
      }
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSrc);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(fs);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        throw new Error('WebGL2 fragment shader error: ' + log);
      }
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error('WebGL2 program link error: ' + log);
      }
      const u = {};
      for (const name of uniformNames) u[name] = gl.getUniformLocation(p, name);
      return { p, u };
    }

    function initGpuResources() {
      maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      batchProg = compileProgram(BATCH_VERT, BATCH_FRAG, [
        'u_view', 'u_pxScale', 'u_portraitLen', 'u_time',
        'u_tex0', 'u_tex1', 'u_tex2', 'u_tex3', 'u_tex4', 'u_tex5', 'u_tex6', 'u_tex7'
      ]);
      warpProg = compileProgram(WARP_VERT, WARP_FRAG, [
        'u_quad', 'u_view', 'u_scene', 'u_heatCount', 'u_enableChroma',
        'u_heat[0]', 'u_heat[1]', 'u_heat[2]', 'u_heat[3]', 'u_heat[4]', 'u_heat[5]',
        'u_heatMeta[0]', 'u_heatMeta[1]', 'u_heatMeta[2]', 'u_heatMeta[3]', 'u_heatMeta[4]', 'u_heatMeta[5]'
      ]);

      batchVao = gl.createVertexArray();
      batchVbo = gl.createBuffer();
      gl.bindVertexArray(batchVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, batchVbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);
      const stride = FLOATS_PER_VERT * 4;
      // 0: a_pos (2), 1: a_uv (2), 2: a_color (4), 3: a_ext (4), 4: a_aux (2)
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 48);

      warpVao = gl.createVertexArray();
      warpVbo = gl.createBuffer();
      gl.bindVertexArray(warpVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, warpVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.bindVertexArray(null);

      // Bind sampler uniforms 0..7 once on batchProg
      gl.useProgram(batchProg.p);
      for (let i = 0; i < MAX_SLOTS; i++) gl.uniform1i(batchProg.u['u_tex' + i], i);

      gl.useProgram(warpProg.p);
      gl.uniform1i(warpProg.u.u_scene, 0);

      // 1x1 opaque white fallback texture
      whiteTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, whiteTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

      sceneTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      sceneFbo = gl.createFramebuffer();
      fboW = 0; fboH = 0;

      timerExt = options.enableGpuTimer ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
      pendingQueries = [];
      activeQuery = null;
    }

    if (!contextLost) initGpuResources();

    function onContextLost(e) {
      e.preventDefault();
      contextLost = true;
      texCache.clear();
      boundTexSlots.length = 0;
      vertCount = 0;
      fboW = fboH = 0;
      emW = emH = blW = blH = 0;
      blurProg = bloomCompProg = null;
      emissiveTex = emissiveFbo = bloomTexA = bloomFboA = bloomTexB = bloomFboB = null;
      usingSceneFbo = false;
      usingEmissiveFbo = false;
      pendingQueries = [];
      activeQuery = null;
      options.onContextLost?.();
    }

    function onContextRestored() {
      if (disposed) return;
      try {
        initGpuResources();
        contextLost = false;
        options.onContextRestored?.();
      } catch (err) {
        contextLost = true;
        options.onContextError?.(err);
      }
    }

    canvas.addEventListener?.('webglcontextlost', onContextLost);
    canvas.addEventListener?.('webglcontextrestored', onContextRestored);

    function ensureFboTarget(tex, fbo, w, h) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        throw new Error('Framebuffer is incomplete.');
      }
    }

    function ensureSceneFbo(w, h) {
      if (fboW === w && fboH === h) return;
      fboW = w; fboH = h;
      ensureFboTarget(sceneTex, sceneFbo, w, h);
    }

    function makeLinearTarget() {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex, fbo: gl.createFramebuffer() };
    }

    function ensureBloomResources(w, h) {
      if (!blurProg) {
        blurProg = compileProgram(BLOOM_QUAD_VERT, BLOOM_BLUR_FRAG, ['u_tex', 'u_texel', 'u_dir']);
        gl.useProgram(blurProg.p);
        gl.uniform1i(blurProg.u.u_tex, 0);
      }
      if (!bloomCompProg) {
        bloomCompProg = compileProgram(BLOOM_QUAD_VERT, BLOOM_COMP_FRAG, ['u_bloom', 'u_gain']);
        gl.useProgram(bloomCompProg.p);
        gl.uniform1i(bloomCompProg.u.u_bloom, 0);
      }
      const ew = Math.max(64, Math.floor(w * 0.5)), eh = Math.max(64, Math.floor(h * 0.5));
      if (!emissiveTex) {
        const t = makeLinearTarget();
        emissiveTex = t.tex; emissiveFbo = t.fbo;
      }
      if (emW !== ew || emH !== eh) {
        emW = ew; emH = eh;
        ensureFboTarget(emissiveTex, emissiveFbo, ew, eh);
      }
      const bw = Math.max(32, Math.floor(w * 0.25)), bh = Math.max(32, Math.floor(h * 0.25));
      if (!bloomTexA) {
        const a = makeLinearTarget(), b = makeLinearTarget();
        bloomTexA = a.tex; bloomFboA = a.fbo;
        bloomTexB = b.tex; bloomFboB = b.fbo;
      }
      if (blW !== bw || blH !== bh) {
        blW = bw; blH = bh;
        ensureFboTarget(bloomTexA, bloomFboA, bw, bh);
        ensureFboTarget(bloomTexB, bloomFboB, bw, bh);
      }
    }

    function applyBlendMode(mode) {
      gl.enable(gl.BLEND);
      if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    function flush() {
      if (!vertCount || contextLost) {
        vertCount = 0;
        boundTexSlots.length = 0;
        return;
      }
      gl.useProgram(batchProg.p);
      gl.uniform4f(batchProg.u.u_view, logicalW, logicalH, viewOffX, viewOffY);
      gl.uniform1f(batchProg.u.u_pxScale, logicalW / Math.max(1, curW));
      gl.uniform1f(batchProg.u.u_portraitLen, portraitLen);
      gl.uniform1f(batchProg.u.u_time, curTime);

      for (let i = 0; i < MAX_SLOTS; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, boundTexSlots[i] || whiteTex);
      }
      applyBlendMode(currentBlend);
      gl.bindVertexArray(batchVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, batchVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, vertCount * FLOATS_PER_VERT));
      gl.drawArrays(gl.TRIANGLES, 0, vertCount);
      drawCallCount++;
      vertCount = 0;
      boundTexSlots.length = 0;
    }

    function ensureSpace(numVerts) {
      if (vertCount + numVerts > MAX_VERTS) flush();
    }

    function acquireTextureSlot(tex) {
      let idx = boundTexSlots.indexOf(tex);
      if (idx >= 0) return idx;
      if (boundTexSlots.length >= MAX_SLOTS) {
        flush();
      }
      boundTexSlots.push(tex);
      return boundTexSlots.length - 1;
    }

    function getOrUploadTexture(key, source, rev = 0) {
      if (!source) return null;
      const srcW = source.naturalWidth || source.videoWidth || source.width || 0;
      const srcH = source.naturalHeight || source.videoHeight || source.height || 0;
      if (srcW <= 0 || srcH <= 0) return null;
      const cacheKey = key || idForSource(source);
      let entry = texCache.get(cacheKey);
      if (entry && entry.rev === rev && entry.width === srcW && entry.height === srcH) {
        entry.frameStamp = frameStamp;
        texCache.delete(cacheKey);
        texCache.set(cacheKey, entry);
        return entry;
      }
      if (!entry) {
        if (texCache.size >= MAX_TEXTURES) {
          for (const [oldK, oldV] of texCache) {
            if (oldV.frameStamp !== frameStamp && !boundTexSlots.includes(oldV.tex)) {
              gl.deleteTexture(oldV.tex);
              texCache.delete(oldK);
              if (texCache.size < MAX_TEXTURES) break;
            }
          }
          if (texCache.size >= MAX_TEXTURES) {
            for (const [oldK, oldV] of texCache) {
              if (!boundTexSlots.includes(oldV.tex)) {
                gl.deleteTexture(oldV.tex);
                texCache.delete(oldK);
                if (texCache.size < MAX_TEXTURES) break;
              }
            }
          }
        }
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + (MAX_SLOTS - 1));
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        entry = { tex, width: srcW, height: srcH, rev, frameStamp };
      } else {
        // If already bound in pending batch, flush before mutating texture contents
        if (boundTexSlots.includes(entry.tex)) flush();
        gl.activeTexture(gl.TEXTURE0 + (MAX_SLOTS - 1));
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        entry.width = srcW;
        entry.height = srcH;
        entry.rev = rev;
        entry.frameStamp = frameStamp;
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      texCache.delete(cacheKey);
      texCache.set(cacheKey, entry);
      return entry;
    }

    function pushVert(x, y, u, v, pr, pg, pb, pa, mode, p1, p2, p3, clip, auxY) {
      const tx = m0 * x + m2 * y + m4;
      const ty = m1 * x + m3 * y + m5;
      let o = vertCount * FLOATS_PER_VERT;
      verts[o] = tx;
      verts[o + 1] = ty;
      verts[o + 2] = u;
      verts[o + 3] = v;
      verts[o + 4] = pr;
      verts[o + 5] = pg;
      verts[o + 6] = pb;
      verts[o + 7] = pa;
      verts[o + 8] = mode;
      verts[o + 9] = p1;
      verts[o + 10] = p2;
      verts[o + 11] = p3;
      verts[o + 12] = clip;
      verts[o + 13] = auxY;
      vertCount++;
    }

    function pushRawVert(tx, ty, u, v, pr, pg, pb, pa, mode, p1, p2, p3, clip, auxY) {
      let o = vertCount * FLOATS_PER_VERT;
      verts[o] = tx;
      verts[o + 1] = ty;
      verts[o + 2] = u;
      verts[o + 3] = v;
      verts[o + 4] = pr;
      verts[o + 5] = pg;
      verts[o + 6] = pb;
      verts[o + 7] = pa;
      verts[o + 8] = mode;
      verts[o + 9] = p1;
      verts[o + 10] = p2;
      verts[o + 11] = p3;
      verts[o + 12] = clip;
      verts[o + 13] = auxY;
      vertCount++;
    }

    function premul(color, alpha = 1) {
      const rgba = Array.isArray(color) ? color : parseColor(color);
      const a = Math.max(0, Math.min(1, rgba[3] * alpha));
      return [rgba[0] * a, rgba[1] * a, rgba[2] * a, a];
    }

    function pushTransform() {
      matStack.push(m0, m1, m2, m3, m4, m5);
    }

    function popTransform() {
      if (matStack.length < 6) {
        m0 = 1; m1 = 0; m2 = 0; m3 = 1; m4 = 0; m5 = 0;
        return;
      }
      m5 = matStack.pop();
      m4 = matStack.pop();
      m3 = matStack.pop();
      m2 = matStack.pop();
      m1 = matStack.pop();
      m0 = matStack.pop();
    }

    function resetTransform() {
      matStack.length = 0;
      m0 = 1; m1 = 0; m2 = 0; m3 = 1; m4 = 0; m5 = 0;
    }

    function translate(tx, ty) {
      m4 += m0 * tx + m2 * ty;
      m5 += m1 * tx + m3 * ty;
    }

    function rotate(rad) {
      if (!rad) return;
      const c = Math.cos(rad), s = Math.sin(rad);
      const a0 = m0, a1 = m1, a2 = m2, a3 = m3;
      m0 = a0 * c + a2 * s;
      m1 = a1 * c + a3 * s;
      m2 = a0 * -s + a2 * c;
      m3 = a1 * -s + a3 * c;
    }

    function scale(sx, sy) {
      m0 *= sx; m1 *= sx;
      m2 *= sy; m3 *= sy;
    }

    function setBlend(mode) {
      const next = mode === 'add' ? 'add' : 'normal';
      if (next !== currentBlend) {
        flush();
        currentBlend = next;
      }
    }

    function setClip(mode, pLen = portraitLen) {
      if (pLen !== portraitLen && vertCount > 0) flush();
      portraitLen = pLen;
      currentClip = mode | 0;
    }

    function pollTimerQueries() {
      if (!timerExt || !pendingQueries.length) return;
      const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
      while (pendingQueries.length) {
        const q = pendingQueries[0];
        const avail = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
        if (!avail && !disjoint) break;
        pendingQueries.shift();
        if (avail && !disjoint) {
          const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
          lastGpuMs = ns / 1e6;
        }
        gl.deleteQuery(q);
      }
    }

    function beginFrame(width, height, logW = 1000, logH = 600, offX = 0, offY = 0, needSceneFbo = false, bgColor = null, timeSec = 0) {
      if (disposed) return false;
      if (contextLost || (gl.isContextLost && gl.isContextLost())) {
        contextLost = true;
        return false;
      }
      const w = Math.max(1, Math.min(maxTexSize, Math.round(width)));
      const h = Math.max(1, Math.min(maxTexSize, Math.round(height)));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      curW = w; curH = h;
      curTime = Number.isFinite(timeSec) ? timeSec : 0;
      logicalW = logW; logicalH = logH;
      viewOffX = offX; viewOffY = offY;
      frameStamp++;
      drawCallCount = 0;
      vertCount = 0;
      boundTexSlots.length = 0;
      currentBlend = 'normal';
      currentClip = 0;
      usingEmissiveFbo = false;
      resetTransform();

      pollTimerQueries();
      if (timerExt && pendingQueries.length < 4 && !activeQuery) {
        activeQuery = gl.createQuery();
        if (activeQuery) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, activeQuery);
      }

      usingSceneFbo = Boolean(needSceneFbo);
      if (usingSceneFbo) {
        ensureSceneFbo(w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.viewport(0, 0, w, h);
      gl.disable(gl.SCISSOR_TEST);
      if (bgColor) {
        const [br, bg, bb, ba] = premul(bgColor, 1);
        gl.clearColor(br, bg, bb, ba);
      } else {
        gl.clearColor(0, 0, 0, 0);
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      applyBlendMode('normal');
      return true;
    }

    function applyHeatRefraction(sources, enableChroma = true) {
      if (!usingSceneFbo || contextLost) return;
      flush();
      usingSceneFbo = false;

      // Blit completed scene FBO to default framebuffer without filtering loss
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, curW, curH, 0, 0, curW, curH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const valid = (sources || []).filter(s => s && s.strength > 0.01 && s.radius > 1).slice(0, 6);
      if (!valid.length) return;

      // Compute tight union bounding box in visible logical field space
      const vMinX = viewOffX, vMinY = viewOffY, vMaxX = viewOffX + logicalW, vMaxY = viewOffY + logicalH;
      let minX = vMaxX, minY = vMaxY, maxX = vMinX, maxY = vMinY;
      for (const s of valid) {
        const pad = s.radius * 1.26 + 4;
        if (s.x - pad < minX) minX = s.x - pad;
        if (s.y - pad < minY) minY = s.y - pad;
        if (s.x + pad > maxX) maxX = s.x + pad;
        if (s.y + pad > maxY) maxY = s.y + pad;
      }
      minX = Math.max(vMinX, minX);
      minY = Math.max(vMinY, minY);
      maxX = Math.min(vMaxX, maxX);
      maxY = Math.min(vMaxY, maxY);
      if (maxX <= minX || maxY <= minY) return;

      gl.disable(gl.BLEND);
      gl.useProgram(warpProg.p);
      gl.uniform4f(warpProg.u.u_view, logicalW, logicalH, viewOffX, viewOffY);
      gl.uniform4f(warpProg.u.u_quad, minX, minY, maxX - minX, maxY - minY);
      gl.uniform1i(warpProg.u.u_heatCount, valid.length);
      gl.uniform1f(warpProg.u.u_enableChroma, enableChroma ? 1 : 0);
      for (let i = 0; i < valid.length; i++) {
        const s = valid[i];
        const kind = s.kind ?? 0;
        const sub = s.sub ?? (s.isImpact ? 1 : 0);
        const chroma = s.chroma ?? (s.isImpact ? 1 : 0);
        gl.uniform4f(warpProg.u[`u_heat[${i}]`], s.x, s.y, s.radius, s.strength);
        gl.uniform4f(warpProg.u[`u_heatMeta[${i}]`], s.time || 0, kind, sub, chroma);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.bindVertexArray(warpVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCallCount++;
      applyBlendMode(currentBlend);
    }

    function beginEmissive() {
      if (contextLost || curW <= 0 || curH <= 0) return false;
      flush();
      ensureBloomResources(curW, curH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, emissiveFbo);
      gl.viewport(0, 0, emW, emH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      usingEmissiveFbo = true;
      currentBlend = 'add';
      currentClip = 0;
      resetTransform();
      applyBlendMode('add');
      return true;
    }

    function endEmissive(bloomGain = 0.5) {
      if (!usingEmissiveFbo || contextLost) return;
      flush();
      usingEmissiveFbo = false;

      if (bloomGain > 0.01 && blurProg && bloomCompProg && bloomFboA && bloomFboB) {
        gl.disable(gl.BLEND);
        gl.useProgram(blurProg.p);
        gl.bindVertexArray(warpVao);
        gl.activeTexture(gl.TEXTURE0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFboA);
        gl.viewport(0, 0, blW, blH);
        gl.bindTexture(gl.TEXTURE_2D, emissiveTex);
        gl.uniform2f(blurProg.u.u_texel, 1 / emW, 1 / emH);
        gl.uniform2f(blurProg.u.u_dir, 1.35, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFboB);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexA);
        gl.uniform2f(blurProg.u.u_texel, 1 / blW, 1 / blH);
        gl.uniform2f(blurProg.u.u_dir, 0, 1.35);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFboA);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexB);
        gl.uniform2f(blurProg.u.u_dir, 2.2, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFboB);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexA);
        gl.uniform2f(blurProg.u.u_dir, 0, 2.2);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, usingSceneFbo ? sceneFbo : null);
        gl.viewport(0, 0, curW, curH);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(bloomCompProg.p);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexB);
        gl.uniform1f(bloomCompProg.u.u_gain, bloomGain);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        drawCallCount += 5;
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, usingSceneFbo ? sceneFbo : null);
        gl.viewport(0, 0, curW, curH);
      }
      currentBlend = 'normal';
      applyBlendMode('normal');
    }

    function endFrame() {
      if (contextLost) return;
      if (usingSceneFbo) {
        // Fallback safety if caller requested scene FBO without calling applyHeatRefraction
        applyHeatRefraction(null);
      } else {
        flush();
      }
      if (activeQuery && timerExt) {
        gl.endQuery(timerExt.TIME_ELAPSED_EXT);
        pendingQueries.push(activeQuery);
        activeQuery = null;
      }
      lastFrameDrawCalls = drawCallCount;
      gl.flush();
    }

    function drawTexture(key, source, x, y, w, h, alpha = 1, stun = 0, rev = 0, uvRect = null) {
      if (alpha <= 0.001 || w === 0 || h === 0 || contextLost) return false;
      const entry = getOrUploadTexture(key, source, rev);
      if (!entry) return false;
      ensureSpace(6);
      const slot = acquireTextureSlot(entry.tex);
      const a = Math.max(0, Math.min(1, alpha));
      const u0 = uvRect ? uvRect[0] : 0, v0 = uvRect ? uvRect[1] : 0;
      const u1 = uvRect ? uvRect[2] : 1, v1 = uvRect ? uvRect[3] : 1;
      const x1 = x + w, y1 = y + h;
      pushVert(x, y, u0, v0, a, a, a, a, 1, slot, stun, 0, currentClip, 0);
      pushVert(x1, y, u1, v0, a, a, a, a, 1, slot, stun, 0, currentClip, 0);
      pushVert(x, y1, u0, v1, a, a, a, a, 1, slot, stun, 0, currentClip, 0);
      pushVert(x, y1, u0, v1, a, a, a, a, 1, slot, stun, 0, currentClip, 0);
      pushVert(x1, y, u1, v0, a, a, a, a, 1, slot, stun, 0, currentClip, 0);
      pushVert(x1, y1, u1, v1, a, a, a, a, 1, slot, stun, 0, currentClip, 0);
      return true;
    }

    function fillRect(x, y, w, h, color, alpha = 1) {
      if (alpha <= 0.001 || w === 0 || h === 0 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001 && currentBlend !== 'add') return;
      ensureSpace(6);
      const x1 = x + w, y1 = y + h;
      pushVert(x, y, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x1, y, 1, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x, y1, 0, 1, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x, y1, 0, 1, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x1, y, 1, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x1, y1, 1, 1, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
    }

    function fillRoundRect(cx, cy, w, h, radius, color, alpha = 1, strokeWidth = 0) {
      if (alpha <= 0.001 || w <= 0 || h <= 0 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001) return;
      ensureSpace(6);
      const hw = w * 0.5, hh = h * 0.5, pad = strokeWidth * 0.5 + 2;
      const qx = hw + pad, qy = hh + pad;
      const sw = strokeWidth > 0 ? strokeWidth * 0.5 : 0;
      pushVert(cx - qx, cy - qy, -qx, -qy, pr, pg, pb, pa, 6, hw, hh, radius, currentClip, sw);
      pushVert(cx + qx, cy - qy, qx, -qy, pr, pg, pb, pa, 6, hw, hh, radius, currentClip, sw);
      pushVert(cx - qx, cy + qy, -qx, qy, pr, pg, pb, pa, 6, hw, hh, radius, currentClip, sw);
      pushVert(cx - qx, cy + qy, -qx, qy, pr, pg, pb, pa, 6, hw, hh, radius, currentClip, sw);
      pushVert(cx + qx, cy - qy, qx, -qy, pr, pg, pb, pa, 6, hw, hh, radius, currentClip, sw);
      pushVert(cx + qx, cy + qy, qx, qy, pr, pg, pb, pa, 6, hw, hh, radius, currentClip, sw);
    }

    function fillCircle(cx, cy, r, color, alpha = 1) {
      if (alpha <= 0.001 || r <= 0 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001 && currentBlend !== 'add') return;
      ensureSpace(6);
      const ext = r + 1.5;
      pushVert(cx - ext, cy - ext, -ext, -ext, pr, pg, pb, pa, 2, 0, r, 0, currentClip, 0);
      pushVert(cx + ext, cy - ext, ext, -ext, pr, pg, pb, pa, 2, 0, r, 0, currentClip, 0);
      pushVert(cx - ext, cy + ext, -ext, ext, pr, pg, pb, pa, 2, 0, r, 0, currentClip, 0);
      pushVert(cx - ext, cy + ext, -ext, ext, pr, pg, pb, pa, 2, 0, r, 0, currentClip, 0);
      pushVert(cx + ext, cy - ext, ext, -ext, pr, pg, pb, pa, 2, 0, r, 0, currentClip, 0);
      pushVert(cx + ext, cy + ext, ext, ext, pr, pg, pb, pa, 2, 0, r, 0, currentClip, 0);
    }

    function strokeCircle(cx, cy, r, color, lineWidth = 2, alpha = 1, dashLen = 0, gapLen = 0) {
      if (alpha <= 0.001 || r <= 0 || lineWidth <= 0 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001) return;
      ensureSpace(6);
      const half = lineWidth * 0.5;
      const innerR = Math.max(0.001, r - half);
      const outerR = r + half;
      const ext = outerR + 1.5;
      const period = dashLen > 0 && gapLen > 0 ? (dashLen + gapLen) : 0;
      pushVert(cx - ext, cy - ext, -ext, -ext, pr, pg, pb, pa, 2, innerR, outerR, period, currentClip, dashLen);
      pushVert(cx + ext, cy - ext, ext, -ext, pr, pg, pb, pa, 2, innerR, outerR, period, currentClip, dashLen);
      pushVert(cx - ext, cy + ext, -ext, ext, pr, pg, pb, pa, 2, innerR, outerR, period, currentClip, dashLen);
      pushVert(cx - ext, cy + ext, -ext, ext, pr, pg, pb, pa, 2, innerR, outerR, period, currentClip, dashLen);
      pushVert(cx + ext, cy - ext, ext, -ext, pr, pg, pb, pa, 2, innerR, outerR, period, currentClip, dashLen);
      pushVert(cx + ext, cy + ext, ext, ext, pr, pg, pb, pa, 2, innerR, outerR, period, currentClip, dashLen);
    }

    function strokeArc(cx, cy, r, a0, a1, color, lineWidth = 2, alpha = 1, roundCap = true) {
      if (alpha <= 0.001 || r <= 0 || lineWidth <= 0 || contextLost) return;
      const span = a1 - a0;
      if (Math.abs(span) < 0.001) return;
      if (Math.abs(span) >= Math.PI * 1.999) {
        strokeCircle(cx, cy, r, color, lineWidth, alpha);
        return;
      }
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001) return;
      ensureSpace(6);
      const midAng = (a0 + a1) * 0.5;
      const halfSpan = Math.min(Math.PI, Math.abs(span) * 0.5);
      const signedHalf = roundCap ? halfSpan : -halfSpan;
      const halfW = lineWidth * 0.5;
      const ext = r + halfW + 1.5;
      pushVert(cx - ext, cy - ext, -ext, -ext, pr, pg, pb, pa, 3, r, halfW, midAng, currentClip, signedHalf);
      pushVert(cx + ext, cy - ext, ext, -ext, pr, pg, pb, pa, 3, r, halfW, midAng, currentClip, signedHalf);
      pushVert(cx - ext, cy + ext, -ext, ext, pr, pg, pb, pa, 3, r, halfW, midAng, currentClip, signedHalf);
      pushVert(cx - ext, cy + ext, -ext, ext, pr, pg, pb, pa, 3, r, halfW, midAng, currentClip, signedHalf);
      pushVert(cx + ext, cy - ext, ext, -ext, pr, pg, pb, pa, 3, r, halfW, midAng, currentClip, signedHalf);
      pushVert(cx + ext, cy + ext, ext, ext, pr, pg, pb, pa, 3, r, halfW, midAng, currentClip, signedHalf);
    }

    function fillArcSector(cx, cy, r, a0, a1, color, alpha = 1, steps = 24) {
      if (alpha <= 0.001 || r <= 0 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001) return;
      ensureSpace(steps * 3);
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + (a1 - a0) * (i / steps);
        const t1 = a0 + (a1 - a0) * ((i + 1) / steps);
        pushVert(cx, cy, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
        pushVert(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
        pushVert(cx + Math.cos(t1) * r, cy + Math.sin(t1) * r, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      }
    }

    function strokeLine(x1, y1, x2, y2, color, lineWidth = 2, alpha = 1, roundCap = true, dashLen = 0, gapLen = 0, dashOffset = 0) {
      if (alpha <= 0.001 || lineWidth <= 0 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001 && currentBlend !== 'add') return;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) {
        if (roundCap) fillCircle(x1, y1, lineWidth * 0.5, color, alpha);
        return;
      }
      ensureSpace(6);
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const halfW = lineWidth * 0.5;
      const pad = (roundCap ? halfW : 0) + 1.5;
      const extW = halfW + 1.5;
      const p0x = x1 - ux * pad, p0y = y1 - uy * pad;
      const p1x = x2 + ux * pad, p1y = y2 + uy * pad;
      const flagW = dashLen > 0 && gapLen > 0 ? (dashLen + gapLen) : (roundCap ? 0 : -1);
      const period = dashLen + gapLen;
      const qPhase = period > 0 ? Math.floor((((dashOffset % period) + period) % period) * 4) : 0;
      const packedAux = dashLen + qPhase * 1024;

      const ax = p0x + nx * extW, ay = p0y + ny * extW;
      const bx = p1x + nx * extW, by = p1y + ny * extW;
      const cx = p0x - nx * extW, cy = p0y - ny * extW;
      const ex = p1x - nx * extW, ey = p1y - ny * extW;
      const uStart = -pad, uEnd = len + pad;

      pushVert(ax, ay, uStart, extW, pr, pg, pb, pa, 4, len, halfW, flagW, currentClip, packedAux);
      pushVert(bx, by, uEnd, extW, pr, pg, pb, pa, 4, len, halfW, flagW, currentClip, packedAux);
      pushVert(cx, cy, uStart, -extW, pr, pg, pb, pa, 4, len, halfW, flagW, currentClip, packedAux);
      pushVert(cx, cy, uStart, -extW, pr, pg, pb, pa, 4, len, halfW, flagW, currentClip, packedAux);
      pushVert(bx, by, uEnd, extW, pr, pg, pb, pa, 4, len, halfW, flagW, currentClip, packedAux);
      pushVert(ex, ey, uEnd, -extW, pr, pg, pb, pa, 4, len, halfW, flagW, currentClip, packedAux);
    }

    function strokePolyline(points, color, lineWidth = 2, alpha = 1, dashLen = 0, gapLen = 0) {
      if (!points || points.length < 2 || alpha <= 0.001 || lineWidth <= 0 || contextLost) return;
      if (dashLen > 0 && gapLen > 0) {
        let distAcc = 0;
        const period = dashLen + gapLen;
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1];
          const seg = Math.hypot(b.x - a.x, b.y - a.y);
          if (seg < 0.01) continue;
          strokeLine(a.x, a.y, b.x, b.y, color, lineWidth, alpha, false, dashLen, gapLen, distAcc % period);
          distAcc += seg;
        }
        return;
      }
      for (let i = 0; i < points.length - 1; i++) {
        strokeLine(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, color, lineWidth, alpha, true);
      }
    }

    // Batch round-capped dash quads with smooth per-vertex horizon fade (segs = [x1,y1,t1,x2,y2,t2,...])
    function drawFadeSegments(segs, color, lineWidth = 2, alpha = 1, horizon = 480, fadeTicks = 240) {
      if (!segs || segs.length < 6 || alpha <= 0.001 || lineWidth <= 0 || contextLost) return;
      const [br, bg, bb, ba] = premul(color, alpha);
      if (ba <= 0.001 && currentBlend !== 'add') return;
      const halfW = lineWidth * 0.5;
      const pad = halfW + 1.5;
      const extW = halfW + 1.5;
      const invFade = fadeTicks > 0 ? 1 / fadeTicks : 0;

      for (let i = 0; i < segs.length; i += 6) {
        const x1 = segs[i], y1 = segs[i + 1], t1 = segs[i + 2];
        const x2 = segs[i + 3], y2 = segs[i + 4], t2 = segs[i + 5];
        const f0 = invFade > 0 ? Math.max(0, Math.min(1, (horizon - t1) * invFade)) : 1;
        const f1 = invFade > 0 ? Math.max(0, Math.min(1, (horizon - t2) * invFade)) : 1;
        if (f0 <= 0.001 && f1 <= 0.001 && currentBlend !== 'add') continue;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) {
          fillCircle(x1, y1, halfW, color, alpha * f0);
          continue;
        }
        ensureSpace(6);
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;
        const p0x = x1 - ux * pad, p0y = y1 - uy * pad;
        const p1x = x2 + ux * pad, p1y = y2 + uy * pad;
        const ax = p0x + nx * extW, ay = p0y + ny * extW;
        const bx = p1x + nx * extW, by = p1y + ny * extW;
        const cx = p0x - nx * extW, cy = p0y - ny * extW;
        const ex = p1x - nx * extW, ey = p1y - ny * extW;
        const uStart = -pad, uEnd = len + pad;
        const r0 = br * f0, g0 = bg * f0, b0 = bb * f0, a0 = ba * f0;
        const r1 = br * f1, g1 = bg * f1, b1 = bb * f1, a1 = ba * f1;

        pushVert(ax, ay, uStart, extW, r0, g0, b0, a0, 4, len, halfW, 0, currentClip, 0);
        pushVert(bx, by, uEnd, extW, r1, g1, b1, a1, 4, len, halfW, 0, currentClip, 0);
        pushVert(cx, cy, uStart, -extW, r0, g0, b0, a0, 4, len, halfW, 0, currentClip, 0);
        pushVert(cx, cy, uStart, -extW, r0, g0, b0, a0, 4, len, halfW, 0, currentClip, 0);
        pushVert(bx, by, uEnd, extW, r1, g1, b1, a1, 4, len, halfW, 0, currentClip, 0);
        pushVert(ex, ey, uEnd, -extW, r1, g1, b1, a1, 4, len, halfW, 0, currentClip, 0);
      }
    }

    function drawRadialStops(cx, cy, maxR, stops, alpha = 1, rings = 28) {
      if (alpha <= 0.001 || maxR <= 0 || !stops || stops.length < 2 || contextLost) return;
      const parsed = stops.map(([offset, col]) => [offset, parseColor(col)]);
      const sampleAt = t => {
        if (t <= parsed[0][0]) return parsed[0][1];
        for (let i = 1; i < parsed.length; i++) {
          if (t <= parsed[i][0]) {
            const [t0, c0] = parsed[i - 1], [t1, c1] = parsed[i];
            const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
            return [
              c0[0] + (c1[0] - c0[0]) * u,
              c0[1] + (c1[1] - c0[1]) * u,
              c0[2] + (c1[2] - c0[2]) * u,
              c0[3] + (c1[3] - c0[3]) * u
            ];
          }
        }
        return parsed[parsed.length - 1][1];
      };

      const bandOffsets = [0];
      for (const [off] of parsed) {
        if (off > bandOffsets[bandOffsets.length - 1] + 0.02 && off < 0.99) bandOffsets.push(off);
      }
      bandOffsets.push(1);

      ensureSpace((bandOffsets.length - 1) * rings * 6);
      for (let b = 0; b < bandOffsets.length - 1; b++) {
        const u0 = bandOffsets[b], u1 = bandOffsets[b + 1];
        const r0 = u0 * maxR, r1 = u1 * maxR;
        const c0 = premul(sampleAt(u0), alpha);
        const c1 = premul(sampleAt(u1), alpha);
        for (let s = 0; s < rings; s++) {
          const a0 = (s / rings) * Math.PI * 2;
          const a1 = ((s + 1) / rings) * Math.PI * 2;
          const ca0 = Math.cos(a0), sa0 = Math.sin(a0);
          const ca1 = Math.cos(a1), sa1 = Math.sin(a1);
          if (r0 <= 0.001) {
            pushVert(cx, cy, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(cx + ca0 * r1, cy + sa0 * r1, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(cx + ca1 * r1, cy + sa1 * r1, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
          } else {
            const x00 = cx + ca0 * r0, y00 = cy + sa0 * r0;
            const x01 = cx + ca1 * r0, y01 = cy + sa1 * r0;
            const x10 = cx + ca0 * r1, y10 = cy + sa0 * r1;
            const x11 = cx + ca1 * r1, y11 = cy + sa1 * r1;
            pushVert(x00, y00, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(x10, y10, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(x01, y01, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(x01, y01, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(x10, y10, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
            pushVert(x11, y11, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
          }
        }
      }
    }

    // Continuous non-overlapping feathered skid & warm umber-to-soot burn ribbon
    function drawSoftRibbon(points, widthAt, isBurn, fade, hardEdge = false, paceAt = null, speedAt = null, heatAt = null) {
      if (!points || !points.length || fade <= 0.005 || contextLost) return;
      const bFlag = isBurn ? 1 : 0;
      const hFlag = hardEdge ? 1 : 0;
      emitSoftRibbonTriangles(points, widthAt, poly => {
        if (poly.length < 3) return;
        ensureSpace((poly.length - 2) * 3);
        const v0 = poly[0];
        for (let i = 1; i + 1 < poly.length; i++) {
          const v1 = poly[i], v2 = poly[i + 1];
          pushVert(v0.x, v0.y, v0.u, v0.v, v0.s, v0.p, v0.sp, v0.h, 5, bFlag, fade, hFlag, currentClip, 0);
          pushVert(v1.x, v1.y, v1.u, v1.v, v1.s, v1.p, v1.sp, v1.h, 5, bFlag, fade, hFlag, currentClip, 0);
          pushVert(v2.x, v2.y, v2.u, v2.v, v2.s, v2.p, v2.sp, v2.h, 5, bFlag, fade, hFlag, currentClip, 0);
        }
      }, paceAt, speedAt, heatAt);
    }

    function drawTaperedSpinArc(cx, cy, radius, startAngle, arcSweep, maxWidth, color, peakAlpha) {
      if (peakAlpha <= 0.004 || maxWidth <= 0 || radius <= 0 || contextLost) return;
      const steps = 18, dir = Math.sign(arcSweep) || 1, endAngle = startAngle + arcSweep;
      const baseRgb = parseColor(color);
      const alphaAt = u => {
        if (u <= 0.15) return peakAlpha * (0.10 + (0.45 * u) / 0.15);
        if (u <= 0.42) return peakAlpha * (0.55 + (0.29 * (u - 0.15)) / 0.27);
        if (u <= 0.78) return peakAlpha * (0.84 + (0.12 * (u - 0.42)) / 0.36);
        return peakAlpha * (0.96 + (0.04 * (u - 0.78)) / 0.22);
      };

      ensureSpace(steps * 6 + 3);
      let prevOx = 0, prevOy = 0, prevIx = 0, prevIy = 0, prevA = 0;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const ang = startAngle + arcSweep * u;
        const tailRamp = Math.pow(u, 0.42);
        const noseTaper = u > 0.78 ? 1 - 0.58 * Math.pow((u - 0.78) / 0.22, 1.35) : 1;
        const half = maxWidth * 0.5 * tailRamp * noseTaper;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const ox = cx + ca * (radius + half), oy = cy + sa * (radius + half);
        const ix = cx + ca * (radius - half), iy = cy + sa * (radius - half);
        const a = Math.max(0, Math.min(1, baseRgb[3] * alphaAt(u)));

        if (s > 0) {
          const r0 = baseRgb[0] * prevA, g0 = baseRgb[1] * prevA, b0 = baseRgb[2] * prevA;
          const r1 = baseRgb[0] * a, g1 = baseRgb[1] * a, b1 = baseRgb[2] * a;
          pushVert(prevOx, prevOy, 0, 0, r0, g0, b0, prevA, 0, 0, 0, 0, currentClip, 0);
          pushVert(ox, oy, 0, 0, r1, g1, b1, a, 0, 0, 0, 0, currentClip, 0);
          pushVert(prevIx, prevIy, 0, 0, r0, g0, b0, prevA, 0, 0, 0, 0, currentClip, 0);

          pushVert(prevIx, prevIy, 0, 0, r0, g0, b0, prevA, 0, 0, 0, 0, currentClip, 0);
          pushVert(ox, oy, 0, 0, r1, g1, b1, a, 0, 0, 0, 0, currentClip, 0);
          pushVert(ix, iy, 0, 0, r1, g1, b1, a, 0, 0, 0, 0, currentClip, 0);
        }
        prevOx = ox; prevOy = oy; prevIx = ix; prevIy = iy; prevA = a;
      }

      const tipAng = endAngle + dir * Math.min(0.06, (maxWidth * 0.48) / Math.max(14, radius));
      const tipX = cx + Math.cos(tipAng) * radius, tipY = cy + Math.sin(tipAng) * radius;
      const tipA = Math.max(0, Math.min(1, baseRgb[3] * peakAlpha));
      pushVert(prevOx, prevOy, 0, 0, baseRgb[0] * prevA, baseRgb[1] * prevA, baseRgb[2] * prevA, prevA, 0, 0, 0, 0, currentClip, 0);
      pushVert(tipX, tipY, 0, 0, baseRgb[0] * tipA, baseRgb[1] * tipA, baseRgb[2] * tipA, tipA, 0, 0, 0, 0, currentClip, 0);
      pushVert(prevIx, prevIy, 0, 0, baseRgb[0] * prevA, baseRgb[1] * prevA, baseRgb[2] * prevA, prevA, 0, 0, 0, 0, currentClip, 0);
    }

    function pack6bitColor(color) {
      const rgb = parseColor(color);
      const r = Math.min(63, Math.max(0, Math.round(rgb[0] * 63)));
      const g = Math.min(63, Math.max(0, Math.round(rgb[1] * 63)));
      const b = Math.min(63, Math.max(0, Math.round(rgb[2] * 63)));
      return r * 4096 + g * 64 + b;
    }

    function drawSuperAuraShader(cx, cy, ringR, lw, c1, c2, level, alpha = 1) {
      if (alpha <= 0.002 || ringR <= 0 || lw <= 0 || contextLost) return;
      const rgb1 = parseColor(c1);
      const packed2 = pack6bitColor(c2);
      const ext = ringR + lw + 26;
      ensureSpace(6);
      pushVert(cx - ext, cy - ext, -ext, -ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, currentClip, packed2);
      pushVert(cx + ext, cy - ext, ext, -ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, currentClip, packed2);
      pushVert(cx - ext, cy + ext, -ext, ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, currentClip, packed2);
      pushVert(cx - ext, cy + ext, -ext, ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, currentClip, packed2);
      pushVert(cx + ext, cy - ext, ext, -ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, currentClip, packed2);
      pushVert(cx + ext, cy + ext, ext, ext, rgb1[0], rgb1[1], rgb1[2], alpha, 7, ringR, lw * 0.5, level, currentClip, packed2);
    }

    function drawTrails(trails, bodies, home, away, ballHeatFn, heatColorFn, feathered = true) {
      if (contextLost || !trails) return;
      const mode = feathered ? 9 : 0;
      const wMul = feathered ? 1.15 : 1;
      for (let index = 0; index < trails.length; index++) {
        const trail = trails[index];
        if (!trail || !trail.length) continue;
        const b = bodies[index];
        if (!b) continue;
        const baseColor = b.team === -1 ? '#ffffff' : b.team === 0 ? home : away;
        const baseRgb = parseColor(baseColor);
        const last = trail[trail.length - 1];
        const near = (b.x - last.x) ** 2 + (b.y - last.y) ** 2 < 4;
        const count = near ? trail.length - 1 : trail.length;
        const pts = [];
        for (let j = 0; j < count; j++) {
          trail[j].origIndex = j;
          trail[j].isHead = false;
          pts.push(trail[j]);
        }
        pts.push({ x: b.x, y: b.y, radius: b.radius, life: 0.24, duration: 0.24, heat: b.team === -1 ? ballHeatFn(b) : 0, origIndex: trail.length, isHead: true });

        const u = [];
        for (let j = 0; j < pts.length - 1; j++) {
          const dx = pts[j + 1].x - pts[j].x, dy = pts[j + 1].y - pts[j].y, len = Math.hypot(dx, dy);
          u.push(len > 0.001 ? { x: dx / len, y: dy / len } : (j > 0 ? u[j - 1] : { x: 1, y: 0 }));
        }

        const sections = [];
        let cur = [pts[0]];
        for (let j = 0; j < pts.length - 1; j++) {
          cur.push(pts[j + 1]);
          if (j < pts.length - 2) {
            const dot = u[j].x * u[j + 1].x + u[j].y * u[j + 1].y;
            if (dot < 0.2) {
              if (cur.length >= 2) sections.push(cur);
              cur = [pts[j + 1]];
            }
          }
        }
        if (cur.length >= 2) sections.push(cur);

        for (const sec of sections) {
          const m = sec.length - 1;
          if (m < 1) continue;
          const S0 = sec[0], Sm = sec[m];
          const L = [], R = [], C = [], H = [];
          for (let k = 0; k <= m; k++) {
            const pt = sec[k];
            let tx = 1, ty = 0;
            if (k === m && pt.isHead && b.vx * b.vx + b.vy * b.vy > 1) {
              const vlen = Math.hypot(b.vx, b.vy);
              tx = b.vx / vlen; ty = b.vy / vlen;
            } else {
              let dx, dy;
              if (k === 0) { dx = sec[1].x - sec[0].x; dy = sec[1].y - sec[0].y; }
              else if (k === m) { dx = sec[m].x - sec[m - 1].x; dy = sec[m].y - sec[m - 1].y; }
              else { dx = sec[k + 1].x - sec[k - 1].x; dy = sec[k + 1].y - sec[k - 1].y; }
              const d = Math.hypot(dx, dy);
              if (d > 0.001) { tx = dx / d; ty = dy / d; }
              else if (k > 0 && L[k - 1]) { tx = L[k - 1].tx; ty = L[k - 1].ty; }
            }
            const nx = -ty, ny = tx;
            const fade = pt.isHead ? 1 : Math.max(0, pt.life / pt.duration);
            const w = b.radius * fade * wMul;
            L.push({ x: pt.x + nx * w, y: pt.y + ny * w, tx, ty, w, fade, heat: pt.heat || 0 });
            R.push({ x: pt.x - nx * w, y: pt.y - ny * w, tx, ty, w, fade, heat: pt.heat || 0 });

            const f = k === 0 && S0.origIndex === 0 ? 0 : fade;
            const h = pt.heat || 0;
            H.push(h);
            if (b.team === -1) {
              const base = 0.23 + Math.min(2, h) * 0.05 + Math.max(0, h - 2) * 0.3;
              const alpha = f <= 0 ? 0 : 1 - Math.pow(1 - Math.min(0.99, base * f), 18 * f);
              const hc = parseColor(heatColorFn(h, 1));
              C.push([hc[0] * alpha, hc[1] * alpha, hc[2] * alpha, alpha]);
            } else {
              const alpha = f <= 0 ? 0 : 1 - Math.pow(1 - 0.23 * f, 18 * f);
              C.push([baseRgb[0] * alpha, baseRgb[1] * alpha, baseRgb[2] * alpha, alpha]);
            }
          }

          const w0 = L[0].w;
          const backX = S0.x - L[0].tx * w0, backY = S0.y - L[0].ty * w0;
          if (Math.hypot(Sm.x - backX, Sm.y - backY) < 1) continue;

          const capSteps = w0 > 0.5 ? 8 : 0;
          ensureSpace(m * 6 + capSteps * 3);
          if (capSteps > 0) {
            const c0 = C[0];
            const baseAng = Math.atan2(L[0].y - S0.y, L[0].x - S0.x);
            for (let s = 0; s < capSteps; s++) {
              const a0 = baseAng + (s / capSteps) * Math.PI;
              const a1 = baseAng + ((s + 1) / capSteps) * Math.PI;
              pushVert(S0.x, S0.y, 0, 0, c0[0], c0[1], c0[2], c0[3], mode, H[0], w0, 0, currentClip, 0);
              pushVert(S0.x + Math.cos(a0) * w0, S0.y + Math.sin(a0) * w0, 0, feathered ? w0 : 0, c0[0], c0[1], c0[2], c0[3], mode, H[0], w0, 0, currentClip, 0);
              pushVert(S0.x + Math.cos(a1) * w0, S0.y + Math.sin(a1) * w0, 0, feathered ? w0 : 0, c0[0], c0[1], c0[2], c0[3], mode, H[0], w0, 0, currentClip, 0);
            }
          }

          const arcU = [0];
          let arcLen = 0;
          for (let k = 1; k <= m; k++) {
            arcLen += Math.hypot(sec[k].x - sec[k - 1].x, sec[k].y - sec[k - 1].y);
            arcU.push(arcLen);
          }

          for (let k = 0; k < m; k++) {
            const u0 = arcLen > 0.001 ? arcU[k] / arcLen : k / m;
            const u1 = arcLen > 0.001 ? arcU[k + 1] / arcLen : (k + 1) / m;
            const c0 = C[k], c1 = C[k + 1];
            const wk = L[k].w, wk1 = L[k + 1].w;
            pushVert(L[k].x, L[k].y, u0, wk, c0[0], c0[1], c0[2], c0[3], mode, H[k], wk, 0, currentClip, 0);
            pushVert(L[k + 1].x, L[k + 1].y, u1, wk1, c1[0], c1[1], c1[2], c1[3], mode, H[k + 1], wk1, 0, currentClip, 0);
            pushVert(R[k].x, R[k].y, u0, -wk, c0[0], c0[1], c0[2], c0[3], mode, H[k], wk, 0, currentClip, 0);

            pushVert(R[k].x, R[k].y, u0, -wk, c0[0], c0[1], c0[2], c0[3], mode, H[k], wk, 0, currentClip, 0);
            pushVert(L[k + 1].x, L[k + 1].y, u1, wk1, c1[0], c1[1], c1[2], c1[3], mode, H[k + 1], wk1, 0, currentClip, 0);
            pushVert(R[k + 1].x, R[k + 1].y, u1, -wk1, c1[0], c1[1], c1[2], c1[3], mode, H[k + 1], wk1, 0, currentClip, 0);
          }
        }
      }
    }

    function fillPolygonWithLinearGrad(polyPts, gx0, gy0, gx1, gy1, stops, alpha = 1) {
      if (!polyPts || polyPts.length < 3 || alpha <= 0.001 || contextLost) return;
      const dx = gx1 - gx0, dy = gy1 - gy0;
      const lenSq = dx * dx + dy * dy || 1;
      const parsed = stops.map(([off, col]) => [off, parseColor(col)]);
      const evalStop = t => {
        const ct = Math.max(0, Math.min(1, t));
        if (ct <= parsed[0][0]) return premul(parsed[0][1], alpha);
        for (let i = 1; i < parsed.length; i++) {
          if (ct <= parsed[i][0]) {
            const [t0, c0] = parsed[i - 1], [t1, c1] = parsed[i];
            const u = t1 > t0 ? (ct - t0) / (t1 - t0) : 0;
            return premul([
              c0[0] + (c1[0] - c0[0]) * u,
              c0[1] + (c1[1] - c0[1]) * u,
              c0[2] + (c1[2] - c0[2]) * u,
              c0[3] + (c1[3] - c0[3]) * u
            ], alpha);
          }
        }
        return premul(parsed[parsed.length - 1][1], alpha);
      };
      const cols = polyPts.map(([px, py]) => evalStop(((px - gx0) * dx + (py - gy0) * dy) / lenSq));
      ensureSpace((polyPts.length - 2) * 3);
      for (let i = 1; i < polyPts.length - 1; i++) {
        const p0 = polyPts[0], p1 = polyPts[i], p2 = polyPts[i + 1];
        const c0 = cols[0], c1 = cols[i], c2 = cols[i + 1];
        pushVert(p0[0], p0[1], 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(p1[0], p1[1], 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(p2[0], p2[1], 0, 0, c2[0], c2[1], c2[2], c2[3], 0, 0, 0, 0, currentClip, 0);
      }
    }

    function fillRibbonPairsWithLinearGrad(leftPts, rightPts, gx0, gy0, gx1, gy1, stops, alpha = 1) {
      const m = Math.min(leftPts?.length || 0, rightPts?.length || 0);
      if (m < 2 || alpha <= 0.001 || contextLost) return;
      const dx = gx1 - gx0, dy = gy1 - gy0;
      const lenSq = dx * dx + dy * dy || 1;
      const parsed = stops.map(([off, col]) => [off, parseColor(col)]);
      const evalStop = (px, py) => {
        const ct = Math.max(0, Math.min(1, ((px - gx0) * dx + (py - gy0) * dy) / lenSq));
        if (ct <= parsed[0][0]) return premul(parsed[0][1], alpha);
        for (let i = 1; i < parsed.length; i++) {
          if (ct <= parsed[i][0]) {
            const [t0, c0] = parsed[i - 1], [t1, c1] = parsed[i];
            const u = t1 > t0 ? (ct - t0) / (t1 - t0) : 0;
            return premul([
              c0[0] + (c1[0] - c0[0]) * u,
              c0[1] + (c1[1] - c0[1]) * u,
              c0[2] + (c1[2] - c0[2]) * u,
              c0[3] + (c1[3] - c0[3]) * u
            ], alpha);
          }
        }
        return premul(parsed[parsed.length - 1][1], alpha);
      };
      ensureSpace((m - 1) * 6);
      for (let i = 0; i < m - 1; i++) {
        const l0 = leftPts[i], l1 = leftPts[i + 1];
        const r0 = rightPts[i], r1 = rightPts[i + 1];
        const cl0 = evalStop(l0[0], l0[1]), cl1 = evalStop(l1[0], l1[1]);
        const cr0 = evalStop(r0[0], r0[1]), cr1 = evalStop(r1[0], r1[1]);
        pushVert(l0[0], l0[1], 0, 0, cl0[0], cl0[1], cl0[2], cl0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(l1[0], l1[1], 0, 0, cl1[0], cl1[1], cl1[2], cl1[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(r0[0], r0[1], 0, 0, cr0[0], cr0[1], cr0[2], cr0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(r0[0], r0[1], 0, 0, cr0[0], cr0[1], cr0[2], cr0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(l1[0], l1[1], 0, 0, cl1[0], cl1[1], cl1[2], cl1[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(r1[0], r1[1], 0, 0, cr1[0], cr1[1], cr1[2], cr1[3], 0, 0, 0, 0, currentClip, 0);
      }
    }

    function fillBandLinearX(x, y, w, h, gx0, gx1, stops, alpha = 1) {
      if (alpha <= 0.001 || w <= 0 || h <= 0 || !stops || stops.length < 2 || contextLost) return;
      const span = gx1 - gx0 || 1;
      const xs = [x, x + w];
      for (const [off] of stops) {
        const sx = gx0 + off * span;
        if (sx > x && sx < x + w) xs.push(sx);
      }
      xs.sort((a, b) => a - b);
      const parsed = stops.map(([off, col]) => [off, parseColor(col)]);
      const evalX = px => {
        const ct = Math.max(0, Math.min(1, (px - gx0) / span));
        if (ct <= parsed[0][0]) return premul(parsed[0][1], alpha);
        for (let i = 1; i < parsed.length; i++) {
          if (ct <= parsed[i][0]) {
            const [t0, c0] = parsed[i - 1], [t1, c1] = parsed[i];
            const u = t1 > t0 ? (ct - t0) / (t1 - t0) : 0;
            return premul([
              c0[0] + (c1[0] - c0[0]) * u,
              c0[1] + (c1[1] - c0[1]) * u,
              c0[2] + (c1[2] - c0[2]) * u,
              c0[3] + (c1[3] - c0[3]) * u
            ], alpha);
          }
        }
        return premul(parsed[parsed.length - 1][1], alpha);
      };
      ensureSpace((xs.length - 1) * 6);
      const y1 = y + h;
      for (let i = 0; i < xs.length - 1; i++) {
        const x0 = xs[i], x1 = xs[i + 1];
        if (x1 - x0 < 0.01) continue;
        const c0 = evalX(x0), c1 = evalX(x1);
        pushVert(x0, y, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(x1, y, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(x0, y1, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(x0, y1, 0, 0, c0[0], c0[1], c0[2], c0[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(x1, y, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
        pushVert(x1, y1, 0, 0, c1[0], c1[1], c1[2], c1[3], 0, 0, 0, 0, currentClip, 0);
      }
    }

    function fillTriangle(x0, y0, x1, y1, x2, y2, color, alpha = 1) {
      if (alpha <= 0.001 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001 && currentBlend !== 'add') return;
      ensureSpace(3);
      pushVert(x0, y0, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x1, y1, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x2, y2, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
    }

    function fillQuad(x0, y0, x1, y1, x2, y2, x3, y3, color, alpha = 1) {
      if (alpha <= 0.001 || contextLost) return;
      const [pr, pg, pb, pa] = premul(color, alpha);
      if (pa <= 0.001 && currentBlend !== 'add') return;
      ensureSpace(6);
      pushVert(x0, y0, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x1, y1, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x3, y3, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x3, y3, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x1, y1, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
      pushVert(x2, y2, 0, 0, pr, pg, pb, pa, 0, 0, 0, 0, currentClip, 0);
    }

    function dispose(releaseContext = false) {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener?.('webglcontextlost', onContextLost);
      canvas.removeEventListener?.('webglcontextrestored', onContextRestored);
      if (!contextLost) {
        for (const entry of texCache.values()) gl.deleteTexture(entry.tex);
        texCache.clear();
        if (activeQuery) { gl.deleteQuery(activeQuery); activeQuery = null; }
        for (const q of pendingQueries) gl.deleteQuery(q);
        pendingQueries = [];
        if (whiteTex) gl.deleteTexture(whiteTex);
        if (sceneTex) gl.deleteTexture(sceneTex);
        if (sceneFbo) gl.deleteFramebuffer(sceneFbo);
        if (emissiveTex) gl.deleteTexture(emissiveTex);
        if (emissiveFbo) gl.deleteFramebuffer(emissiveFbo);
        if (bloomTexA) gl.deleteTexture(bloomTexA);
        if (bloomFboA) gl.deleteFramebuffer(bloomFboA);
        if (bloomTexB) gl.deleteTexture(bloomTexB);
        if (bloomFboB) gl.deleteFramebuffer(bloomFboB);
        if (batchVbo) gl.deleteBuffer(batchVbo);
        if (batchVao) gl.deleteVertexArray(batchVao);
        if (warpVbo) gl.deleteBuffer(warpVbo);
        if (warpVao) gl.deleteVertexArray(warpVao);
        if (batchProg) gl.deleteProgram(batchProg.p);
        if (warpProg) gl.deleteProgram(warpProg.p);
        if (blurProg) gl.deleteProgram(blurProg.p);
        if (bloomCompProg) gl.deleteProgram(bloomCompProg.p);
        if (releaseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }

    return {
      gl,
      get isLost() { if (!contextLost && gl.isContextLost?.()) contextLost = true; return contextLost; },
      get textureCount() { return texCache.size; },
      get lastDrawCalls() { return lastFrameDrawCalls; },
      get lastGpuMs() { return lastGpuMs; },
      beginFrame,
      applyHeatRefraction,
      beginEmissive,
      endEmissive,
      endFrame,
      flush,
      pushTransform,
      popTransform,
      resetTransform,
      translate,
      rotate,
      scale,
      setBlend,
      setClip,
      drawTexture,
      fillRect,
      fillRoundRect,
      fillCircle,
      strokeCircle,
      strokeArc,
      fillArcSector,
      strokeLine,
      strokePolyline,
      drawFadeSegments,
      drawRadialStops,
      drawSoftRibbon,
      drawTaperedSpinArc,
      drawSuperAuraShader,
      drawTrails,
      fillPolygonWithLinearGrad,
      fillRibbonPairsWithLinearGrad,
      fillBandLinearX,
      fillTriangle,
      fillQuad,
      pushRawVert,
      dispose
    };
  }

  // Legacy-compatible helper for simple sprite-list callers if needed
  function create(canvas, artwork, options) {
    if (!Array.isArray(artwork)) return createSceneRenderer(canvas, artwork || options);
    const gpu = createSceneRenderer(canvas, options);
    if (!gpu) throw new Error('WebGL2 is unavailable on this browser/device.');
    return {
      gpu,
      draw(commands, heat, time, strength) {
        if (!gpu.beginFrame(canvas.width || 1000, canvas.height || 600, 1000, 600, 0, 0, strength > 0.01)) return;
        for (const c of commands) {
          const [id, x, y, width, height, angle = 0, opacity = 1] = c;
          gpu.pushTransform();
          gpu.translate(x, y);
          if (angle) gpu.rotate(angle);
          gpu.drawTexture('art:' + id, artwork[id], -width / 2, -height / 2, width, height, opacity);
          gpu.popTransform();
        }
        if (strength > 0.01 && heat) {
          gpu.applyHeatRefraction([{ x: heat.x, y: heat.y, radius: 56, strength: strength / 8, time, isImpact: false }]);
        }
        gpu.endFrame();
      },
      dispose() { gpu.dispose(); }
    };
  }

  const api = { create, createSceneRenderer, parseColor, emitSoftRibbonTriangles };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallWebGL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
