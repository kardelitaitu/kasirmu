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
 * WHAT IT DOES — derives one origin per route in wrangler.toml (`host/*` ->
 * `https://host/`), fetches each, and fails when a route answers 5xx or does not
 * answer at all. Any extra origins on the command line are checked too, which is
 * how a route can be tested before it is added to the config.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — it asserts reachability, not content: a
 * 200 from an origin that is serving the wrong build is not this guard's job
 * (the asset-hash comparison used in the audits covers that), and a 3xx is a
 * pass because dashboard.kasir.mu answers 302 by design.
 *
 * Exit codes: 0 all origins reachable · 1 at least one unreachable · 2 self-test failed.
 *
 * SELF-TEST — `--self-test` grades the decisions above on fixtures, in both
 * directions, so the guard is proven able to redden without a deploy: the
 * config parse, the retry, the tally, and — through the real main() with fs and
 * fetch stubbed — the wiring between them. No case touches the network.
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
 *
 * The key match is anchored to the line start because wrangler.toml's own header
 * records the shape that broke this config once: `routes` placed after a
 * [table] header becomes `observability.logs.routes`, which wrangler warns about
 * and drops. An unanchored match reads that dead key as the live one and a
 * deploy verifies a route set wrangler never applied.
 *
 * A DOTTED key is refused rather than ignored: `observability.logs.routes` is
 * the dropped array, so reading it would verify a route set wrangler never
 * applied, and returning [] would report a missing config where the config is
 * present but dead — the two failures need different fixes.
 *
 * Two top-level declarations throw rather than letting one win: whichever
 * array wrangler ignores, the other is what this guard would otherwise grade.
 */
