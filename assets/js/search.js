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
 *  - Modular Pipeline: Separates data fetching, result rendering, empty/error state handling, and UI controls.
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

  /* --------------------------------------------------------------------------
   * Section 1: DOM Element Accessors & State Variables
   * -------------------------------------------------------------------------- */

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

  /* --------------------------------------------------------------------------
   * Section 2: Sanitization & URL Utilities
   * -------------------------------------------------------------------------- */

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
   * Helper to retrieve base URL from document root attribute
   */
  function getBaseUrl() {
    let base = document.documentElement.getAttribute('data-base-url') || '/';
    if (!base.endsWith('/')) {
      base += '/';
    }
    return base;
  }

  /* --------------------------------------------------------------------------
   * Section 3: DOM Component Builders (Chips & Result Rows)
   * -------------------------------------------------------------------------- */

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

  /* --------------------------------------------------------------------------
   * Section 4: UI State Management & Renderers
   * -------------------------------------------------------------------------- */

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

  /**
   * Toggles the search-active UI state across input controls and list pagination buttons.
   * @param {boolean} isActive - Whether a search query is currently active.
   */
  function setSearchActiveState(isActive) {
    const pager = getListPager();
    if (searchClear) searchClear.hidden = !isActive;
    if (searchShortcut) searchShortcut.style.display = isActive ? 'none' : '';
    if (pager) pager.style.display = isActive ? 'none' : '';
  }

  /**
   * Restores the sidebar message list to its original state before search.
   */
  function resetSearch() {
    const container = getListContainer();
    const count = getListCount();

    if (container && originalNodes.length > 0) {
      container.replaceChildren(...originalNodes.map(n => n.cloneNode(true)));
    }
    if (count && originalCountText) {
      count.textContent = originalCountText;
    }
    setSearchActiveState(false);
  }

  /**
   * Constructs and renders a formatted empty/status state container into the message list.
   * @param {HTMLElement|null} container - Target list container.
   * @param {string|Node} message - Primary feedback message string or DOM node.
   * @param {string|Node} [hint] - Optional secondary guidance string or DOM node.
   */
  function renderEmptyState(container, message, hint) {
    if (!container) return;

    const emptyState = document.createElement('div');
    emptyState.className = 'search-empty-state';

    const msgEl = document.createElement('div');
    if (typeof message === 'string') {
      msgEl.textContent = message;
    } else if (message instanceof Node) {
      msgEl.appendChild(message);
    }
    emptyState.appendChild(msgEl);

    if (hint) {
      const hintEl = document.createElement('div');
      hintEl.className = 'search-empty-hint';
      if (typeof hint === 'string') {
        hintEl.textContent = hint;
      } else if (hint instanceof Node) {
        hintEl.appendChild(hint);
      }
      emptyState.appendChild(hintEl);
    }

    container.replaceChildren(emptyState);
  }

  /**
   * Renders the guidance state when the static search index hasn't been generated.
   * @param {HTMLElement|null} container - Target list container.
   * @param {HTMLElement|null} countEl - Counter display element.
   * @param {string} query - Active search query.
   */
  function renderIndexNotBuiltState(container, countEl, query) {
    const hintFrag = document.createDocumentFragment();
    hintFrag.appendChild(document.createTextNode('Run '));
    const code = document.createElement('code');
    code.textContent = 'npx pagefind --site build';
    hintFrag.appendChild(code);
    hintFrag.appendChild(document.createTextNode(' to generate the search index.'));

    renderEmptyState(container, 'Search index is not built yet.', hintFrag);
    if (countEl) {
      countEl.textContent = `0 results for "${query}"`;
    }
  }

  /**
   * Renders the empty state when no posts match the search query.
   * @param {HTMLElement|null} container - Target list container.
   * @param {HTMLElement|null} countEl - Counter display element.
   * @param {string} query - Active search query.
   */
  function renderNoResultsState(container, countEl, query) {
    const msgFrag = document.createDocumentFragment();
    msgFrag.appendChild(document.createTextNode('No posts matching "'));
    const strong = document.createElement('strong');
    strong.textContent = query;
    msgFrag.appendChild(strong);
    msgFrag.appendChild(document.createTextNode('"'));

    renderEmptyState(container, msgFrag);
    if (countEl) {
      countEl.textContent = `0 of ${originalTotal || '0'} results`;
    }
  }

  /**
   * Renders error feedback when search query execution fails.
   * @param {HTMLElement|null} container - Target list container.
   */
  function renderSearchErrorState(container) {
    renderEmptyState(container, 'Error executing search.');
  }

  /**
   * Renders the retrieved search result items into the message list container.
   * @param {HTMLElement|null} container - Target list container.
   * @param {HTMLElement|null} countEl - Counter display element.
   * @param {Array<object>} items - Resolved Pagefind result data objects.
   */
  function renderSearchResults(container, countEl, items) {
    if (countEl) {
      countEl.textContent = `1 to ${items.length} of ${items.length} results`;
    }
    if (container) {
      const fragment = document.createDocumentFragment();
      items.forEach(item => {
        fragment.appendChild(createResultRow(item));
      });
      container.replaceChildren(fragment);
    }
  }

  /* --------------------------------------------------------------------------
   * Section 5: Pagefind Integration & Search Execution
   * -------------------------------------------------------------------------- */

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
   * Queries the Pagefind search index and loads item data objects concurrently.
   * @param {object} pf - Initialized Pagefind instance.
   * @param {string} query - Cleaned search query.
   * @param {number} [maxResults=50] - Maximum number of results to fetch data for.
   * @returns {Promise<{total: number, items: Array<object>}>} Search total count and resolved items array.
   */
  async function fetchSearchResults(pf, query, maxResults = 50) {
    const search = await pf.search(query);
    if (!search || !search.results || search.results.length === 0) {
      return { total: 0, items: [] };
    }
    const items = await Promise.all(search.results.slice(0, maxResults).map(r => r.data()));
    return { total: search.results.length, items };
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

    setSearchActiveState(true);

    const pf = await loadPagefind();
    if (searchId !== currentSearchId) return;

    if (!pf) {
      renderIndexNotBuiltState(container, count, cleanQuery);
      return;
    }

    try {
      const { total, items } = await fetchSearchResults(pf, cleanQuery, 50);
      if (searchId !== currentSearchId) return;

      if (total === 0) {
        renderNoResultsState(container, count, cleanQuery);
        return;
      }

      renderSearchResults(container, count, items);
    } catch (err) {
      console.error('[Pagefind] Search error:', err);
      if (searchId === currentSearchId) {
        renderSearchErrorState(container);
      }
    }
  }

  /* --------------------------------------------------------------------------
   * Section 6: Event Listeners & Keyboard Shortcuts
   * -------------------------------------------------------------------------- */

  // Listen for tag filter updates from scroll-memory.js to reset search input and refresh cache
  window.addEventListener('flow:list-updated', () => {
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      setSearchActiveState(false);
    }
    captureOriginalState();
  });

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
