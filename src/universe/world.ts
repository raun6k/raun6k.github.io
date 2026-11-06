// The system: bodies, where they are, and how the camera frames each stop.
// Pure data and math, no DOM or GL.

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** Rodrigues rotation of v about unit axis k. */
export const rot = (v: V3, k: V3, deg: number): V3 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
};

export const TYPE = { terran: 0, burned: 1, giant: 2, ice: 3, rock: 4, locked: 5, hole: 6 } as const;
export type Kind = keyof typeof TYPE;

export interface Body {
  id: string;
  label: string;
  kind: Kind;
  r: number;
  pos: V3;
  seed: number;
  /** Atmosphere height as a fraction of radius; 0 for airless bodies. */
  atm: number;
  axis: V3;
  /** Radians per second of dilated time. */
  spin: number;
  /** Section the body opens when clicked. */
  anchor: string;
}

const polar = (a: number, deg: number, y = 0): V3 => {
  const t = (deg * Math.PI) / 180;
  return [a * Math.cos(t), y, a * Math.sin(t)];
};

const hashId = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 997) / 17;
};

export const SUN = { pos: [0, 0, 0] as V3, r: 70 };

const PYLON_POS = polar(5200, 196, 30);

export const BODIES: Body[] = [
  { id: 'origin', label: 'Origin', kind: 'terran', r: 100, pos: polar(4200, 30), seed: 3.7, atm: 0.017, axis: norm([0.18, 1, 0.1]), spin: 0.0016, anchor: 'top' },
  { id: 'burn', label: 'Burn scar', kind: 'burned', r: 42, pos: polar(2600, 118, 40), seed: 21.3, atm: 0.035, axis: norm([0.4, 1, -0.2]), spin: 0.0025, anchor: 'research' },
  { id: 'pylon', label: 'Pylon', kind: 'giant', r: 72, pos: PYLON_POS, seed: 8.2, atm: 0.018, axis: norm([0.34, 1, 0.26]), spin: 0.004, anchor: 'pylon' },
  { id: 'tracelens', label: 'TraceLens', kind: 'ice', r: 11, pos: add(PYLON_POS, [330, -18, 240]), seed: 41.1, atm: -1, axis: norm([0.1, 1, 0.3]), spin: 0.008, anchor: 'tracelens' },
  { id: 'agent-governance-toolkit', label: 'Agent Governance', kind: 'rock', r: 8, pos: add(PYLON_POS, [-210, 22, 410]), seed: 13.9, atm: 0, axis: norm([0.6, 1, 0.1]), spin: 0.01, anchor: 'agent-governance-toolkit' },
  { id: 'rivedix', label: 'Rivedix', kind: 'locked', r: 34, pos: polar(1500, 290, -30), seed: 30.4, atm: 0.012, axis: norm([0.0, 1, 0.1]), spin: 0, anchor: 'experience' },
  { id: 'well', label: 'The well', kind: 'hole', r: 15, pos: polar(7000, 318, 160), seed: 2.0, atm: 0, axis: norm([0.22, 1, -0.36]), spin: 0, anchor: 'explorations' },
];

/** Add an entry to src/data/projects.ts and it gets a moon here automatically. */
export function bodyFor(id: string, label: string, index: number): Body {
  const known = BODIES.find(b => b.id === id);
  if (known) return known;
  const seed = hashId(id);
  const body: Body = {
    id,
    label,
    kind: index % 2 ? 'rock' : 'ice',
    r: 7 + (seed % 5),
    pos: add(PYLON_POS, [Math.cos(seed) * (560 + index * 150), -10 + (seed % 40), Math.sin(seed) * (560 + index * 150)]),
    seed,
    atm: 0,
    axis: norm([Math.sin(seed), 1, Math.cos(seed)]),
    spin: 0.008,
    anchor: id,
  };
  BODIES.push(body);
  return body;
}

export interface Frame {
  body: string;
  /** Camera distance from the centre, in radii. */
  dist: number;
  /** Angle between the sun and the camera as seen from the body. 0 full, 180 eclipse. */
  az: number;
  /** Rotates the camera around the body-sun axis. */
  around?: number;
  /** Degrees from looking at the centre towards the sunward limb. */
  pitch?: number;
  /** Degrees sideways. Positive moves the body to the left of frame. */
  yaw?: number;
  roll?: number;
  focal?: number;
}

export interface Key {
  pos: V3;
  fwd: V3;
  up: V3;
  focal: number;
}

