#!/usr/bin/env node
/**
 * scripts/check-unified-routes.mjs — every licence-server route has a Caddy carve-out.
 *
 * Why this exists: the unified image path-routes one public port to two services, and the
 * default branch sends `/api/v1/*` to the RUST one. The licence server is a PocketBase app, so
 * every route it registers needs a carve-out naming it — and a route added without one answers
 * 404 in production while passing every test, because tests talk to the router and never to
 * caddy. That happened: the whole device-link flow (ADR #54 \2.5) sat under an unrouted prefix.
 *
 * The rule is mechanical: for each route the licence server registers in apps/license-server/main.go,
 * its four-segment prefix must appear as a `handle` in apps/unified/Caddyfile that proxies to the
 * PocketBase port. Routes are read from the `se.Router.<METHOD>(...)` registrations, not from
 * main.go's string literals alone: several are registered by constant (midtransSnapPath,
 * paddleWebhookPath, midtransWebhookPath, trialPath, …) declared in sibling files, and a
 * literal-only scan silently missed the whole Midtrans namespace. Nothing here reads caddy
 * semantics beyond that; first-match-wins ordering is not verified, only coverage.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// C31: the path is overridable so the negative control can point the gate at a
// deliberately corrupted copy. Default is unchanged, and this is the ONLY way
// to exercise the syntax validator's failure branch without editing a tracked
// file in place. `argv[2]` wins so a report can paste a self-contained command.
const caddyPath = process.argv[2] ?? join(root, 'apps/unified/Caddyfile');
const caddy = readFileSync(caddyPath, 'utf8');

// ── Caddyfile syntax validation (C31) ────────────────────────────────────────
//
// WHY A PARSER AND NOT `caddy validate`. The real validator is the only thing
// that understands caddy's full grammar, and it is NOT reachable from this
// gate: no `caddy` binary is on PATH here, `ops/docker/Dockerfile.unified`
// copies the binary into the RUNTIME stage of the deployed image (stage 3,
// `COPY --from=caddy /usr/bin/caddy`) where the gate never runs, and this gate
// is invoked by `scripts/check.sh` as a plain node step with no daemon. Pulling
// an image or downloading a binary inside a static gate would add a network
// dependency the brief forbids inventing, so this is the strongest check that
// IS available offline.
//
// WHAT IT CATCHES, and why it is not the old text scan. The previous check
// split the file on the literal `handle ` and read routing off that, so it
// could not see structure at all: a missing closing brace, a stray token or a
// mis-nested block all still yielded the same 7 prefixes and exited 0, while
// caddy would refuse to adapt the file and the container would fail to start.
// This lexer understands comments, quoted strings and escapes (so the `{…}`
// inside the header comment is not a brace), and the parser then checks brace
// balance, statement nesting, top-level shape, and the depth-1 directive
// vocabulary (plus that every `import` resolves).
//
// LIMITS, stated so nobody reads more into a green run than is there: this is
// a STRUCTURAL check, not caddy's grammar. It cannot know a directive's full
// argument grammar, matcher semantics, or whether a block is legal in its
// context. It deliberately does NOT flag an unterminated quoted string, which
// real caddy accepts (verified: `encode "gzip` validates clean) - being
// stricter than caddy here would fail a file that deploys fine. The real
// validator remains the deployed image's own `caddy validate` at start-up.

// Caddy HTTP handler directives legal at DEPTH 1 (directly inside a site
// block or a snippet body).
//
// SCOPE IS DELIBERATE AND NARROW. Sub-directives at depth >= 2 are open-ended
// (a `reverse_proxy` block has health_* and lb_* keys, a `log` block has
// `output`, a `basic_auth` block has user entries), so checking them requires
// caddy's full grammar and a whitelist there produces FALSE POSITIVES - this
// was measured, not assumed: `output`, `user` and `@api` are all legal and were
// all rejected by a depth-agnostic version of this list. A false positive that
// fails a legitimate deploy is worse than the stray token it would catch, so
// the check stops at depth 1 where the set is finite and documented.
//
// A named matcher (`@name`) and a path matcher (`*`, `/foo/*`) are also legal
// at statement position and are accepted by shape, not by list.
const DEPTH1_DIRECTIVES = new Set([
  'abort', 'acme_server', 'basic_auth', 'basicauth', 'bind', 'debug', 'encode',
  'error', 'file_server', 'forward_auth', 'handle', 'handle_errors',
  'handle_path', 'header', 'import', 'invoke', 'log', 'map', 'method',
  'metrics', 'php_fastcgi', 'push', 'redir', 'request_body', 'request_header',
  'respond', 'reverse_proxy', 'rewrite', 'root', 'route', 'skip_log',
  'templates', 'tls', 'tracing', 'try_files', 'uri', 'vars',
]);

/** True for a statement head that is a matcher rather than a directive. */
function isMatcher(head) {
  return head.startsWith('@') || head === '*' || head.startsWith('/');
}

/**
 * Tokenize a Caddyfile: comments, quoted strings, escapes and braces.
 *
 * Line numbers are 1-based. `firstOnLine` marks a token that starts a
 * statement, which is what makes this a parse rather than a scan: a directive
 * is only recognised at statement position, so an argument that happens to
 * spell a directive name is not mistaken for one.
 */
