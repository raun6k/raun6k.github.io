// Section navigation skips the intro, aligns the final layout, and spotlights it.
const page = document.querySelector('.page');
const sectionLinks = document.querySelectorAll('.topbar nav a[href^="#"]');
let restoreTimer;
let unfoldTimer;
let alignTimer;
let restorationPending = false;

function clearSpotlight() {
  clearTimeout(restoreTimer);
  clearTimeout(unfoldTimer);
  clearTimeout(alignTimer);
  restorationPending = false;
  page.classList.remove('restoring-brightness');
  page.classList.remove('has-spotlight');
  page.querySelectorAll('main section').forEach(section => { section.querySelector('.entries').inert = false; });
  page.querySelectorAll('.spotlight').forEach(section => {
    section.classList.remove('spotlight');
  });
}

function restoreAfterMovement() {
  if (!page.classList.contains('has-spotlight') || restorationPending) return;
  restorationPending = true;
  restoreTimer = setTimeout(() => {
    page.classList.add('restoring-brightness');
    const fadeTime = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
    unfoldTimer = setTimeout(clearSpotlight, fadeTime);
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

  const align = () => {
    if (location.hash === hash) {
      section.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  };
  requestAnimationFrame(align);
  // Font loading can change line wrapping after the first layout.
  document.fonts.ready.then(align);
  alignTimer = setTimeout(() => {
    if (section.classList.contains('spotlight') && !restorationPending) align();
  }, 500);
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
document.addEventListener('keydown', clearSpotlight);
document.addEventListener('touchstart', clearSpotlight, { passive: true });
document.addEventListener('pointerdown', clearSpotlight, { passive: true });
