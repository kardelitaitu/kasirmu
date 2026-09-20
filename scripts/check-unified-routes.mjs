#!/usr/bin/env node
/**
 * scripts/check-unified-routes.mjs — every licence-server route has a Caddy carve-out.
 *
 * Why this exists: the unified image path-routes one public port to two services, and the
 * default branch sends `/api/v1/*` to the RUST one. The licence server is a PocketBase app, so
 * every route it registers needs a carve-out naming it — and a route added without one answers
 * 404 in production while passing every test, because tests talk to the router and never to
 * caddy. That happened: the whole device-link flow (ADR #54 §2.5) sat under an unrouted prefix.
 *
 * The rule is mechanical: for each `/api/...` route literal in apps/license-server/main.go, its
 * four-segment prefix must appear as a `handle` in apps/unified/Caddyfile that proxies to the
 * PocketBase port. Nothing here reads caddy semantics beyond that; first-match-wins ordering is
 * not verified, only coverage.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(join(root, 'apps/license-server/main.go'), 'utf8');
const caddy = readFileSync(join(root, 'apps/unified/Caddyfile'), 'utf8');

const prefixes = new Set();
for (const m of main.matchAll(/"(\/api\/[^"]+)"/g)) {
  prefixes.add(m[1].split('/').slice(0, 4).join('/'));
}
if (prefixes.size === 0) {
  console.error('unified-routes: found no /api routes in the licence server — the parser drifted');
  process.exit(2);
}

// The handle blocks in FILE ORDER, each with the service it reaches: order decides.
const handles = [];
for (const block of caddy.split('handle ').slice(1)) {
  const pattern = block.split(/\s/)[0];
  if (!pattern.startsWith('/api/')) continue;
  const target = block.match(/reverse_proxy\s+(\S+)/)?.[1] ?? '';
  handles.push({ pattern, pocketbase: target.endsWith(':8080'), headers: block.includes('import security_headers') });
}
if (handles.length === 0) {
  console.error('unified-routes: found no /api handle blocks in apps/unified/Caddyfile');
  process.exit(2);
}

/** The service the first matching handle sends this prefix to. */
function resolvesTo(prefix) {
  const first = handles.find((h) =>
    h.pattern.endsWith('*')
      ? (prefix + '/').startsWith(h.pattern.slice(0, -1))
      : prefix === h.pattern,
  );
  return first ? (first.pocketbase ? 'pocketbase' : 'rust') : 'none';
}

const missing = [...prefixes].filter((prefix) => resolvesTo(prefix) !== 'pocketbase').sort();

// Every block must import the shared header snippet: a carve-out added without it serves its
// endpoints with no nosniff, no frame-deny, no referrer policy and no HSTS, which is invisible
// in a diff that only reads the routing. Caught one such block (the device-link carve-out).
const bare = handles.filter((h) => !h.headers).map((h) => h.pattern);

if (missing.length === 0 && bare.length === 0) {
  console.log(
    'unified-routes: OK — ' + prefixes.size + ' licence-server route prefix(es), each resolving to :8080',
  );
  for (const prefix of [...prefixes].sort()) console.log('  ' + prefix + '/* -> ' + resolvesTo(prefix));
  process.exit(0);
}

for (const pattern of bare) {
  console.error('  - ' + pattern + ' does not `import security_headers`');
}
console.error('unified-routes: ' + missing.length + ' route prefix(es) reach the Rust service by default');
for (const prefix of missing) console.error('  - ' + prefix + '/* is not carved out; add a matching handle block');
console.error('A route without a carve-out answers 404 in production while its tests pass.');
process.exit(1);
