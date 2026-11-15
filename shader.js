// Fragment shader for the slide. Everything is drawn on one full-screen triangle:
// each pixel casts a ray down a bending tube of radius 1 and shades what it hits.
window.SLIDE_VERT = `#version 300 es
in vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

window.SLIDE_FRAG = `#version 300 es
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uBase;     // whole rings travelled, wrapped at PERIOD
uniform float uFrac;     // distance into the current ring (world units)
uniform float uSpeed;    // world units per second
uniform float uRoll;
uniform float uYaw;
uniform float uSkyPitch;
uniform vec2  uK;        // how hard the slide bends (x: right, y: up)
uniform vec2  uCam;
uniform vec2  uLook;
out vec4 outColor;

const float PI = 3.14159265;
const float L = 0.8;          // length of one ring of panels
const float NU = 16.0;        // triangles columns around the tube
const float PERIOD = 8192.0;  // ring pattern repeats seamlessly after this many rings
const float CH = 0.92;        // half-angle of the pearly chute at the bottom
const float SC = 168.0 / 8192.0;
const float SCI = 204.0 / 8192.0;

// Weighted toward pink / fuchsia / violet / blue; cyan, mint, orange, yellow are accents.
const vec3 PAL[12] = vec3[12](
  vec3(1.00, 0.36, 0.72),  // pink
  vec3(1.00, 0.10, 0.78),  // fuchsia
  vec3(0.60, 0.26, 1.00),  // violet
  vec3(0.22, 0.38, 1.00),  // blue
  vec3(0.20, 0.85, 1.00),  // cyan accent
  vec3(0.50, 0.30, 1.00),  // violet
  vec3(1.00, 0.20, 0.85),  // fuchsia
  vec3(1.00, 0.50, 0.75),  // pink
  vec3(0.30, 0.45, 1.00),  // blue
  vec3(0.35, 1.00, 0.70),  // mint accent
  vec3(0.72, 0.30, 1.00),  // violet
  vec3(1.00, 0.28, 0.62)); // hot pink

vec3 pal(float x){
  x = mod(x, 12.0);
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(PAL[int(i)], PAL[int(mod(i + 1.0, 12.0))], f);
}
float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

// Smooth noise along the ride, periodic over PERIOD rings.
float ringNoise(float v, float sp){
  float x = v / sp, i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  float n = PERIOD / sp;
  return mix(h11(mod(i, n) + sp * 7.3), h11(mod(i + 1.0, n) + sp * 7.3), f);
}
// How far (radians from straight up) the roof is open at ring v. 0 = covered tunnel.
float openAt(float v){
  float n = ringNoise(v, 128.0) * 0.72 + ringNoise(v, 32.0) * 0.28;
  return smoothstep(0.36, 0.66, n) * 2.15;
}
vec3 sceneCol(float vAbs){
  return pal(uTime * 0.07 + vAbs * SC + 1.5 * sin(uTime * 0.013));
}

