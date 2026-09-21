#!/usr/bin/env node
/**
 * scripts/check-testid.mjs -- data-testid compliance gate.
 *
 * Implements docs/plans/todo-testid-checker-spec.md (frozen). Scans `ui/src`
 * source files only -- never tests, e2e, dev-mock or test-utils -- and asserts:
 *
 *   R1  every normalized literal matches ^[a-z0-9]+(-[a-z0-9]+)*$
 *   R2  no full normalized literal is produced by >= 2 distinct files unless a
 *       `contracts[]` row in scripts/testid-baseline.json allows it
 *
 * querySelector / querySelectorAll / getByTestId / findByTestId / getAllByTestId
 * are CONSUMERS: they produce nothing (C6).
 * Exit 0 = clean, 1 = findings, 2 = could not run (C7).
 *
 * Usage:
 *   node scripts/check-testid.mjs              # scan ui/src
 *   node scripts/check-testid.mjs --self-test  # spec section 6 fixtures
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SCAN_ROOT = join(REPO, 'ui', 'src');
const BASELINE_PATH = join(HERE, 'testid-baseline.json');

export const EXIT = { OK: 0, FINDINGS: 1, CANNOT_RUN: 2 };
export const HOLE = 'hole';
export const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EXCLUDED_PREFIXES = ['ui/e2e/', 'ui/src/dev-mock/', 'ui/src/test-utils/'];
const EXCLUDED_EXACT = 'ui/src/test-setup.ts';
const ALLOWED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;

/** Section 3 exclusion set: a file is scanned only if NONE of these hold. */
export function isExcluded(relPath) {
  if (relPath.includes('/__tests__/')) return true;
  const base = relPath.split('/').pop() ?? relPath;
  if (TEST_FILE.test(base)) return true;
  if (EXCLUDED_PREFIXES.some((x) => relPath.startsWith(x))) return true;
  if (relPath === EXCLUDED_EXACT) return true;
  const dot = relPath.lastIndexOf('.');
  if (dot < 0 || !ALLOWED_EXT.has(relPath.slice(dot))) return true;
  return false;
}

/* Lexical helpers */

/** Index just past the closing quote of the string starting at `i`. */
function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (quote === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        if (depth === 0) break;
        j++;
      }
      j++;
      continue;
    }
    if (c === quote) return j + 1;
    j++;
  }
  return j;
}

/**
 * mask[i] === false means index i sits inside a string or a nested brace/paren
 * group, so splitting never cuts inside a `${...}` hole.
 */
function topLevelMask(src) {
  const n = src.length;
  const mask = new Array(n).fill(true);
  const mark = (from, to) => { for (let k = from; k < to && k < n; k++) mask[k] = false; };
  const stack = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      mark(i, end);
      i = end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { stack.push(i); i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      const o = stack.pop();
      if (o !== undefined) mark(o + 1, i);
      i++;
      continue;
    }
    i++;
  }
  for (const o of stack) mark(o + 1, n);
  return mask;
}

function findTopLevel(src, mask, ch, from) {
  for (let i = from ?? 0; i < src.length; i++) {
    if (!mask[i] || src[i] !== ch) continue;
    if (ch === '?' && (src[i + 1] === '?' || src[i + 1] === '.' || src[i - 1] === '?')) continue;
    if (ch === ':' && (src[i + 1] === ':' || src[i - 1] === ':')) continue;
    return i;
  }
  return -1;
}

function splitTopLevel(src, mask, pred) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (!mask[i] || !pred(src, i)) continue;
    const width = src[i + 1] === src[i] ? 2 : 1;
    parts.push(src.slice(start, i));
    i += width - 1;
    start = i + 1;
  }
  parts.push(src.slice(start));
  return parts;
}

/* Section 2 parser */

/** Normalization rule 3: the placeholder is APPENDED AFTER the hyphen. */
export function appendHole(acc) {
  if (acc === '') return HOLE;
  return acc.endsWith('-') ? acc + HOLE : acc + '-' + HOLE;
}

