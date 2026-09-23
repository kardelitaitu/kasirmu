#!/usr/bin/env node
/**
 * Post-deploy reachability guard for the kasir.mu Worker.
 *
 * WHY THIS EXISTS — measured 2026-09-23: `wrangler deploy` replaces the zone's
 * entire route set with the `routes` array in wrangler.toml. When that array
 * named only the two subdomains, the marketing host's own route (which lived in
 * the Cloudflare dashboard) was deleted, every kasir.mu URL fell through to the
 * origin behind the DNS record, and the site answered 522 after ~19.5s — while
 * admin.kasir.mu and dashboard.kasir.mu kept answering 200 from the same
 * Worker. A healthy Worker with a missing route is invisible from the dashboard,
 * so the deploy itself reported success.
 *
 * WHAT IT DOES — derives one origin per route in wrangler.toml (`host/*` →
 * `https://host/`), fetches each, and fails when a route answers 5xx or does not
 * answer at all. Any extra origins on the command line are checked too, which is
 * how a route can be tested before it is added to the config.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — it asserts reachability, not content: a
 * 200 from an origin that is serving the wrong build is not this guard's job
 * (the asset-hash comparison used in the audits covers that), and a 3xx is a
 * pass because dashboard.kasir.mu answers 302 by design.
 *
 * Exit codes: 0 all origins reachable · 1 at least one unreachable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRANGLER_TOML = path.join(HERE, '..', 'wrangler.toml');

const RETRIES = Number(process.env.VERIFY_RETRIES ?? '6');
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? '20000');
const DELAY_MS = Number(process.env.VERIFY_DELAY_MS ?? '5000');

/**
 * The route patterns declared in wrangler.toml's `routes` array.
 *
 * Comments are stripped before the array is read: the array carries a long
 * comment explaining this very failure, and a quoted word inside a comment
 * would otherwise be read as a route.
 */
export function routePatterns(routesText) {
  const withoutComments = routesText.replace(/#[^\n]*/g, '');
  const array = withoutComments.match(/routes\s*=\s*\[([\s\S]*?)\]/);
  if (!array) return [];
  return [...array[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** `kasir.mu/*` → `https://kasir.mu/`. Patterns this shape cannot express are skipped. */
export function originsFor(patterns) {
  const origins = [];
  for (const pattern of patterns) {
    const host = pattern.split('/')[0];
    if (!host || host.includes('*')) continue;
    const origin = `https://${host}/`;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

async function statusOf(origin) {
  try {
    const res = await fetch(origin, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status;
  } catch (error) {
    return error instanceof Error ? `error: ${error.name}` : 'error';
  }
}

/** Reachable means "answers without a 5xx"; a 3xx is a pass (see the header). */
function reachable(status) {
  return typeof status === 'number' && status < 500;
}

async function verify(origin) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    last = await statusOf(origin);
    if (reachable(last)) return { ok: true, attempts: attempt, status: last };
    // A fresh deploy can still be propagating; retry before calling it dead.
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return { ok: false, attempts: RETRIES, status: last };
}

async function main() {
  const declared = originsFor(routePatterns(fs.readFileSync(WRANGLER_TOML, 'utf8')));
  const origins = [...declared, ...process.argv.slice(2)];
  if (origins.length === 0) {
    console.error('verify-deploy: no routes found in wrangler.toml and none given');
    process.exit(1);
  }

  let failed = 0;
  for (const origin of origins) {
    const result = await verify(origin);
    const label = `${origin} -> ${result.status}`;
    if (result.ok) {
      console.log(`  ok   ${label}${result.attempts > 1 ? ` (after ${result.attempts} attempts)` : ''}`);
    } else {
      failed += 1;
      console.error(`  FAIL ${label}${declared.includes(origin) ? '' : ' (extra origin)'}`);
    }
  }

  if (failed > 0) {
    console.error(
      `\nverify-deploy: ${failed} of ${origins.length} origin(s) unreachable.\n` +
        'A 5xx here after a deploy usually means the route is missing: `wrangler deploy`\n' +
        'replaces the zone route set with wrangler.toml\'s `routes` array, so a route\n' +
        'that lives only in the Cloudflare dashboard is deleted by the next deploy.',
    );
    process.exit(1);
  }
  console.log(`verify-deploy: ${origins.length} origin(s) reachable`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