function lexCaddyfile(src) {
  const tokens = [];
  const lines = src.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let first = true;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break; // comment runs to end of line
      if (ch === '{' || ch === '}') {
        tokens.push({ value: ch, line: n + 1, firstOnLine: first });
        first = false; i++; continue;
      }
      if (ch === '"') {
        // A quoted token may contain braces and '#'. An unterminated quote
        // runs to end of line rather than erroring - caddy accepts it.
        let j = i + 1; let buf = '';
        while (j < line.length) {
          if (line[j] === '\\' && j + 1 < line.length) { buf += line[j + 1]; j += 2; continue; }
          if (line[j] === '"') { j++; break; }
          buf += line[j]; j++;
        }
        tokens.push({ value: buf, line: n + 1, firstOnLine: first, quoted: true });
        first = false; i = j; continue;
      }
      let j = i;
      while (j < line.length && line[j] !== ' ' && line[j] !== '\t' && line[j] !== '{' && line[j] !== '}') j++;
      tokens.push({ value: line.slice(i, j), line: n + 1, firstOnLine: first });
      first = false; i = j;
    }
  }
  return tokens;
}

/**
 * Structural validation. Returns a list of human-readable problems (empty =
 * the file is structurally sound). Never throws.
 */
function validateCaddyfile(src) {
  const errors = [];
  const tokens = lexCaddyfile(src);
  const snippets = new Set();
  const stack = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    // A closing brace is its own statement wherever it appears.
    if (t.value === '}') {
      if (stack.length === 0) {
        errors.push(`line ${t.line}: unmatched '}' - a block is closed that was never opened`);
      } else {
        stack.pop();
      }
      i++; continue;
    }
    if (!t.firstOnLine) { i++; continue; }

    // The statement runs to the next line-starting token (or a closing brace).
    const stmt = [];
    let j = i;
    while (j < tokens.length && tokens[j].value !== '}' && (j === i || !tokens[j].firstOnLine)) {
      stmt.push(tokens[j]); j++;
    }
    const head = stmt[0].value;
    const opensBlock = stmt[stmt.length - 1].value === '{';

    if (stack.length === 0) {
      if (/^\(.+\)$/.test(head)) {
        snippets.add(head.slice(1, -1));
        if (!opensBlock) {
          errors.push(`line ${stmt[0].line}: snippet '${head}' does not open a block with '{'`);
        }
      } else if (!opensBlock) {
        errors.push(`line ${stmt[0].line}: top-level statement '${head}' does not open a block with '{'`);
      }
    } else {
      // Depth 1 only: see DEPTH1_DIRECTIVES for why deeper checks are unsound.
      if (stack.length === 1 && !isMatcher(head) && !DEPTH1_DIRECTIVES.has(head)) {
        errors.push(
          `line ${stmt[0].line}: unrecognized directive '${head}' - caddy would refuse to start` +
            ' (if this is a real caddy directive, add it to DEPTH1_DIRECTIVES)',
        );
      }
      if (head === 'import') {
        const target = stmt[1]?.value;
        if (!target) {
          errors.push(`line ${stmt[0].line}: 'import' names no snippet or file`);
        } else if (!snippets.has(target) && !existsSync(join(dirname(caddyPath), target))) {
          errors.push(
            `line ${stmt[0].line}: 'import ${target}' names neither a snippet defined above it nor a file beside the Caddyfile` +
              ' - caddy refuses to start on an unresolved import',
          );
        }
      }
    }
    if (opensBlock) stack.push({ line: stmt[0].line, head });
    i = j;
  }
  for (const open of stack) {
    errors.push(`line ${open.line}: '${open.head}' opens a block that is never closed with '}'`);
  }
  return errors;
}

const syntaxErrors = validateCaddyfile(caddy);
if (syntaxErrors.length > 0) {
  console.error('unified-routes: ' + caddyPath + ' is not structurally valid caddy: ');
  for (const e of syntaxErrors) console.error('  - ' + e);
  console.error('Caddy refuses to adapt a file like this at container start, so the deploy builds and then does not boot.');
  process.exit(1);
}

// The whole licence-server package: route constants live in the file that owns the handler.
const dir = join(root, 'apps/license-server');
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
  .sort()
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
const main = sources.find(([f]) => f === 'main.go')?.[1] ?? '';

// Route constants: `fooPath = "/api/…"`, with or without its own `const` keyword.
const routeConstants = new Map();
for (const [, src] of sources) {
  for (const m of src.matchAll(/^[ \t]*(?:const[ \t]+)?(\w+)[ \t]*=[ \t]*"(\/api\/[^"]*)"/gm)) {
    routeConstants.set(m[1], m[2]);
  }
}

// The routes actually registered: each argument is a literal or one of those constants.
const prefixes = new Set();
const unresolved = [];
for (const m of main.matchAll(/se\.Router\.[A-Z]+\([ \t]*([^,]+?)[ \t]*,/g)) {
  const arg = m[1];
  const route = arg.startsWith('"') ? arg.slice(1, -1) : routeConstants.get(arg);
  if (route?.startsWith('/api/')) prefixes.add(route.split('/').slice(0, 4).join('/'));
  else unresolved.push(arg);
}
if (unresolved.length > 0) {
  console.error(
    'unified-routes: could not resolve ' +
      unresolved.length +
      ' route registration(s) in main.go — the parser drifted: ' +
      unresolved.join(', '),
  );
  process.exit(2);
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