#!/usr/bin/env node

/**
 * scripts/capture-screenshot.mjs
 *
 * Spawns a local static HTTP server for the `build/` directory, launches
 * headless Chromium via Playwright, renders the specified post page at
 * 1500x1000 resolution, and writes the output PNG to `images/screenshot.png`.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Configuration
const buildDir = path.resolve(rootDir, 'build');
const outputPath = path.resolve(rootDir, process.env.OUTPUT_PATH || 'images/screenshot.png');
const rawPostPath = process.env.POST_PATH || process.argv[2] || 'posts/2022/01/art-of-reading-code/';
const postPath = rawPostPath.startsWith('/') ? rawPostPath.slice(1) : rawPostPath;

const VIEWPORT_WIDTH = 1500;
const VIEWPORT_HEIGHT = 1000;

// MIME type dictionary for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.jxl': 'image/jxl',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pf_filter': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_meta': 'application/octet-stream',
};

if (!fs.existsSync(buildDir)) {
  console.error(`Error: Build directory not found at "${buildDir}". Please run Hugo build first.`);
  process.exit(1);
}

// Start lightweight static HTTP server
const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  let filePath = path.join(buildDir, reqPath);

  // Normalize path navigation and directory indexing
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

// Listen on an ephemeral port on 127.0.0.1
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const targetUrl = `http://127.0.0.1:${port}/${postPath}`;
  console.log(`[Flow Screenshot] Local static server running on http://127.0.0.1:${port}`);
  console.log(`[Flow Screenshot] Navigating to: ${targetUrl}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });

    const context = await browser.newContext({
      viewport: {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      },
      deviceScaleFactor: 1,
      colorScheme: 'dark', // Match Flow default theme
    });

    const page = await context.newPage();

    // Navigate to post page
    await page.goto(targetUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Ensure web fonts and layout are fully ready
    await page.evaluate(() => document.fonts.ready);
    // Allow any CSS transitions / animations to settle
    await page.waitForTimeout(600);

    // Ensure destination directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Capture the screenshot
    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false,
    });

    console.log(`[Flow Screenshot] Successfully captured ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} screenshot to: ${outputPath}`);
  } catch (error) {
    console.error('[Flow Screenshot] Error capturing screenshot:', error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
    server.close(() => {
      console.log('[Flow Screenshot] Server shut down.');
    });
  }
});
