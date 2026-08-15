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

// Seamless infinite scrolling for message list
(function() {
  const listItems = document.querySelector('.message-list-items');
  const listPane = document.querySelector('.list-pane');
  if (!listItems || !listPane) return;

  let nextUrl = listItems.getAttribute('data-next-url');
  if (!nextUrl) return;

  const sentinel = listItems.querySelector('.infinite-scroll-sentinel');
  const statusIndicator = listItems.querySelector('.infinite-scroll-status');
  const countEl = document.querySelector('.message-list-count');
  const nextBtn = document.querySelector('.pager-btn[data-pager="next"]');

  let isLoading = false;
  const currentPath = window.location.pathname;

  async function loadNextPage() {
    if (isLoading || !nextUrl) return;
    isLoading = true;
    if (statusIndicator) statusIndicator.classList.add('is-loading');

    try {
      const res = await fetch(nextUrl);
      if (!res.ok) throw new Error('Fetch failed');
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const newRows = doc.querySelectorAll('.message-list-items .message-row');
      const existingHrefs = new Set(
        Array.from(listItems.querySelectorAll('.message-row')).map(r => r.getAttribute('href'))
      );

      newRows.forEach(row => {
        const href = row.getAttribute('href');
        if (!existingHrefs.has(href)) {
          if (href === currentPath) {
            row.classList.add('current-row');
            row.setAttribute('aria-current', 'page');
          }
          if (sentinel) {
            listItems.insertBefore(row, sentinel);
          } else {
            listItems.appendChild(row);
          }
          existingHrefs.add(href);
        }
      });

      // Update nextUrl from the fetched page
      const docItems = doc.querySelector('.message-list-items');
      nextUrl = docItems ? docItems.getAttribute('data-next-url') : null;
      listItems.setAttribute('data-next-url', nextUrl || '');

      // Update header counter
      if (countEl) {
        const first = countEl.getAttribute('data-first') || '1';
        const total = countEl.getAttribute('data-total') || '';
        const currentCount = listItems.querySelectorAll('.message-row').length;
        if (total) {
          countEl.textContent = `${first}–${currentCount} of ${total}`;
        }
      }

      // Update next button link / disabled state
      if (nextBtn) {
        if (nextUrl) {
          nextBtn.setAttribute('href', nextUrl);
          nextBtn.classList.remove('disabled');
          nextBtn.removeAttribute('aria-disabled');
        } else {
          nextBtn.classList.add('disabled');
          nextBtn.setAttribute('aria-disabled', 'true');
          nextBtn.removeAttribute('href');
        }
      }
    } catch (err) {
      console.warn('Infinite scroll error:', err);
    } finally {
      isLoading = false;
      if (statusIndicator) statusIndicator.classList.remove('is-loading');
    }
  }

  if ('IntersectionObserver' in window && sentinel) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadNextPage();
      }
    }, {
      root: listPane,
      rootMargin: '200px'
    });
    observer.observe(sentinel);
  } else {
    listPane.addEventListener('scroll', () => {
      if (listPane.scrollTop + listPane.clientHeight >= listPane.scrollHeight - 150) {
        loadNextPage();
      }
    }, { passive: true });
  }
})();