export function keyFromFrame(f: Frame): Key {
  const b = BODIES.find(x => x.id === f.body) ?? BODIES[0];
  const S = norm(sub(SUN.pos, b.pos));
  const ref: V3 = Math.abs(S[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const side = norm(cross(S, ref));
  const axis = rot(side, S, f.around ?? 0);
  const c = rot(S, axis, f.az);
  const pos = add(b.pos, mul(c, f.dist * b.r));
  // Basis: e3 towards the body, e2 towards the sun around the limb.
  const e3 = mul(c, -1);
  let e2 = sub(S, mul(e3, dot(S, e3)));
  e2 = len(e2) < 1e-3 ? norm(cross(e3, side)) : norm(e2);
  // Roll first, around the line to the body, so yaw and pitch stay screen-space:
  // positive yaw puts the body right of frame, positive pitch puts it lower.
  let fwd = e3;
  let up = f.roll ? rot(e2, fwd, f.roll) : e2;
  if (f.pitch) {
    const rightP = norm(cross(fwd, up));
    fwd = rot(fwd, rightP, f.pitch);
    up = rot(up, rightP, f.pitch);
  }
  if (f.yaw) fwd = rot(fwd, up, f.yaw);
  return { pos, fwd: norm(fwd), up: norm(up), focal: f.focal ?? 1.9 };
}

export interface Stop {
  id: string;
  a: Frame;
  b: Frame;
  /** Phone framing: body pushed up behind the heading. */
  ma?: Frame;
  mb?: Frame;
  /** Reading column side, used to dim the sky behind the text. */
  side: -1 | 0 | 1;
}

// Roll sets where the sun sits: negative puts the lit side upper right, away from
// a left-hand reading column; positive mirrors that for a right-hand column.
export const STOPS: Record<string, Stop> = {
  top: {
    id: 'top', side: 0,
    a: { body: 'origin', dist: 1.16, az: 118.5, around: 18, pitch: 70, yaw: 15, roll: -8, focal: 1.75 },
    b: { body: 'origin', dist: 1.14, az: 116, around: 22, pitch: 58, yaw: 11, roll: -6, focal: 1.75 },
    ma: { body: 'origin', dist: 1.2, az: 121.8, around: 18, pitch: 66, yaw: 1, roll: -3, focal: 1.6 },
    mb: { body: 'origin', dist: 1.18, az: 118.6, around: 22, pitch: 56, yaw: 1, roll: -3, focal: 1.6 },
  },
  about: {
    id: 'about', side: -1,
    a: { body: 'origin', dist: 1.55, az: 62, around: 40, yaw: 33, roll: -50, focal: 1.7 },
    b: { body: 'origin', dist: 1.68, az: 52, around: 50, yaw: 32, roll: -56, focal: 1.7 },
    ma: { body: 'origin', dist: 2.25, az: 92, around: 40, pitch: -22, roll: -40, focal: 1.6 },
    mb: { body: 'origin', dist: 2.4, az: 84, around: 50, pitch: -22, roll: -48, focal: 1.6 },
  },
  research: {
    id: 'research', side: -1,
    a: { body: 'burn', dist: 1.75, az: 60, around: 200, yaw: 27, roll: -38, focal: 1.8 },
    b: { body: 'burn', dist: 1.6, az: 74, around: 215, yaw: 30, roll: -44, focal: 1.8 },
    ma: { body: 'burn', dist: 2.7, az: 86, around: 200, pitch: -21, roll: -30, focal: 1.7 },
    mb: { body: 'burn', dist: 2.5, az: 96, around: 215, pitch: -21, roll: -38, focal: 1.7 },
  },
  projects: {
    id: 'projects', side: -1,
    a: { body: 'pylon', dist: 5.4, az: 66, around: 262, yaw: 14, roll: -52, focal: 1.8 },
    b: { body: 'pylon', dist: 4.8, az: 80, around: 270, yaw: 16, roll: -58, focal: 1.8 },
    ma: { body: 'pylon', dist: 7, az: 66, around: 262, pitch: -16, roll: -10, focal: 1.7 },
    mb: { body: 'pylon', dist: 6.4, az: 80, around: 270, pitch: -16, roll: -14, focal: 1.7 },
  },
  pylon: {
    id: 'pylon', side: 1,
    a: { body: 'pylon', dist: 3.9, az: 106, around: 300, yaw: -22, roll: 22, focal: 1.8 },
    b: { body: 'pylon', dist: 3.4, az: 120, around: 306, yaw: -24, roll: 28, focal: 1.8 },
    ma: { body: 'pylon', dist: 5.2, az: 118, around: 300, pitch: -18, roll: 18, focal: 1.7 },
    mb: { body: 'pylon', dist: 4.8, az: 136, around: 306, pitch: -18, roll: 24, focal: 1.7 },
  },
  tracelens: {
    id: 'tracelens', side: -1,
    a: { body: 'tracelens', dist: 6.4, az: 74, around: 120, yaw: 10, roll: -12, focal: 2.9 },
    b: { body: 'tracelens', dist: 5.7, az: 86, around: 128, yaw: 11, roll: -16, focal: 2.9 },
    ma: { body: 'tracelens', dist: 5.2, az: 72, around: 120, pitch: -18, roll: -12, focal: 1.7 },
    mb: { body: 'tracelens', dist: 4.8, az: 84, around: 128, pitch: -18, roll: -16, focal: 1.7 },
  },
  'agent-governance-toolkit': {
    id: 'agent-governance-toolkit', side: 1,
    a: { body: 'agent-governance-toolkit', dist: 4.7, az: 66, around: 200, yaw: -11, roll: 24, focal: 2.9 },
    b: { body: 'agent-governance-toolkit', dist: 4.1, az: 80, around: 208, yaw: -12, roll: 30, focal: 2.9 },
    ma: { body: 'agent-governance-toolkit', dist: 4.6, az: 88, around: 60, pitch: -18, roll: 24, focal: 1.7 },
    mb: { body: 'agent-governance-toolkit', dist: 4.2, az: 102, around: 68, pitch: -18, roll: 30, focal: 1.7 },
  },
  experience: {
    id: 'experience', side: -1,
    a: { body: 'rivedix', dist: 2.8, az: 86, around: 150, yaw: 19, roll: -90, focal: 1.8 },
    b: { body: 'rivedix', dist: 2.5, az: 90, around: 150, yaw: 21, roll: -90, focal: 1.8 },
    ma: { body: 'rivedix', dist: 3.1, az: 86, around: 150, pitch: -20, roll: -90, focal: 1.7 },
    mb: { body: 'rivedix', dist: 2.9, az: 90, around: 150, pitch: -20, roll: -90, focal: 1.7 },
  },
  explorations: {
    id: 'explorations', side: -1,
    a: { body: 'well', dist: 27, az: 100, around: 112, yaw: 18, roll: 48, focal: 1.9 },
    b: { body: 'well', dist: 21, az: 104, around: 118, yaw: 21, roll: 52, focal: 1.9 },
    ma: { body: 'well', dist: 34, az: 100, around: 112, pitch: -15, roll: -12, focal: 1.7 },
    mb: { body: 'well', dist: 28, az: 104, around: 118, pitch: -15, roll: -16, focal: 1.7 },
  },
  contact: {
    id: 'contact', side: 0,
    a: { body: 'origin', dist: 1.24, az: 118, around: 150, pitch: 66, yaw: 12, roll: -6, focal: 1.75 },
    b: { body: 'origin', dist: 1.15, az: 117.6, around: 150, pitch: 76, yaw: 16, roll: -7, focal: 1.75 },
    ma: { body: 'origin', dist: 1.3, az: 118, around: 150, pitch: 60, yaw: 6, roll: -5, focal: 1.6 },
    mb: { body: 'origin', dist: 1.2, az: 121.8, around: 150, pitch: 68, yaw: 2, roll: -3, focal: 1.6 },
  },
};

/** Framing for a project added to the data files that has no authored shot. */
export function stopFor(id: string, index: number, side: 1 | -1): Stop {
  if (STOPS[id]) return STOPS[id];
  const y = -side * 11;
  const r = side * 18;
  const s: Stop = {
    id, side,
    a: { body: id, dist: 5, az: 72, around: 40 + index * 37, yaw: y, roll: r, focal: 2.9 },
    b: { body: id, dist: 4.4, az: 84, around: 48 + index * 37, yaw: y, roll: r * 1.3, focal: 2.9 },
    ma: { body: id, dist: 4.8, az: 72, around: 40 + index * 37, pitch: -18, focal: 1.7 },
    mb: { body: id, dist: 4.4, az: 84, around: 48 + index * 37, pitch: -18, focal: 1.7 },
  };
  STOPS[id] = s;
  return s;
}

/** Camera pose for one spline segment. Drift is linear; transit leaves tangentially, like a real burn. */
export function interp(a: Key, b: Key, s: number, transit: boolean, tangentA: V3, tangentB: V3): Key {
  if (!transit) {
    return {
      pos: lerp3(a.pos, b.pos, s),
      fwd: norm(lerp3(a.fwd, b.fwd, s)),
      up: norm(lerp3(a.up, b.up, s)),
      focal: a.focal + (b.focal - a.focal) * s,
    };
  }
  // Cubic rather than quintic: the destination should grow in the window for a while.
  const e = s * s * (3 - 2 * s);
  const L = len(sub(b.pos, a.pos));
  const p1 = add(a.pos, mul(tangentA, L * 0.38));
  const p2 = sub(b.pos, mul(tangentB, L * 0.38));
  const u = 1 - e;
  let pos = add(add(mul(a.pos, u * u * u), mul(p1, 3 * u * u * e)), add(mul(p2, 3 * u * e * e), mul(b.pos, e * e * e)));
  // A burn that would cross a planet skims its atmosphere instead.
  for (const o of BODIES) {
    if (o.kind === 'hole') continue;
    const d = sub(pos, o.pos);
    const dl = len(d);
    const clear = o.r * 1.1;
    if (dl < clear) pos = add(o.pos, mul(d, clear / (dl || 1)));
  }
  // Turn early: look at where you are going before you get there.
  const tl = Math.min(1, Math.max(0, (s - 0.04) / 0.5));
  const look = tl * tl * (3 - 2 * tl);
  return {
    pos,
    fwd: norm(lerp3(a.fwd, b.fwd, look)),
    up: norm(lerp3(a.up, b.up, look)),
    // The lens opens at peak speed and closes again on arrival.
    focal: (a.focal + (b.focal - a.focal) * look) * (1 - 0.2 * Math.sin(Math.PI * s)),
  };
}
