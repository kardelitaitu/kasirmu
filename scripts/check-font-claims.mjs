#!/usr/bin/env node
/**
 * check-font-claims.mjs -- run the commands in todo-font-system.md's reproduction block
 * and report whether each still produces what the plan says it produces.
 *
 * Why this exists: the block was written as "commands, not values", but the expectations
 * beside those commands were still prose, and prose drifts. Round 15 proved the point the
 * hard way -- one row's command (`git grep -c -e 'font-src'`, expected 2 per file) could
 * not fail: after adding a host to the shipped CSP it printed 2 and 2, identical to clean.
 * A documented check nobody executes becomes a description of a past run.
 *
 * What it does: for each row, run the command, compare against the expectation stated
 * HERE (this file, not the document, is the home of the value; the document points here),
 * and print DRIFT rather than a silent OK. Rows that need a browser are named and skipped
 * -- an uncovered row that says so is worth more than a fake one.
 *
 * Usage:  node scripts/check-font-claims.mjs
 * Exit:   0 every covered row agreed | 1 at least one drifted | 2 a command could not run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const results = [];
let cleanNote = '';
let worst = 0;

function run(args, opts = {}) {
  try {
    const out = execFileSync(args[0], args.slice(1), { cwd: REPO, encoding: 'utf-8', ...opts });
    return { out, status: 0, ran: true };
  } catch (e) {
    // git grep exits 1 when nothing matched, and for several rows that IS the expected
    // result, so a nonzero status is kept rather than flattened to success. The bug this
    // guard exists for: the first version returned { ok: true, out: '' } for ANY error,
    // which let `git ls-files` outside a repository -- status 128, empty stdout -- read
    // as the expected emptiness. A broken pipeline is not a zero.
    const out = typeof e.stdout === 'string' ? e.stdout : '';
    const status = typeof e.status === 'number' ? e.status : -1;
    return { out, status, ran: status >= 0 && status !== 128 };
  }
}

/** Did the command run at all, and (for emptiness rows) end with a status that means "no match"? */
function cleanAbsence(r, allowed) {
  return r.ran && allowed.includes(r.status) && r.out.trim() === '';
}


function check(name, pass, observed, expected) {
  results.push({ name, pass, observed, expected });
  if (!pass) worst = Math.max(worst, 1);
}

// ---- row: remote hosts still named under ui/ ---------------------------------------
const remote = run(['git', '--no-optional-locks', 'grep', '-l', '-e', 'fonts.googleapis.com', '-e', 'fonts.gstatic.com', '--', 'ui/']);
if (!remote.ran) { console.error('the remote-host grep could not run (status ' + remote.status + ')'); process.exit(2); }
const remotePaths = remote.out.trim().split('\n').filter(Boolean);
check('remote hosts named under ui/', remotePaths.length === 1 && remotePaths[0] === 'ui/src/__tests__/themeTokenCompliance.test.ts',
  `${remotePaths.length} path(s): ${remotePaths.join(', ') || '(none)'}`,
  'exactly 1, the compliance suite, where the strings exist only to fail on');

// ---- row: the CSP clause in both shells, both keys --------------------------------
const csp = run(['git', '--no-optional-locks', 'grep', '-o', '-e', 'font-src [^;\"]*', '--',
  'apps/desktop-client/tauri.conf.json', 'apps/tablet-client/tauri.conf.json']);
if (!csp.ran) { console.error('the CSP grep could not run (status ' + csp.status + ')'); process.exit(2); }
const clauses = csp.out.trim().split('\n').filter(Boolean);
const uniq = [...new Set(clauses.map((l) => l.split(':').slice(1).join(':').trim()))];
check('font-src clause, both shells and both keys', clauses.length === 4 && uniq.length === 1 && uniq[0] === "font-src 'self' data:",
  `${clauses.length} clause(s), ${uniq.length} distinct: ${JSON.stringify(uniq)}`,
  '4 clauses, all identical to `font-src \'self\' data:`');

