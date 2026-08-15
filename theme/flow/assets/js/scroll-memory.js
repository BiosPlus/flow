(function() {
  const pane = document.querySelector('.list-pane');
  if (!pane) return;

  const SCROLL_KEY = 'flow-list-scroll';

  // Restore scroll position
  window.addEventListener('DOMContentLoaded', () => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      pane.scrollTop = parseInt(saved, 10);
    }
  });

  // Save scroll position throttled
  let ticking = false;
  pane.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        sessionStorage.setItem(SCROLL_KEY, pane.scrollTop.toString());
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();

// Keyboard traversal focus scrolling for tag strip
(function() {
  const strip = document.querySelector('.tag-strip');
  if (!strip) return;

  strip.addEventListener('focusin', (e) => {
    const item = e.target;
    if (item.classList.contains('tag-strip-item')) {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  });
})();