/** Read a quoted or template literal; null when the text is not one. */
function readString(text) {
  const s = text.trim();
  if (s.length === 0) return null;
  const q = s[0];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  if (q === '`') {
    let acc = '';
    let buf = '';
    let i = 1;
    while (i < s.length) {
      if (s[i] === '\\') { buf += s[i + 1] ?? ''; i += 2; continue; }
      if (s[i] === '$' && s[i + 1] === '{') {
        let depth = 1;
        i += 2;
        while (i < s.length && depth > 0) {
          if (s[i] === '{') depth++;
          else if (s[i] === '}') depth--;
          if (depth === 0) break;
          i++;
        }
        i++;
        acc = appendHole(acc + buf);
        buf = '';
        continue;
      }
      if (s[i] === q) return acc + buf;
      buf += s[i];
      i++;
    }
    return acc + buf;
  }
  const end = s.lastIndexOf(q);
  if (end <= 0) return null;
  return s.slice(1, end).replace(/\\(.)/g, '$1');
}

/** 2.4b: ALL alternatives -- ternary both branches, || / && operands. */
export function splitAlternatives(src) {
  const mask = topLevelMask(src);
  const q = findTopLevel(src, mask, '?');
  if (q >= 0) {
    const c = findTopLevel(src, mask, ':', q + 1);
    if (c > q) {
      // The condition is src.slice(0, q) and produces NOTHING; the two
      // alternatives are the branches (nested ternary -> 3+ via recursion).
      return [
        ...splitAlternatives(src.slice(q + 1, c)),
        ...splitAlternatives(src.slice(c + 1)),
      ];
    }
  }
  const parts = splitTopLevel(src, mask, (t, i) =>
    (t[i] === '|' && t[i + 1] === '|') || (t[i] === '&' && t[i + 1] === '&'));
  if (parts.length > 1) return parts.flatMap((x) => splitAlternatives(x));
  return [src];
}

/** 2.4c per alternative: literal / template / '+' concat; anything else SKIP. */
export function extractAlternative(alt) {
  let s = alt.trim();
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  const mask = topLevelMask(s);
  const parts = splitTopLevel(s, mask, (t, i) => t[i] === '+' && t[i + 1] !== '+');
  const first = readString(parts[0] ?? '');
  if (first === null) return null;
  let acc = first;
  let tail = false;
  for (const part of parts.slice(1)) {
    const lit = readString(part);
    if (lit === null) { tail = true; continue; }
    acc += lit;
  }
  if (tail) acc = appendHole(acc);
  return acc;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/** 2.4a MANDATORY balanced-brace scan (the greedy regex is banned by the spec). */
function scanBalanced(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/**
 * Scan one file into producer records AND consumer references.
 * Producers are `data-testid=` / `dataTestId=` attributes; consumers are the
 * same token inside a querySelector/querySelectorAll/getByTestId/findByTestId/
 * getAllByTestId call (C6) -- they produce nothing but they still REFERENCE the
 * literal, which is what makes a cross-file contract a contract.
 */
export function scanText(text, file) {
  const records = [];
  const refs = [];
  const re = /(?:data-testid|dataTestId)\s*=\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const before = text.slice(Math.max(0, start - 40), start);
    const isConsumer = /\[|\(/.test(before);
    let i = start + m[0].length;
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i);
      const raw = text.slice(i + 1, Math.max(i + 1, end - 1)).replace(/\\(.)/g, '$1');
      (isConsumer ? refs : records).push({ normalized: raw, file, line: lineOf(text, start) });
      re.lastIndex = end;
      continue;
    }
    if (ch === '{') {
      const close = scanBalanced(text, i);
      if (close < 0) { re.lastIndex = i + 1; continue; }
      for (const alt of splitAlternatives(text.slice(i + 1, close))) {
        const lit = extractAlternative(alt);
        if (lit === null) continue;
        (isConsumer ? refs : records).push({ normalized: lit, file, line: lineOf(text, start) });
      }
      re.lastIndex = close + 1;
      continue;
    }
    re.lastIndex = i + 1;
  }
  return { records, refs };
}

/** Producer records only -- what R1 and R2 are computed from. */
export function parseSource(text, file) {
  return scanText(text, file).records;
}

/* Corpus */

export function walk(dir, rel) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const relPath = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), relPath));
    else if (e.isFile()) out.push({ abs: join(dir, e.name), rel: relPath });
  }
  return out;
}

