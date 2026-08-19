/**
 * resize.js - Interactive Split-Pane Drag-and-Drop Resizer for Flow Theme
 *
 * Features:
 *  - Modern Pointer Events API with `setPointerCapture` for smooth cursor tracking.
 *  - Real-time CSS Custom Property `--sidebar-width` updates across split panes.
 *  - Boundary Clamping: Min 320px, Max `window.innerWidth - 350px` (or 900px).
 *  - LocalStorage Persistence: Remembers user preference across navigation.
 *  - Double-Click to Reset: Resets width to default 500px.
 *  - Keyboard Accessibility: ArrowLeft/ArrowRight to adjust, Home/End for bounds, Enter to reset.
 */
(function() {
  const DEFAULT_WIDTH = 500;
  const MIN_WIDTH = 320;
  const STORAGE_KEY = 'flow_sidebar_width';

  function getMaxWidth() {
    return Math.max(MIN_WIDTH, Math.min(900, window.innerWidth - 350));
  }

  function getSavedWidth() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= MIN_WIDTH && val <= 1200) {
          return val;
        }
      }
    } catch (e) {
      // LocalStorage access may fail if cookies/storage are blocked or in restricted iframe sandbox
      console.warn('Failed to read sidebar width from localStorage:', e);
    }
    return null;
  }

  function applyWidth(width, persist) {
    const maxWidth = getMaxWidth();
    const clamped = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, width)));
    document.documentElement.style.setProperty('--sidebar-width', clamped + 'px');

    const resizers = document.querySelectorAll('.split-resizer, .sub-resizer');
    resizers.forEach(r => {
      r.setAttribute('aria-valuenow', clamped);
    });

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, clamped);
      } catch (e) {
        // LocalStorage access may fail due to quota limits or privacy restrictions
        console.warn('Failed to save sidebar width to localStorage:', e);
      }
    }
    return clamped;
  }

  function resetWidth() {
    document.documentElement.style.setProperty('--sidebar-width', DEFAULT_WIDTH + 'px');
    const resizers = document.querySelectorAll('.split-resizer, .sub-resizer');
    resizers.forEach(r => {
      r.setAttribute('aria-valuenow', DEFAULT_WIDTH);
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // LocalStorage access may fail if storage is restricted
      console.warn('Failed to remove sidebar width from localStorage:', e);
    }
  }

  function initResizer(el) {
    if (!el) return;

    let isDragging = false;
    let startX = 0;
    let startWidth = DEFAULT_WIDTH;

    el.setAttribute('role', 'separator');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-valuemin', MIN_WIDTH);
    el.setAttribute('aria-valuemax', 900);
    el.setAttribute('tabindex', '0');

    el.addEventListener('pointerdown', (e) => {
      // Only handle primary button (left click) or touch/pen
      if (e.button !== 0) return;

      e.preventDefault();
      isDragging = true;
      startX = e.clientX;

      // Compute current width from computed style
      const currentWidthStr = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width');
      startWidth = parseInt(currentWidthStr, 10) || DEFAULT_WIDTH;

      el.setPointerCapture(e.pointerId);
      document.body.classList.add('is-resizing');
    });

    el.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const newWidth = startWidth + deltaX;
      applyWidth(newWidth, false);
    });

    function endDrag(e) {
      if (!isDragging) return;
      isDragging = false;
      document.body.classList.remove('is-resizing');

      try {
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch (err) {
        // Pointer capture may have been lost or already released implicitly
        console.warn('Failed to release pointer capture:', err);
      }

      const deltaX = e.clientX - startX;
      const newWidth = startWidth + deltaX;
      applyWidth(newWidth, true);
    }

    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    // Double-click resets to default width
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      resetWidth();
    });

    // Keyboard controls when focused
    el.addEventListener('keydown', (e) => {
      const currentVal = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10) || DEFAULT_WIDTH;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        applyWidth(currentVal - 16, true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        applyWidth(currentVal + 16, true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        applyWidth(MIN_WIDTH, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        applyWidth(getMaxWidth(), true);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        resetWidth();
      }
    });
  }

  function init() {
    // Apply saved width if any
    const saved = getSavedWidth();
    if (saved) {
      applyWidth(saved, false);
    }

    const resizers = document.querySelectorAll('.split-resizer, .sub-resizer');
    resizers.forEach(initResizer);

    // Adjust if window resizes smaller than current sidebar + reading pane
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1000) {
        const currentVal = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10) || DEFAULT_WIDTH;
        const max = getMaxWidth();
        if (currentVal > max) {
          applyWidth(max, true);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
