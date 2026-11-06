// Runs the scene: scroll becomes a position on the trajectory, the pointer
// becomes a mass, and everything else is uniforms. Loaded lazily after first paint.

import fragSrc from './scene.frag?raw';
import {
  BODIES, SUN, STOPS, TYPE, add, bodyFor, cross, dot, interp, keyFromFrame, len, lerp3, mul, norm, stopFor, sub,
  type Body, type Key, type V3,
} from './world';

const VERT = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const DUST_VERT = `#version 300 es
precision highp float;
in vec4 aSeed;
uniform mat3 uCam; uniform float uFocal; uniform float uAspect;
uniform vec3 uOffset; uniform vec3 uVel; uniform vec4 uMass; uniform float uBox; uniform float uClock;
out float vA;
void main(){
  float tail = float(gl_VertexID & 1);
  vec3 p = mod(aSeed.xyz * uBox + uOffset, uBox) - uBox * 0.5;
  vec3 c = p * uCam;
  c += uVel * tail;
  // Slow personal drift so the dust never reads as a rigid volume.
  c += 0.25 * vec3(sin(uClock * 0.09 + aSeed.w * 40.0), cos(uClock * 0.07 + aSeed.w * 61.0), 0.0);
  float z = c.z + 0.01;
  vec2 ndc = c.xy / max(z, 0.05) * uFocal;
  vec2 d = ndc - uMass.xy;
  float r2 = dot(d, d) + 0.002;
  // Grains fall towards the cursor mass, then whip around it.
  float m = uMass.z * uMass.z;
  ndc -= d * clamp(m / r2, 0.0, 0.92);
  vec2 perp = vec2(-d.y, d.x);
  ndc += perp * clamp(m * 0.6 / r2, 0.0, 0.5) * uMass.w;
  gl_Position = vec4(ndc.x / uAspect * z, ndc.y * z, 0.0, c.z > 0.2 ? z : -1.0);
  float depth = smoothstep(uBox * 0.5, uBox * 0.12, length(c)) * smoothstep(0.2, 2.0, c.z);
  vA = depth * (0.25 + aSeed.w * 0.75) * (tail > 0.5 ? 0.15 : 1.0);
}`;

const DUST_FRAG = `#version 300 es
precision highp float;
in float vA; out vec4 o;
void main(){ o = vec4(vec3(0.74, 0.76, 0.82) * vA * 0.5, 1.0); }`;

export interface Options {
  low: boolean;
  reduced: boolean;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram()!;
  const v = mk(gl.VERTEX_SHADER, vs);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return { p, v, f };
}