/** C5: repeats inside ONE file collapse to a single R2 record. */
export function dedupeRecords(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const key = r.normalized + '\u0000' + r.file;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** C4: keys on the FULL normalized string -- prefix keys are a bug. */
export function producersByLiteral(records) {
  const map = new Map();
  for (const r of records) {
    const set = map.get(r.normalized) ?? new Set();
    set.add(r.file);
    map.set(r.normalized, set);
  }
  return map;
}

/** C4: keys on the FULL normalized string -- prefix keys are a bug. */
export function collisionMap(records) {
  const map = new Map();
  for (const r of records) {
    const set = map.get(r.normalized) ?? new Set();
    set.add(r.file);
    map.set(r.normalized, set);
  }
  const collisions = new Map();
  for (const [lit, files] of map) if (files.size >= 2) collisions.set(lit, files);
  return collisions;
}

/** B4.3: missing or unparseable baseline exits 2, never 1. */
export function loadBaseline() {
  let raw;
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8');
  } catch (err) {
    return { error: 'baseline unreadable (' + BASELINE_PATH + '): ' + err.message };
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.max_duplicate_contracts !== 'number' || !Array.isArray(parsed.contracts)) {
      return { error: 'baseline malformed: max_duplicate_contracts (number) and contracts (array) are required' };
    }
    return { baseline: parsed };
  } catch (err) {
    return { error: 'baseline unparseable JSON: ' + err.message };
  }
}

/** R1 + R2 + baseline verdict over parsed records. */
export function analyze(records, baseline, refs) {
  const findings = [];
  const deduped = dedupeRecords(records);
  const refList = refs || [];

  // R1 -- absolute; no baseline section can permit it (B4.2).
  for (const r of deduped) {
    if (!KEBAB.test(r.normalized)) {
      findings.push('R1 kebab-case violation: ' + JSON.stringify(r.normalized) + ' at ' + r.file + ':' + r.line);
    }
  }

  // R2
  const collisions = collisionMap(deduped);
  const producers = producersByLiteral(deduped);
  const allowed = new Map();
  for (const row of (baseline && baseline.contracts) || []) {
    allowed.set(row.literal, new Set(row.files || []));
  }

  // C9 / B4.1 stale-entry rule. A row stays live only while the literal is
  // still a >= 2-file contract: at least one producer plus every file the row
  // names still referencing the literal, and NOTHING outside the row is a
  // producer (B4.4: a third producer fails the exact set match).
  const participants = new Map();
  for (const r of [...deduped, ...refList]) {
    const set = participants.get(r.normalized) ?? new Set();
    set.add(r.file);
    participants.set(r.normalized, set);
  }
  for (const [literal, declared] of allowed) {
    const live = participants.get(literal);
    const litProducers = producers.get(literal) ?? new Set();
    if (!live || live.size < 2) {
      findings.push('STALE baseline entry: ' + literal + ' is no longer a >= 2-file contract -- delete the contracts row');
      continue;
    }
    if (litProducers.size < 1) {
      findings.push('STALE baseline entry: ' + literal + ' has no producer left -- delete the contracts row');
      continue;
    }
    const liveSet = new Set(live);
    const exact = liveSet.size === declared.size && [...declared].every((f) => liveSet.has(f));
    if (!exact) {
      findings.push('STALE baseline entry: ' + literal + ' participant set changed -- row files [' + [...declared].sort().join(', ') + '] vs live [' + [...liveSet].sort().join(', ') + ']');
    }
    for (const p of litProducers) {
      if (!declared.has(p)) {
        findings.push('B4.4 third producer of allowed literal ' + literal + ': ' + p + ' is not in the contracts row');
      }
    }
  }

  for (const [literal, files] of collisions) {
    if (allowed.has(literal)) continue;
    findings.push('R2 duplicate data-testid ' + JSON.stringify(literal) + ' produced by ' + [...files].sort().join(', ') + ' (no contracts row)');
  }

  // C10: the ratchet counts live CONTRACTS -- a literal with >= 2 files in
  // play (producer plus consumer) and at least one producer left.
  let contracts = 0;
  for (const [literal, files] of participants) {
    if (files.size >= 2 && (producers.get(literal) ?? new Set()).size >= 1) contracts++;
  }
  const cap = (baseline && baseline.max_duplicate_contracts) || 0;
  if (contracts > cap) {
    findings.push('C10 live contract count ' + contracts + ' exceeds max_duplicate_contracts ' + cap);
  }

  return { exit: findings.length > 0 ? EXIT.FINDINGS : EXIT.OK, findings, collisions, contracts };
}