export function routePatterns(routesText) {
  const withoutComments = routesText.replace(/#[^\n]*/g, '');
  /// The bare key a line declares, or '' when it declares none. A key is the
  /// first whitespace-free token, cut at '=', ':' or ']'; a [table] header yields
  /// its inner name. No regex: an anchored pattern here mis-read a
  /// bracket-leading line, which is exactly the shape a header has.
  const keyOf = (line) => {
    let word = '';
    for (const ch of line.trim()) {
      if (ch === ' ' || ch === String.fromCharCode(9)) break;
      word += ch;
    }
    let cut = [];
    for (const ch of word) {
      if (ch === '=' || ch === ':' || ch === ']') break;
      cut.push(ch);
    }
    const bare = cut.join('');
    if (!bare.startsWith('[')) return bare;
    return bare.slice(1, bare.length);
  };
  const lines = withoutComments.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const isHeader = lines[i].trim().startsWith('[');
    const key = keyOf(lines[i]);
    // A header names a TABLE, and the next non-blank line's word nests under it.
    const nextLine = isHeader ? lines.slice(i + 1).find((l) => l.trim() !== '') ?? '' : '';
    const carried = keyOf(nextLine);
    const declared = isHeader && carried ? key + '.' + carried : key;
    const parts = declared.split('.');
    const last = parts[parts.length - 1];
    // `observability.logs.routes` is the array wrangler warns about and drops;
    // reporting it as "no routes" would send the reader to add a key that is
    // already there and dead, so it is named as the config error it is.
    if (parts.length > 1 && last === 'routes') {
      // Plain concatenation, no template literal: an earlier build of this line
      // threw on every input once this branch ran.
      throw new Error("wrangler.toml declares '" + String(declared) + "'; a dotted key is not a top-level routes key");
    }
  }
  const arrays = [...withoutComments.matchAll(/^[ \t]*routes[ \t]*=[ \t]*\[([\s\S]*?)\]/gm)];
  if (arrays.length > 1) {
    throw new Error(`wrangler.toml declares 'routes' ${arrays.length} times; wrangler honours one of them`);
  }
  if (arrays.length === 0) return [];
  return [...arrays[0][1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** `kasir.mu/*` -> `https://kasir.mu/`. Patterns this shape cannot express are skipped. */
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

/**
 * The origins to probe: the config's, then any given on the command line.
 *
 * A duplicate extra origin is an error, not a second check. Appending blind
 * meant the same URL was fetched twice and — when it answered — counted twice
 * in the "N origin(s) reachable" the run prints, so the total overstated the
 * number of routes actually covered.
 */
export function planOrigins(declared, extra = []) {
  const errors = [];
  const seen = new Set(declared);
  const extras = [];
  for (const origin of extra) {
    if (seen.has(origin)) {
      errors.push(`${origin} is on the command line but already comes from the config`);
      continue;
    }
    seen.add(origin);
    extras.push(origin);
  }
  return { declared, extras, origins: [...declared, ...extras], errors };
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
export function reachable(status) {
  return typeof status === 'number' && status < 500;
}

/**
 * The verdict for one origin. `attemptStatuses` holds one entry per fetch made,
 * in order; the last entry is what the origin finally answered. An empty list
 * is zero attempts — NOT reachable, because nothing was checked.
 */
export function verdict(attemptStatuses) {
  const attempts = attemptStatuses.length;
  const status = attempts > 0 ? attemptStatuses[attempts - 1] : undefined;
  return { ok: reachable(status), attempts, status };
}

async function verify(origin, { retries = RETRIES, delayMs = DELAY_MS, fetchStatus = statusOf } = {}) {
  const tried = [];
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    tried.push(await fetchStatus(origin));
    if (reachable(tried[attempt - 1])) return verdict(tried);
    // A fresh deploy can still be propagating; retry before calling it dead.
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return verdict(tried);
}

/**
 * The whole-run verdict and the sentences it prints.
 *
 * An origin that never answered is already a failure, but it is labelled: the
 * old message called a DNS/TLS timeout "unreachable" with no hint that it had
 * produced no HTTP status at all, which reads like a 522 and sends the operator
 * to the route table instead of the DNS record.
 */
export function report(results, { declared = [] } = {}) {
  const lines = [];
  let failed = 0;
  for (const r of results) {
    const label = `${r.origin} -> ${r.status}`;
    const missing = typeof r.status === 'number' ? '' : ' (never answered: no HTTP status)';
    if (r.ok) {
      lines.push({
        stream: 'stdout',
        text: `  ok   ${label}${r.attempts > 1 ? ` (after ${r.attempts} attempts)` : ''}`,
      });
      continue;
    }
    failed += 1;
    const extra = declared.includes(r.origin) ? '' : ' (extra origin)';
    lines.push({ stream: 'stderr', text: `  FAIL ${label}${extra}${missing}` });
  }

  if (results.length === 0) {
    // The vacuous pass this guard must never have: input checked nothing.
    return {
      exit: 1,
      lines: [
        {
          stream: 'stderr',
          text:
            'verify-deploy: nothing was checked — no origin came from wrangler.toml and none was given; ' +
            'an empty check is not a pass.',
        },
      ],
    };
  }
  if (failed > 0) {
    return {
      exit: 1,
      lines: [
        ...lines,
        {
          stream: 'stderr',
          text:
            `\nverify-deploy: ${failed} of ${results.length} origin(s) unreachable.\n` +
            'A 5xx here after a deploy usually means the route is missing: `wrangler deploy`\n' +
            "replaces the zone route set with wrangler.toml's `routes` array, so a route\n" +
            'that lives only in the Cloudflare dashboard is deleted by the next deploy.',
        },
      ],
    };
  }
  return {
    exit: 0,
    lines: [...lines, { stream: 'stdout', text: `verify-deploy: ${results.length} origin(s) reachable` }],
  };
}

/** Reads and derives the plan from a wrangler.toml body; keeps the parse errors. */
export function planFromConfig(routesText, extra = []) {
  try {
    return planOrigins(originsFor(routePatterns(routesText)), extra);
  } catch (error) {
    return { declared: [], extras: [], origins: [], errors: [error.message] };
  }
}

/**
 * The live path. `deps` exists so the self-test can grade THIS function rather
 * than a copy of it; production passes nothing and gets fs/fetch/process.
 */
async function main(extra = process.argv.slice(2), deps = {}) {
  const io = {
    readToml: () => fs.readFileSync(WRANGLER_TOML, 'utf8'),
    fetchStatus: statusOf,
    retries: RETRIES,
    delayMs: DELAY_MS,
    ...deps,
  };
  let plan;
  try {
    plan = planOrigins(originsFor(routePatterns(io.readToml())), extra);
  } catch (error) {
    plan = { declared: [], extras: [], origins: [], errors: [error.message] };
  }
  for (const error of plan.errors) console.error(`verify-deploy: config: ${error}`);
  if (plan.errors.length > 0) return 1;
  if (plan.origins.length === 0) {
    console.error('verify-deploy: no routes found in wrangler.toml and none given');
    return 1;
  }

  const results = [];
  for (const origin of plan.origins) {
    results.push({ origin, ...(await verify(origin, { ...io, fetchStatus: io.fetchStatus })) });
  }

  const outcome = report(results, plan);
  for (const line of outcome.lines) {
    if (line.stream === 'stdout') console.log(line.text);
    else console.error(line.text);
  }
  return outcome.exit;
}

// ── Self-test ───────────────────────────────────────────────────────────
// Most cases assert that a WRONG input reddens, because a case that only
// proves "the happy path stays happy" is the vacuous-pass class in test form.
// The two shapes this file was actually suspect of — an empty plan printing
// its clean sentence, and a skipped origin reading as a pass — are pinned both
// as a pure decision and, through main(), as wiring.

const TOML_REAL = `name = "oz-pos"
main = "worker.ts"
routes = [
  # a "quoted word" inside a comment must not become a route
  "kasir.mu/*",
  "www.kasir.mu/*",
  "dashboard.kasir.mu/*",
  "admin.kasir.mu/*",
]
[vars]
LICENSE_API_URL = "https://license.kasir.mu"
`;

const tomlWith = (body) => `name = "x"\n${body}\n`;

/** A fake fetchStatus keyed by origin: a status, a status list to drain, or an error name. */
function fakeFetch(byOrigin) {
  const calls = [];
  const fn = async (origin) => {
    calls.push(origin);
    const q = byOrigin[origin];
    // A list drains all but its last entry, so the final value repeats when retried.
    const next = Array.isArray(q) ? (q.length > 1 ? q.shift() : q[0]) : q;
    if (typeof next === 'number') return next;
    // statusOf() answers `error: <name>` when fetch throws, so the fake returns that
    // string rather than throwing: the cases grade the retry, not the catch block.
    return next;
  };
  fn.calls = calls;
  return fn;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Runs the module's real main() with fs/fetch/console replaced; returns what it printed. */
async function runMain({ toml, extra = [], fetchStatus }) {
  const saved = { log: console.log, error: console.error };
  const out = [];
  const err = [];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    const exit = await main(extra, {
      readToml: () => toml,
      fetchStatus: fetchStatus ?? (async () => 200),
      retries: 2,
      delayMs: 0,
    });
    return { exit, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    console.log = saved.log;
    console.error = saved.error;
  }
}

const CASES = [
  // ── route parsing ──────────────────────────────────────────────────
  {
    name: 'parses the four declared routes, in order, from the real config shape',
    run: () => {
      const want = ['kasir.mu/*', 'www.kasir.mu/*', 'dashboard.kasir.mu/*', 'admin.kasir.mu/*'];
      const got = routePatterns(TOML_REAL);
      assert(JSON.stringify(got) === JSON.stringify(want), `parsed ${JSON.stringify(got)}`);
    },
  },
  {
    name: 'a "quoted word" in a comment is not read as a route',
    run: () => {
      const got = routePatterns(tomlWith('# "evil.example/*"\nroutes = [\n  "kasir.mu/*",\n]'));
      assert(JSON.stringify(got) === '["kasir.mu/*"]', `parsed ${JSON.stringify(got)}`);
    },
  },
  {
    name: 'a missing routes key yields [] so the caller can refuse it',
    run: () => {
      assert(routePatterns('name = "x"\n').length === 0, 'a missing routes key produced patterns');
    },
  },
  {
    name: 'a nested dotted routes key (the [observability.logs] shape) throws, never reads as []',
    run: () => {
      const text = '[observability.logs]\nroutes = [\n  "nested.example/*",\n]\n';
      let message = '';
      try {
        routePatterns(text);
      } catch (error) {
        message = error.message;
      }
      // Assert the KEY, not the sentence: an earlier version "passed" this case on a
      // generic comment match while the key check itself never fired.
      assert(message.includes("'observability.logs.routes'"), `dotted key not named: ${JSON.stringify(message)}`);
      assert(planFromConfig(text).origins.length === 0, 'a dotted key produced origins');
    },
  },
  {
    name: 'declaring routes twice throws instead of silently picking one',
    run: () => {
      let message = '';
      try {
        routePatterns(tomlWith('routes = ["a.example/*"]\nroutes = ["b.example/*"]'));
      } catch (error) {
        message = error.message;
      }
      assert(/2 times/.test(message), `accepted two routes arrays: ${JSON.stringify(message)}`);
    },
  },
  {
    name: 'the line-anchored match still spans a block whose list starts on the next line',
    run: () => {
      const got = routePatterns(tomlWith('routes = [\n  "a.example/*",\n]'));
      assert(got.length === 1 && got[0] === 'a.example/*', JSON.stringify(got));
    },
  },

  // ── origin derivation ──────────────────────────────────────────────
  {
    name: 'one https origin per host, deduplicated, in config order',
    run: () => {
      const got = originsFor(['kasir.mu/*', 'www.kasir.mu/*', 'kasir.mu/*', 'a.example/en/*']);
      const want = ['https://kasir.mu/', 'https://www.kasir.mu/', 'https://a.example/'];
      assert(JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
    },
  },
  {
    name: 'a wildcard or empty host is skipped, never turned into https://*/',
    run: () => {
      const got = originsFor(['*/x', '/*']);
      assert(got.length === 0, JSON.stringify(got));
    },
  },

  // ── reachability ──────────────────────────────────────────────────
  {
    name: '2xx, 3xx and 4xx are reachable (a 4xx is a host answering; 302 is by design)',
    run: () => {
      for (const status of [200, 204, 301, 302, 404]) {
        assert(reachable(status) === true, `${status} read as unreachable`);
      }
    },
  },
  {
    name: '5xx, a fetch error and no status at all are unreachable (the 522 incident)',
    run: () => {
      for (const status of [500, 503, 522]) {
        assert(reachable(status) === false, `${status} read as reachable`);
      }
      assert(reachable('error: TimeoutError') === false, 'a fetch error read as reachable');
      assert(reachable(undefined) === false, 'no status at all read as reachable');
    },
  },
  {
    name: 'the LAST attempt decides: 200 then 503 is a fail, zero attempts is a fail',
    run: () => {
      assert(verdict([200, 503]).ok === false, 'a trailing 503 was forgiven');
      assert(verdict([200, 200]).ok === true, 'two 200s read as failed');
      assert(verdict([]).ok === false, 'zero attempts read as reachable');
    },
  },

  // ── retry ─────────────────────────────────────────────────────────
  {
    name: 'a route that propagates late passes and reports how many attempts it took',
    run: async () => {
      const fetchStatus = fakeFetch({ 'https://a.example/': [503, 500, 200] });
      const r = await verify('https://a.example/', { retries: 6, delayMs: 0, fetchStatus });
      assert(r.ok === true && r.attempts === 3 && r.status === 200, JSON.stringify(r));
    },
  },
  {
    name: 'a route that is dead every time exhausts exactly retries attempts',
    run: async () => {
      const fetchStatus = fakeFetch({ 'https://a.example/': 522 });
      const r = await verify('https://a.example/', { retries: 4, delayMs: 0, fetchStatus });
      assert(r.ok === false && r.attempts === 4 && r.status === 522, JSON.stringify(r));
      assert(fetchStatus.calls.length === 4, `fetched ${fetchStatus.calls.length} times`);
    },
  },
  {
    name: 'a PASSING route is fetched exactly once (a retry loop that keeps going is not a pass)',
    run: async () => {
      const fetchStatus = fakeFetch({ 'https://a.example/': 200 });
      const r = await verify('https://a.example/', { retries: 6, delayMs: 0, fetchStatus });
      assert(r.ok === true && r.attempts === 1, JSON.stringify(r));
      assert(fetchStatus.calls.length === 1, `fetched ${fetchStatus.calls.length} times after a 200`);
    },
  },
  {
    name: 'a route that never answers is a fail, not a skipped origin',
    run: async () => {
      const fetchStatus = fakeFetch({ 'https://a.example/': 'error: TimeoutError' });
      const r = await verify('https://a.example/', { retries: 2, delayMs: 0, fetchStatus });
      assert(r.ok === false && r.status === 'error: TimeoutError', JSON.stringify(r));
      assert(fetchStatus.calls.length === 2, `a silent origin was retried ${fetchStatus.calls.length} times`);
    },
  },

  // ── the tally ─────────────────────────────────────────────────────
  {
    name: 'one dead route of four fails the run, names the count, prints no clean sentence',
    run: () => {
      const origins = ['https://a/', 'https://b/', 'https://c/', 'https://d/'];
      const results = origins.map((origin, i) => ({
        origin,
        ok: i !== 2,
        attempts: 1,
        status: i === 2 ? 522 : 200,
      }));
      const outcome = report(results, { declared: origins });
      assert(outcome.exit === 1, `exit ${outcome.exit}`);
      const text = outcome.lines.map((l) => l.text).join('\n');
      assert(/1 of 4 origin\(s\) unreachable/.test(text), text);
      assert(!/origin\(s\) reachable/.test(text), `clean sentence printed: ${text}`);
    },
  },
  {
    name: 'SKIPPED is not PASSED: a result marked ok:false (status "skipped") fails the run',
    run: () => {
      const origins = ['https://a/', 'https://b/'];
      const results = [
        { origin: 'https://a/', ok: true, attempts: 1, status: 200 },
        { origin: 'https://b/', ok: false, attempts: 0, status: 'skipped' },
      ];
      const outcome = report(results, { declared: origins });
      assert(outcome.exit === 1, `exit ${outcome.exit} for a skipped origin`);
      assert(/1 of 2 origin\(s\) unreachable/.test(outcome.lines.map((l) => l.text).join('\n')), 'no failing count');
    },
  },
  {
    name: 'VACUOUS: an empty result set exits 1 and never prints the clean sentence',
    run: () => {
      const outcome = report([], { declared: [] });
      const text = outcome.lines.map((l) => l.text).join('\n');
      assert(outcome.exit === 1, `empty run exited ${outcome.exit}`);
      assert(/nothing was checked/.test(text), text);
      assert(!/origin\(s\) reachable/.test(text), `clean sentence printed: ${text}`);
    },
  },
  {
    name: 'all four reachable prints exactly one clean sentence and exits 0',
    run: () => {
      const origins = ['https://a/', 'https://b/', 'https://c/', 'https://d/'];
      const results = origins.map((origin) => ({ origin, ok: true, attempts: 1, status: 200 }));
      const outcome = report(results, { declared: origins });
      assert(outcome.exit === 0, `exit ${outcome.exit}`);
      const texts = outcome.lines.map((l) => l.text);
      assert(texts.length === 5, `lines: ${texts.join(' | ')}`);
      assert(/^verify-deploy: 4 origin\(s\) reachable$/.test(texts[4]), texts[4]);
    },
  },
  {
    name: 'an extra origin and a silent origin are both labelled in the FAIL line',
    run: () => {
      const results = [{ origin: 'https://x/', ok: false, attempts: 2, status: 'error: TimeoutError' }];
      const text = report(results, { declared: [] }).lines.map((l) => l.text).join('\n');
      assert(/FAIL https:\/\/x\/ -> error: TimeoutError \(extra origin\) \(never answered/.test(text), text);
    },
  },

  // ── the plan ──────────────────────────────────────────────────────
  {
    name: 'a duplicate command-line origin is an error, not a second "reachable" origin',
    run: () => {
      const plan = planOrigins(['https://a.example/'], ['https://b.example/', 'https://a.example/']);
      assert(plan.errors.length === 1, JSON.stringify(plan.errors));
      assert(
        JSON.stringify(plan.origins) === JSON.stringify(['https://a.example/', 'https://b.example/']),
        JSON.stringify(plan.origins),
      );
    },
  },
  {
    name: 'an extra origin is still checked — the test-a-route-before-adding-it path',
    run: () => {
      const plan = planFromConfig(tomlWith('routes = ["a.example/*"]'), ['https://preview.example/']);
      assert(
        JSON.stringify(plan.origins) === JSON.stringify(['https://a.example/', 'https://preview.example/']),
        JSON.stringify(plan.origins),
      );
      assert(plan.errors.length === 0, JSON.stringify(plan.errors));
    },
  },
  {
    name: 'a config that declares routes twice is a plan error, not an empty plan',
    run: () => {
      const plan = planFromConfig(tomlWith('routes = ["a.example/*"]\nroutes = ["b.example/*"]'));
      assert(plan.origins.length === 0, JSON.stringify(plan.origins));
      assert(/2 times/.test(plan.errors.join(' ')), JSON.stringify(plan.errors));
    },
  },

  // ── wiring: the real main(), with fs and fetch injected ───────────
  {
    name: 'WIRING: main() on the real config probes each origin once and exits 0 when all answer',
    run: async () => {
      const seen = [];
      const r = await runMain({
        toml: TOML_REAL,
        fetchStatus: async (origin) => {
          seen.push(origin);
          return origin === 'https://dashboard.kasir.mu/' ? 302 : 200;
        },
      });
      assert(r.exit === 0, `exit ${r.exit}, stderr: ${r.stderr}`);
      assert(/^verify-deploy: 4 origin\(s\) reachable$/m.test(r.stdout), r.stdout);
      assert(
        JSON.stringify(seen) === JSON.stringify(originsFor(routePatterns(TOML_REAL))),
        `fetched ${JSON.stringify(seen)}`,
      );
    },
  },
  {
    name: 'WIRING: main() exits 1 when the apex route answers 522 (the 2026-09-23 incident)',
    run: async () => {
      const r = await runMain({
        toml: TOML_REAL,
        fetchStatus: async (origin) => (origin === 'https://kasir.mu/' ? 522 : 200),
      });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(/verify-deploy: 1 of 4 origin\(s\) unreachable/.test(r.stderr), r.stderr);
      assert(!/origin\(s\) reachable/.test(r.stdout), `clean sentence printed: ${r.stdout}`);
    },
  },
  {
    name: 'WIRING: main() exits 1 when a route never answers (timeout), not silently ok',
    run: async () => {
      const r = await runMain({
        toml: TOML_REAL,
        // The seam returns what statusOf() returns on a throw: an 'error: <name>' string.
        fetchStatus: async (origin) => (origin === 'https://www.kasir.mu/' ? 'error: TimeoutError' : 200),
      });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(/never answered/.test(r.stderr), r.stderr);
    },
  },
  {
    name: 'WIRING: main() on a config with no routes exits 1 and prints nothing on stdout',
    run: async () => {
      const r = await runMain({ toml: 'name = "x"\n' });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(/no routes found in wrangler.toml and none given/.test(r.stderr), r.stderr);
      assert(r.stdout === '', `stdout was: ${r.stdout}`);
    },
  },
  {
    name: 'WIRING: main() with a duplicate routes key exits 1 before fetching anything',
    run: async () => {
      let fetched = 0;
      const r = await runMain({
        toml: tomlWith('routes = ["a.example/*"]\nroutes = ["b.example/*"]'),
        fetchStatus: async () => {
          fetched += 1;
          return 200;
        },
      });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(/config: wrangler.toml declares 'routes' 2 times/.test(r.stderr), r.stderr);
      assert(fetched === 0, `fetched ${fetched} times after a config error`);
    },
  },
  {
    name: 'WIRING: main() names a dotted key as the config error, not as "no routes found"',
    run: async () => {
      const r = await runMain({ toml: '[observability.logs]\nroutes = [\n  "nested.example/*",\n]\n' });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(/config: wrangler.toml declares 'observability\.logs\.routes'/.test(r.stderr), r.stderr);
      assert(!/no routes found/.test(r.stderr), `a dead-but-present key was reported as absent: ${r.stderr}`);
    },
  },
  {
    name: 'WIRING: main() with a duplicate command-line origin exits 1 without probing',
    run: async () => {
      let fetched = 0;
      const r = await runMain({
        toml: tomlWith('routes = ["a.example/*"]'),
        extra: ['https://a.example/'],
        fetchStatus: async () => {
          fetched += 1;
          return 200;
        },
      });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(/already comes from the config/.test(r.stderr), r.stderr);
      assert(fetched === 0, `fetched ${fetched} times`);
    },
  },
  {
    name: 'WIRING: main() refuses a config probing zero origins even with no fetch (vacuous)',
    run: async () => {
      const r = await runMain({ toml: tomlWith('routes = ["*/x"]') });
      assert(r.exit === 1, `exit ${r.exit}`);
      assert(r.stdout === '', `stdout was: ${r.stdout}`);
    },
  },
];

async function selfTest() {
  let failed = 0;
  for (const c of CASES) {
    try {
      await c.run();
      console.log(`  ok   ${c.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${c.name}\n       ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed > 0) {
    console.error(`\nverify-deploy --self-test: ${failed} of ${CASES.length} case(s) failed.`);
    process.exitCode = 2;
    return;
  }
  console.log(`verify-deploy --self-test: ${CASES.length} case(s) passed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    process.exitCode = await main(process.argv.slice(2));
  }
}
