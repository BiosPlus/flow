# ⚡ Flow

> **A high-performance Hugo theme crafted like a desktop mail client.**  
> Posts are messages. Tags are labels. Read seamlessly with an interactive split-pane interface.

[![Hugo Version](https://img.shields.io/badge/Hugo-Extended_v0.165.0+-FF4088?logo=hugo&logoColor=white)](https://gohugo.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero npm Required](https://img.shields.io/badge/Zero_npm-Hugo_Native-success.svg)](https://gohugo.io/)
[![Search: Pagefind](https://img.shields.io/badge/Search-Pagefind-orange.svg)](https://pagefind.app/)
[![Design: M3 + AMOLED](https://img.shields.io/badge/Design-AMOLED_%2F_M3-000000.svg)](#design--typography)

![Flow Theme Preview](screenshot.png)

---

## 🌟 Why Flow?

Most blog themes force readers into a repetitive cycle: scroll an index, click a post, read, click back, scroll again, and repeat.

**Flow reimagines blogging through the familiarity and efficiency of a desktop mail client** (think Superhuman, Apple Mail, or Fastmail). The screen splits into a persistent, scrollable message list on the left and a distraction-free reading pane on the right. Readers can browse your entire archive, filter by labels, and jump between articles instantly—without ever losing their place or context.

Whether you're writing technical deep-dives, development logs, essays, or daily notes, **Flow gives your readers a premium, snappy, native-app feel backed by 100% static HTML.**

---

## ✨ Features at a Glance

### 📬 Desktop Mail Client Interface
* **Persistent Split-Pane Architecture**: Browse your post list while reading articles side-by-side.
* **Draggable & Resizable Splitter**: Custom drag-and-drop divider with smooth pointer capture, real-time `--sidebar-width` styling, double-click to reset, and keyboard controls (`←`/`→`/`Home`/`End`).
* **Instant Width & Scroll Memory**: Persists divider width and message list scroll position in `localStorage`/`sessionStorage` with zero Layout Shift (CLS).
* **Infinite Scroll & Virtualized Lists**: Dynamic `IntersectionObserver` loads older posts seamlessly; CSS `content-visibility: auto` guarantees silky 60fps scrolling even with hundreds of posts.
* **Mobile-Responsive Adaptation**: Gracefully transforms on viewports `<1000px` into an intuitive single-pane flow with smooth back navigation.

### 🔍 Lightning-Fast Static Search (Pagefind)
* **Instant Full-Text Search**: Live 120ms debounced search indexes titles, summaries, and full post bodies.
* **In-Place Sidebar Results**: Search results render directly in the message list with matching query highlights (`<mark>`) without clearing the active reading pane.
* **Global Keyboard Shortcuts**: Press `/` or `Cmd+K` / `Ctrl+K` to search from anywhere, `Esc` to restore the list, and `Enter` to open the top result.
* **Zero Initial Overhead**: Dynamically lazy-loads the Pagefind search bundle on first focus or hover.

### 🏷️ Intelligent Taxonomy & Tag Strip
* **Horizontal Tag Selector**: Quick-filter strip in the sub-bar displaying post counts with smooth keyboard scrolling.
* **Pinned Tags**: Showcase your primary categories (e.g., `thoughts`, `engineering`, `tutorials`) right at the front via `site.Params.pinnedTags`.
* **Deterministic M3 Color Chips**: Tags are hashed via 32-bit FNV-1a into 8 Material Design 3 contrast-checked color pairs in both Go templates and JS.
* **Instant Client-Side Filtering**: Clicking any tag dynamically updates the sidebar list via background fetch without reloading the page.
* **Dedicated Tags Directory**: Built-in `/tags/` overview page listing all taxonomies sorted by post count.

### 🖼️ Modern Next-Gen Media Pipeline
* **Automatic Format Delivery**: Smart `<picture>` and `<video>` generation with fallbacks:
  * **Static Raster**: Visual-lossless JPEG XL (`.jxl`) with automatic WebP dynamic generation and original format fallbacks.
  * **Animated GIFs**: Transcoded to ultra-lightweight WebM (`.webm`) looping `<video>` tags with GIF fallback.
  * **Vectors**: Native SVG passthrough.
* **Markdown Render Hooks**: Standard Markdown syntax `![alt](image.png "caption")` automatically leverages the modern media processor.
* **`modern_image` Shortcode**: Rich media embedding with captions, custom classes, intrinsic width/height, lazy loading, and breakout styling.
* **Automated Transcoder Script**: Build-time incremental media transcoding script (`scripts/transcode-media.sh`) using `cjxl` and `ffmpeg`.

### ⚡ Zero-Toolchain Asset Pipeline
* **No npm / Tailwind / PostCSS / Sass required**: All bundling, `@import` resolution, CSS nesting, and JS minification are handled natively by Hugo Extended's built-in esbuild engine.
* **Subresource Integrity (SRI)**: Asset pipelines generate fingerprinted CSS and JS bundles with cryptographic integrity hashes.
* **Instant Chroma Syntax Highlighting**: Clean code blocks with dark and light themes rendered natively with Hugo's `css.ChromaStyles`.

### ♿ Accessibility & Modern Web Standards
* **AMOLED Dark Theme by Default**: Deep black canvas with Material Design 3 surface elevations, paired with an automatic, high-contrast light mode (`prefers-color-scheme: light`).
* **Semantic HTML5 & Landmarks**: Accessible structure (`<header>`, `<nav>`, `<main>`, `<article>`) with full ARIA attributes and skip-to-content links.
* **Modern Typography**: System-native font stacks with modern CSS `text-wrap: balance` on headings and `text-wrap: pretty` on body copy.
* **View Transitions API**: Seamless cross-document MPA page transitions for modern browsers.
* **Syndication Ready**: Built-in Atom 1.0 and RSS feeds with auto-discovery tags and toolbar subscription buttons.

---

## Development

The project requires a minimum Hugo version of 0.165.0, because it uses `css.ChromaStyles` and `importContext` introduced in that version.

Run the following command for local development:
```sh
hugo server --disableFastRender
```
The `--disableFastRender` flag is **mandatory**. Every page's HTML depends on every other page due to the embedded list, and fast render will serve stale lists.