// a: angle around the tube (0 = bottom, +-PI = top). v: rings ahead of the camera.
// Returns colour and alpha (alpha 0 = hole, the sky shows through).
vec4 surf(float a, float v, float z, float ndv){
  float vAbs = mod(v + uBase, PERIOD);
  vec3 sc = sceneCol(vAbs);
  float aa = abs(a);
  vec3 frameCol = vec3(0.025, 0.012, 0.05) + sc * 0.03;
  float soft = 1.0 + z * 0.12;

  if (aa < CH) {
    // Pearly chute with an iridescent sheen.
    float e = aa / CH;
    vec3 base = vec3(0.40, 0.39, 0.45) * (0.35 + 0.65 * (1.0 - e * e * 0.6));
    vec3 irid = pal(a * 2.4 + vAbs * SCI + uTime * 0.15 + ndv * 3.0);
    float sx = a * 9.0, si = floor(sx), sf = sx - si;
    sf = sf * sf * (3.0 - 2.0 * sf);
    float streak = pow(mix(h11(si + 40.0), h11(si + 41.0), sf), 5.0);
    vec3 col = base * (sc * sc * 1.15 + sc * 0.2 + 0.10) + irid * (0.10 + 0.22 * (1.0 - ndv)) + (irid + 0.3) * streak * 0.30;
    float seam = fract(vAbs / 3.0);
    col *= 1.0 - 0.5 * smoothstep(0.03 * soft, 0.0, min(seam, 1.0 - seam) * 3.0 * L);
    col += sc * 1.6 * smoothstep(CH - 0.06, CH - 0.01, aa);   // glowing lip
    return vec4(col, 1.0);
  }

  float frostTop = 1.22 + 0.5 * ringNoise(vAbs, 32.0);
  float seamGlow = exp(-abs(aa - frostTop) * 34.0);

  if (aa < frostTop) {
    // Lower shell: big frosted panels lit from behind, LED strips in the seams.
    float bh = 0.29;
    float b = floor((aa - CH) / bh);
    float fa = fract((aa - CH) / bh);
    float w = (v + uBase) * 0.5 + 0.5 * mod(b, 2.0);
    float cell = floor(w), f = w - cell;
    vec2 id = vec2(mod(cell, PERIOD * 0.5), b * 2.0 + step(0.0, a) + 11.0);
    float h = h21(id);
    float topD = PI - (CH + (b + 0.5) * bh);
    float cv = mod((cell + 0.5 - 0.5 * mod(b, 2.0)) * 2.0, PERIOD);
    if (topD < openAt(cv) + (h - 0.5) * 0.5) return vec4(0.0);
    float dv = min(f, 1.0 - f) * 2.0 * L;
    float da = min(fa, 1.0 - fa) * bh;
    float d = min(dv, da);
    float glass = smoothstep(0.018 * soft, 0.034 * soft, d);
    vec3 col = (sc * sc * 0.80 + sc * 0.12 + 0.02) * (0.62 + 0.38 * h) * (0.75 + 0.25 * smoothstep(0.0, 0.12, d));
    col = mix(frameCol, col, glass);
    col += sc * 1.5 * exp(-da * 46.0);
    col += sc * 2.4 * seamGlow;
    return vec4(col, 1.0);
  }

  // Upper body: triangular dichroic glass in dark frames.
  float u = (a + PI) / (2.0 * PI) * NU;
  float sh = mod(0.5 * uBase, NU);
  float qx = u - 0.5 * v - sh;
  float ci = floor(qx), cj = floor(v);
  vec2 f = vec2(qx - ci, v - cj);
  float up = step(1.0, f.x + f.y);
  vec2 cen = mix(vec2(1.0 / 3.0), vec2(2.0 / 3.0), up);
  float d = up > 0.5
    ? min(min(1.0 - f.x, 1.0 - f.y), (f.x + f.y - 1.0) * 0.707)
    : min(min(f.x, f.y), (1.0 - f.x - f.y) * 0.707);
  float vc = cj + cen.y;
  float ucm = mod(ci + cen.x + 0.5 * vc + sh, NU);
  float topD = min(ucm, NU - ucm) * (2.0 * PI / NU);
  vec2 id = vec2(mod(ci, NU) + up * 37.0, mod(cj + uBase, PERIOD));
  float h = h21(id), h2 = h21(id + 71.3), h3 = h21(id + 13.7);
  float edge = topD - openAt(mod(vc + uBase, PERIOD)) - (h - 0.5) * 0.7;
  float frame = 1.0 - smoothstep(0.034 * soft, 0.058 * soft, d);
  if (edge < 0.0) {
    // Roof is open here. Near the opening a bare skeleton of frames remains.
    if (edge > -0.32 && h2 > 0.35 && frame > 0.5) return vec4(frameCol + sc * 0.05, 1.0);
    return vec4(0.0);
  }
  vec3 g = pal(h * 12.0 + (1.0 - ndv) * 2.5 + uTime * 0.05 + 0.3 * sin(uTime * 0.2 + h * 40.0));
  if (h2 > 0.80) g = mix(vec3(1.0, 0.50, 0.10), vec3(1.0, 0.86, 0.22), h3);   // orange / yellow accents
  float bright = h2 < 0.10 ? 0.10 : 0.35 + 0.65 * h3;
  vec3 col = (g * g * 0.80 + sc * 0.12) * bright * (0.55 + 0.45 * smoothstep(0.0, 0.3, d));
  col = mix(col, frameCol, frame);
  col += sc * 2.4 * seamGlow;
  return vec4(col, 1.0);
}

