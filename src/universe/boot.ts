// Wires the universe to the page: navigation, pointer mass, labels, the chart,
// and the fallbacks. Everything here is progressive; the HTML works without it.

import { createUniverse, type FrameInfo, type Universe } from './engine';
import { STOPS, type V3 } from './world';

const root = document.documentElement;
const canvas = document.getElementById('universe') as HTMLCanvasElement | null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const memGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
const low = coarse || innerWidth < 760 || memGB <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;

function fallback() {
  root.classList.remove('gl-on', 'gl-text');
  root.classList.add('no-gl');
  canvas?.remove();
  document.querySelectorAll<HTMLElement>('[data-stop]').forEach(el => observeStop(el));
}
const still = document.querySelector<HTMLElement>('.still');

// Keeps nav state alive even when there is no GL loop to report it.
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-nav]')];
const setActive = (id: string) => {
  const section = document.querySelector(`[data-stop="${id}"]`)?.closest<HTMLElement>('[data-section]');
  const key = section?.dataset.section || id;
  navLinks.forEach(a => (a.dataset.nav === key ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  document.querySelectorAll<HTMLElement>('[data-stop]').forEach(el => el.classList.toggle('is-current', el.dataset.stop === id));
  // No WebGL: pre-rendered stills of the same frames. Unknown stops fall back to the first.
  if (root.classList.contains('no-gl') && still) still.style.backgroundImage = `url('/universe/${id}.webp'), url('/universe/top.webp')`;
};
function observeStop(el: HTMLElement) {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActive(el.dataset.stop!)), { rootMargin: '-45% 0px -45% 0px' });
  io.observe(el);
}

// ------------------------------------------------------------------ cinematic scroll

let tween = 0;
function flyTo(y: number, ms?: number) {
  cancelAnimationFrame(tween);
  const start = scrollY;
  const dist = Math.abs(y - start);
  if (reduced || dist < 2) { scrollTo(0, y); return; }
  const duration = ms ?? Math.min(3400, 900 + Math.sqrt(dist) * 22);
  const t0 = performance.now();
  const cancel = () => { cancelAnimationFrame(tween); removeEventListener('wheel', cancel); removeEventListener('touchstart', cancel); };
  addEventListener('wheel', cancel, { passive: true, once: true });
  addEventListener('touchstart', cancel, { passive: true, once: true });
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    scrollTo(0, start + (y - start) * e);
    if (t < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}

const scrollYFor = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.top + scrollY - (el.id === 'top' ? r.top + scrollY : Math.min(innerHeight * 0.14, 96));
};

function navigate(id: string, opts: { push?: boolean; instant?: boolean } = {}) {
  const target = id === 'top' ? document.getElementById('top') : document.getElementById(id);
  if (!target) return;
  if (opts.push !== false) history.pushState(null, '', id === 'top' ? location.pathname : `#${id}`);
  const y = scrollYFor(target);
  if (opts.instant) scrollTo(0, y); else flyTo(y);
  target.focus({ preventScroll: true });
}

document.addEventListener('click', e => {
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const url = new URL(a.href, location.href);
  if (url.pathname !== location.pathname || !url.hash) return;
  const id = url.hash.slice(1);
  if (!document.getElementById(id)) return;
  e.preventDefault();
  navigate(id);
});

// ------------------------------------------------------------------ boot

async function boot() {
  if (!canvas) return;
  let u: Universe | null = null;
  try {
    u = createUniverse(canvas, { low, reduced });
  } catch (err) {
    console.warn('Universe unavailable', err);
  }
  if (!u) return fallback();
  const ok = await u.whenCompiled();
  if (!ok) return fallback();
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    u?.stop();
    fallback();
  });

  u.onTooSlow(() => {
    u?.stop();
    fallback();
  });
  u.start();

  try {
    await Promise.all([
      document.fonts.load('300 200px "Newsreader Variable"'),
      document.fonts.load('italic 300 200px "Newsreader Variable"'),
    ]);
    await document.fonts.ready;
  } catch { /* the system serif is fine */ }
  u.layout();
  u.buildText();
  root.classList.add('gl-on');

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { u!.layout(); u!.buildText(); }, 140);
  });
  if ('ResizeObserver' in window) {
    // Abstracts opening and fonts settling both change the trajectory's scroll stops.
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { u!.layout(); u!.buildText(); }, 140);
    }).observe(document.body);
  }

  wirePointer(u);
  wireLabels(u);
  wireChart(u);
  wireEasterEggs(u);
  (window as unknown as { __universe: Universe }).__universe = u;
  console.log(
    '%cYou are on a free-return trajectory.%c\nEverything here is one fragment shader. No meshes, no textures, no server.\nThe source: https://github.com/raun6k/raun6k.github.io',
    'font: italic 15px Georgia, serif; color: #e8c9a0',
    'font: 11px monospace; color: #8a8f99',
  );
}

