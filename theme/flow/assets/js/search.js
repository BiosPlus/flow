/**
 * Pagefind Search Integration for Flow Theme
 */
(function() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const searchShortcut = document.getElementById('search-shortcut');
  const listItemsContainer = document.getElementById('message-list-items');
  const listCount = document.getElementById('message-list-count');

  if (!searchInput || !listItemsContainer || !listCount) {
    return;
  }

  let pagefind = null;
  let pagefindLoading = null;
  let originalListHtml = listItemsContainer.innerHTML;
  let originalCountText = listCount.textContent;
  let originalTotal = listCount.getAttribute('data-total') || '';
  let debounceTimer = null;
  let currentSearchId = 0;

  function fnv32a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % 8;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadPagefind() {
    if (pagefind) return pagefind;
    if (pagefindLoading) return pagefindLoading;

    pagefindLoading = (async () => {
      try {
        const pf = await import('/pagefind/pagefind.js');
        if (pf.init) {
          await pf.init();
        }
        pagefind = pf;
        return pf;
      } catch (err) {
        console.warn('[Pagefind] Search index not found at /pagefind/pagefind.js', err);
        return null;
      } finally {
        pagefindLoading = null;
      }
    })();

    return pagefindLoading;
  }

  function resetSearch() {
    listItemsContainer.innerHTML = originalListHtml;
    listCount.textContent = originalCountText;
    if (searchClear) searchClear.hidden = true;
    if (searchShortcut) searchShortcut.style.display = '';
  }

  function renderChip(tag) {
    const idx = fnv32a(tag);
    return `<span class="chip chip--${idx}">${escapeHtml(tag)}</span>`;
  }

  function renderResultRow(item) {
    const currentPath = window.location.pathname;
    const isCurrent = (item.url === currentPath) || (item.url === currentPath + '/') || (currentPath === item.url + '/');
    const rowClass = isCurrent ? 'current-row message-row' : 'message-row';
    const ariaCurrent = isCurrent ? ' aria-current="page"' : '';

    const dateStr = item.meta && item.meta.date ? escapeHtml(item.meta.date) : '';
    const readTimeStr = item.meta && item.meta.readingTime ? `${escapeHtml(item.meta.readingTime)}` : '';
    const titleStr = item.meta && item.meta.title ? escapeHtml(item.meta.title) : 'Untitled';
    const snippetHtml = item.excerpt || (item.meta && item.meta.summary ? escapeHtml(item.meta.summary) : '');

    let tags = [];
    if (item.filters && item.filters.tag) {
      tags = Array.isArray(item.filters.tag) ? item.filters.tag : [item.filters.tag];
    } else if (item.meta && item.meta.tags) {
      tags = item.meta.tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    const tagsHtml = tags.length > 0
      ? `<div style="flex: 0 0 auto; display: flex; align-items: center;">${tags.map(renderChip).join('')}</div>`
      : '';

    return `
      <a href="${item.url}" class="${rowClass}"${ariaCurrent} style="display: block; padding: 0.5rem; border-bottom: 1px solid var(--rule); color: inherit; text-decoration: none;">
        <div style="display: flex; justify-content: space-between; font-size: 0.8em; color: var(--ink-soft);">
          <span>${dateStr}</span>
          ${readTimeStr ? `<span>${readTimeStr}</span>` : ''}
        </div>
        <div style="font-weight: bold; margin: 0.2rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink);">${titleStr}</div>
        <div style="display: flex; min-width: 0;">
          <div style="flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em; color: var(--ink-soft);">
            ${snippetHtml}
          </div>
          ${tagsHtml}
        </div>
      </a>
    `;
  }

  async function performSearch(query) {
    const searchId = ++currentSearchId;
    const cleanQuery = query.trim();

    if (!cleanQuery) {
      resetSearch();
      return;
    }

    if (searchClear) searchClear.hidden = false;
    if (searchShortcut) searchShortcut.style.display = 'none';

    const pf = await loadPagefind();

    if (searchId !== currentSearchId) return;

    if (!pf) {
      listItemsContainer.innerHTML = `
        <div class="search-empty-state">
          <div>Search index is not built yet.</div>
          <div class="search-empty-hint">Run <code>npx pagefind --site build</code> to generate the search index.</div>
        </div>
      `;
      listCount.textContent = `0 results for "${cleanQuery}"`;
      return;
    }

    try {
      const search = await pf.search(cleanQuery);
      if (searchId !== currentSearchId) return;

      if (!search.results || search.results.length === 0) {
        listItemsContainer.innerHTML = `
          <div class="search-empty-state">
            <div>No posts matching "<strong>${escapeHtml(cleanQuery)}</strong>"</div>
          </div>
        `;
        listCount.textContent = `0 of ${originalTotal || '0'} results`;
        return;
      }

      // Fetch top result data objects
      const dataResults = await Promise.all(search.results.slice(0, 50).map(r => r.data()));
      if (searchId !== currentSearchId) return;

      listCount.textContent = `1 to ${dataResults.length} of ${dataResults.length} results`;
      listItemsContainer.innerHTML = dataResults.map(renderResultRow).join('');
    } catch (err) {
      console.error('[Pagefind] Search error:', err);
      if (searchId === currentSearchId) {
        listItemsContainer.innerHTML = `
          <div class="search-empty-state">
            <div>Error executing search.</div>
          </div>
        `;
      }
    }
  }

  // Pre-load Pagefind on input focus / mouseover
  searchInput.addEventListener('focus', () => loadPagefind(), { once: true });
  searchInput.addEventListener('mouseover', () => loadPagefind(), { once: true });

  // Input event with debouncing
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value;
    debounceTimer = setTimeout(() => {
      performSearch(query);
    }, 120);
  });

  // Clear button click
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      resetSearch();
      searchInput.focus();
    });
  }

  // Keyboard navigation & shortcuts
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      resetSearch();
      searchInput.blur();
    } else if (e.key === 'Enter') {
      const firstResult = listItemsContainer.querySelector('.message-row');
      if (firstResult && firstResult.href) {
        window.location.href = firstResult.href;
      }
    }
  });

  // Global shortcut to focus search input: '/' or 'Cmd/Ctrl + K'
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;

    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );

    // '/' key when not typing in an input
    if (e.key === '/' && !isInputActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }

    // 'Cmd+K' or 'Ctrl+K'
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
})();