vec3 rotSky(vec3 d){
  float cp = cos(uSkyPitch), sp = sin(uSkyPitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(uYaw), sy = sin(uYaw);
  return vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
}
float starLayer(vec2 sp, float seed){
  vec2 cell = floor(sp), f = fract(sp) - 0.5;
  vec2 off = (vec2(h21(cell + seed), h21(cell + seed + 9.1)) - 0.5) * 0.7;
  float b = h21(cell + seed + 3.3);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + b * 3.0) + b * 50.0);
  return smoothstep(0.085, 0.0, length(f - off)) * step(0.72, b) * (0.5 + 1.8 * b * b) * tw;
}
vec3 sky(vec3 d){
  d = rotSky(d);
  vec2 sp = vec2(atan(d.x, d.z), asin(clamp(d.y, -1.0, 1.0)));
  float st = starLayer(sp * 22.0, 0.0) + 0.6 * starLayer(sp * 41.0, 17.0);
  vec3 haze = pal(sp.x * 0.9 + uTime * 0.02) * (0.003 + 0.010 * smoothstep(0.7, -0.2, d.y));
  return vec3(0.002, 0.0015, 0.008) + haze + vec3(0.85, 0.88, 1.0) * st;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float cr = cos(uRoll), sr = sin(uRoll);
  uv = vec2(uv.x * cr - uv.y * sr, uv.x * sr + uv.y * cr);
  const float F = 0.8;
  vec3 d = normalize(vec3(uv + uLook, F));
  vec2 m = d.xy / max(d.z, 0.05);
  float dither = h21(gl_FragCoord.xy + fract(uTime) * 91.7);

  // Sky, with stars stretched away from the centre as speed rises.
  vec3 skyCol = vec3(0.0);
  float sb = uSpeed * 0.0012;
  for (int j = 0; j < 4; j++) {
    float t = (float(j) + dither) / 4.0;
    skyCol += sky(normalize(vec3(uv * (1.0 - sb * t) + uLook, F)));
  }
  skyCol *= 0.25;

  // Find where this ray meets the tube wall.
  float z0 = 0.0, z1 = -1.0;
  for (int i = 1; i <= 56; i++) {
    float fi = float(i);
    float z = 0.15 * fi + 0.012 * fi * fi;
    if (length(uCam + m * z - uK * z * z) > 1.0) { z1 = z; break; }
    z0 = z;
  }
  vec3 col;
  if (z1 < 0.0) {
    col = sceneCol(mod(46.0 / L + uBase, PERIOD)) * 0.22;
  } else {
    for (int i = 0; i < 6; i++) {
      float zm = 0.5 * (z0 + z1);
      if (length(uCam + m * zm - uK * zm * zm) > 1.0) z1 = zm; else z0 = zm;
    }
    float z = 0.5 * (z0 + z1);
    vec2 P = uCam + m * z - uK * z * z;
    float a = atan(P.x, -P.y);
    float ndv = clamp(abs(dot(normalize(vec3(m, 1.0)), vec3(normalize(P), 0.0))) * 2.5, 0.0, 1.0);
    float v = (z + uFrac) / L;

    // Motion blur: smear the surface along the direction of travel, longer when faster.
    float blur = uSpeed * 0.017 / L;
    vec3 acc = vec3(0.0);
    for (int j = 0; j < 6; j++) {
      vec4 s = surf(a, v + (float(j) + dither) / 6.0 * blur, z, ndv);
      acc += mix(skyCol, s.rgb, s.a);
    }
    col = acc / 6.0;
    float fog = 1.0 - exp(-z * 0.05);
    col = mix(col, sceneCol(mod(v + uBase, PERIOD)) * 0.10 + skyCol * 0.5, fog * 0.85);
  }

  float vig = 1.0 - 0.32 * dot(uv, uv);
  col *= vig;
  col = 1.0 - exp(-col * 1.35);
  col = pow(col, vec3(0.4545));
  col += (dither - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;
