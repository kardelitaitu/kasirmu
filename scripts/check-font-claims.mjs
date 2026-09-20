#!/usr/bin/env node
/**
 * check-font-claims.mjs -- execute the claims THIS LANE publishes, and report whether each
 * command still produces what the prose says it produces.
 *
 * The population widened in stages, and the sentence had to follow it: it began as the
 * reproduction block of todo-font-system.md, then took on the bundle-budget facts, and now
 * covers claims published in docs/plans/notes.md items 37 onward as well. Calling all of that
 * "the plan's reproduction block" would leave the tool's own description narrower than its
 * set -- the exact defect this file keeps finding in other people's counts.
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

// vitest colourises whenever COLORTERM is set -- it is set on this machine
// (COLORTERM=truecolor), even through a pipe -- and the escapes land INSIDE the
// summary line, between the label and the numbers:
//   "      Tests \u001b[22m \u001b[1m\u001b[32m52 passed\u001b[39m\u001b[22m..."
// The summary regex below needs a digit straight after `Tests\s+`, so it matched
// nothing and the row reported "could not parse the vitest summary (did the run
// start?)" about a run that had started and passed all 52 cases. Strip once, in
// run(), so every row reads text rather than terminal control codes.
const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '');

function run(args, opts = {}) {
  try {
    const out = stripAnsi(execFileSync(args[0], args.slice(1), { cwd: REPO, encoding: 'utf-8', ...opts }));
    return { out, status: 0, ran: true };
  } catch (e) {
    // git grep exits 1 when nothing matched, and for several rows that IS the expected
    // result, so a nonzero status is kept rather than flattened to success. The bug this
    // guard exists for: the first version returned { ok: true, out: '' } for ANY error,
    // which let `git ls-files` outside a repository -- status 128, empty stdout -- read
    // as the expected emptiness. A broken pipeline is not a zero.
    const out = typeof e.stdout === 'string' ? stripAnsi(e.stdout) : '';
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
  'apps/desktop-tauri/tauri.conf.json', 'apps/mobile-tauri/tauri.conf.json']);
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
const scale = run(['git', '--no-optional-locks', 'grep', '-n', '-e', '--text-', '--', 'ui/src/theme/tokens.css']);
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

// ---- rows: the bundle-budget gate this plan now makes claims about ----------------
// Population, every time: these greps are scoped to the paths where the thing would HAVE
// to live, not to the whole repo. A whole-repo search for a script name counts prose about
// its absence as a hit; see the tablet row's message.
const WF = ['.github/workflows'];
const WIRING = ['.github/workflows', '.githooks', 'scripts/check-ui.mjs', 'scripts/check.sh'];

const src = run(['git', '--no-optional-locks', 'grep', '-n', '-e', 'BUDGET_WOFF2_KB', '-e', "woff2:", '--', 'scripts/check-bundle.mjs']);
const woff2Line = /BUDGET_WOFF2_KB\s*\?\?\s*(\d+)/.exec(src.out)?.[1];
check('the budget gate prices .woff2 (dd12da524)', src.ran && src.out.includes('woff2:'),
  `woff2 budget present, default prints as ${woff2Line ?? '?'} KB (value shown, not asserted)`,
  'a woff2 entry in `budgets` in scripts/check-bundle.mjs');

const wfGate = run(['git', '--no-optional-locks', 'grep', '-l', '-i', '-e', 'check-bundle', '-e', 'bundle:check', '--', ...WF]);
// This claim was INVERTED by d3ae1e201, which added `Bundle budget (desktop)` and
// `(tablet)` steps to dev-ci.yml#ui-test. The row that asserted the absence fired, and now
// asserts the presence -- so a future edit that drops those steps goes red instead of
// quietly returning to the state this whole thread was about.
const wfFiles = wfGate.out.trim() === '' ? [] : wfGate.out.trim().split('\n').filter(Boolean);
check('the budget gate runs in a live workflow', wfGate.ran && wfFiles.length >= 1 && wfFiles.some((f) => /dev-ci\.yml$/.test(f)),
  `${wfFiles.length} live workflow(s) name it: ${wfFiles.join(', ') || 'none'}`,
  '>=1, with dev-ci.yml among them -- if this drifts the CI steps were deleted, and the `ci` block on the bundle-budget row became a lie in the same commit');

const shGate = run(['git', '--no-optional-locks', 'grep', '-i', '-n', 'bundle budget', '--', 'scripts/check.sh']);
check('scripts/check.sh has no budget step (its header claims otherwise)', cleanAbsence(shGate, [0, 1]),
  shGate.out.trim() === '' ? 'no match (case-INsensitive: the step is capitalised "Bundle budget", so a case-sensitive grep reads an absent file)' : shGate.out.trim(),
  '0 -- this is the half of notes.md item 37 that dd12da524 did not close');

// This claim was INVERTED by b89747b28: the tablet budget used to have no caller, and the
// row existed to say so. It fired the moment the leg landed, which is the whole point of
// putting it here -- but it also over-counted, reporting 2 calls where there is 1, because
// the second hit was this lane's own comment line naming the script inside the file that
// calls it. A line mentioning a command is not a line running it, and that is true inside
// code files as well as inside .md, so the row now separates the two numbers and shows the
// surviving line rather than asking to be believed.
const tabletHits = run(['git', '--no-optional-locks', 'grep', '-n', 'bundle:check:mobile', '--', ...WIRING]);
const strip = (l) => l.replace(/^[^:]+:\d+:/, '');
const allHits = tabletHits.out.trim() ? tabletHits.out.trim().split('\n').filter(Boolean) : [];
const codeHits = allHits.filter((l) => !/^\s*(\/\/|\*|#)/.test(strip(l)));
const tabletProse = run(['git', '--no-optional-locks', 'grep', '-l', 'bundle:check:mobile', '--', '.']);
const proseCount = tabletProse.out.trim().split('\n').filter(Boolean).length;
check('the tablet budget is called by the runner that exists', tabletHits.ran && codeHits.length >= 1,
  `${allHits.length} mention(s) in ${WIRING.join(', ')}, ${codeHits.length} outside comments${codeHits.length ? ` -- \`${strip(codeHits[0]).trim().replace(/\s+/g, ' ')}\`` : ''}; files repo-wide naming it: ${proseCount}`,
  '>=1 non-comment call -- notes.md item 38, closed by b89747b28. If this drifts the leg was deleted, and the `bundle budget (mobile)` needle in scripts/gates.json has become a lie as well');

const gateRows = run(['node', '-e', "const g=require('./scripts/gates.json').gates;const r=g.find(x=>x.id==='bundle-budget');console.log(JSON.stringify({found:!!r,status:r&&r.status,runners:r&&r.runners,ci:(r&&r.ci)??'absent'}))"]);
let gj = {};
try { gj = JSON.parse(gateRows.out.trim() || '{}'); } catch { gj = {}; }
// The row that used to assert `ci` was ABSENT now asserts it points somewhere real.
// Reading the workflow file is the difference: a ci block naming a retired `.bak`
// pipeline, or a job that no longer exists in it, satisfies "a key is present" and
// enforces nothing -- which is exactly the shape AGENTS.md documents for `required`.
const ciBlock = (gj.ci && gj.ci !== 'absent') ? gj.ci : null;
const ciWfPath = ciBlock ? path.join(REPO, '.github', 'workflows', path.basename(ciBlock.workflow ?? '')) : null;
const ciJobDeclared = !!(ciWfPath && fs.existsSync(ciWfPath) && String(ciBlock.job)
  && fs.readFileSync(ciWfPath, 'utf8').split('\n').includes(`  ${ciBlock.job}:`));
check('the manifest ci block points at a job declared in a live workflow',
  gateRows.status === 0 && gj.found === true && !!ciBlock && !/\.bak$/.test(String(ciBlock.workflow)) && ciJobDeclared,
  `ci=${JSON.stringify(ciBlock)} -> ${ciBlock ? path.basename(ciBlock.workflow) : 'none'}${ciJobDeclared ? ` job '${ciBlock.job}' declared` : ` job '${ciBlock.job ?? '-'}' NOT declared at job indent`}; status=${gj.status} is policy language, this row is the machine state beside it`,
  'a real workflow file (not .bak) with that job key -- if this drifts, either the steps or the row was edited and the other was left behind');

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
  const suite = run([process.execPath, VITEST_BIN, 'run', 'src/__tests__/themeTokenCompliance.test.ts', '--reporter=verbose'], { cwd: path.join(REPO, 'ui') });
  const suiteOut = suite.out ?? '';
  const failed = /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \((\d+)\))?/.exec(suiteOut);
  if (!failed) {
    check('the sixteen rules', false, 'could not parse the vitest summary (did the run start?)',
      'at most 1 failure, and that one only while a walked path is dirty');
  } else {
    const nf = Number(failed[1] ?? 0);
    // This row used to allow one failure while a walked path was dirty. The allowance was
    // written for a specific borrowed red -- `--shadow-md` in another session's UNCOMMITTED
    // ui/src/features/sales/CartPanelLineItem.css -- and that red cleared on 2026-09-16
    // while the tree stayed dirty. A temporary tolerance with no expiry condition becomes a
    // mask: it would have accepted any new failure silently. So: zero, and the dirty tree is
    // a NOTE about what the green covers, never a reason to grade a red as passing.
    check('the sixteen rules (frozen: zero failures since the borrowed red cleared)', nf === 0,
      `${nf} failed | ${failed[2]} passed (of ${failed[3] ?? '?'})`,
      '0 failures. If the only failure is again a borrowed one from a dirty walked path, that is a '
      + 'conversation with the lane that owns the file -- not a reason to loosen this row again.');

    // The two walkers in that suite print their own populations in their case titles. Take
    // the numbers from the run and the floors from the test's own source: restating 575 or
    // 120 here would create a second copy of a value whose whole purpose is to be one.
    const srcTest = fs.readFileSync(path.join(REPO, 'ui', 'src', '__tests__', 'themeTokenCompliance.test.ts'), 'utf8');
    const floor = (name) => Number(new RegExp(`const ${name} = (\\d+);`).exec(srcTest)?.[1] ?? NaN);
    const jsTitle = /the script walk opened every directory it was pointed at \((\d+) files in hand\)/.exec(suiteOut);
    const cssTitle = /the CSS walk opened every directory it was pointed at \((\d+) sheets in hand\)/.exec(suiteOut);
    const jsFloor = floor('scriptFloor');
    check('both walkers print their own denominator, above their own floor',
      !!jsTitle && !!cssTitle && Number.isFinite(jsFloor) && Number(jsTitle[1]) >= jsFloor,
      `script walk ${jsTitle ? jsTitle[1] : 'title not printed'} files against a floor of ${Number.isFinite(jsFloor) ? jsFloor : 'unreadable'} (item 36 quotes 671 at its writing); CSS walk ${cssTitle ? cssTitle[1] : 'title not printed'} sheets`,
      'both case titles present and the JS count at or above the floor declared in the test source -- if the title vanished the guard was deleted, and if the count fell the walk narrowed');

    // notes.md item 39's published number, executed rather than remembered.
    const reach = run(['node', '-e', "const g=require('./scripts/gates.json').gates;const r=g.filter(x=>x.status==='required'&&!x.ci);console.log(r.length+'|'+r.map(x=>x.id).join(','))"]);
    const [rc, ids] = (reach.out || '').trim().split('|');
    check('notes.md item 39: the count of required rows with no ci block', reach.status === 0 && rc === '10',
      `${rc} row(s): ${ids}`,
      '10 -- if this drifts a row gained or lost CI coverage: repair item 39 and this literal together. 6 -> 8 on 2026-09-19: root-policy had already joined without a re-count (the seventh), and the ADR #55 lane added server-origins, which is local-only by design. bundle-budget left this set in d3ae1e201. 8 -> 10 on 2026-09-20: env-docs joined at 226812432 (ci(gates): require every read env var to be documented) and unified-routes at eac292c91 (fix(unified): route the device-link endpoints to the licence server). Both carry status required, no ci key, and a single scripts/check.sh runner -- the same local-only shape as server-origins and root-policy, not a ci key that went missing.');

    // Informational, not a verdict: in a shared checkout the tree is dirty more often
    // than it is clean, and a tool that reports that as drift every day is a tool whose
    // drift signal gets ignored. It is recorded because AGENTS.md's rule binds every
    // walker -- a green over a dirty tree is a claim about the disk, not about HEAD.
    cleanNote = dirtyLines.length === 0
      ? 'walked tree clean -- the green above is a claim about HEAD'
      : `walked tree NOT clean (${dirtyLines.length} path(s) under ui/src dirty) -- the green above is a claim about the disk, not a revision`;
  }
}


console.log('\n  claims published by this lane (todo-font-system.md + notes.md items 37 onward), executed');
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
