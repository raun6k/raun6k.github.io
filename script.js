// Section navigation skips the intro, aligns the final layout, and spotlights it.
const page = document.querySelector('.page');
const sectionLinks = document.querySelectorAll('.topbar nav a[href^="#"]');
let restoreTimer;
let unfoldTimer;
let alignmentFrame;
let restorationPending = false;

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
    if (progress < 1) alignmentFrame = requestAnimationFrame(frame);
  };
  alignmentFrame = requestAnimationFrame(frame);
}

function clearSpotlight(expanding = false) {
  const selected = page.querySelector('.spotlight');
  clearTimeout(restoreTimer);
  clearTimeout(unfoldTimer);
  cancelAnimationFrame(alignmentFrame);
  restorationPending = false;
  page.classList.remove('restoring-brightness');
  page.classList.remove('has-spotlight');
  page.querySelectorAll('main section').forEach(section => { section.querySelector('.entries').inert = false; });
  page.querySelectorAll('.spotlight').forEach(section => {
    section.classList.remove('spotlight');
  });
  if (expanding && selected) followSection(selected, true);
}

function restoreAfterMovement() {
  if (!page.classList.contains('has-spotlight') || restorationPending) return;
  restorationPending = true;
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
document.addEventListener('keydown', () => clearSpotlight());
document.addEventListener('touchstart', () => clearSpotlight(), { passive: true });
document.addEventListener('pointerdown', () => clearSpotlight(), { passive: true });
document.addEventListener('wheel', () => clearSpotlight(), { passive: true });
