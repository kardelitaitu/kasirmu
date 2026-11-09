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
// `--self-test` is a flag, not a path: argv[2] is read positionally below, so a bare
// `process.argv[2]` made `--self-test` resolve as a filename and the whole gate died
// with ENOENT before the self-test ever ran. Flags are filtered out first.
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const caddyPath = args[0] ?? join(root, 'apps/unified/Caddyfile');
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
    // A closing brace is its own statement wherever it appears -- but a QUOTED "}"
    // is data, not structure. The lexer already marks it (quoted: true) and this
    // check ignored the mark, so `respond "}" 200` reported "unmatched '}'" and
    // failed a Caddyfile that caddy accepts. Found by mutation-testing the parser.
    if (t.value === '}' && !t.quoted) {
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
    while (
      j < tokens.length &&
      !(tokens[j].value === '}' && !tokens[j].quoted) &&
      (j === i || !tokens[j].firstOnLine)
    ) {
      stmt.push(tokens[j]); j++;
    }
    const head = stmt[0].value;
    // Same rule for the opening side: a quoted "{" is an argument, not a block.
    const last = stmt[stmt.length - 1];
    const opensBlock = last.value === '{' && !last.quoted;

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

// ── Self-test: the Caddyfile validator's failure branch ──────────────────────
//
// The gate's whole answer over a broken file is "errors.length === 0 ? pass : fail",
// so a validator that quietly stopped reporting would print a clean run over a
// Caddyfile caddy refuses to adapt. Until now the only way to exercise the failure
// branch was to hand-craft a corrupted copy and point argv[2] at it -- which nobody
// re-runs, so a lexer edit that broke the parser stayed invisible.
//
// Each case is a shape the parser has to classify. The ones marked "must fail" are the
// defects the C31 rewrite was written for: the OLD text scan split on the literal
// "handle " and saw none of them, exiting 0 on all four.
const SELF_TEST_CASES = [
  // --- structurally sound: must report NO errors ---
  ['minimal site block', ':80 {\n  encode gzip\n}\n', 0],
  // A brace inside a QUOTED string is not a brace. The lexer must not count it.
  ['brace inside a quoted string', ':80 {\n  respond "{" 200\n}\n', 0],
  // A brace inside a COMMENT is not a brace either -- the header comment in the real
  // Caddyfile contains one, which is what the old text scan tripped over.
  ['brace inside a comment', ':80 {\n  # a comment with { in it\n  encode gzip\n}\n', 0],
  // Matchers and the "*" head are not directives and must not be graded as unknown.
  ['a matcher head is not a directive', ':80 {\n  @api path /api/*\n  reverse_proxy @api localhost:8080\n}\n', 0],
  // A brace inside a QUOTED string is data, not structure. Before the fix,
  // `respond "}" 200` reported "unmatched '}'" and failed a Caddyfile caddy accepts.
  //
  // HOW THESE CASES RELATE TO THE THREE GUARDS -- read this before "improving" them.
  // The fix is three guards: the top-of-loop brace branch, the statement-run while
  // condition, and the opensBlock test. They are JOINTLY load-bearing and SINGLY
  // redundant: reverting any ONE of them still accepts this case, because the other
  // two reject the quoted brace independently. Only reverting all three restores the
  // old behaviour and reddens it, which was measured. So a mutation test that reverts
  // one guard says "case survives" and is CORRECT to -- it is not a weak case, it is a
  // redundant fix. What these cases pin is the BEHAVIOUR (a quoted brace is not
  // structure), not the shape of the code that implements it.
  ['a quoted closing brace is data', ':80 {\n  respond "}" 200\n}\n', 0],
  ['a quoted opening brace is data', ':80 {\n  respond "{" 200\n}\n', 0],
  ['a quoted brace does not hide a real unclosed block', ':80 {\n  respond "}" 200\n', 1],
  // --- structurally broken: must report at least one error ---
  ['unclosed block', ':80 {\n  encode gzip\n', 1],
  ['unmatched closing brace', '}\n', 1],
  ['unknown depth-1 directive', ':80 {\n  totally_not_a_directive\n}\n', 1],
  ['top-level statement without a block', 'encode gzip\n', 1],
  ['import that resolves to nothing', ':80 {\n  import nowhere_theres_no_file\n}\n', 1],
  ['snippet declared without a block', '(snip)\n', 1],
];

function selfTest() {
  const failures = [];
  for (const [name, src, wantMin] of SELF_TEST_CASES) {
    let got;
    try {
      got = validateCaddyfile(src).length;
    } catch (err) {
      failures.push('  ' + name + ': validateCaddyfile THREW (' + err.message + ') - it must never throw');
      continue;
    }
    const ok = wantMin === 0 ? got === 0 : got >= wantMin;
    if (!ok) {
      const want = wantMin === 0 ? 'no errors' : 'at least ' + wantMin + ' error';
      failures.push('  ' + name + ': expected ' + want + ', validator reported ' + got);
    }
  }
  if (failures.length > 0) {
    console.error('SELF-TEST WRONG:');
    for (const line of failures) console.error(line);
    return 2;
  }
  console.log('SELF-TEST OK (' + SELF_TEST_CASES.length + ' cases, no file read)');
  return 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

// Grade the validator before grading the tree: a lexer or parser edit that made
// validateCaddyfile report nothing would make the syntax gate pass over any file at all.
{
  const rc = selfTest();
  if (rc !== 0) {
    console.error('VALIDATOR WENT DEAF: not trusting the Caddyfile check below.');
    process.exit(rc);
  }
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