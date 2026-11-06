// The whole universe is this one fragment shader: every body is an analytic
// ray-sphere hit shaded procedurally from a tiling 3D noise texture, so there
// are no meshes and no downloaded textures. Rays start at the origin; all
// positions are camera-relative, which keeps float precision across the system.

precision highp float;
precision highp int;
precision highp sampler3D;

#define MAXB 4
#define T_TERRAN 0
#define T_BURNED 1
#define T_GIANT 2
#define T_ICE 3
#define T_ROCK 4
#define T_LOCKED 5
#define T_HOLE 6

uniform vec2 uRes;        // drawing-buffer pixels
uniform vec2 uCss;        // CSS pixels
uniform float uTime;      // dilated by the cursor mass
uniform float uClock;     // real time, for dither and flow that must not stop
uniform mat3 uCam;
uniform float uFocal;
uniform vec3 uSunPos;
uniform float uSunR;
uniform float uSunVis;    // CPU-side occlusion of the sun, drives the glare
uniform int uCount;
uniform vec4 uB[MAXB];    // xyz centre, w radius
uniform vec4 uP[MAXB];    // type, seed, atmosphere height / R, octaves
uniform vec4 uQ[MAXB];    // axis xyz, spin angle
uniform sampler3D uNoise;
uniform sampler2D uText;
uniform vec4 uTR[2];      // on-screen rect in CSS px: x, y, w, h
uniform vec4 uTA[2];      // atlas rect in uv
uniform vec2 uTOp;        // opacity per slot
uniform float uGhost;     // how much a heading shows through a body that eclipses it
uniform vec4 uMass;       // xy position, z Einstein radius, w collapse 0..1
uniform vec4 uWave;       // xy origin, z radius, w amplitude
uniform vec3 uGrade;      // exposure, reading dim, dim side (-1 left, 1 right, 0 all)

out vec4 outColor;

const mat3 M3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

// ---------------------------------------------------------------- noise

