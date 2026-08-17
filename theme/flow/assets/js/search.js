/**
 * search.js - Pagefind Client-Side Search Integration for Flow Theme
 *
 * Architecture & Features:
 *  - Lazy Loading: Dynamically imports `/pagefind/pagefind.js` on first hover or focus.
 *  - Live Debounced Search: Executes search queries with 120ms debouncing, replacing sidebar rows in real time.
 *  - Deterministic Chip Color Hashing: Uses 32-bit FNV-1a hash mod 8 matching Hugo's Go template `chip.html`.
 *  - State Preservation: Caches original sidebar HTML and restores it when query is cleared.
 *  - Race Condition Protection: Monotonic search IDs prevent out-of-order async resolution.
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
  let originalListHtml = '';
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
   * Escapes HTML entities to prevent XSS injection in search excerpts and metadata.
   * @param {string} str - Raw string.
   * @returns {string} Escaped HTML-safe string.
   */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Captures the default unsearched HTML and counter state of the sidebar message list.
   */
  function captureOriginalState() {
    const container = getListContainer();
    const count = getListCount();
    if (container) {
      originalListHtml = container.innerHTML;
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

    if (container && originalListHtml) {
      container.innerHTML = originalListHtml;
    }
    if (count && originalCountText) {
      count.textContent = originalCountText;
    }
    if (pager) pager.style.display = '';
    if (searchClear) searchClear.hidden = true;
    if (searchShortcut) searchShortcut.style.display = '';
  }

  /**
   * Generates markup for an individual tag chip with deterministic FNV32a color index.
   * @param {string} tag - Tag name.
   * @returns {string} Tag chip HTML.
   */
  function renderChip(tag) {
    const idx = fnv32a(tag);
    return `<span class="chip chip--${idx}">${escapeHtml(tag)}</span>`;
  }

  /**
   * Renders a search result row styled identically to standard message rows.
   * @param {object} item - Pagefind result data object.
   * @returns {string} Message row HTML.
   */
  function renderResultRow(item) {
    const currentPath = window.location.pathname;
    const isCurrent = (item.url === currentPath) || (item.url === currentPath + '/') || (currentPath === item.url + '/');
    const rowClass = isCurrent ? 'current-row message-row' : 'message-row';
    const ariaCurrent = isCurrent ? ' aria-current="page"' : '';

    let dateStr = item.meta && item.meta.date ? escapeHtml(item.meta.date) : '';
    let readTimeStr = item.meta && item.meta.readingTime ? escapeHtml(item.meta.readingTime) : '';
    if (readTimeStr && !readTimeStr.includes('min read')) {
      readTimeStr += ' min read';
    }
    const readTimeHtml = readTimeStr
      ? `<span class="row-read-time">${readTimeStr}</span>`
      : '<span></span>';
    const titleStr = item.meta && item.meta.title ? escapeHtml(item.meta.title) : 'Untitled';
    const snippetHtml = item.excerpt || (item.meta && item.meta.summary ? escapeHtml(item.meta.summary) : '');

    let tags = [];
    if (item.filters && item.filters.tag) {
      tags = Array.isArray(item.filters.tag) ? item.filters.tag : [item.filters.tag];
    } else if (item.meta && item.meta.tags) {
      tags = item.meta.tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    const tagsHtml = tags.length > 0
      ? `<div class="row-chips">${tags.map(renderChip).join('')}</div>`
      : '';

    return `
      <a href="${escapeHtml(item.url)}" class="${rowClass}"${ariaCurrent}>
        <div class="row-header">
          <div class="row-subject">${titleStr}</div>
          ${dateStr ? `<span class="row-date">${dateStr}</span>` : ''}
        </div>
        <div class="row-snippet">
          ${snippetHtml}
        </div>
        <div class="row-footer">
          ${readTimeHtml}
          ${tagsHtml}
        </div>
      </a>
    `;
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
        container.innerHTML = `
          <div class="search-empty-state">
            <div>Search index is not built yet.</div>
            <div class="search-empty-hint">Run <code>npx pagefind --site build</code> to generate the search index.</div>
          </div>
        `;
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
          container.innerHTML = `
            <div class="search-empty-state">
              <div>No posts matching "<strong>${escapeHtml(cleanQuery)}</strong>"</div>
            </div>
          `;
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
        container.innerHTML = dataResults.map(renderResultRow).join('');
      }
    } catch (err) {
      console.error('[Pagefind] Search error:', err);
      if (searchId === currentSearchId && container) {
        container.innerHTML = `
          <div class="search-empty-state">
            <div>Error executing search.</div>
          </div>
        `;
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