// ---- row: first-party face RULES in ui/src (not prose) ----------------------------
const faces = run(['git', '--no-optional-locks', 'grep', '-nE', '@font-face[[:space:]]*\\{', '--', ':(glob)ui/src/**/*.css']);
if (!faces.ran) { console.error('the face-rule grep could not run (status ' + faces.status + ')'); process.exit(2); }
check('first-party @font-face rules under ui/src', cleanAbsence(faces, [0, 1]),
  faces.out.trim() === '' ? (faces.status === 0 || faces.status === 1 ? 'no output' : `no output but exit ${faces.status} -- not the same fact`) : `${faces.out.trim().split('\n').length} line(s)`,
  'no output -- the word occurs in ui/src only inside comments, and that gap is the point');

// ---- row: glyph-relative sizing --------------------------------------------------
const ch = run(['git', '--no-optional-locks', 'grep', '-nE', '[0-9](\\.[0-9]+)?ch\\b', '--', ':(glob)ui/src/**/*.css']);
if (!ch.ran) { console.error('the ch grep could not run (status ' + ch.status + ')'); process.exit(2); }
const chLines = ch.out.trim().split('\n').filter(Boolean);
check('ch sizing sites under ui/src', chLines.length === 3 && chLines.every((l) => l.includes('max-width')),
  `${chLines.length} line(s)${chLines.every((l) => l.includes('max-width')) ? ', all max-width' : ', NOT all max-width'}`,
  'exactly 3, all max-width');

// ---- row: font binaries tracked in git -------------------------------------------
const bins = run(['git', '--no-optional-locks', 'ls-files', '*.woff2', '*.woff', '*.ttf', '*.otf', '*.eot']);
if (!bins.ran) { console.error('ls-files could not run (status ' + bins.status + ') -- outside a repository, an empty list means nothing'); process.exit(2); }
check('font binaries tracked in git', cleanAbsence(bins, [0]),
  bins.out.trim() === '' ? (bins.status === 0 ? 'empty' : `empty but exit ${bins.status}`) : `${bins.out.trim().split('\n').length} file(s): ${bins.out.trim().replace(/\n/g, ', ')}`,
  'empty -- the files live in ui/node_modules and reach the build through Vite');

// ---- row: the type scale the bench measures --------------------------------------
const scale = run(['git', '--no-optional-locks', 'grep', '-n', '-e', '--text-', '--', 'ui/src/frontend/themes/tokens.css']);
if (!scale.ran) { console.error('the scale grep could not run (status ' + scale.status + ')'); process.exit(2); }
const steps = scale.out.trim().split('\n').filter((l) => /--text-[a-z0-9]+:/.test(l));
const remOnly = steps.every((l) => /:\s*\.?[0-9.]+rem;/.test(l.split(/--text/)[1].replace(/^[^:]*:/, ':')) || /rem/.test(l));
check('the shipped --text-* scale', steps.length === 12 && remOnly,
  `${steps.length} step(s), ${remOnly ? 'all rem' : 'NOT all rem'}`,
  '12 steps from 2xs to hero, declared in rem');

// ---- row: faces, files, data:, bytes in the build (delegated to the checker) -----
const bundle = run(['node', path.join('scripts', 'check-font-bundle.mjs')]);
if (!bundle.ran || bundle.status !== 0) {
  check('the built font surface', false, `checker exited ${bundle.status} (2 means there is no build to read)`, '13 blocks, 12 files + 1 data:, 13/13 swap, 0 absent, 0 orphans');
} else {
  const b = bundle.out;
  const m = {
    blocks: /@font-face blocks\s+(\d+)/.exec(b)?.[1],
    refs: /src url\(\) refs\s+(\d+)\s+=\s+(\d+) file refs \+ (\d+) inline/.exec(b),
    swap: /font-display: swap\s+(\d+) of (\d+)/.exec(b),
    absent: /referenced but absent\s+(\d+)/.exec(b)?.[1],
    orphans: /on disk, never ref'd\s+(\d+)/.exec(b)?.[1],
    stale: /commits that could change these numbers since the build: (\d+)/.exec(b)?.[1],
  };
  const okBundle = m.blocks === '13' && m.refs?.[1] === '13' && m.refs?.[2] === '12' && m.refs?.[3] === '1'
    && m.swap?.[1] === '13' && m.swap?.[2] === '13' && m.absent === '0' && m.orphans === '0';
  check('the built font surface', okBundle,
    `blocks=${m.blocks} refs=${m.refs?.[1]} (${m.refs?.[2]} files + ${m.refs?.[3]} data) swap=${m.swap?.[1]}/${m.swap?.[2]} absent=${m.absent} orphans=${m.orphans}`,
    '13 blocks; 13 refs = 12 files + 1 data:; 13/13 swap; 0 absent; 0 orphans');
  check('the artifact is current with HEAD', m.stale === '0', `${m.stale} commit(s) on the font surface since the build`,
    '0 -- rebuild (cd ui && npm run build) before trusting the figures above');
}