export function createUniverse(canvas: HTMLCanvasElement, opts: Options) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return null;

  const frag = `#version 300 es\n#define QUALITY ${opts.low ? 0 : 1}\n${fragSrc}`;
  const scene = compile(gl, VERT, frag);
  const dust = compile(gl, DUST_VERT, DUST_FRAG);
  const parallel = gl.getExtension('KHR_parallel_shader_compile');

  // Noise: 64^3 random bytes in four channels. Trilinear filtering plus a
  // smoothed lookup coordinate turns this into value noise without any compute.
  const noise = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, noise);
  const N = 64;
  const bytes = new Uint8Array(N * N * N * 4);
  // Deterministic, so the universe is the same one for every visitor.
  let st = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i += 4) {
    st ^= st << 13; st ^= st >>> 17; st ^= st << 5;
    bytes[i] = st & 255; bytes[i + 1] = (st >>> 8) & 255; bytes[i + 2] = (st >>> 16) & 255; bytes[i + 3] = (st >>> 24) & 255;
  }
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);

  const textTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Dust: two vertices per grain, head and tail, so speed draws streaks.
  const grains = opts.low ? 260 : 700;
  const dustSeeds = new Float32Array(grains * 8);
  for (let i = 0; i < grains; i++) {
    const a = Math.random(), b = Math.random(), c = Math.random(), d = Math.random();
    dustSeeds.set([a, b, c, d, a, b, c, d], i * 8);
  }
  const dustVao = gl.createVertexArray();
  gl.bindVertexArray(dustVao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, dustSeeds, gl.STATIC_DRAW);

  let ready = false;
  let U: Record<string, WebGLUniformLocation | null> = {};
  let DU: Record<string, WebGLUniformLocation | null> = {};

  const finishLink = () => {
    if (!gl.getProgramParameter(scene.p, gl.LINK_STATUS)) {
      console.error('Universe shader failed:', gl.getShaderInfoLog(scene.f) || gl.getProgramInfoLog(scene.p));
      return false;
    }
    if (!gl.getProgramParameter(dust.p, gl.LINK_STATUS)) {
      console.error('Dust shader failed:', gl.getShaderInfoLog(dust.v), gl.getProgramInfoLog(dust.p));
      return false;
    }
    const names = ['uRes', 'uCss', 'uTime', 'uClock', 'uCam', 'uFocal', 'uSunPos', 'uSunR', 'uSunVis', 'uCount', 'uB', 'uP', 'uQ', 'uNoise', 'uText', 'uTR', 'uTA', 'uTOp', 'uGhost', 'uMass', 'uWave', 'uGrade'];
    for (const n of names) U[n] = gl.getUniformLocation(scene.p, n);
    for (const n of ['uCam', 'uFocal', 'uAspect', 'uOffset', 'uVel', 'uMass', 'uBox', 'uClock']) DU[n] = gl.getUniformLocation(dust.p, n);
    const attr = gl.getAttribLocation(dust.p, 'aSeed');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(vao);
    gl.useProgram(scene.p);
    gl.uniform1i(U.uNoise, 0);
    gl.uniform1i(U.uText, 1);
    return true;
  };

  /** Resolves once the shader is linked, without blocking the main thread where the driver allows it. */
  const whenCompiled = () =>
    new Promise<boolean>(resolve => {
      const t0 = performance.now();
      const poll = () => {
        if (!parallel || gl.getProgramParameter(scene.p, parallel.COMPLETION_STATUS_KHR)) {
          ready = finishLink();
          resolve(ready);
        } else if (performance.now() - t0 > 25000) {
          // A driver this slow will not hold a frame rate either: use the stills.
          resolve(false);
        } else setTimeout(poll, 50);
      };
      poll();
    });

  // ------------------------------------------------------------------ sizing

  let scale = opts.low ? Math.min(devicePixelRatio || 1, 1.25) : Math.min(devicePixelRatio || 1, 1.5);
  let cssW = 1, cssH = 1;
  const isPhone = () => innerWidth < 760;

  const resize = () => {
    cssW = innerWidth;
    // Use the large viewport height so mobile toolbars do not re-layout the scene.
    cssH = canvas.clientHeight || innerHeight;
    canvas.width = Math.max(2, Math.round(cssW * scale));
    canvas.height = Math.max(2, Math.round(cssH * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    dirty = true;
  };

  // ------------------------------------------------------------------ text in the world

  interface GLText { el: HTMLElement; x: number; y: number; w: number; h: number; ax: number; ay: number; aw: number; ah: number; }
  let glTexts: GLText[] = [];

  const buildText = () => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-gl-text]')];
    if (!els.length) { glTexts = []; return; }
    const SIZE = opts.low ? 1024 : 2048;
    const cv = document.createElement('canvas');
    cv.width = SIZE; cv.height = SIZE;
    const ctx = cv.getContext('2d', { willReadFrequently: false })!;
    const metrics = els.map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      return { el, r, cs, fs, pad: fs * 0.22 };
    });
    // Choose a raster scale that fits the shelf packing.
    let S = Math.min(2, Math.max(1, scale * 1.2));
    const pack = (S: number) => {
      let x = 2, y = 2, row = 0;
      const out: { ax: number; ay: number; aw: number; ah: number }[] = [];
      for (const m of metrics) {
        const aw = Math.ceil((m.r.width + m.pad * 2) * S), ah = Math.ceil((m.r.height + m.pad * 2) * S);
        if (x + aw + 2 > SIZE) { x = 2; y += row + 2; row = 0; }
        if (aw > SIZE) return null;
        out.push({ ax: x, ay: y, aw, ah });
        x += aw + 2; row = Math.max(row, ah);
      }
      return y + row <= SIZE ? out : null;
    };
    let placed = pack(S);
    while (!placed && S > 0.5) { S *= 0.85; placed = pack(S); }
    if (!placed) { glTexts = []; return; }
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    glTexts = metrics.map((m, i) => {
      const a = placed![i];
      ctx.save();
      ctx.translate(a.ax, a.ay);
      ctx.scale(S, S);
      ctx.font = `${m.cs.fontStyle} ${m.cs.fontWeight} ${m.fs}px ${m.cs.fontFamily}`;
      const ls = parseFloat(m.cs.letterSpacing) || 0;
      const text = m.el.textContent || '';
      const fm = ctx.measureText('Hg');
      const asc = fm.fontBoundingBoxAscent, desc = fm.fontBoundingBoxDescent;
      const base = m.pad + (m.r.height - (asc + desc)) / 2 + asc;
      const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      if (spaced.letterSpacing !== undefined) {
        spaced.letterSpacing = `${ls}px`;
        ctx.fillText(text, m.pad, base);
      } else {
        let cx = m.pad;
        for (const ch of text) { ctx.fillText(ch, cx, base); cx += ctx.measureText(ch).width + ls; }
      }
      ctx.restore();
      return {
        el: m.el,
        x: m.r.left + scrollX - m.pad,
        y: m.r.top + scrollY - m.pad,
        w: m.r.width + m.pad * 2,
        h: m.r.height + m.pad * 2,
        ax: a.ax / SIZE, ay: a.ay / SIZE, aw: a.aw / SIZE, ah: a.ah / SIZE,
      };
    });
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const anis = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anis) gl.texParameterf(gl.TEXTURE_2D, anis.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    document.documentElement.classList.add('gl-text');
    dirty = true;
  };

  // ------------------------------------------------------------------ trajectory

  interface K { key: Key; scroll: number; transit: boolean; tanA: V3; tanB: V3; stop: string; side: number; }
  let keys: K[] = [];
  let stopEls: HTMLElement[] = [];

  const scanStops = () => {
    stopEls = [...document.querySelectorAll<HTMLElement>('[data-stop]')];
    stopEls.forEach((el, i) => {
      const id = el.dataset.stop!;
      const label = el.dataset.label || id;
      if (!STOPS[id]) { bodyFor(id, label, i); stopFor(id, i, el.classList.contains('right') ? 1 : -1); }
    });
  };

  const layoutTrajectory = () => {
    const phone = isPhone();
    const vh = innerHeight;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    const out: K[] = [];
    stopEls.forEach((el, i) => {
      const id = el.dataset.stop!;
      const s = STOPS[id];
      if (!s) return;
      const r = el.getBoundingClientRect();
      const top = r.top + scrollY, bottom = r.bottom + scrollY;
      // Arrive as the heading rises into view, so the world is there to meet it.
      let a = Math.max(0, top - vh * 0.8);
      let b = Math.max(a + vh * 0.25, bottom - vh * 0.34);
      if (i === 0) a = 0;
      if (i === stopEls.length - 1) { b = maxScroll; a = Math.min(a, b - 1); }
      const fa = phone && s.ma ? s.ma : s.a;
      const fb = phone && s.mb ? s.mb : s.b;
      out.push({ key: keyFromFrame(fa), scroll: a, transit: false, tanA: [0, 0, 0], tanB: [0, 0, 0], stop: id, side: phone ? 0 : s.side });
      out.push({ key: keyFromFrame(fb), scroll: b, transit: true, tanA: [0, 0, 0], tanB: [0, 0, 0], stop: id, side: phone ? 0 : s.side });
    });
    // Tangents: leave along the drift direction, arrive along the next one.
    for (let i = 0; i + 1 < out.length; i++) {
      if (!out[i].transit) continue;
      const prev = out[i - 1], cur = out[i], nx = out[i + 1], nn = out[i + 2];
      cur.tanA = norm(sub(cur.key.pos, prev.key.pos));
      cur.tanB = nn ? norm(sub(nn.key.pos, nx.key.pos)) : norm(sub(nx.key.pos, cur.key.pos));
    }
    keys = out;
  };

  /** Fractional key index for a scroll position. */
  const uFromScroll = (y: number) => {
    if (!keys.length) return 0;
    if (y <= keys[0].scroll) return 0;
    for (let i = 0; i + 1 < keys.length; i++) {
      if (y <= keys[i + 1].scroll) {
        const d = keys[i + 1].scroll - keys[i].scroll;
        return i + (d > 0 ? (y - keys[i].scroll) / d : 1);
      }
    }
    return keys.length - 1;
  };

  const sample = (u: number): Key => {
    const i = Math.min(keys.length - 2, Math.max(0, Math.floor(u)));
    const k = keys[i];
    return interp(k.key, keys[i + 1].key, Math.min(1, Math.max(0, u - i)), k.transit, k.tanA, k.tanB);
  };

  /** Plan-view camera for the chart, fitted to every orbit. */
  const chartKey = (): Key => {
    let reach = 0;
    for (const b of BODIES) reach = Math.max(reach, Math.hypot(b.pos[0], b.pos[2]));
    const aspect = cssW / Math.max(cssH, 1);
    const f = 1.9;
    const fit = aspect > 1.1 ? reach * 1.12 : (reach * 1.3) / aspect;
    const h = fit * f;
    return { pos: [reach * 0.02, h, h * 0.24], fwd: norm([-reach * 0.02, -h, -h * 0.24]), up: norm([0, 0.24, -1]), focal: f };
  };

  // ------------------------------------------------------------------ state

  let uCur = 0, uGoal = 0;
  let time = Math.random() * 400 + 40;
  let clock = 0;
  let last = performance.now();
  let chart = 0, chartGoal = 0;
  let intro = opts.reduced || location.hash ? 1 : 0;
  let exposure = opts.reduced || location.hash ? 1 : 0;
  let mx = 0, my = 0, mxs = 0, mys = 0;
  let massActive = false;
  let holding = false;
  let collapse = 0;
  let waveT = -1, waveAmp = 0, waveX = 0, waveY = 0;
  let lastPos: V3 = [0, 0, 0];
  let dustOff: V3 = [0, 0, 0];
  let velCam: V3 = [0, 0, 0];
  let frameMs = 16, slowFrames = 0, fastFrames = 0, hiddenPause = false;
  let dimCur = 0, dimSide = 0;
  let sunVis = 1;
  const hooks: ((info: FrameInfo) => void)[] = [];
  let frameCount = 0;
  let probeRound = 0, probeStart = 3, probeMs = 0;
  const probePixel = new Uint8Array(4);
  let tooSlow: (() => void) | null = null;
  let dirty = true;
  let stopped = false;

  const pickBodies = (pos: V3) => {
    return BODIES.map(b => {
      const d = len(sub(b.pos, pos));
      const reach = b.kind === 'hole' ? b.r * 18 : b.kind === 'giant' ? b.r * 2.6 : b.r;
      return { b, d, size: reach / d };
    })
      .sort((a, b) => b.size - a.size)
      .slice(0, 4);
  };

  const project = (v: V3, cam: { pos: V3; right: V3; up: V3; fwd: V3; focal: number }) => {
    const d = sub(v, cam.pos);
    const z = dot(d, cam.fwd);
    if (z <= 0) return null;
    const k = cam.focal / z;
    const nx = dot(d, cam.right) * k, ny = dot(d, cam.up) * k;
    return { x: (nx * cssH + cssW) / 2, y: (cssH - ny * cssH) / 2, z, nx, ny };
  };

  const render = (now: number) => {
    if (stopped) return;
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;

    if (!ready || !keys.length) { if (!stopped) requestAnimationFrame(render); return; }
    if (document.hidden) { hiddenPause = true; setTimeout(() => requestAnimationFrame(render), 300); return; }

    uGoal = uFromScroll(scrollY);
    // Nothing moving? Save the battery: reduced-motion draws only on change, phones at half rate.
    frameCount++;
    const moving = Math.abs(uGoal - uCur) > 1e-3 || holding || collapse > 0 || waveT >= 0 || chart !== chartGoal || intro < 1;
    if ((opts.reduced && !moving && !dirty) || (opts.low && !moving && frameCount % 2)) {
      requestAnimationFrame(render);
      return;
    }
    dirty = false;
    if (opts.reduced) {
      // Reduced motion: cut between composed stills, no flight.
      const i = Math.min(keys.length - 1, Math.max(0, Math.round(uGoal)));
      uCur = i;
    } else {
      const jump = Math.abs(uGoal - uCur);
      uCur += (uGoal - uCur) * (1 - Math.exp(-dt * (jump > 3 ? 3.2 : 5.5)));
    }
    if (!opts.reduced) clock += dt;

    // Intro: the sun crests the limb. Skipped for deep links and reduced motion.
    if (intro < 1) {
      intro = Math.min(1, intro + dt / 5.2);
      exposure = smooth(0.0, 0.55, intro);
    }
    chart = opts.reduced ? chartGoal : chart + (chartGoal - chart) * (1 - Math.exp(-dt * 2.6));
    if (Math.abs(chartGoal - chart) < 0.0005) chart = chartGoal;

    // Mass: idle glass bead, ramps to a horizon while held.
    const collapseRate = holding ? 0.62 : -1.6;
    const prevCollapse = collapse;
    collapse = Math.min(1, Math.max(0, collapse + dt * collapseRate));
    if (!holding && prevCollapse > 0.12 && collapse < prevCollapse && waveT < 0) {
      waveT = 0; waveAmp = prevCollapse * 0.03; waveX = mxs; waveY = mys;
    }
    if (waveT >= 0) {
      waveT += dt * 1.55;
      if (waveT > 3.4) waveT = -1;
    }
    time += dt * (opts.reduced ? 0 : 1 - 0.92 * smooth(0.1, 1, collapse));
    const ms = opts.reduced ? 1 : 1 - Math.exp(-dt * 7);
    mxs += (mx - mxs) * ms;
    mys += (my - mys) * ms;

    // Camera.
    let k = sample(uCur);
    if (intro < 1) {
      const e = 1 - Math.pow(1 - intro, 3);
      // Start deeper in the planet's shadow; the sun comes up as the camera drifts out of it.
      const f = STOPS.top ? (isPhone() && STOPS.top.ma ? STOPS.top.ma : STOPS.top.a) : null;
      if (f) {
        const early = keyFromFrame({ ...f, az: f.az + 7.5, pitch: (f.pitch ?? 0) - 1.6 });
        k = {
          pos: lerp3(early.pos, k.pos, e),
          fwd: norm(lerp3(early.fwd, k.fwd, e)),
          up: norm(lerp3(early.up, k.up, e)),
          focal: k.focal,
        };
      }
    }
    const flightPos = k.pos;
    if (chart > 0.0005) {
      const c = chartKey();
      const e = chart * chart * (3 - 2 * chart);
      // Fly in log space so the pull-back feels like scale, not speed.
      const p = lerp3(k.pos, c.pos, e * e);
      k = { pos: p, fwd: norm(lerp3(k.fwd, c.fwd, e)), up: norm(lerp3(k.up, c.up, e)), focal: k.focal + (c.focal - k.focal) * e };
    }

    // Pointer parallax, a degree at most.
    let fwd = k.fwd, up = k.up;
    if (!opts.reduced && chart < 0.5) {
      const px = mxs * 0.012 * (1 - chart * 2), py = mys * 0.008 * (1 - chart * 2);
      const r0 = norm(cross(fwd, up));
      fwd = norm(add(fwd, add(mul(r0, px), mul(up, py))));
    }
    const right = norm(cross(fwd, up));
    up = norm(cross(right, fwd));
    const camInfo = { pos: k.pos, right, up, fwd, focal: k.focal };

    // Clamped camera velocity for dust streaks.
    const v = sub(k.pos, lastPos);
    lastPos = k.pos;
    const speed = len(v) / Math.max(dt, 0.001);
    const clamped = Math.tanh(speed / 900) * 9;
    const vdir = norm(v);
    const vStep = mul(vdir, clamped * dt);
    dustOff = sub(dustOff, vStep);
    const vc: V3 = [dot(vdir, right), dot(vdir, up), dot(vdir, fwd)];
    const streak = Math.tanh(speed / 500) * 0.75 + 0.004;
    velCam = opts.reduced ? [0, 0, 0] : mul(vc, -streak);

    // Bodies.
    const picked = pickBodies(k.pos);
    const bArr = new Float32Array(16), pArr = new Float32Array(16), qArr = new Float32Array(16);
    picked.forEach(({ b, d }, i) => {
      const rel = sub(b.pos, k.pos);
      bArr.set([rel[0], rel[1], rel[2], b.r], i * 4);
      const px = (b.r / Math.max(d - b.r * 0.9, 0.001)) * k.focal * canvas.height * 0.5;
      const oct = Math.max(2, Math.min(opts.low ? 6 : 9, Math.floor(2.6 + Math.log2(Math.max(px, 1)) * 0.82)));
      pArr.set([TYPE[b.kind], b.seed, b.atm, oct], i * 4);
      qArr.set([b.axis[0], b.axis[1], b.axis[2], time * b.spin], i * 4);
    });

    // Sun visibility: sample around the disc against every body for a soft crest.
    const sunRel = sub(SUN.pos, k.pos);
    const sunD = norm(sunRel);
    let vis = 1;
    for (const { b } of picked) {
      if (b.kind === 'hole') continue;
      const c = sub(b.pos, k.pos);
      const t = dot(c, sunD);
      if (t <= 0) continue;
      const dist = Math.sqrt(Math.max(dot(c, c) - t * t, 0));
      const over = (dist - b.r) / t;
      vis = Math.min(vis, smooth(-0.003, 0.012, over));
    }
    sunVis += (vis - sunVis) * (1 - Math.exp(-dt * 9));

    // Text slots: the two world-text elements nearest the viewport.
    const trArr = new Float32Array(8), taArr = new Float32Array(8), top: [number, number] = [0, 0];
    let slot = 0;
    const textFade = (1 - chart) * smooth(0.22, 0.62, intro);
    for (const t of glTexts) {
      if (slot > 1) break;
      const y = t.y - scrollY;
      if (y + t.h < 0 || y > cssH) continue;
      trArr.set([t.x - scrollX, y, t.w, t.h], slot * 4);
      taArr.set([t.ax, t.ay, t.aw, t.ah], slot * 4);
      top[slot] = textFade;
      slot++;
    }

    // Reading dim: sky falls away behind the column while you read.
    const idx = Math.min(keys.length - 1, Math.round(uCur));
    const seg = keys[Math.min(keys.length - 1, Math.floor(uCur))];
    const reading = seg && !seg.transit ? 1 : 0;
    const near = Math.round(uCur) === 0 || Math.round(uCur) === 1;
    const dimGoal = chart > 0.2 ? 0 : near ? 0 : reading * (isPhone() ? 0.5 : keys[idx]?.side === 0 ? 0.2 : 0.62);
    dimCur += (dimGoal - dimCur) * (1 - Math.exp(-dt * 3.5));
    dimSide = keys[idx]?.side ?? 0;

    const probing = probeRound < 3 && frameCount > probeStart && frameCount <= probeStart + 4;
    const probeT0 = probing ? performance.now() : 0;
    gl.bindVertexArray(vao);
    gl.useProgram(scene.p);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uCss, cssW, cssH);
    gl.uniform1f(U.uTime, time);
    gl.uniform1f(U.uClock, clock);
    gl.uniformMatrix3fv(U.uCam, false, new Float32Array([...right, ...up, ...fwd]));
    gl.uniform1f(U.uFocal, k.focal);
    gl.uniform3f(U.uSunPos, sunRel[0], sunRel[1], sunRel[2]);
    gl.uniform1f(U.uSunR, SUN.r);
    gl.uniform1f(U.uSunVis, sunVis * (1 - 0.86 * chart));
    gl.uniform1i(U.uCount, picked.length);
    gl.uniform4fv(U.uB, bArr);
    gl.uniform4fv(U.uP, pArr);
    gl.uniform4fv(U.uQ, qArr);
    gl.uniform4fv(U.uTR, trArr);
    gl.uniform4fv(U.uTA, taArr);
    gl.uniform2f(U.uTOp, top[0], top[1]);
    gl.uniform1f(U.uGhost, isPhone() ? 0.8 : 0.22);
    const idleE = massActive && !opts.reduced ? 0.032 : 0;
    const rE = idleE + collapse * collapse * 0.24;
    gl.uniform4f(U.uMass, mxs, mys, rE, collapse);
    gl.uniform4f(U.uWave, waveX, waveY, Math.max(waveT, 0), waveT >= 0 ? waveAmp * Math.exp(-waveT * 1.1) : 0);
    gl.uniform3f(U.uGrade, exposure, dimCur, dimSide);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!opts.reduced) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(dust.p);
      gl.bindVertexArray(dustVao);
      gl.uniformMatrix3fv(DU.uCam, false, new Float32Array([...right, ...up, ...fwd]));
      gl.uniform1f(DU.uFocal, k.focal);
      gl.uniform1f(DU.uAspect, cssW / cssH);
      gl.uniform3f(DU.uOffset, dustOff[0], dustOff[1], dustOff[2]);
      gl.uniform3f(DU.uVel, velCam[0], velCam[1], velCam[2]);
      gl.uniform4f(DU.uMass, mxs, mys, rE * 1.1, collapse);
      gl.uniform1f(DU.uBox, 24);
      gl.uniform1f(DU.uClock, clock);
      gl.drawArrays(gl.LINES, 0, grains * 2);
      gl.disable(gl.BLEND);
    }

    // GPU probe: a 1px readback forces the frame to finish, so this is real GPU time and
    // unaffected by rAF throttling. It sizes the canvas before anyone sees a slow frame.
    if (probing) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probePixel);
      probeMs += performance.now() - probeT0;
      if (frameCount === probeStart + 4) {
        const ms = probeMs / 4;
        probeMs = 0;
        probeRound++;
        probeStart = frameCount + 3;
        const predictedAtMin = (ms * (0.5 * 0.5)) / (scale * scale);
        if (predictedAtMin > 70) { tooSlow?.(); return; }
        if (ms > 26 && scale > 0.5) {
          scale = Math.max(0.5, scale * Math.sqrt(22 / ms));
          resize();
        } else probeRound = 3;
      }
    }

    const info: FrameInfo = {
      project: (b: Body) => {
        const c = project(b.pos, camInfo);
        if (!c) return null;
        const d = len(sub(b.pos, k.pos));
        const px = (b.r / d) * k.focal * cssH * 0.5;
        // Hidden behind a larger body?
        let occluded = false;
        for (const o of BODIES) {
          if (o === b || o.kind === 'hole') continue;
          const oc = sub(o.pos, k.pos), od = len(oc);
          if (od > d) continue;
          const dirB = norm(sub(b.pos, k.pos));
          const t = dot(oc, dirB);
          if (t > 0 && Math.sqrt(Math.max(dot(oc, oc) - t * t, 0)) < o.r) occluded = true;
        }
        return { x: c.x, y: c.y, px, occluded };
      },
      u: uCur,
      chart,
      progress: keys.length > 1 ? uCur / (keys.length - 1) : 0,
      stop: keys[Math.min(keys.length - 1, Math.round(uCur))]?.stop ?? 'top',
      intro,
      posXZ: [flightPos[0], flightPos[2]],
    };
    for (const h of hooks) h(info);

    // Adaptive resolution: hold 40+ fps on whatever GPU this is.
    // A long gap means the page was throttled or hidden, not that the GPU is slow.
    if (rawDt < 0.2) frameMs += (rawDt * 1000 - frameMs) * 0.08;
    if (rawDt >= 0.2) { /* ignore */ }
    else if (frameMs > 28) { slowFrames++; fastFrames = 0; }
    else if (frameMs < 15) { fastFrames++; slowFrames = 0; }
    else { slowFrames = 0; fastFrames = 0; }
    const maxS = opts.low ? Math.min(devicePixelRatio || 1, 1.25) : Math.min(devicePixelRatio || 1, 1.5);
    if (slowFrames > 36 && scale > 0.5) {
      scale = Math.max(0.5, scale * 0.82);
      resize();
      slowFrames = 0;
    } else if (fastFrames > 360 && scale < maxS) {
      scale = Math.min(maxS, scale * 1.12);
      resize();
      fastFrames = 0;
    }

    requestAnimationFrame(render);
  };

  // ------------------------------------------------------------------ public

  return {
    gl,
    whenCompiled,
    start() {
      scanStops();
      resize();
      layoutTrajectory();
      uCur = uFromScroll(scrollY);
      // A reload partway down the page should not replay the sunrise.
      if (scrollY > 50) { intro = 1; exposure = 1; }
      lastPos = keys.length ? sample(uCur).pos : [0, 0, 0];
      last = performance.now();
      requestAnimationFrame(render);
    },
    layout() {
      resize();
      layoutTrajectory();
    },
    buildText,
    setPointer(x: number, y: number, active: boolean) {
      mx = (2 * x - cssW) / cssH;
      my = (cssH - 2 * y) / cssH;
      if (!massActive && active) { mxs = mx; mys = my; }
      massActive = active;
    },
    setHold(on: boolean) { holding = on; },
    pulse(amp = 0.03, x?: number, y?: number) {
      waveT = 0; waveAmp = amp;
      waveX = x ?? mxs; waveY = y ?? mys;
    },
    setChart(on: boolean) { chartGoal = on ? 1 : 0; },
    onTooSlow(fn: () => void) { tooSlow = fn; },
    /** Snap the trajectory to the current scroll, used when leaving the chart. */
    snap() { uCur = uFromScroll(scrollY); },
    onFrame(fn: (i: FrameInfo) => void) { hooks.push(fn); },
    get scaleNow() { return scale; },
    get fps() { return 1000 / frameMs; },
    /** The chart camera, for drawing orbits in screen space. */
    chartProjector() {
      const k = chartKey();
      const right = norm(cross(k.fwd, k.up));
      const up = norm(cross(right, k.fwd));
      const cam = { pos: k.pos, right, up, fwd: k.fwd, focal: k.focal };
      return (v: V3) => project(v, cam);
    },
    /** World-space samples of the actual flight path, for the chart. */
    trajectory(samples = 18) {
      const pts: V3[] = [];
      for (let i = 0; i + 1 < keys.length; i++) {
        const n = keys[i].transit ? samples : 2;
        for (let j = 0; j < n; j++) {
          const k = keys[i];
          // Sample uniformly in eased parameter so points do not bunch at stops.
          pts.push(interp(k.key, keys[i + 1].key, j / n, k.transit, k.tanA, k.tanB).pos);
        }
      }
      if (keys.length) pts.push(keys[keys.length - 1].key.pos);
      return pts;
    },
    /** Skip the intro; used by deep links and the capture script. */
    skipIntro() { intro = 1; exposure = 1; },
    stop() { stopped = true; },
    get bodies() { return BODIES; },
    get sun() { return SUN; },
  };
}

export interface FrameInfo {
  project: (b: Body) => { x: number; y: number; px: number; occluded: boolean } | null;
  u: number;
  chart: number;
  progress: number;
  stop: string;
  intro: number;
  posXZ: [number, number];
}

export type Universe = NonNullable<ReturnType<typeof createUniverse>>;
