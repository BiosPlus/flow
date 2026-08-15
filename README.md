# Flow Hugo Theme

A blog presented as a mail client. Posts are messages. Tags are labels. The screen splits so the list stays visible while reading.

## Development

The project requires a minimum Hugo version of 0.165.0, because it uses `css.ChromaStyles` and `importContext` introduced in that version.

Run the following command for local development:
```sh
hugo server --disableFastRender
```
The `--disableFastRender` flag is **mandatory**. Every page's HTML depends on every other page due to the embedded list, and fast render will serve stale lists.

## Features

- **No npm, no Tailwind, no PostCSS, no Sass:** Hugo's bundled esbuild covers bundling, `@import` inlining, native CSS nesting and minification.
- **Pure CSS Responsive Layout:** Works beautifully on desktop and mobile without JS layout shifts.
- **Accessibility:** Includes landmarks, visible focus rings, non-color state signals, and skip links.
- **Chroma Syntax Highlighting:** Integrated without npm, using Hugo's built-in `css.ChromaStyles`.
- **Modern Media Pipeline:** Automated build-time transcoding of PNG/JPG images to JPEG XL (`.jxl`) with WebP failovers, and animated GIFs to WebM (`.webm`) `<video>` loops.
