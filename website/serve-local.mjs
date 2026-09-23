import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PORT env override lets a second instance run alongside a dev server
// (e.g. PORT=4322 node serve-local.mjs) for header/asset verification.
const PORT = Number(process.env.PORT) || 4321;
const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

// Cache-Control mirror of public/_headers so local Lighthouse runs see the
// same cache lifetimes production serves (Workers static assets honors
// _headers; this dev server does not).
const CACHE_POLICY = [
  { match: (p) => p.startsWith('/_astro/') || p.startsWith('/videos/'), cache: 'public, max-age=31536000, immutable' },
  { match: (p) => p.startsWith('/admin/'), cache: 'no-store, max-age=0' },
  { match: (p) => p === '/og-image.png' || p === '/favicon.svg', cache: 'public, max-age=604800' },
];
const cacheControlFor = (urlPath) =>
  CACHE_POLICY.find((r) => r.match(urlPath))?.cache ?? 'public, max-age=0, must-revalidate';

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    
    // Intercept runtime config endpoint (handled by Cloudflare Worker in production)
    if (urlPath === '/__oz/runtime-config.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      // The dispatch is part of the contract, not decoration: an island that
      // hydrated before this response landed only learns the URL from the
      // event (see RUNTIME_CONFIG_EVENT in src/lib/runtime-config.ts). worker.ts
      // emits the same pair in production.
      res.end(
        'window.__OZ_CONFIG__ = { licenseApiUrl: "http://localhost:8080", contactEndpoint: "/api/contact" };' +
          'window.dispatchEvent(new Event("oz:runtime-config"));',
      );
      return;
    }

    if (urlPath === '/' || urlPath === '') {
      urlPath = '/en/';
    }
    
    let filePath = path.join(DIST, urlPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(DIST, '404.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheControlFor(urlPath),
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('404 Not Found');
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`500 Internal Error: ${err.message}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Local server listening on http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
});