float vn(vec3 p) {
  vec3 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0).x;
}
vec4 vn4(vec3 p) {
  vec3 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoise, (i + f + 0.5) / 64.0, 0.0);
}
float fbm(vec3 p, float oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  int o = int(oct);
  for (int i = 0; i < o; i++) {
    s += a * vn(p);
    n += a;
    p = M3 * p * 2.03 + 1.7;
    a *= 0.56;
  }
  return s / n;
}
float ridged(vec3 p, float oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  int o = int(oct);
  for (int i = 0; i < o; i++) {
    float v = 1.0 - abs(2.0 * vn(p) - 1.0);
    s += a * v * v;
    n += a;
    p = M3 * p * 2.11 + 3.1;
    a *= 0.5;
  }
  return s / n;
}
float hash1(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec4 hash4(vec3 p) {
  vec4 q = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

// ---------------------------------------------------------------- geometry

vec3 toLocal(vec3 v, vec3 axis, float spin) {
  vec3 t = normalize(cross(axis, vec3(0.31, 0.17, 0.93)));
  vec3 b = cross(axis, t);
  float x = dot(v, t), y = dot(v, axis), z = dot(v, b);
  float c = cos(spin), s = sin(spin);
  return vec3(c * x - s * z, y, s * x + c * z);
}

// ---------------------------------------------------------------- sky

vec3 stars(vec3 d) {
  vec3 col = vec3(0.0);
  float px = 2.0 / (uRes.y * uFocal);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 60.0 + 80.0 * fi * (1.0 + fi);
    vec3 g = d * s + fi * 19.7;
    vec3 id = floor(g);
    vec4 h = hash4(id);
    float keep = 0.945 + 0.015 * fi;
    if (h.w < keep) continue;
    vec3 f = g - id - 0.5 - (h.xyz - 0.5) * 0.5;
    float w = 0.72 * px * s;
    float e = exp(-dot(f, f) / (w * w));
    float mag = (h.w - keep) / (1.0 - keep);
    mag = mag * mag * mag * mag;
    vec3 tint = mix(vec3(1.0, 0.70, 0.48), vec3(0.66, 0.80, 1.0), h.x);
    tint = mix(vec3(1.0), tint, 0.7);
    col += e * tint * (0.008 + mag * (1.3 - fi * 0.4));
  }
  return col;
}

vec3 sky(vec3 d) {
  vec3 col = stars(d);
  // A very faint galactic plane, tilted away from the ecliptic.
  vec3 gal = normalize(vec3(0.36, 0.84, -0.40));
  float lat = dot(d, gal);
  float band = exp(-lat * lat / 0.05);
  if (band > 0.002) {
    vec3 q = d * 2.6;
    float n = fbm(q + fbm(q * 1.4 + 3.0, 3.0) * 1.3, 5.0);
    float lanes = smoothstep(0.42, 0.66, fbm(q * 2.3 + 11.0, 4.0));
    float glow = band * smoothstep(0.28, 0.72, n) * (1.0 - 0.75 * lanes);
    col += glow * mix(vec3(0.018, 0.021, 0.034), vec3(0.042, 0.029, 0.024), n) * 1.5;
  }
  return col;
}

// ---------------------------------------------------------------- atmosphere

vec3 atmosphere(vec3 rd, vec3 c, float R, float H, vec3 L, float tSurf,
                vec3 betaR, float betaM, float g, out vec3 trans) {
  trans = vec3(1.0);
  float Ra = R + H;
  float b = dot(rd, c);
  float h = b * b - dot(c, c) + Ra * Ra;
  if (h <= 0.0) return vec3(0.0);
  h = sqrt(h);
  float t0 = max(b - h, 0.0), t1 = b + h;
  if (t1 <= 0.0) return vec3(0.0);
  t1 = min(t1, tSurf);
  if (t1 <= t0) return vec3(0.0);
#if QUALITY > 0
  const int N = 9;
#else
  const int N = 5;
#endif
  // Samples spaced by sinh around closest approach: grazing rays stop banding.
  float va = asinh((t0 - b) / H), vb = asinh((t1 - b) / H);
  float dv = (vb - va) / float(N);
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  for (int i = 0; i < N; i++) {
    float v = va + (float(i) + 0.5) * dv;
    float t = b + H * sinh(v);
    float dt = H * cosh(v) * dv;
    vec3 pc = rd * t - c;
    float r = length(pc);
    float alt = max(r - R, 0.0) / H;
    float dR = exp(-alt * 5.2) * dt / H;
    float dM = exp(-alt * 12.0) * dt / H;
    odR += dR;
    odM += dM;
    float bs = dot(pc, L);
    float r2 = r * r;
    float hs = bs * bs - r2 + Ra * Ra;
    float pathS = -bs + sqrt(max(hs, 0.0));
    float d2 = max(r2 - bs * bs, 0.0);
    float shadow = bs > 0.0 ? 1.0 : smoothstep(R * 0.992, R * 1.006, sqrt(d2));
    if (shadow <= 0.0) continue;
    float odS = pathS / H;
    vec3 tau = betaR * (odR + exp(-alt * 5.2) * odS * 0.30) + betaM * 1.1 * (odM + exp(-alt * 12.0) * odS * 0.30);
    vec3 tr = exp(-tau) * shadow;
    sR += dR * tr;
    sM += dM * tr;
  }
  float mu = dot(rd, L);
  float pR = 0.0597 * (1.0 + mu * mu);
  float gg = g * g;
  float pM = 0.0796 * (1.0 - gg) * (1.0 + mu * mu) / ((2.0 + gg) * pow(max(1.0 + gg - 2.0 * g * mu, 1e-3), 1.5));
  trans = exp(-(betaR * odR + betaM * odM));
  vec3 ca = normalize(rd * b - c);
  float dayness = smoothstep(-0.12, 0.24, dot(ca, L));
  float m2 = max(mu, 0.0);
  float near = m2 * m2 * m2 * m2 * m2 * m2 * m2;
  float gather = mix(0.05 + 1.5 * near, 1.0, dayness);
  return (sR * betaR * pR + sM * betaM * pM) * 9.0 * gather;
}

// ---------------------------------------------------------------- surfaces

struct Mat { vec3 alb; vec3 emit; float gloss; float cloud; };

float heightOf(int type, vec3 q, float seed, float oct) {
  if (type == T_TERRAN) {
    vec3 w = q * 3.2 + seed + 1.1 * vec3(fbm(q * 2.4 + 11.0, 4.0), fbm(q * 2.4 + 23.0, 4.0), fbm(q * 2.4 + 37.0, 4.0));
    return fbm(w, oct);
  }
  if (type == T_ICE) return ridged(q * 3.0 + seed, oct);
  if (type == T_ROCK) return fbm(q * 3.4 + seed, oct) * 0.6 + ridged(q * 2.1 + seed, oct - 1.0) * 0.4;
  if (type == T_LOCKED) return fbm(q * 2.2 + seed, min(oct, 6.0));
  if (type == T_BURNED) return fbm(q * 5.0 + seed, oct);
  return 0.5;
}

// Harvested parcels: a warped grid gives the quilt of fields seen from orbit.
// A parcel burns whole when the noise under its centre exceeds 0.60, the
// threshold the burned-cropland paper deploys. Embers sit on the burn front.
Mat burned(vec3 q, float seed, float oct, vec3 Lw) {
  Mat m = Mat(vec3(0.0), vec3(0.0), 0.0, 0.0);
  vec3 p = q + seed;
  vec3 warp = 0.05 * vec3(vn(p * 6.0), vn(p * 6.0 + 9.0), vn(p * 6.0 + 21.0));
  float F = 34.0;
  vec3 g = (p + warp) * F;
  vec3 id = floor(g);
  vec3 f = g - id;
  vec4 h = hash4(id);
  // Sub-parcels break the regular grid.
  vec3 g2 = g * 2.0 + h.xyz;
  vec3 id2 = floor(g2);
  vec4 h2 = hash4(id2);
  vec3 f2 = g2 - id2;
  float pick = h.w > 0.45 ? h2.x : h.x;
  vec3 straw = vec3(0.34, 0.26, 0.13);
  vec3 stubble = vec3(0.20, 0.145, 0.075);
  vec3 soil = vec3(0.105, 0.070, 0.042);
  vec3 green = vec3(0.070, 0.105, 0.040);
  vec3 col = pick < 0.4 ? mix(stubble, straw, pick / 0.4) : pick < 0.8 ? mix(soil, stubble, (pick - 0.4) / 0.4) : mix(green, soil, (pick - 0.8) / 0.2);
  col *= 0.75 + 0.5 * vn(p * 80.0);
  // Field boundaries.
  vec3 ed = min(f2, 1.0 - f2);
  float edge = smoothstep(0.0, 0.06, min(ed.x, min(ed.y, ed.z)));
  col *= 0.72 + 0.28 * edge;
  // Coarse relief so the quilt sits on a planet instead of being the planet.
  float macro = fbm(p * 2.3, 5.0);
  col = mix(col, vec3(0.09, 0.065, 0.05), smoothstep(0.58, 0.72, macro));
  col = mix(col, col * 0.55, smoothstep(0.55, 0.32, macro) * 0.8);

  vec3 c0 = (id + 0.5) / F;
  float sCell = fbm(c0 * 7.5 + 40.0, 5.0);
  float sFine = fbm((p + warp) * 7.5 + 40.0, oct);
  float s = mix(sCell, sFine, 0.12);
  float burn = smoothstep(0.597, 0.603, s);
  vec3 scar = mix(vec3(0.012, 0.010, 0.010), vec3(0.035, 0.026, 0.022), vn(p * 60.0));
  col = mix(col, scar, burn);
  // Ash halo around each scar.
  col = mix(col, col * 0.45, smoothstep(0.54, 0.60, s) * (1.0 - burn));
  m.alb = col;

  // Embers on the front.
  float front = smoothstep(0.575, 0.598, s) * smoothstep(0.625, 0.60, s);
  vec3 eg = (p + warp) * 150.0;
  vec3 eid = floor(eg);
  vec4 eh = hash4(eid);
  vec3 ef = eg - eid - 0.5 - (eh.xyz - 0.5) * 0.6;
  float spark = exp(-dot(ef, ef) * 22.0);
  float flick = 0.65 + 0.35 * sin(uClock * (0.8 + eh.y * 2.0) + eh.x * 40.0);
  float on = step(0.68, eh.w);
  m.emit = vec3(1.0, 0.33, 0.07) * front * on * spark * flick * 3.2
         + vec3(0.60, 0.16, 0.03) * front * 0.10;
  return m;
}

Mat terran(vec3 q, float seed, float oct, float time, float hgt, out float shadowCloud, vec3 Ll) {
  Mat m = Mat(vec3(0.0), vec3(0.0), 0.0, 0.0);
  float land = smoothstep(0.495, 0.515, hgt);
  float lat = abs(q.y);
  vec3 ocean = mix(vec3(0.010, 0.030, 0.052), vec3(0.005, 0.014, 0.030), smoothstep(0.50, 0.38, hgt));
  float rock = fbm(q * 9.0 + seed, 5.0);
  vec3 dry = mix(vec3(0.17, 0.115, 0.075), vec3(0.32, 0.24, 0.17), rock);
  vec3 wet = mix(vec3(0.045, 0.060, 0.035), vec3(0.085, 0.085, 0.05), rock);
  vec3 ground = mix(wet, dry, smoothstep(0.25, 0.65, 1.0 - lat + (rock - 0.5) * 0.6 - 0.3));
  ground = mix(ground, ground * 0.6, smoothstep(0.53, 0.62, hgt));
  float ice = smoothstep(0.78, 0.86, lat + (rock - 0.5) * 0.18);
  m.alb = mix(ocean, ground, land);
  m.alb = mix(m.alb, vec3(0.75, 0.80, 0.86), ice);
  m.gloss = (1.0 - land) * (1.0 - ice);

  // Clouds drift over the surface in their own domain-warped layer.
  vec3 cq = q;
  float spinC = time * 0.006;
  cq.xz = mat2(cos(spinC), -sin(spinC), sin(spinC), cos(spinC)) * cq.xz;
  // Stretched east-west and sheared, so weather reads as bands of fronts, not blobs.
  vec3 cw = cq * vec3(4.2, 7.6, 4.2) + seed + 2.2 * vec3(fbm(cq * 3.0 + 5.0, 5.0), fbm(cq * 3.0 + 15.0, 5.0), fbm(cq * 3.0 + 25.0, 5.0));
  float c = fbm(cw, oct);
  float wisps = ridged(cw * 3.4, max(oct - 2.0, 2.0));
  float cloud = smoothstep(0.505, 0.60, c + (wisps - 0.42) * 0.09);
  m.cloud = cloud;
  // Cloud shadows: same field, sampled toward the sun.
  float c2 = fbm(cw + Ll * 0.35, min(oct, 5.0));
  shadowCloud = smoothstep(0.505, 0.62, c2);
  return m;
}

// ---------------------------------------------------------------- rings

// Eight lanes, one for each concurrent request in the Pylon benchmark.
// Particle flow is scaled from the measured 184.9 tokens/s at eight requests.
float ringDensity(float rr, float seed) {
  float lane = (rr - 1.42) / (2.46 - 1.42);
  if (lane < 0.0 || lane > 1.0) return 0.0;
  float l8 = lane * 8.0;
  float id = floor(l8);
  float f = l8 - id;
  float gap = smoothstep(0.0, 0.05, f) * smoothstep(1.0, 0.95, f);
  float fine = fbm(vec3(rr * 26.0, seed, 0.0), 5.0);
  float w = 0.55 + 0.35 * sin(id * 2.3 + seed) ;
  float env = smoothstep(0.0, 0.03, lane) * smoothstep(1.0, 0.92, lane);
  return env * gap * clamp(w * (0.35 + 1.1 * fine), 0.0, 1.0);
}

vec3 ringColor(float rr, float seed) {
  float n = fbm(vec3(rr * 7.0, seed + 3.0, 1.0), 3.0);
  return mix(vec3(0.30, 0.28, 0.27), vec3(0.62, 0.57, 0.52), n);
}

// ---------------------------------------------------------------- black hole

// Integrates a null geodesic in units of the Schwarzschild radius, starting at
// the influence sphere. The thin disk is emissive with Doppler beaming.
vec3 blackHole(vec3 rd, vec3 c, float Rs, vec3 n, float infl, out float covered) {
  covered = 0.0;
  float b = dot(rd, c);
  float R = Rs * infl;
  float h = b * b - dot(c, c) + R * R;
  if (h <= 0.0) return vec3(0.0);
  h = sqrt(h);
  float t0 = max(b - h, 0.0);
  if (b + h <= 0.0) return vec3(0.0);
  vec3 p = (rd * t0 - c) / Rs;
  vec3 v = rd;
  float h2 = dot(cross(p, v), cross(p, v));
#if QUALITY > 0
  const int N = 72;
#else
  const int N = 34;
#endif
  vec3 acc = vec3(0.0);
  float al = 0.0;
  bool captured = false;
  for (int i = 0; i < N; i++) {
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r < 1.02) { captured = true; break; }
    if (r > infl * 1.01 && dot(p, v) > 0.0) break;
    float dt = clamp(0.13 * r, 0.04, 2.2) * (QUALITY > 0 ? 1.0 : 1.9);
    vec3 pn = p + v * dt;
    v += -1.5 * h2 * pn / pow(dot(pn, pn), 2.5) * dt;
    float s0 = dot(p, n), s1 = dot(pn, n);
    if (s0 * s1 < 0.0 && al < 0.995) {
      vec3 ip = mix(p, pn, s0 / (s0 - s1));
      float rr = length(ip);
      if (rr > 2.7 && rr < 12.5) {
        vec3 t = normalize(cross(n, vec3(0.2, 0.9, 0.1)));
        vec3 bt = cross(n, t);
        vec2 dp = vec2(dot(ip, t), dot(ip, bt));
        float ang = uTime * 1.5 / pow(rr, 1.5);
        vec2 sp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * dp;
        float streak = fbm(vec3(sp * vec2(0.42) + 10.0, rr * 0.75), 5.0);
        float inner = smoothstep(2.7, 3.3, rr), outer = smoothstep(12.5, 5.0, rr);
        float dens = inner * outer * (0.30 + 1.3 * streak * streak);
        vec3 vel = normalize(cross(n, ip)) * sqrt(0.5 / max(rr - 1.0, 0.2));
        float dop = 1.0 / max(1.0 - dot(normalize(v), vel) * 0.92, 0.25);
        float heat = pow(3.0 / rr, 1.4);
        vec3 tint = mix(vec3(1.0, 0.38, 0.10), vec3(1.0, 0.82, 0.60), clamp(heat * dop * 0.55, 0.0, 1.0));
        tint = mix(tint, vec3(0.82, 0.88, 1.0), clamp(heat * dop * 0.28 - 0.25, 0.0, 1.0));
        float a = clamp(dens * 1.05, 0.0, 1.0);
        acc += (1.0 - al) * a * tint * heat * pow(dop, 3.0) * 1.15;
        al += (1.0 - al) * a;
      }
    }
    p = pn;
  }
  covered = 1.0;
  if (captured) return acc;
  return acc + (1.0 - al) * sky(normalize(v));
}

