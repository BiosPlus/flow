(function() {
  const SCROLL_KEY = 'flow-list-scroll';
  const ACTIVE_TAG_KEY = 'flow-active-tag';

  // In-memory cache for tag sidebar HTML: url -> innerHTML
  const tagListCache = new Map();

  let currentObserver = null;
  let isInfiniteLoading = false;
  let isTagFiltering = false;

  function normalizeUrl(url) {
    if (!url) return '/';
    try {
      const parsed = new URL(url, window.location.origin);
      let path = parsed.pathname;
      if (!path.endsWith('/') && !path.includes('.')) {
        path += '/';
      }
      return path;
    } catch (e) {
      return url;
    }
  }

  function extractListPane(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const listPane = doc.querySelector('.list-pane');
    return listPane ? listPane.innerHTML : null;
  }

  // Restore scroll position
  function restoreScrollPosition() {
    const pane = document.querySelector('.list-pane');
    if (!pane) return;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      pane.scrollTop = parseInt(saved, 10);
    }
  }

  // Save scroll position throttled
  (function initScrollSaver() {
    const pane = document.querySelector('.list-pane');
    if (!pane) return;

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
  (function initTagStripKeyboard() {
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
  function initInfiniteScroll() {
    const listItems = document.querySelector('.message-list-items');
    const listPane = document.querySelector('.list-pane');
    if (!listItems || !listPane) return;

    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }

    let nextUrl = listItems.getAttribute('data-next-url');
    if (!nextUrl) return;

    const sentinel = listItems.querySelector('.infinite-scroll-sentinel');
    const statusIndicator = listItems.querySelector('.infinite-scroll-status');
    const countEl = document.querySelector('.message-list-count');
    const nextBtn = document.querySelector('.pager-btn[data-pager="next"]');

    const currentPath = normalizeUrl(window.location.pathname);

    async function loadNextPage() {
      if (isInfiniteLoading || !nextUrl) return;
      isInfiniteLoading = true;
      if (statusIndicator) statusIndicator.classList.add('is-loading');

      try {
        const res = await fetch(nextUrl);
        if (!res.ok) throw new Error('Fetch failed');
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const newRows = doc.querySelectorAll('.message-list-items .message-row');
        const existingHrefs = new Set(
          Array.from(listItems.querySelectorAll('.message-row')).map(r => normalizeUrl(r.getAttribute('href')))
        );

        newRows.forEach(row => {
          const href = normalizeUrl(row.getAttribute('href'));
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
        isInfiniteLoading = false;
        if (statusIndicator) statusIndicator.classList.remove('is-loading');
      }
    }

    if ('IntersectionObserver' in window && sentinel) {
      currentObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          loadNextPage();
        }
      }, {
        root: listPane,
        rootMargin: '200px'
      });
      currentObserver.observe(sentinel);
    } else {
      listPane.addEventListener('scroll', () => {
        if (listPane.scrollTop + listPane.clientHeight >= listPane.scrollHeight - 150) {
          loadNextPage();
        }
      }, { passive: true });
    }
  }

  // Dynamic Tag Filtering
  async function applyTagFilter(rawTagUrl, options = {}) {
    const { resetScroll = true } = options;
    const tagUrl = normalizeUrl(rawTagUrl);
    const listPane = document.querySelector('.list-pane');
    const tagStrip = document.querySelector('.tag-strip');
    if (!listPane) return;

    if (isTagFiltering) return;
    isTagFiltering = true;

    listPane.classList.add('is-filtering');

    try {
      let listHtml = tagListCache.get(tagUrl);
      if (!listHtml) {
        const res = await fetch(tagUrl);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const text = await res.text();
        listHtml = extractListPane(text);
        if (listHtml) {
          tagListCache.set(tagUrl, listHtml);
        }
      }

      if (listHtml) {
        listPane.innerHTML = listHtml;

        if (resetScroll) {
          listPane.scrollTop = 0;
          sessionStorage.removeItem(SCROLL_KEY);
        } else {
          restoreScrollPosition();
        }

        // Highlight current post in the list if present
        const currentPath = normalizeUrl(window.location.pathname);
        const rows = listPane.querySelectorAll('.message-row');
        rows.forEach(row => {
          const href = normalizeUrl(row.getAttribute('href'));
          if (href === currentPath) {
            row.classList.add('current-row');
            row.setAttribute('aria-current', 'page');
          } else {
            row.classList.remove('current-row');
            row.removeAttribute('aria-current');
          }
        });

        // Update active state in tag-strip
        if (tagStrip) {
          tagStrip.querySelectorAll('.tag-strip-item').forEach(item => {
            const itemHref = normalizeUrl(item.getAttribute('href'));
            const isMatch = (itemHref === tagUrl) || (tagUrl === '/' && itemHref === '/');
            if (isMatch) {
              item.classList.add('current');
              item.setAttribute('aria-current', 'page');
              item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            } else {
              item.classList.remove('current');
              item.removeAttribute('aria-current');
            }
          });
        }

        // Update mobile back-to-list href
        const backToList = document.querySelector('.back-to-list');
        if (backToList) {
          backToList.setAttribute('href', tagUrl === '/' ? '/' : tagUrl);
        }

        // Update sessionStorage
        if (tagUrl === '/' || tagUrl === '') {
          sessionStorage.removeItem(ACTIVE_TAG_KEY);
        } else {
          sessionStorage.setItem(ACTIVE_TAG_KEY, tagUrl);
        }

        // Reconnect infinite scroll for the newly populated list
        initInfiniteScroll();

        // Dispatch event for search and other listeners
        window.dispatchEvent(new CustomEvent('flow:list-updated', { detail: { url: tagUrl } }));
      }
    } catch (err) {
      console.warn('Failed to apply tag filter:', err);
    } finally {
      listPane.classList.remove('is-filtering');
      isTagFiltering = false;
    }
  }

  // Intercept tag clicks
  document.addEventListener('click', (e) => {
    // 1. Tag strip items
    const tagStripItem = e.target.closest('.tag-strip-item');
    if (tagStripItem) {
      const href = tagStripItem.getAttribute('href');
      // If it is "/tags/" (the all tags directory view), allow default navigation
      if (href && normalizeUrl(href) === '/tags/') {
        return;
      }
      if (href) {
        e.preventDefault();
        applyTagFilter(href, { resetScroll: true });
        return;
      }
    }

    // 2. Reading metadata tags in single post view (.reading-meta a)
    const metaTag = e.target.closest('.reading-meta a, a.reading-meta-tag');
    if (metaTag) {
      const href = metaTag.getAttribute('href');
      if (href && href.includes('/tags/')) {
        e.preventDefault();
        applyTagFilter(href, { resetScroll: true });
        return;
      }
    }
  });

  // Initialization on DOMContentLoaded
  window.addEventListener('DOMContentLoaded', () => {
    const listPane = document.querySelector('.list-pane');
    if (!listPane) return;

    const currentPath = normalizeUrl(window.location.pathname);
    const isHomePage = currentPath === '/';
    const isTaxonomyPage = currentPath === '/tags/';

    // Cache initial list
    if (isHomePage) {
      tagListCache.set('/', listPane.innerHTML);
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
      restoreScrollPosition();
      initInfiniteScroll();
    } else if (isTaxonomyPage) {
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
      restoreScrollPosition();
      initInfiniteScroll();
    } else if (currentPath.startsWith('/tags/')) {
      // Direct visit to a tag page
      tagListCache.set(currentPath, listPane.innerHTML);
      sessionStorage.setItem(ACTIVE_TAG_KEY, currentPath);
      restoreScrollPosition();
      initInfiniteScroll();
    } else {
      // Single post page
      const savedTag = sessionStorage.getItem(ACTIVE_TAG_KEY);
      if (savedTag) {
        applyTagFilter(savedTag, { resetScroll: false });
      } else {
        restoreScrollPosition();
        initInfiniteScroll();
      }
    }
  });
})();
