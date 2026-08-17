/**
 * scroll-memory.js - Flow Theme Interaction & State Controller
 *
 * Core Responsibilities:
 *  1. Scroll Memory: Persists sidebar scroll position across page navigation via sessionStorage.
 *  2. Keyboard Traversal: Auto-scrolls tag strip items into view when focused via keyboard.
 *  3. Seamless Infinite Scroll: Automatically loads subsequent post pages as reader scrolls down.
 *  4. Client-Side Tag Filtering: Fetches and swaps the sidebar list dynamically when clicking tags.
 */
(function() {
  // Session storage keys for state persistence
  const SCROLL_KEY = 'flow-list-scroll';
  const ACTIVE_TAG_KEY = 'flow-active-tag';

  // In-memory cache for tag sidebar HTML: url -> innerHTML
  const tagListCache = new Map();

  let currentObserver = null;
  let isInfiniteLoading = false;
  let isTagFiltering = false;

  /**
   * Helper to retrieve base URL from document root attribute.
   * @returns {string} Base URL with trailing slash (e.g. "/" or "/subpath/")
   */
  function getBaseUrl() {
    let base = document.documentElement.getAttribute('data-base-url') || '/';
    if (!base.endsWith('/')) {
      base += '/';
    }
    return base;
  }

  /**
   * Normalizes a URL to a trailing-slash pathname for deterministic comparisons.
   * @param {string} url - The URL or pathname string.
   * @returns {string} Normalized pathname (e.g. "/tags/thought/").
   */
  function normalizeUrl(url) {
    if (!url) return getBaseUrl();
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

  /**
   * Parses an HTML string and extracts the innerHTML of `.list-pane`.
   * @param {string} htmlString - Raw HTML fetched from server.
   * @returns {string|null} Inner HTML of list pane, or null if not found.
   */
  function extractListPane(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const listPane = doc.querySelector('.list-pane');
    return listPane ? listPane.innerHTML : null;
  }

  /**
   * Restores the sidebar message list scroll position from sessionStorage.
   * If no saved position exists, scrolls the currently active post into view.
   */
  function restoreScrollPosition() {
    const pane = document.querySelector('.list-pane');
    if (!pane) return;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      pane.scrollTop = parseInt(saved, 10);
    } else {
      const currentRow = pane.querySelector('.message-row.current-row');
      if (currentRow) {
        currentRow.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }

  /**
   * Throttles scroll position saves to sessionStorage using requestAnimationFrame.
   */
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

  /**
   * Ensures focused tag strip items scroll horizontally into view for keyboard users.
   */
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

  /**
   * Initializes infinite scrolling on the sidebar message list using IntersectionObserver.
   */
  function initInfiniteScroll() {
    const listItems = document.querySelector('.message-list-items');
    const listPane = document.querySelector('.list-pane');
    if (!listItems || !listPane) return;

    // Disconnect any existing observer before attaching a new one
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

    /**
     * Fetches the next page of posts and appends them to the message list.
     */
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

        // Append only non-duplicate rows
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

        // Update nextUrl from the newly fetched page DOM
        const docItems = doc.querySelector('.message-list-items');
        nextUrl = docItems ? docItems.getAttribute('data-next-url') : null;
        listItems.setAttribute('data-next-url', nextUrl || '');

        // Update header post counter (e.g. "1–50 of 100")
        if (countEl) {
          const first = countEl.getAttribute('data-first') || '1';
          const total = countEl.getAttribute('data-total') || '';
          const currentCount = listItems.querySelectorAll('.message-row').length;
          countEl.setAttribute('data-last', currentCount.toString());
          if (total) {
            countEl.textContent = `${first}–${currentCount} of ${total}`;
          }
        }

        // Update header next page button link / disabled state
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

        // Keep cached HTML in sync with expanded list
        const activeTag = sessionStorage.getItem(ACTIVE_TAG_KEY);
        const homeUrl = getBaseUrl();
        if (activeTag) {
          tagListCache.set(activeTag, listPane.innerHTML);
        } else if (currentPath === homeUrl) {
          tagListCache.set(homeUrl, listPane.innerHTML);
        }
        window.dispatchEvent(new CustomEvent('flow:list-updated', { detail: { url: activeTag || currentPath } }));
      } catch (err) {
        console.warn('Infinite scroll error:', err);
      } finally {
        isInfiniteLoading = false;
        if (statusIndicator) statusIndicator.classList.remove('is-loading');
      }
    }

    // Intercept next page button clicks to load posts seamlessly without navigating reading pane
    if (nextBtn) {
      nextBtn.onclick = (e) => {
        if (nextUrl) {
          e.preventDefault();
          loadNextPage();
        }
      };
    }

    // Attach IntersectionObserver to sentinel with a 200px pre-load threshold
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
      // Fallback for environments without IntersectionObserver
      listPane.addEventListener('scroll', () => {
        if (listPane.scrollTop + listPane.clientHeight >= listPane.scrollHeight - 150) {
          loadNextPage();
        }
      }, { passive: true });
    }
  }

  /**
   * Dynamically fetches and renders posts for a tag without full page reload.
   * @param {string} rawTagUrl - Target tag URL.
   * @param {object} [options] - Filtering options.
   * @param {boolean} [options.resetScroll=true] - Whether to reset sidebar scroll to top.
   */
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

        // Highlight current post in the filtered list if present
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

        // Update active tab state in tag-strip
        if (tagStrip) {
          const homeUrl = getBaseUrl();
          tagStrip.querySelectorAll('.tag-strip-item').forEach(item => {
            const itemHref = normalizeUrl(item.getAttribute('href'));
            const isMatch = (itemHref === tagUrl) || (tagUrl === homeUrl && itemHref === homeUrl);
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

        // Update mobile back-to-list href to match active filter
        const backToList = document.querySelector('.back-to-list');
        if (backToList) {
          const homeUrl = getBaseUrl();
          backToList.setAttribute('href', tagUrl === homeUrl ? homeUrl : tagUrl);
        }

        // Persist active tag filter in sessionStorage
        const homeUrl = getBaseUrl();
        if (tagUrl === homeUrl || tagUrl === '' || tagUrl === '/') {
          sessionStorage.removeItem(ACTIVE_TAG_KEY);
        } else {
          sessionStorage.setItem(ACTIVE_TAG_KEY, tagUrl);
        }

        // Reconnect infinite scroll for the newly populated list
        initInfiniteScroll();

        // Dispatch notification event for search.js and external listeners
        window.dispatchEvent(new CustomEvent('flow:list-updated', { detail: { url: tagUrl } }));
      }
    } catch (err) {
      console.warn('Failed to apply tag filter:', err);
    } finally {
      listPane.classList.remove('is-filtering');
      isTagFiltering = false;
    }
  }

  // Intercept tag clicks across tag strip and single post metadata
  document.addEventListener('click', (e) => {
    const homeUrl = getBaseUrl();
    const tagsRoot = `${homeUrl}tags/`;

    // 1. Tag strip items
    const tagStripItem = e.target.closest('.tag-strip-item');
    if (tagStripItem) {
      const href = tagStripItem.getAttribute('href');
      // If it is the all tags directory view (/tags/ or /subpath/tags/), allow standard browser navigation
      if (href && normalizeUrl(href) === tagsRoot) {
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
      if (href && (href.includes('/tags/') || normalizeUrl(href).startsWith(tagsRoot))) {
        e.preventDefault();
        applyTagFilter(href, { resetScroll: true });
        return;
      }
    }
  });

  // Initialization on DOM ready
  window.addEventListener('DOMContentLoaded', () => {
    const listPane = document.querySelector('.list-pane');
    if (!listPane) return;

    const homeUrl = getBaseUrl();
    const tagsRoot = `${homeUrl}tags/`;
    const currentPath = normalizeUrl(window.location.pathname);
    const isHomePage = currentPath === homeUrl;
    const isTaxonomyPage = currentPath === tagsRoot;

    // Cache initial list
    if (isHomePage) {
      tagListCache.set(homeUrl, listPane.innerHTML);
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
      restoreScrollPosition();
      initInfiniteScroll();
    } else if (isTaxonomyPage) {
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
      restoreScrollPosition();
      initInfiniteScroll();
    } else if (currentPath.startsWith(tagsRoot)) {
      // Direct visit to a tag URL
      tagListCache.set(currentPath, listPane.innerHTML);
      sessionStorage.setItem(ACTIVE_TAG_KEY, currentPath);
      restoreScrollPosition();
      initInfiniteScroll();
    } else {
      // Single post page: restore active tag filter if previously chosen
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