/** Run the gate over an explicit file list. Empty corpus -> exit 2 (C8). */
export function runCheck(files) {
  if (!files || files.length === 0) {
    return { exit: EXIT.CANNOT_RUN, lines: ['could not run: 0 files scanned under ' + SCAN_ROOT] };
  }
  const records = [];
  const refs = [];
  let plain = 0;
  let brace = 0;
  for (const f of files) {
    const text = readFileSync(f.abs, 'utf8');
    plain += (text.match(/data-testid\s*=\s*["']/g) || []).length;
    brace += (text.match(/data-testid\s*=\s*\{/g) || []).length;
    const scanned = scanText(text, f.rel);
    records.push(...scanned.records);
    refs.push(...scanned.refs);
  }
  const loaded = loadBaseline();
  if (loaded.error) return { exit: EXIT.CANNOT_RUN, lines: [loaded.error, 'resolved root: ' + SCAN_ROOT] };
  const res = analyze(records, loaded.baseline, refs);
  const lines = [];
  lines.push('scanned ' + files.length + ' files under ' + SCAN_ROOT);
  lines.push('attributes: ' + plain + ' plain, ' + brace + ' brace-expression');
  lines.push('literals: ' + dedupeRecords(records).length + ' unique (literal, file) pairs; ' + res.collisions.size + ' cross-file collision(s); ' + res.contracts + ' live contract(s)');
  for (const f of res.findings) lines.push('  FAIL ' + f);
  if (res.findings.length === 0) lines.push('  OK R1 kebab-case clean, R2 collisions covered by the baseline');
  return { exit: res.exit, lines };
}

/* Self-test: spec section 6 fixtures */

export const FIXTURES = [
  { src: 'SecurityTrailScreen.tsx:255', input: "data-testid={'security-trail-outcome-' + chip.value}", expect: ['security-trail-outcome-hole'] },
  { src: 'DiagnosticsSection.tsx:130', input: "data-testid={'diagnostics-row-' + key}", expect: ['diagnostics-row-hole'] },
  { src: 'KdsHamburgerPanel.tsx:99', input: 'data-testid={dataTestId}', expect: [] },
  { src: 'ExpoScreen.tsx:350', input: "data-testid={column.zone ? `kds-expo-station-\${column.zone}` : 'kds-expo-station-none'}", expect: ['kds-expo-station-hole', 'kds-expo-station-none'] },
  { src: 'StationSelectorModal.tsx:82', input: "data-testid={isAll ? 'kds-station-option-all' : `kds-station-option-\${zone}`}", expect: ['kds-station-option-all', 'kds-station-option-hole'] },
  { src: 'KdsHamburgerPanel.tsx:496', input: 'dataTestId="kds-settings-yellow-slider"', expect: ['kds-settings-yellow-slider'] },
  { src: 'RetailPosScreen.tsx:443', input: 'querySelector<HTMLElement>(\'[data-testid="product-grid-scroll"]\')', expect: [] },
  { src: 'KdsTicketCard.tsx:314', input: "data-testid={`kds-order-card-\${order.display_number ?? order.id}`}", expect: ['kds-order-card-hole'] },
  { src: 'synthetic Foo_Bar', input: 'data-testid="Foo_Bar"', expect: ['Foo_Bar'], r1: 'FAIL' },
  { src: 'synthetic foo--bar', input: 'data-testid="foo--bar"', expect: ['foo--bar'], r1: 'FAIL' },
  { src: 'synthetic foo-bar-', input: 'data-testid="foo-bar-"', expect: ['foo-bar-'], r1: 'FAIL' },
];

function selfTest() {
  const rows = [];
  let failures = 0;
  const add = (source, input, expected, actual, ok) => {
    if (!ok) failures++;
    rows.push({ source, input, expected, actual, ok });
  };

  for (const fx of FIXTURES) {
    const got = parseSource(fx.input, 'synthetic.tsx').map((r) => r.normalized);
    const ok = JSON.stringify(got) === JSON.stringify(fx.expect);
    add(fx.src, fx.input, JSON.stringify(fx.expect), JSON.stringify(got), ok);
    if (fx.r1 === 'FAIL') {
      const allKebab = got.every((g) => KEBAB.test(g));
      add(fx.src + ' (R1)', fx.input, 'R1 FAIL', allKebab ? 'R1 PASS' : 'R1 FAIL', !allKebab);
    }
  }

  const dupRecords = parseSource('data-testid="product-grid-scroll"\ndata-testid="product-grid-scroll"', 'ui/src/features/retail/RetailProductGrid.tsx');
  const dedup = dedupeRecords(dupRecords);
  add('RetailProductGrid.tsx:658,678 (C5)', 'two data-testid="product-grid-scroll" in one file', '1 record', dedup.length + ' record(s)', dedup.length === 1);

  const twoFiles = [
    { normalized: 'dup-x', file: 'ui/src/a/A.tsx', line: 1 },
    { normalized: 'dup-x', file: 'ui/src/b/B.tsx', line: 1 },
  ];
  const r2 = analyze(twoFiles, { max_duplicate_contracts: 1, contracts: [] });
  const namesBoth = r2.findings.some((f) => f.includes('dup-x') && f.includes('A.tsx') && f.includes('B.tsx'));
  add('synthetic (R2)', 'two files, both data-testid="dup-x", not in baseline', 'exit 1, names both files', 'exit ' + r2.exit + ' -- ' + (r2.findings[0] ?? '(none)'), r2.exit === EXIT.FINDINGS && namesBoth);

  const covered = analyze(twoFiles, { max_duplicate_contracts: 1, contracts: [{ literal: 'dup-x', files: ['ui/src/a/A.tsx', 'ui/src/b/B.tsx'] }] });
  add('synthetic (baseline covers it)', 'same two files WITH a contracts row', 'exit 0', 'exit ' + covered.exit + ' -- ' + (covered.findings[0] ?? 'clean'), covered.exit === EXIT.OK);

  const three = [...twoFiles, { normalized: 'dup-x', file: 'ui/src/c/C.tsx', line: 1 }];
  const third = analyze(three, { max_duplicate_contracts: 1, contracts: [{ literal: 'dup-x', files: ['ui/src/a/A.tsx', 'ui/src/b/B.tsx'] }] });
  add('synthetic (B4.4)', 'third producer of an allowed literal', 'exit 1', 'exit ' + third.exit + ' -- ' + (third.findings[0] ?? 'clean'), third.exit === EXIT.FINDINGS);

  const stale = analyze(twoFiles, { max_duplicate_contracts: 1, contracts: [{ literal: 'gone-now', files: ['ui/src/a/A.tsx'] }] });
  add('synthetic (B4.1)', 'contracts row for a literal with no live collision', 'exit 1, STALE', 'exit ' + stale.exit + ' -- ' + (stale.findings[0] ?? 'clean'), stale.exit === EXIT.FINDINGS && stale.findings.some((f) => f.startsWith('STALE')));

  const empty = runCheck([]);
  add('synthetic (C8)', '0 files scanned', 'exit 2', 'exit ' + empty.exit + ' -- ' + empty.lines[0], empty.exit === EXIT.CANNOT_RUN);

  console.log('');
  console.log('check-testid.mjs --self-test -- spec section 6 fixtures');
  console.log('');
  for (const r of rows) {
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.source);
    console.log('        input:    ' + r.input);
    console.log('        expected: ' + r.expected);
    console.log('        actual:   ' + r.actual);
  }
  console.log('');
  console.log('  ' + (rows.length - failures) + '/' + rows.length + ' fixture rows passed');
  if (failures > 0) {
    console.error('');
    console.error('  FAIL ' + failures + ' fixture row(s) failed');
    return EXIT.FINDINGS;
  }
  console.log('  OK all fixture rows passed');
  return EXIT.OK;
}

/* Main */

export function main(argv) {
  const args = argv || [];
  if (args.includes('--self-test')) return selfTest();
  let st;
  try { st = statSync(SCAN_ROOT); } catch {
    console.error('could not run: scan root unreadable: ' + SCAN_ROOT);
    return EXIT.CANNOT_RUN;
  }
  if (!st.isDirectory()) {
    console.error('could not run: scan root is not a directory: ' + SCAN_ROOT);
    return EXIT.CANNOT_RUN;
  }
  const files = walk(SCAN_ROOT, 'ui/src').filter((f) => !isExcluded(f.rel));
  const res = runCheck(files);
  for (const l of res.lines) console.log(l);
  return res.exit;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) process.exit(main(process.argv.slice(2)));
