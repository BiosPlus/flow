/**
 * search.js - Pagefind Client-Side Search Integration for Flow Theme
 *
 * Architecture & Features:
 *  - Lazy Loading: Dynamically imports `/pagefind/pagefind.js` on first hover or focus.
 *  - Live Debounced Search: Executes search queries with 120ms debouncing, replacing sidebar rows in real time.
 *  - Deterministic Chip Color Hashing: Uses 32-bit FNV-1a hash mod 8 matching Hugo's Go template `chip.html`.
 *  - State Preservation: Caches original sidebar DOM nodes and restores them when query is cleared.
 *  - Race Condition Protection: Monotonic search IDs prevent out-of-order async resolution.
 *  - Safe DOM Construction: Zero innerHTML usage with strict excerpt sanitization preventing XSS.
 *  - Keyboard Shortcuts:
 *      * `/` or `Cmd+K` / `Ctrl+K`: Focus and select search input.
 *      * `Escape`: Clear search and restore previous message list.
 *      * `Enter`: Open first matched post directly.
 */
(function() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const searchShortcut = document.getElementById('search-shortcut');

  if (!searchInput) {
    return;
  }

  /**
   * Helper DOM element accessors
   */
  function getListContainer() {
    return document.getElementById('message-list-items');
  }

  function getListCount() {
    return document.getElementById('message-list-count');
  }

  function getListPager() {
    return document.getElementById('message-list-pager');
  }

  let pagefind = null;
  let pagefindLoading = null;
  let originalNodes = [];
  let originalCountText = '';
  let originalTotal = '';
  let debounceTimer = null;
  let currentSearchId = 0;

  /**
   * 32-bit FNV-1a string hashing algorithm with memoization cache.
   * Maps tag strings deterministically to an integer index (0..7) identical to Hugo's `hash.FNV32a`.
   * @param {string} str - Tag string to hash.
   * @returns {number} Color index (0..7).
   */
  const fnvCache = Object.create(null);
  function fnv32a(str) {
    if (fnvCache[str] !== undefined) return fnvCache[str];
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const res = (hash >>> 0) % 8;
    fnvCache[str] = res;
    return res;
  }

  /**
   * Validates and sanitizes URLs to prevent javascript: or unsafe scheme injection.
   * @param {string} url - Target URL string.
   * @returns {string} Sanitized URL safe for href attribute.
   */
  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '#';
    const trimmed = url.trim();
    if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
      return trimmed;
    }
    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch (e) {}
    return '#';
  }

  /**
   * Normalizes a URL to a trailing-slash pathname for deterministic comparisons.
   * @param {string} url - The URL or pathname string.
   * @returns {string} Normalized pathname.
   */
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

  /**
   * Safely renders a search snippet into a container node.
   * Parses the input and strictly allows only text nodes and <mark> elements,
   * completely neutralizing any malicious scripts, elements, attributes, or event listeners.
   * @param {HTMLElement} container - Target container element.
   * @param {string} rawHtmlOrText - Raw HTML or text snippet from search results.
   */
  function renderSafeSnippet(container, rawHtmlOrText) {
    if (!rawHtmlOrText) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtmlOrText, 'text/html');

    function appendSanitizedNodes(sourceParent, targetParent) {
      for (const node of sourceParent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          targetParent.appendChild(document.createTextNode(node.textContent));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();
          if (tagName === 'mark') {
            const mark = document.createElement('mark');
            appendSanitizedNodes(node, mark);
            targetParent.appendChild(mark);
          } else {
            // For any other element tag, strip the tag and keep only sanitized inner text/marks
            appendSanitizedNodes(node, targetParent);
          }
        }
      }
    }

    appendSanitizedNodes(doc.body, container);
  }

  /**
   * Captures the default unsearched DOM nodes and counter state of the sidebar message list.
   */
  function captureOriginalState() {
    const container = getListContainer();
    const count = getListCount();
    if (container) {
      originalNodes = Array.from(container.childNodes).map(n => n.cloneNode(true));
    }
    if (count) {
      originalCountText = count.textContent;
      originalTotal = count.getAttribute('data-total') || '';
    }
  }

  // Initial capture on load
  captureOriginalState();

  // Listen for tag filter updates from scroll-memory.js to reset search input and refresh cache
  window.addEventListener('flow:list-updated', () => {
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      if (searchClear) searchClear.hidden = true;
      if (searchShortcut) searchShortcut.style.display = '';
    }
    captureOriginalState();
  });

  /**
   * Helper to retrieve base URL from document root attribute
   */
  function getBaseUrl() {
    let base = document.documentElement.getAttribute('data-base-url') || '/';
    if (!base.endsWith('/')) {
      base += '/';
    }
    return base;
  }

  /**
   * Dynamically loads and initializes the Pagefind JavaScript bundle.
   * @returns {Promise<object|null>} Pagefind instance or null if unavailable.
   */
  async function loadPagefind() {
    if (pagefind) return pagefind;
    if (pagefindLoading) return pagefindLoading;

    pagefindLoading = (async () => {
      const pagefindPath = `${getBaseUrl()}pagefind/pagefind.js`;
      try {
        const pf = await import(pagefindPath);
        if (pf.init) {
          await pf.init();
        }
        pagefind = pf;
        return pf;
      } catch (err) {
        console.warn(`[Pagefind] Search index not found at ${pagefindPath}`, err);
        return null;
      } finally {
        pagefindLoading = null;
      }
    })();

    return pagefindLoading;
  }

  /**
   * Restores the sidebar message list to its original state before search.
   */
  function resetSearch() {
    const container = getListContainer();
    const count = getListCount();
    const pager = getListPager();

    if (container && originalNodes.length > 0) {
      container.replaceChildren(...originalNodes.map(n => n.cloneNode(true)));
    }
    if (count && originalCountText) {
      count.textContent = originalCountText;
    }
    if (pager) pager.style.display = '';
    if (searchClear) searchClear.hidden = true;
    if (searchShortcut) searchShortcut.style.display = '';
  }

  /**
   * Creates a DOM element for an individual tag chip with deterministic FNV32a color index.
   * @param {string} tag - Tag name.
   * @returns {HTMLElement} Tag chip <span> element.
   */
  function createChip(tag) {
    const idx = fnv32a(tag);
    const chip = document.createElement('span');
    chip.className = `chip chip--${idx}`;
    chip.textContent = tag;
    return chip;
  }

  /**
   * Creates a DOM element for a search result row styled identically to standard message rows.
   * @param {object} item - Pagefind result data object.
   * @returns {HTMLElement} Message row <a> element.
   */
  function createResultRow(item) {
    const currentPath = normalizeUrl(window.location.pathname);
    const itemPath = item.url ? normalizeUrl(item.url) : '';
    const isCurrent = (itemPath === currentPath);

    const row = document.createElement('a');
    row.href = sanitizeUrl(item.url);
    row.className = isCurrent ? 'current-row message-row' : 'message-row';
    if (isCurrent) {
      row.setAttribute('aria-current', 'page');
    }

    // Row Header (Subject + Date)
    const header = document.createElement('div');
    header.className = 'row-header';

    const subject = document.createElement('div');
    subject.className = 'row-subject';
    subject.textContent = (item.meta && item.meta.title) ? item.meta.title : 'Untitled';
    header.appendChild(subject);

    if (item.meta && item.meta.date) {
      const date = document.createElement('span');
      date.className = 'row-date';
      date.textContent = item.meta.date;
      header.appendChild(date);
    }
    row.appendChild(header);

    // Row Snippet
    const snippet = document.createElement('div');
    snippet.className = 'row-snippet';
    const rawSnippet = item.excerpt || (item.meta && item.meta.summary ? item.meta.summary : '');
    renderSafeSnippet(snippet, rawSnippet);
    row.appendChild(snippet);

    // Row Footer (Read Time + Tag Chips)
    const footer = document.createElement('div');
    footer.className = 'row-footer';

    let readTimeStr = item.meta && item.meta.readingTime ? item.meta.readingTime : '';
    if (readTimeStr && !readTimeStr.includes('min read')) {
      readTimeStr += ' min read';
    }

    if (readTimeStr) {
      const readTime = document.createElement('span');
      readTime.className = 'row-read-time';
      readTime.textContent = readTimeStr;
      footer.appendChild(readTime);
    } else {
      footer.appendChild(document.createElement('span'));
    }

    let tags = [];
    if (item.filters && item.filters.tag) {
      tags = Array.isArray(item.filters.tag) ? item.filters.tag : [item.filters.tag];
    } else if (item.meta && item.meta.tags) {
      tags = item.meta.tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    if (tags.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'row-chips';
      tags.forEach(tag => {
        chips.appendChild(createChip(tag));
      });
      footer.appendChild(chips);
    }

    row.appendChild(footer);
    return row;
  }

  /**
   * Executes a full-text search against Pagefind and updates the message list UI.
   * @param {string} query - Raw search query.
   */
  async function performSearch(query) {
    const searchId = ++currentSearchId;
    const cleanQuery = query.trim();

    if (!cleanQuery) {
      resetSearch();
      return;
    }

    const container = getListContainer();
    const count = getListCount();
    const pager = getListPager();

    if (searchClear) searchClear.hidden = false;
    if (searchShortcut) searchShortcut.style.display = 'none';
    if (pager) pager.style.display = 'none';

    const pf = await loadPagefind();

    // Guard against outdated out-of-order async responses
    if (searchId !== currentSearchId) return;

    if (!pf) {
      if (container) {
        const emptyState = document.createElement('div');
        emptyState.className = 'search-empty-state';
        const msg = document.createElement('div');
        msg.textContent = 'Search index is not built yet.';
        const hint = document.createElement('div');
        hint.className = 'search-empty-hint';
        hint.appendChild(document.createTextNode('Run '));
        const code = document.createElement('code');
        code.textContent = 'npx pagefind --site build';
        hint.appendChild(code);
        hint.appendChild(document.createTextNode(' to generate the search index.'));
        emptyState.appendChild(msg);
        emptyState.appendChild(hint);
        container.replaceChildren(emptyState);
      }
      if (count) {
        count.textContent = `0 results for "${cleanQuery}"`;
      }
      return;
    }

    try {
      const search = await pf.search(cleanQuery);
      if (searchId !== currentSearchId) return;

      if (!search.results || search.results.length === 0) {
        if (container) {
          const emptyState = document.createElement('div');
          emptyState.className = 'search-empty-state';
          const msg = document.createElement('div');
          msg.appendChild(document.createTextNode('No posts matching "'));
          const strong = document.createElement('strong');
          strong.textContent = cleanQuery;
          msg.appendChild(strong);
          msg.appendChild(document.createTextNode('"'));
          emptyState.appendChild(msg);
          container.replaceChildren(emptyState);
        }
        if (count) {
          count.textContent = `0 of ${originalTotal || '0'} results`;
        }
        return;
      }

      // Fetch top result data objects concurrently (capped at 50 results)
      const dataResults = await Promise.all(search.results.slice(0, 50).map(r => r.data()));
      if (searchId !== currentSearchId) return;

      if (count) {
        count.textContent = `1 to ${dataResults.length} of ${dataResults.length} results`;
      }
      if (container) {
        const fragment = document.createDocumentFragment();
        dataResults.forEach(item => {
          fragment.appendChild(createResultRow(item));
        });
        container.replaceChildren(fragment);
      }
    } catch (err) {
      console.error('[Pagefind] Search error:', err);
      if (searchId === currentSearchId && container) {
        const emptyState = document.createElement('div');
        emptyState.className = 'search-empty-state';
        const msg = document.createElement('div');
        msg.textContent = 'Error executing search.';
        emptyState.appendChild(msg);
        container.replaceChildren(emptyState);
      }
    }
  }

  // Pre-load Pagefind on input focus / mouseover for instantaneous search response
  searchInput.addEventListener('focus', () => loadPagefind(), { once: true });
  searchInput.addEventListener('mouseover', () => loadPagefind(), { once: true });

  // Input event with 120ms debouncing
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value;
    debounceTimer = setTimeout(() => {
      performSearch(query);
    }, 120);
  });

  // Clear button click handler
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      resetSearch();
      searchInput.focus();
    });
  }

  // Keyboard navigation within the search input
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      resetSearch();
      searchInput.blur();
    } else if (e.key === 'Enter') {
      const container = getListContainer();
      const firstResult = container ? container.querySelector('.message-row') : null;
      if (firstResult && firstResult.href) {
        window.location.href = firstResult.href;
      }
    }
  });

  // Global keyboard shortcuts to focus search input: '/' or 'Cmd/Ctrl + K'
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;

    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );

    // '/' key shortcut (when not focused inside a form input)
    if (e.key === '/' && !isInputActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }

    // 'Cmd+K' (Mac) or 'Ctrl+K' (Windows/Linux)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
})();