// ---- row: the rules themselves ---------------------------------------------------
// Spawned through process.execPath and the package's own bin script: `npx` is a .cmd
// shim on Windows and execFileSync does not resolve it, so the first version of this
// row reported "could not parse the vitest summary" when in fact nothing had run --
// which is a drift verdict about the instrument, not about the plan, and the worst kind.
const VITEST_BIN = path.join(REPO, 'ui', 'node_modules', 'vitest', 'vitest.mjs');
const dirty = run(['git', '--no-optional-locks', 'status', '--porcelain', '--', 'ui/src']);
if (!dirty.ran) { console.error('git status could not run (status ' + dirty.status + ')'); process.exit(2); }
const dirtyLines = dirty.out.trim().split('\n').filter(Boolean);
if (!fs.existsSync(VITEST_BIN)) {
  check('the sixteen rules', false, `vitest not installed at ${path.relative(REPO, VITEST_BIN)} -- row could not run`,
    'at most 1 failure, and that one only while a walked path is dirty');
} else {
  const suite = run([process.execPath, VITEST_BIN, 'run', 'src/__tests__/themeTokenCompliance.test.ts'], { cwd: path.join(REPO, 'ui') });
  const suiteOut = suite.out ?? '';
  const failed = /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \((\d+)\))?/.exec(suiteOut);
  if (!failed) {
    check('the sixteen rules', false, 'could not parse the vitest summary (did the run start?)',
      'at most 1 failure, and that one only while a walked path is dirty');
  } else {
    const nf = Number(failed[1] ?? 0);
    check('the sixteen rules', nf <= 1 && (nf === 0 || dirtyLines.length > 0),
      `${nf} failed | ${failed[2]} passed (of ${failed[3] ?? '?'})`,
      'at most 1 failure, and that one only while a walked path is dirty');
    // Informational, not a verdict: in a shared checkout the tree is dirty more often
    // than it is clean, and a tool that reports that as drift every day is a tool whose
    // drift signal gets ignored. It is recorded because AGENTS.md's rule binds every
    // walker -- a green over a dirty tree is a claim about the disk, not about HEAD.
    cleanNote = dirtyLines.length === 0
      ? 'walked tree clean -- the green above is a claim about HEAD'
      : `walked tree NOT clean (${dirtyLines.length} path(s) under ui/src dirty) -- the green above is a claim about the disk, not a revision`;
  }
}


console.log('\n  todo-font-system.md -- reproduction block, executed');
for (const r of results) {
  console.log(`   ${r.pass ? 'OK  ' : 'DRIFT'}  ${r.name}`);
  console.log(`          observed : ${r.observed}`);
  if (!r.pass) console.log(`          expected : ${r.expected}`);
}
if (cleanNote) console.log(`   NOTE   ${cleanNote}`);
console.log('\n  not covered here (needs a browser): `node ui/e2e/font-visual-audit.mjs` -- the');
console.log('  before/after pair, the type-scale table and the artifact age come from that run.');
const n = results.filter((r) => r.pass).length;
console.log(`\n  ${n} of ${results.length} covered rows agreed with the plan.`);
process.exit(worst);
