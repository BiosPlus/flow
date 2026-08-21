/**
 * scroll-memory.js - Flow Theme Interaction & State Controller
 *
 * Core Responsibilities:
 *  1. Scroll Memory: Persists sidebar scroll position across page navigation via sessionStorage.
 *  2. Keyboard Traversal: Auto-scrolls tag strip items into view when focused via keyboard.
 *  3. Seamless Infinite Scroll: Automatically loads subsequent post pages as reader scrolls down.
 *  4. Client-Side Tag Filtering: Fetches and swaps the sidebar list dynamically when clicking tags.
 *  5. Safe DOM Construction: Zero innerHTML usage with strict sanitization preventing XSS.
 */
(function() {
  // Session storage keys for state persistence
  const SCROLL_KEY = 'flow-list-scroll';
  const ACTIVE_TAG_KEY = 'flow-active-tag';

  // In-memory cache for tag sidebar DOM nodes: url -> Node[]
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

  const ALLOWED_HTML_TAGS = new Set([
    'div', 'nav', 'span', 'a', 'p', 'time', 'header', 'main', 'mark'
  ]);

  const ALLOWED_SVG_TAGS = new Set([
    'svg', 'polyline', 'path', 'line', 'circle', 'rect', 'polygon'
  ]);

  const ALLOWED_ATTRS = new Set([
    'class', 'id', 'role', 'title', 'tabindex',
    'aria-label', 'aria-hidden', 'aria-current', 'aria-disabled',
    'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-orientation',
    'data-first', 'data-last', 'data-total', 'data-next-url', 'data-prev-url', 'data-pager', 'data-base-url',
    'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'points', 'd', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'x', 'y'
  ]);

  const DANGEROUS_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'audio', 'video',
    'img', 'base', 'link', 'meta', 'form', 'input', 'button', 'noscript'
  ]);

  /**
   * Safely clones and sanitizes a DOM node, neutralizing scripts, dangerous tags, and event handlers.
   * @param {Node} node - Untrusted source DOM node from DOMParser.
   * @returns {Node|null} Clean sanitized DOM node or DocumentFragment, or null if stripped.
   */
  function cloneSanitizedNode(node) {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      if (DANGEROUS_TAGS.has(tagName)) {
        return null;
      }

      let cleanElement = null;

      if (ALLOWED_SVG_TAGS.has(tagName)) {
        cleanElement = document.createElementNS('http://www.w3.org/2000/svg', tagName);
      } else if (ALLOWED_HTML_TAGS.has(tagName)) {
        cleanElement = document.createElement(tagName);
      } else {
        // For unlisted, non-dangerous container elements, unwrap and sanitize child nodes
        const fragment = document.createDocumentFragment();
        for (const child of node.childNodes) {
          const cleanChild = cloneSanitizedNode(child);
          if (cleanChild) {
            fragment.appendChild(cleanChild);
          }
        }
        return fragment.hasChildNodes() ? fragment : null;
      }

      // Sanitize and copy attributes
      for (const attr of node.attributes) {
        const attrName = attr.name.toLowerCase();
        // Drop any inline event handlers (onerror, onload, onclick, etc.)
        if (attrName.startsWith('on')) {
          continue;
        }

        if (attrName === 'href') {
          cleanElement.setAttribute('href', sanitizeUrl(attr.value));
        } else if (ALLOWED_ATTRS.has(attrName) || attrName.startsWith('data-') || attrName.startsWith('aria-')) {
          cleanElement.setAttribute(attr.name, attr.value);
        }
      }

      // Recursively clone and sanitize child nodes
      for (const child of node.childNodes) {
        const cleanChild = cloneSanitizedNode(child);
        if (cleanChild) {
          cleanElement.appendChild(cleanChild);
        }
      }

      return cleanElement;
    }

    return null;
  }

  /**
   * Helper to deeply clone an array of DOM nodes for safe reuse.
   * @param {Node[]} nodes - Array of DOM nodes.
   * @returns {Node[]} Array of cloned DOM nodes.
   */
  function cloneNodes(nodes) {
    if (!nodes) return [];
    return nodes.map(n => n.cloneNode(true));
  }

  /**
   * Captures the current child nodes of a container element.
   * @param {HTMLElement} element - Container element.
   * @returns {Node[]} Cloned child nodes.
   */
  function captureChildNodes(element) {
    if (!element) return [];
    return Array.from(element.childNodes).map(n => n.cloneNode(true));
  }

  /**
   * Parses an HTML string, locates `.list-pane`, and extracts sanitized child DOM nodes.
   * @param {string} htmlString - Raw HTML fetched from server.
   * @returns {Node[]|null} Array of sanitized DOM nodes, or null if not found.
   */
  function extractSanitizedListPaneNodes(htmlString) {
    try {
      const doc = new DOMParser().parseFromString(htmlString, 'text/html');
      const listPane = doc.querySelector('.list-pane');
      if (!listPane) return null;

      const sanitizedNodes = [];
      for (const child of listPane.childNodes) {
        const clean = cloneSanitizedNode(child);
        if (clean) {
          sanitizedNodes.push(clean);
        }
      }
      return sanitizedNodes.length > 0 ? sanitizedNodes : null;
    } catch (e) {
      console.warn('Failed to parse list pane HTML:', e);
      return null;
    }
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
   * Fetches an HTML document from a given URL and parses it into a DOM Document.
   * @param {string} url - Target URL to fetch.
   * @returns {Promise<Document>} Parsed HTML Document.
   */
  async function fetchHtmlDocument(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /**
   * Appends sanitized message rows to the list container, avoiding duplicates.
   * @param {HTMLElement} listItems - Container holding message rows.
   * @param {NodeList|Element[]} rawRows - Unsanitized message row elements.
   * @param {HTMLElement|null} sentinel - Sentinel element to insert before, if present.
   * @param {string} currentPath - Current page normalized URL path.
   */
  function appendSanitizedMessageRows(listItems, rawRows, sentinel, currentPath) {
    const existingHrefs = new Set(
      Array.from(listItems.querySelectorAll('.message-row')).map(r => normalizeUrl(r.getAttribute('href')))
    );

    rawRows.forEach(rawRow => {
      const row = cloneSanitizedNode(rawRow);
      if (!row || row.nodeType !== Node.ELEMENT_NODE) return;
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
  }

  /**
   * Updates the header message list counter display and attributes.
   * @param {HTMLElement|null} countEl - The counter element.
   * @param {HTMLElement} listItems - Container holding message rows.
   */
  function updateMessageListCount(countEl, listItems) {
    if (!countEl) return;
    const first = countEl.getAttribute('data-first') || '1';
    const total = countEl.getAttribute('data-total') || '';
    const currentCount = listItems.querySelectorAll('.message-row').length;
    countEl.setAttribute('data-last', currentCount.toString());
    if (total) {
      countEl.textContent = `${first}–${currentCount} of ${total}`;
    }
  }

  /**
   * Updates the header next page button link and disabled state.
   * @param {HTMLElement|null} nextBtn - Next page link/button element.
   * @param {string|null} nextUrl - Next page URL or null if no further pages.
   */
  function updatePagerNextButton(nextBtn, nextUrl) {
    if (!nextBtn) return;
    if (nextUrl) {
      nextBtn.setAttribute('href', sanitizeUrl(nextUrl));
      nextBtn.classList.remove('disabled');
      nextBtn.removeAttribute('aria-disabled');
    } else {
      nextBtn.classList.add('disabled');
      nextBtn.setAttribute('aria-disabled', 'true');
      nextBtn.removeAttribute('href');
    }
  }

  /**
   * Synchronizes in-memory tag cache with current list pane contents.
   * @param {HTMLElement} listPane - List pane container element.
   * @param {string} currentPath - Current page normalized URL path.
   */
  function syncTagListCache(listPane, currentPath) {
    const activeTag = sessionStorage.getItem(ACTIVE_TAG_KEY);
    const homeUrl = getBaseUrl();
    if (activeTag) {
      tagListCache.set(activeTag, captureChildNodes(listPane));
    } else if (currentPath === homeUrl) {
      tagListCache.set(homeUrl, captureChildNodes(listPane));
    }
  }

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
        const doc = await fetchHtmlDocument(nextUrl);
        const rawRows = doc.querySelectorAll('.message-list-items .message-row');
        appendSanitizedMessageRows(listItems, rawRows, sentinel, currentPath);

        const docItems = doc.querySelector('.message-list-items');
        nextUrl = docItems ? docItems.getAttribute('data-next-url') : null;
        listItems.setAttribute('data-next-url', nextUrl || '');

        updateMessageListCount(countEl, listItems);
        updatePagerNextButton(nextBtn, nextUrl);
        syncTagListCache(listPane, currentPath);

        const activeTag = sessionStorage.getItem(ACTIVE_TAG_KEY);
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
   * Fetches and caches sanitized list pane nodes for a given tag URL.
   * @param {string} tagUrl - Normalized tag URL.
   * @returns {Promise<Node[]|null>} Array of sanitized DOM nodes or null.
   */
  async function fetchTagNodes(tagUrl) {
    let cachedNodes = tagListCache.get(tagUrl);
    if (!cachedNodes) {
      const res = await fetch(tagUrl);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const text = await res.text();
      cachedNodes = extractSanitizedListPaneNodes(text);
      if (cachedNodes) {
        tagListCache.set(tagUrl, cloneNodes(cachedNodes));
      }
    }
    return cachedNodes;
  }

  /**
   * Updates sidebar scroll position according to filtering options.
   * @param {HTMLElement} listPane - The sidebar list pane container.
   * @param {boolean} resetScroll - Whether to scroll to top and clear saved scroll position.
   */
  function updateListScrollState(listPane, resetScroll) {
    if (resetScroll) {
      listPane.scrollTop = 0;
      sessionStorage.removeItem(SCROLL_KEY);
    } else {
      restoreScrollPosition();
    }
  }

  /**
   * Highlights the message row corresponding to current page location.
   * @param {HTMLElement} container - The container element holding .message-row elements.
   */
  function updateActivePostRow(container) {
    const currentPath = normalizeUrl(window.location.pathname);
    const rows = container.querySelectorAll('.message-row');
    rows.forEach(row => {
      const href = normalizeUrl(row.getAttribute('href'));
      const isCurrent = (href === currentPath);
      row.classList.toggle('current-row', isCurrent);
      if (isCurrent) {
        row.setAttribute('aria-current', 'page');
      } else {
        row.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Updates the active tab state in tag-strip and scrolls it into view.
   * @param {HTMLElement|null} tagStrip - The tag strip container element.
   * @param {string} tagUrl - The active tag URL.
   */
  function updateTagStripState(tagStrip, tagUrl) {
    if (!tagStrip) return;
    const homeUrl = getBaseUrl();
    tagStrip.querySelectorAll('.tag-strip-item').forEach(item => {
      const itemHref = normalizeUrl(item.getAttribute('href'));
      const isMatch = (itemHref === tagUrl) || (tagUrl === homeUrl && itemHref === homeUrl);
      item.classList.toggle('current', isMatch);
      if (isMatch) {
        item.setAttribute('aria-current', 'page');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } else {
        item.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Updates mobile back-to-list navigation href to match active filter.
   * @param {string} tagUrl - Active tag URL.
   */
  function updateBackToListLink(tagUrl) {
    const backToList = document.querySelector('.back-to-list');
    if (backToList) {
      const homeUrl = getBaseUrl();
      const targetHref = tagUrl === homeUrl ? homeUrl : tagUrl;
      backToList.setAttribute('href', sanitizeUrl(targetHref));
    }
  }

  /**
   * Persists or clears active tag filter state in sessionStorage.
   * @param {string} tagUrl - Active tag URL.
   */
  function persistActiveTag(tagUrl) {
    const homeUrl = getBaseUrl();
    if (tagUrl === homeUrl || tagUrl === '' || tagUrl === '/') {
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
    } else {
      sessionStorage.setItem(ACTIVE_TAG_KEY, tagUrl);
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
    if (!listPane || isTagFiltering) return;

    isTagFiltering = true;
    listPane.classList.add('is-filtering');

    try {
      const cachedNodes = await fetchTagNodes(tagUrl);
      if (cachedNodes && cachedNodes.length > 0) {
        listPane.replaceChildren(...cloneNodes(cachedNodes));
        updateListScrollState(listPane, resetScroll);
        updateActivePostRow(listPane);
        updateTagStripState(tagStrip, tagUrl);
        updateBackToListLink(tagUrl);
        persistActiveTag(tagUrl);

        initInfiniteScroll();
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
      tagListCache.set(homeUrl, captureChildNodes(listPane));
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
      restoreScrollPosition();
      initInfiniteScroll();
    } else if (isTaxonomyPage) {
      sessionStorage.removeItem(ACTIVE_TAG_KEY);
      restoreScrollPosition();
      initInfiniteScroll();
    } else if (currentPath.startsWith(tagsRoot)) {
      // Direct visit to a tag URL
      tagListCache.set(currentPath, captureChildNodes(listPane));
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