function wirePointer(u: Universe) {
  if (reduced) return;
  const hint = document.getElementById('mass-hint');
  const interactive = 'a,button,input,select,textarea,summary,details,pre,figure,.prose,p,li,dt,dd';
  let holdTimer = 0;
  let downX = 0, downY = 0;
  let touchHold = false;

  addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') u.setPointer(e.clientX, e.clientY, true);
    else if (touchHold) u.setPointer(e.clientX, e.clientY, true);
    if (e.pointerType !== 'mouse' && holdTimer && Math.hypot(e.clientX - downX, e.clientY - downY) > 10) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
  }, { passive: true });
  document.addEventListener('mouseleave', () => u.setPointer(0, 0, false));

  let dilationTimer = 0;
  let dilationShown = false;
  const begin = () => {
    u.setHold(true);
    root.classList.add('holding');
    hint?.classList.add('used');
    // The clouds really do slow down. Say so once, for whoever holds on long enough.
    dilationTimer = window.setTimeout(() => {
      if (dilationShown) return;
      dilationShown = true;
      document.dispatchEvent(new CustomEvent('toast', { detail: 'Time runs slower here.' }));
    }, 3200);
  };
  const end = () => {
    clearTimeout(holdTimer);
    clearTimeout(dilationTimer);
    holdTimer = 0;
    u.setHold(false);
    root.classList.remove('holding');
    if (touchHold) { touchHold = false; setTimeout(() => u.setPointer(0, 0, false), 900); }
  };

  addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest?.(interactive) || root.classList.contains('chart-open')) return;
    downX = e.clientX; downY = e.clientY;
    if (e.pointerType === 'mouse') begin();
    else {
      // Touch: only a still press counts, so scrolling keeps priority.
      holdTimer = window.setTimeout(() => {
        touchHold = true;
        u.setPointer(downX, downY, true);
        begin();
      }, 320);
    }
  });
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  addEventListener('blur', end);

  // Keyboard equivalent: hold G. Centre of the screen, same physics.
  let gDown = false;
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'g' || e.repeat || gDown) return;
    if ((e.target as Element).closest?.('input,textarea,dialog')) return;
    gDown = true;
    u.setPointer(innerWidth / 2, innerHeight * 0.45, true);
    begin();
  });
  addEventListener('keyup', e => {
    if (e.key.toLowerCase() !== 'g' || !gDown) return;
    gDown = false;
    end();
  });
}

function wireLabels(u: Universe) {
  if (coarse) { u.onFrame(info => setActive(info.stop)); return; }
  const host = document.getElementById('labels');
  if (!host) return;
  const items = u.bodies.map(b => {
    const a = document.createElement('a');
    a.className = 'lbl';
    a.href = `#${b.anchor}`;
    a.tabIndex = -1;
    a.textContent = b.label;
    a.setAttribute('aria-hidden', 'true');
    host.appendChild(a);
    return { b, a, shown: false };
  });
  let lastStop = '';
  u.onFrame((info: FrameInfo) => {
    root.classList.toggle('scrolled', scrollY > innerHeight * 0.5);
    if (info.stop !== lastStop) { lastStop = info.stop; setActive(info.stop); }
    if (chartOpen) { items.forEach(i => { if (i.shown) { i.a.style.opacity = '0'; i.shown = false; } }); return; }
    const here = STOPS[info.stop]?.a.body;
    for (const it of items) {
      // The world you are reading about already has a heading.
      const p = it.b.id === here || STOPS[info.stop]?.side === 0 ? null : info.project(it.b);
      const show = !!p && !p.occluded && p.x > 24 && p.x < innerWidth - 120 && p.y > 64 && p.y < innerHeight - 40 && p.px < 70 && info.intro >= 1 && scrollY > innerHeight * 0.8;
      if (show && p) {
        it.a.style.transform = `translate3d(${(p.x + Math.max(p.px, 2) * 0.72 + 8).toFixed(1)}px,${(p.y - Math.max(p.px, 2) * 0.72 - 8).toFixed(1)}px,0)`;
        if (!it.shown) { it.a.style.opacity = '1'; it.a.style.pointerEvents = 'auto'; it.shown = true; }
      } else if (it.shown) {
        it.a.style.opacity = '0';
        it.a.style.pointerEvents = 'none';
        it.shown = false;
      }
    }
  });
}

let chartOpen = false;