// ---------------------------------------------------------------- main

vec2 lensed(vec2 p, out float hole, out float ring) {
  vec2 d = p - uMass.xy;
  float r2 = dot(d, d);
  float r = sqrt(r2);
  float rE = uMass.z;
  hole = 0.0;
  ring = 0.0;
  if (rE <= 0.0) return p;
  float rH = rE * 0.62 * uMass.w;
  float px = 2.0 / uRes.y;
  hole = smoothstep(rH + px, rH - px, r) * step(0.001, uMass.w);
  ring = uMass.w * exp(-pow((r - rH * 1.02) / (rE * 0.022 + px), 2.0));
  // Point-lens deflection. The softening keeps a small idle mass glassy.
  return p - d * (rE * rE) / (r2 + rE * rE * 0.06 * (1.0 - uMass.w));
}

void main() {
  vec2 p = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  if (uWave.w > 0.0) {
    vec2 dw = p - uWave.xy;
    float lw = length(dw) + 1e-4;
    float x = lw - uWave.z;
    p += dw / lw * uWave.w * sin(x * 34.0) * exp(-x * x * 26.0);
  }
  float hole, phot;
  vec2 pl = lensed(p, hole, phot);
  vec3 rd = normalize(uCam * vec3(pl, uFocal));
  float pw = 2.0 / (uRes.y * uFocal);
  vec3 Lg = normalize(uSunPos);

  // Nearest opaque hit.
  int hit = -1;
  float tHit = 1e12, cov = 0.0;
  for (int i = 0; i < uCount; i++) {
    int ty = int(uP[i].x);
    if (ty == T_HOLE) continue;
    vec3 c = uB[i].xyz;
    float R = uB[i].w;
    float b = dot(rd, c);
    if (b <= 0.0) continue;
    float d = sqrt(max(dot(c, c) - b * b, 0.0));
    float cv = clamp(0.5 - (d - R) / (pw * b), 0.0, 1.0);
    if (cv <= 0.0) continue;
    float t = b - sqrt(max(R * R - d * d, 0.0));
    if (t > 0.0 && t < tHit) { tHit = t; hit = i; cov = cv; }
  }

  // Headings live out in the sky, behind every body, in the same bent light.
  vec2 css = vec2((pl.x * uRes.y + uRes.x) * 0.5, (uRes.y - pl.y * uRes.y) * 0.5) * (uCss.y / uRes.y);
  float txt = 0.0;
  for (int i = 0; i < 2; i++) {
    if (uTOp[i] <= 0.0) continue;
    vec2 uv = (css - uTR[i].xy) / uTR[i].zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    txt = max(txt, textureLod(uText, uTA[i].xy + uv * uTA[i].zw, 0.0).a * uTOp[i]);
  }

  // Background: stars, black hole, headings.
  vec3 col = vec3(0.0);
  if (cov < 1.0) {
    float covered = 0.0;
    vec3 bh = vec3(0.0);
    for (int i = 0; i < uCount; i++) {
      if (int(uP[i].x) == T_HOLE) {
        bh = blackHole(rd, uB[i].xyz, uB[i].w, uQ[i].xyz, 16.0, covered);
      }
    }
    col = covered > 0.5 ? bh : sky(rd);

    col = mix(col, vec3(0.93, 0.92, 0.88), txt);
  }

  // Rings of any giant, sorted against the opaque hit.
  vec4 ringFront = vec4(0.0);
  vec4 ringBack = vec4(0.0);
  for (int i = 0; i < uCount; i++) {
    if (int(uP[i].x) != T_GIANT) continue;
    vec3 c = uB[i].xyz, axis = uQ[i].xyz;
    float R = uB[i].w;
    float dn = dot(rd, axis);
    if (abs(dn) < 1e-5) continue;
    float t = dot(c, axis) / dn;
    if (t <= 0.0) continue;
    vec3 rp = rd * t - c;
    float rr = length(rp) / R;
    float dens = ringDensity(rr, uP[i].y);
    if (dens <= 0.0) continue;
    vec3 L = normalize(uSunPos - c);
    // Planet shadow on the rings.
    float bs = dot(rp, L);
    float d2 = dot(rp, rp) - bs * bs;
    float shade = bs > 0.0 ? 1.0 : smoothstep(R * R * 0.96, R * R * 1.04, d2);
    // Grain flowing along the lanes.
    vec3 tang = normalize(cross(axis, rp));
    float ang = atan(dot(rp, normalize(cross(axis, vec3(0.31, 0.17, 0.93)))), dot(rp, cross(axis, normalize(cross(axis, vec3(0.31, 0.17, 0.93))))));
    float lane = floor((rr - 1.42) / (2.46 - 1.42) * 8.0);
    float flow = uClock * 0.0115 * 184.9 / (6.0 + lane * 2.0);
    vec3 gp = vec3(ang * 140.0 + flow, rr * 900.0, lane);
    float grain = 0.86 + 0.28 * vn(gp);
    vec3 V = -rd;
    float forward = pow(max(dot(rd, L), 0.0), 6.0);
    float lit = 0.22 + 1.6 * forward + 0.34 * abs(dot(axis, L));
    vec3 rc = ringColor(rr, uP[i].y) * lit * shade * grain * 1.05;
    float alpha = clamp(dens * 0.58 / max(abs(dn) * 2.4, 0.30), 0.0, 0.94);
    if (t < tHit) ringFront = vec4(rc * alpha, alpha);
    else ringBack = vec4(rc * alpha, alpha);
  }

  // Surface.
  if (hit >= 0) {
    int ty = int(uP[hit].x);
    float seed = uP[hit].y, oct = uP[hit].w;
    vec3 c = uB[hit].xyz, axis = uQ[hit].xyz;
    float R = uB[hit].w;
    vec3 L = normalize(uSunPos - c);
    vec3 N = normalize(rd * tHit - c);
    vec3 V = -rd;
    vec3 q = toLocal(N, axis, uQ[hit].w);
    vec3 Ll = toLocal(L, axis, uQ[hit].w);
    vec3 surf = vec3(0.0);
    float hgt = 0.5;
    if (ty != T_GIANT) {
      hgt = ty == T_BURNED ? 0.5 : heightOf(ty, q, seed, oct);
    }
    // Bump from finite differences of the height field.
    vec3 Nb = N;
    float nearEnough = oct >= 5.0 ? 1.0 : 0.0;
#if QUALITY > 0
    if (nearEnough > 0.5 && ty != T_GIANT && ty != T_BURNED) {
      float e = 0.0035;
      vec3 tu = normalize(cross(N, vec3(0.13, 0.91, 0.37)));
      vec3 tv = cross(N, tu);
      float bo = min(oct, 6.0);
      float h0 = heightOf(ty, q, seed, bo);
      float hu = heightOf(ty, toLocal(normalize(N + tu * e), axis, uQ[hit].w), seed, bo);
      float hv = heightOf(ty, toLocal(normalize(N + tv * e), axis, uQ[hit].w), seed, bo);
      float kb = ty == T_TERRAN ? (hgt > 0.5 ? 0.9 : 0.0) : ty == T_ROCK ? 1.1 : ty == T_ICE ? 0.42 : 0.16;
      Nb = normalize(N - (tu * (hu - h0) + tv * (hv - h0)) / e * 0.09 * kb);
    }
#endif
    float ndl = dot(N, L);
    float nbl = max(dot(Nb, L), 0.0);
    float term = smoothstep(-0.05, 0.12, ndl);
    vec3 sunTint = mix(vec3(1.0, 0.42, 0.20), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.38, ndl));
    vec3 H = normalize(L + V);

    if (ty == T_TERRAN) {
      float sc = 0.0;
      Mat m = terran(q, seed, oct, uTime, hgt, sc, Ll);
      vec3 ground = m.alb * nbl * sunTint * (1.0 - 0.72 * sc);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
      float glint = pow(max(dot(Nb, H), 0.0), 340.0) * 1.3 + pow(max(dot(Nb, H), 0.0), 60.0) * 0.018;
      ground += m.gloss * sunTint * term * (glint + fres * 0.08 * vec3(0.5, 0.7, 1.0));
      // Clouds shade themselves: thick cores toward the sun darken what sits behind them.
      float selfShade = 1.0 - 0.58 * sc * (1.0 - 0.4 * m.cloud);
      vec3 cloudLit = vec3(0.60, 0.61, 0.64) * (0.05 + max(nbl, 0.0)) * sunTint * term * selfShade;
      surf = mix(ground, cloudLit, m.cloud * 0.94);
      // Twilight: sky-lit cloud tops, so the night side has mass and not just absence.
      float dusk = exp(min(ndl, 0.0) * 8.0) * (1.0 - term);
      surf += mix(m.alb * 0.5, vec3(0.62, 0.70, 0.95), m.cloud) * dusk * vec3(0.022, 0.026, 0.040);
      // Rare lightning inside night-side storms.
      float slot = floor(uClock * 7.0);
      vec3 lg = q * 44.0;
      vec3 lid = floor(lg);
      vec3 lf = lg - lid - 0.5;
      vec4 lh = hash4(lid + slot);
      float bolt = step(0.9992, lh.x) * exp(-dot(lf, lf) * 30.0) * m.cloud * (1.0 - term);
      surf += vec3(0.55, 0.62, 1.0) * bolt * 0.32;
    } else if (ty == T_BURNED) {
      Mat m = burned(q, seed, oct, Ll);
      surf = m.alb * max(ndl, 0.0) * sunTint * 1.15 + m.emit * (0.25 + 0.75 * (1.0 - term));
    } else if (ty == T_GIANT) {
      vec3 qq = q;
      float wob = fbm(vec3(qq.x * 3.0, qq.y * 12.0, qq.z * 3.0) + seed + uTime * 0.008, oct);
      float lat = qq.y + (wob - 0.5) * 0.10;
      float b1 = fbm(vec3(lat * 15.0, seed, 3.0), 5.0);
      float b2 = fbm(vec3(lat * 44.0 + wob * 1.8, seed + 8.0, 1.0), 4.0);
      vec3 cream = vec3(0.70, 0.62, 0.50), rust = vec3(0.33, 0.20, 0.14), ash = vec3(0.20, 0.20, 0.24);
      vec3 alb = mix(ash, cream, smoothstep(0.32, 0.68, b1));
      alb = mix(alb, rust, smoothstep(0.46, 0.70, b2) * 0.75);
      // Fine shear detail near the band edges.
      float shear = fbm(vec3(qq.xz * 8.0, lat * 80.0) + uTime * 0.012, max(oct - 1.0, 3.0));
      alb *= 0.82 + 0.36 * shear;
      float limb = pow(max(dot(N, V), 0.0), 0.5);
      surf = alb * max(ndl, 0.0) * sunTint * (0.45 + 0.55 * limb) * 1.05;
      // Ring shadow.
      float dnl = dot(L, axis);
      if (abs(dnl) > 1e-4) {
        vec3 sp = N * R;
        float ts = -dot(sp, axis) / dnl;
        if (ts > 0.0) {
          float rr = length(sp + L * ts) / R;
          surf *= 1.0 - 0.82 * ringDensity(rr, seed);
        }
      }
    } else if (ty == T_ICE) {
      float crack = smoothstep(0.012, 0.0, abs(fbm(q * 4.0 + seed, oct) - 0.5));
      float crack2 = smoothstep(0.008, 0.0, abs(fbm(q * 7.5 + seed + 9.0, oct) - 0.5));
      vec3 alb = mix(vec3(0.56, 0.61, 0.66), vec3(0.88, 0.90, 0.92), fbm(q * 2.5 + seed, 5.0));
      alb = mix(alb, vec3(0.42, 0.24, 0.16), crack);
      alb = mix(alb, vec3(0.30, 0.34, 0.42), crack2 * 0.7);
      surf = alb * nbl * mix(sunTint, vec3(1.0), 0.65);
      surf += pow(max(dot(Nb, H), 0.0), 60.0) * 0.18 * term;
    } else if (ty == T_ROCK) {
      float fiss = smoothstep(0.016, 0.0, abs(fbm(q * 4.2 + seed + 7.0, oct) - 0.5));
      vec3 alb = mix(vec3(0.075, 0.068, 0.066), vec3(0.235, 0.215, 0.200), hgt);
      // A few impact craters.
      vec3 cg = q * 7.0 + seed;
      vec3 cid = floor(cg);
      vec4 ch = hash4(cid);
      vec3 cf = cg - cid - 0.5 - (ch.xyz - 0.5) * 0.4;
      float cr = length(cf) / (0.12 + 0.2 * ch.w);
      alb *= 0.7 + 0.5 * smoothstep(0.75, 1.0, cr) * smoothstep(1.3, 1.0, cr) + 0.3 * smoothstep(1.0, 0.7, cr) * -0.6;
      alb = mix(alb, vec3(0.018), fiss);
      surf = alb * nbl * sunTint * 1.3;
    } else if (ty == T_LOCKED) {
      // Tidally locked: the sun never moves, so the surface is organised by it.
      float s = dot(N, L);
      float w = fbm(q * 3.4 + seed + uTime * 0.004, min(oct, 7.0));
      // Wind-scoured dayside: long ridged dunes running away from the substellar point.
      float dune = ridged(q * 5.5 + seed + w * 2.2, min(oct, 7.0));
      vec3 scorch = mix(vec3(0.26, 0.19, 0.11), vec3(0.82, 0.68, 0.44), smoothstep(0.25, 0.75, hgt * 0.6 + dune * 0.55));
      vec3 band = mix(vec3(0.06, 0.08, 0.055), vec3(0.14, 0.15, 0.09), w);
      vec3 ice = mix(vec3(0.14, 0.17, 0.22), vec3(0.38, 0.44, 0.52), hgt);
      float e = (w - 0.5) * 0.05;
      vec3 alb = mix(ice, band, smoothstep(-0.02, 0.05, s + e));
      alb = mix(alb, scorch, smoothstep(0.11, 0.26, s + e));
      surf = alb * max(nbl, 0.0) * mix(vec3(1.0, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.3, s));
      // Starlit ice on the far side, so the line reads even in the dark.
      surf += ice * 0.018 * (1.0 - term);
    }
    // Earthshine-level ambient keeps night sides from being a hole in the sky.
    surf += 0.0006;

    // Aerial perspective.
    float H_ = max(uP[hit].z, 0.0) * R;
    if (H_ > 0.0) {
      vec3 tr;
      vec3 betaR = ty == T_BURNED ? vec3(1.0, 0.72, 0.5) : ty == T_LOCKED ? vec3(0.9, 0.85, 0.8) : ty == T_GIANT ? vec3(1.0, 0.95, 0.85) : vec3(0.60, 1.12, 2.25);
      float betaM = ty == T_BURNED ? 0.34 : 0.10;
      float graze = 1.0 - max(dot(N, V), 0.0);
      float tEnd = tHit + 2.0 * max(dot(rd, c) - tHit, 0.0) * pow(graze, 14.0);
      vec3 sc = atmosphere(rd, c, R, H_, L, tEnd, betaR, betaM, 0.76, tr);
      surf = surf * tr + sc;
      if (cov < 1.0) {
        vec3 tr2;
        vec3 sc2 = atmosphere(rd, c, R, H_, L, 1e12, betaR, betaM, 0.76, tr2);
        col = col * tr2 + sc2;
      }
    }
    col = mix(ringBack.a > 0.0 ? col * (1.0 - ringBack.a) + ringBack.rgb : col, surf, cov);
    col = mix(col, vec3(0.93, 0.92, 0.88), txt * uGhost * cov);
  } else {
    col = col * (1.0 - ringBack.a) + ringBack.rgb;
    col = col * (1.0 - ringFront.a) + ringFront.rgb;
    ringFront = vec4(0.0);
  }
  col = col * (1.0 - ringFront.a) + ringFront.rgb;

  // TraceLens: seven beads on one orbit. Six keep station; one runs late, and burns.
  for (int i = 0; i < uCount; i++) {
    if (uP[i].z >= 0.0) continue; // a negative atmosphere flags the body that carries beads
    vec3 c = uB[i].xyz, axis = uQ[i].xyz;
    float R = uB[i].w;
    vec3 L = normalize(uSunPos - c);
    vec3 e1 = normalize(cross(axis, vec3(0.31, 0.17, 0.93)));
    vec3 e2 = cross(axis, e1);
    float best = tHit, bcv = 0.0;
    vec3 bN = vec3(0.0);
    bool late = false;
    for (int k = 0; k < 7; k++) {
      float fk = float(k);
      float lag = k == 4 ? 0.24 + 0.05 * sin(uClock * 0.4) : 0.0;
      float th = uClock * 0.05 + fk * 0.46 - lag;
      vec3 bc = c + (e1 * cos(th) + e2 * sin(th)) * R * 1.62;
      float br = R * (k == 4 ? 0.05 : 0.042);
      float b = dot(rd, bc);
      if (b <= 0.0) continue;
      float d = sqrt(max(dot(bc, bc) - b * b, 0.0));
      float cv = clamp(0.5 - (d - br) / (pw * b), 0.0, 1.0);
      if (cv <= 0.0) continue;
      float t = b - sqrt(max(br * br - d * d, 0.0));
      if (t < best) { best = t; bcv = cv; bN = normalize(rd * t - bc); late = k == 4; }
    }
    if (bcv > 0.0) {
      vec3 bc = late ? vec3(0.42, 0.22, 0.14) : vec3(0.62, 0.65, 0.68);
      vec3 shade = bc * max(dot(bN, L), 0.0) * 1.2 + 0.002;
      if (late) shade += vec3(1.0, 0.36, 0.09) * 1.8;
      col = mix(col, shade, bcv);
    }
  }

  // Sky-side limb scatter and bloom for every atmosphere the ray grazes.
  for (int i = 0; i < uCount; i++) {
    int ty = int(uP[i].x);
    if (ty == T_HOLE) continue;
    vec3 c = uB[i].xyz;
    float R = uB[i].w, H_ = max(uP[i].z, 0.0) * R;
    vec3 L = normalize(uSunPos - c);
    float b = dot(rd, c);
    if (b <= 0.0) continue;
    float d = sqrt(max(dot(c, c) - b * b, 0.0));
    if (b - R > tHit) continue;
    if (H_ > 0.0 && i != hit && d > R - pw * b) {
      vec3 tr;
      vec3 betaR = ty == T_BURNED ? vec3(1.0, 0.72, 0.5) : ty == T_LOCKED ? vec3(0.9, 0.85, 0.8) : ty == T_GIANT ? vec3(1.0, 0.95, 0.85) : vec3(0.60, 1.12, 2.25);
      float betaM = ty == T_BURNED ? 0.34 : 0.10;
      vec3 sc = atmosphere(rd, c, R, H_, L, tHit, betaR, betaM, 0.76, tr);
      col = col * tr + sc;
    }
    if (H_ > 0.0 && d > R && hit < 0) {
      // A wide, soft halo standing in for bloom on the sunward limb.
      vec3 limbP = normalize(rd * b - c);
      float sunward = pow(max(dot(limbP, L) * 0.5 + 0.5, 0.0), 6.0);
      float x = (d - R) / (R * uP[i].z);
      vec3 tint = ty == T_TERRAN ? vec3(0.34, 0.56, 1.0) : vec3(0.9, 0.56, 0.3);
      col += tint * sunward * exp(-x * 0.55) * 0.042;
    }
  }

  // The sun.
  float mu = dot(rd, Lg);
  float dSun = length(uSunPos);
  float cosR = sqrt(max(1.0 - (uSunR * uSunR) / (dSun * dSun), 0.0));
  if (hit < 0 || tHit > dSun) {
    col += vec3(26.0, 23.0, 19.0) * smoothstep(cosR - 1e-5, cosR + 1e-5, mu);
  }
  // Glare sits on top of everything: it happens in the lens, not in the scene.
  float a = max(mu, 0.0);
  vec3 sunC = uCam * vec3(0.0, 0.0, 1.0);
  vec3 glare = vec3(1.0, 0.86, 0.68) * (pow(a, 9000.0) * 6.0 + pow(a, 1100.0) * 1.1 + pow(a, 130.0) * 0.20 + pow(a, 14.0) * 0.022);
  // Anamorphic streak through the sun's image.
  vec3 cs = Lg * uCam;
  if (cs.z > 0.0) {
    vec2 sp = cs.xy / cs.z * uFocal;
    vec2 ds = pl - sp;
    glare += vec3(0.55, 0.68, 1.0) * exp(-abs(ds.y) * 120.0) * exp(-abs(ds.x) * 1.1) * 0.22;
  }
  col += glare * uSunVis;

  // Cursor mass: horizon and photon ring.
  col = mix(col, vec3(0.0), hole);
  col += vec3(1.0, 0.76, 0.52) * phot * 1.4;

  // Grade.
  col *= uGrade.x;
  if (uGrade.y > 0.0) {
    float sx = p.x * uRes.y / uRes.x;
    float mask = uGrade.z == 0.0 ? 1.0 : smoothstep(-0.12, 0.42, sx * uGrade.z);
    col *= 1.0 - uGrade.y * mask * (1.0 - txt);
  }
  // Vignette.
  vec2 vg = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - dot(vg, vg) * 0.55;
  // ACES-fit tonemap.
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  // Dither: dark gradients band without it.
  float dn = hash1(vec3(gl_FragCoord.xy, floor(uClock * 24.0) * 7.0)) + hash1(vec3(gl_FragCoord.yx + 13.0, floor(uClock * 24.0) * 3.0)) - 1.0;
  col += dn / 170.0;
  outColor = vec4(col, 1.0);
}
