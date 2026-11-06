// Section navigation skips the intro, aligns the final layout, and spotlights it.
// Preserve file previews while using the root homepage URL on the hosted site.
if (location.protocol === 'https:' || location.protocol === 'http:') {
  document.querySelectorAll('a[href^="index.html"], a[href^="../index.html"]').forEach(link => {
    link.setAttribute('href', link.getAttribute('href').replace(/^(\.\.\/)?index\.html/, (_, parent) => parent || './'));
  });
  if (location.pathname.endsWith('/index.html')) {
    history.replaceState(null, '', './' + location.search + location.hash);
  }
}

// Keep previously shared section URLs working, then shorten their fragments.
const legacySections = {
  '#projects-heading': '#projects',
  '#publications-heading': '#publications',
  '#open-source-heading': '#open-source'
};
if (legacySections[location.hash]) {
  history.replaceState(null, '', legacySections[location.hash]);
}

const page = document.querySelector('.page');
const sectionLinks = document.querySelectorAll('.topbar nav a[href^="#"]');
let restoreTimer;
let unfoldTimer;
let alignmentFrame;
let restorationPending = false;
let scrollLocked = false;
let restorationVersion = 0;

function followSection(section, expanding = false) {
  cancelAnimationFrame(alignmentFrame);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reducedMotion ? 0 : 1300;
  const startScroll = window.scrollY;
  const started = performance.now();
  const frame = now => {
    const progress = duration ? Math.min(1, (now - started) / duration) : 1;
    const bounds = section.getBoundingClientRect();
    let spaceAbove = 0;
    let spaceRemaining = 0;
    if (!expanding && page.classList.contains('has-spotlight')) {
      page.querySelectorAll('main section:not(.spotlight) .entries').forEach(entries => {
        const size = entries.getBoundingClientRect();
        const space = size.height + parseFloat(getComputedStyle(entries).marginTop);
        spaceRemaining += space;
        if (size.top < bounds.top) spaceAbove += space;
      });
    }
    const target = Math.max(0, Math.min(
      window.scrollY + bounds.top + bounds.height / 2 - window.innerHeight / 2 - spaceAbove,
      document.documentElement.scrollHeight - window.innerHeight - spaceRemaining
    ));
    // Follow re-expansion directly; ease the initial trip to the section.
    const amount = expanding ? 1 : progress * progress * (3 - 2 * progress);
    window.scrollTo({ top: startScroll + (target - startScroll) * amount, behavior: 'instant' });
    if (expanding ? scrollLocked : progress < 1) alignmentFrame = requestAnimationFrame(frame);
  };
  alignmentFrame = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(alignmentFrame);
    frame(performance.now());
  };
}

function clearSpotlight(expanding = false) {
  const version = ++restorationVersion;
  const selected = page.querySelector('.spotlight');
  clearTimeout(restoreTimer);
  clearTimeout(unfoldTimer);
  cancelAnimationFrame(alignmentFrame);
  restorationPending = false;
  scrollLocked = expanding && Boolean(selected);
  page.classList.remove('restoring-brightness');
  page.classList.remove('has-spotlight');
  page.querySelectorAll('main section').forEach(section => { section.querySelector('.entries').inert = false; });
  page.querySelectorAll('.spotlight').forEach(section => {
    section.classList.remove('spotlight');
  });
  if (expanding && selected) {
    // Reading animations flushes the style change and returns actual CSS transitions.
    const transitions = [...page.querySelectorAll('main .entries')].flatMap(entries =>
      entries.getAnimations().filter(animation =>
        ['grid-template-rows', 'margin-top'].includes(animation.transitionProperty)
      )
    );
    const finishAlignment = followSection(selected, true);
    Promise.allSettled(transitions.map(transition => transition.finished)).then(() => {
      // Ignore completion from an older restoration after navigation or Escape.
      if (version !== restorationVersion) return;
      scrollLocked = false;
      finishAlignment();
    });
  }
}

function restoreAfterMovement() {
  if (!page.classList.contains('has-spotlight') || restorationPending) return;
  restorationPending = true;
  scrollLocked = true;
  restoreTimer = setTimeout(() => {
    page.classList.add('restoring-brightness');
    const fadeTime = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
    unfoldTimer = setTimeout(() => clearSpotlight(true), fadeTime);
  }, 500);
}

function activateSection(hash) {
  const heading = document.getElementById(hash.slice(1));
  const section = heading?.closest('section');
  if (!section) return;

  // Finish rather than cancel: completed intro animations cannot restart.
  page.getAnimations({ subtree: true }).forEach(animation => {
    if (animation.animationName) animation.finish();
  });
  clearSpotlight();
  section.classList.add('spotlight');
  page.classList.add('has-spotlight');
  page.querySelectorAll('main section').forEach(other => { other.querySelector('.entries').inert = other !== section; });

  followSection(section);
}

sectionLinks.forEach(link => {
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);
    activateSection(link.hash);
  });
});

if (location.hash) activateSection(location.hash);
window.addEventListener('hashchange', () => {
  clearSpotlight();
  if (location.hash) activateSection(location.hash);
});

document.addEventListener('mousemove', restoreAfterMovement, { passive: true });
function guardScroll(event) {
  if (!page.classList.contains('has-spotlight') && !scrollLocked) return;
  // Let pinch-to-zoom keep working.
  if (event.ctrlKey || (event.touches && event.touches.length > 1)) return;
  event.preventDefault();
  restoreAfterMovement();
}
document.addEventListener('wheel', guardScroll, { passive: false });
document.addEventListener('touchmove', guardScroll, { passive: false });
document.addEventListener('touchstart', restoreAfterMovement, { passive: true });
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.topbar nav a')) restoreAfterMovement();
}, { passive: true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') clearSpotlight();
  else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
    const target = event.target;
    if (!target.closest('input, textarea, select, button, a, [contenteditable]')) guardScroll(event);
  }
});