function wireChart(u: Universe) {
  const dlg = document.getElementById('chart') as HTMLDialogElement | null;
  const svg = document.getElementById('chart-svg') as unknown as SVGSVGElement | null;
  const layer = document.getElementById('chart-bodies');
  if (!dlg || !svg || !layer) return;
  const close = dlg.querySelector<HTMLButtonElement>('[data-chart-close]');
  const SVGNS = 'http://www.w3.org/2000/svg';

  const draw = () => {
    const P = u.chartProjector();
    const W = innerWidth, H = innerHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const toPath = (pts: V3[]) => {
      let d = '';
      for (const v of pts) {
        const p = P(v);
        if (!p) continue;
        d += `${d ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
      return d;
    };
    // Orbits around the sun, plus small rings for the moons in Pylon's system.
    const hub = u.bodies.find(b => b.kind === 'giant');
    for (const b of u.bodies) {
      const moon = hub && b !== hub && Math.hypot(b.pos[0] - hub.pos[0], b.pos[2] - hub.pos[2]) < 1400;
      const centre: V3 = moon ? hub!.pos : [0, 0, 0];
      const a = Math.hypot(b.pos[0] - centre[0], b.pos[2] - centre[2]);
      if (a < 1) continue;
      const pts: V3[] = [];
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        pts.push([centre[0] + Math.cos(t) * a, b.pos[1], centre[2] + Math.sin(t) * a]);
      }
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', toPath(pts));
      path.setAttribute('class', 'orbit');
      svg.appendChild(path);
    }
    const traj = document.createElementNS(SVGNS, 'path');
    traj.setAttribute('d', toPath(u.trajectory(28)));
    traj.setAttribute('class', 'traj');
    svg.appendChild(traj);
    const probe = document.createElementNS(SVGNS, 'circle');
    probe.setAttribute('r', '3.2');
    probe.setAttribute('class', 'probe');
    probe.id = 'chart-probe';
    svg.appendChild(probe);

    // Sites are real links; the map doubles as the sitemap.
    layer.querySelectorAll('[data-body]').forEach(el => {
      const b = u.bodies.find(x => x.id === (el as HTMLElement).dataset.body);
      if (!b) return;
      const p = P(b.pos);
      if (p) (el as HTMLElement).style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
    });
    const un = layer.querySelector<HTMLElement>('[data-uncharted]');
    if (un) {
      const p = P([-5600, 20, -3900]);
      if (p) un.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
    }
  };

  const open = () => {
    if (dlg.open) return;
    draw();
    dlg.showModal();
    chartOpen = true;
    root.classList.add('chart-open');
    u.setChart(true);
    close?.focus();
  };
  const shut = () => {
    if (!dlg.open) return;
    dlg.close();
  };
  dlg.addEventListener('close', () => {
    chartOpen = false;
    root.classList.remove('chart-open');
    u.setChart(false);
  });

  document.querySelectorAll('[data-chart-open]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); open(); }));
  close?.addEventListener('click', shut);
  document.addEventListener('open-chart', open);

  dlg.addEventListener('click', e => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const id = new URL(a.href, location.href).hash.slice(1);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    shut();
    // Falling from the chart: the page teleports while the camera is high above it,
    // so the descent is one continuous drop instead of a flight past everything.
    navigate(id, { instant: true });
    u.snap();
  });

  addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'm' && !(e.target as Element).closest?.('input,textarea')) {
      if (dlg.open) shut(); else open();
    }
  });

  addEventListener('resize', () => { if (dlg.open) draw(); });

  // Mini chart in the header: the real trajectory, with a dot for where you are.
  const mini = document.getElementById('mini-path') as unknown as SVGPathElement | null;
  const dot = document.getElementById('mini-dot') as unknown as SVGCircleElement | null;
  if (mini) {
    const pts = u.trajectory(8);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of pts) { minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]); minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]); }
    const s = 32 / Math.max(maxX - minX, maxZ - minZ, 1);
    const ox = (36 - (maxX - minX) * s) / 2, oz = (36 - (maxZ - minZ) * s) / 2;
    const map = (x: number, z: number): [number, number] => [ox + (x - minX) * s, oz + (z - minZ) * s];
    mini.setAttribute('d', pts.map((v, i) => { const [x, y] = map(v[0], v[2]); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(''));
    u.onFrame(info => {
      const [x, y] = map(info.posXZ[0], info.posXZ[1]);
      dot?.setAttribute('cx', x.toFixed(1));
      dot?.setAttribute('cy', y.toFixed(1));
      if (chartOpen) {
        const P = u.chartProjector();
        const p = P([info.posXZ[0], 0, info.posXZ[1]]);
        const probe = document.getElementById('chart-probe');
        if (p && probe) { probe.setAttribute('cx', p.x.toFixed(1)); probe.setAttribute('cy', p.y.toFixed(1)); }
      }
    });
  }
}

function wireEasterEggs(u: Universe) {
  document.addEventListener('descend-burst', () => {
    let n = 0;
    const fire = () => {
      u.pulse(0.05, (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.2);
      if (++n < 4) setTimeout(fire, 340);
    };
    fire();
  });
}

// ------------------------------------------------------------------ go

if (!canvas || !('WebGL2RenderingContext' in window)) {
  fallback();
} else {
  // Give the browser one frame to paint the text before the shader compiles.
  requestAnimationFrame(() => setTimeout(boot, 0));
}

