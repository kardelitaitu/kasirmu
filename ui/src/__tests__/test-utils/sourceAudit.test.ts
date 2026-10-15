/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── Shared source-audit scanner unit tests ─────────────────────────
//
// Pins the scanner primitives shared by drift-guard audits
// (topologyHistoryEntryAudit, …): comment/string stripping with the
// original-index map, balanced updater-body extraction, the combined
// scanUpdaters, line numbers, and the whole-tree file walk.

import { describe, expect, it } from 'vitest';
import {
  collectSourceFiles,
  extractUpdaterBodies,
  lineNumberAt,
  scanUpdaters,
  stripCommentsAndStrings,
} from '@/__tests__/test-utils/sourceAudit';
import { join } from 'path';

describe('sourceAudit.stripCommentsAndStrings', () => {
  it('removes line comments, block comments, strings and templates, keeping everything else', () => {
    const src = [
      "// line comment (with parens)",
      "const a = 'str (x)'; /* block /* */",
      'const b = `tmpl ${a}`;',
      'const c = "double \\"quoted\\"";',
      'const d = { x: 1 };',
    ].join('\n');
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).not.toContain('line comment');
    expect(stripped).not.toContain('block');
    expect(stripped).not.toContain('str');
    expect(stripped).not.toContain('tmpl');
    expect(stripped).toContain('const d = { x: 1 };');
  });

  it('preserves the newline of a line comment so later lines keep their shape', () => {
    const { stripped } = stripCommentsAndStrings('// c\nsetX(1);');
    expect(stripped).toBe('\nsetX(1);');
  });

  it('returns origIndexAt mapping each emitted char to its original position', () => {
    // "// c\n" is 5 chars; the line comment's newline is preserved, so the
    // first emitted char (the newline) maps to original 4 and 's' to 5.
    const { stripped, origIndexAt } = stripCommentsAndStrings('// c\nsetX(1);');
    expect(stripped[0]).toBe('\n');
    expect(origIndexAt[0]).toBe(4);
    expect(stripped[1]).toBe('s');
    expect(origIndexAt[1]).toBe(5);
  });

  // ── A regex literal containing a slash is NOT a line comment ───────
  //
  // The scanner read any `//` as a comment start, so `/^#\\//` -- the hash-route
  // regex three production files carry -- was treated as `//` and the REST OF THAT
  // LINE was discarded. Measured on features/staff/StaffManagementScreen.tsx: the
  // trailing `.split(...)` was present in the source and absent from the stripped
  // output, so every audit scanning that file was blind to it.

  it('keeps code that follows a regex literal on the same line', () => {
    const src = 'const r = /^#\\//; const AFTER = 2;';
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).toContain('AFTER');
  });

  it('handles a slash inside a regex character class, where it needs no escape', () => {
    const src = 'const parts = s.split(/[/]+/); const AFTER = 2;';
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).toContain('AFTER');
  });

  it('still removes a real line comment that follows code', () => {
    const src = 'const a = 1; // comment with setX((prev) => bad)\nconst b = 2;';
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).not.toContain('setX');
    expect(stripped).toContain('const a = 1;');
    expect(stripped).toContain('const b = 2;');
  });

  it('does NOT mistake division for a regex (the inverse direction)', () => {
    // After an identifier, a value-ending token, `/` is division. Reading it as a
    // regex would swallow every char to the next `/`, which is worse than the bug
    // this fix removes -- so the false-positive direction is pinned too.
    const src = 'const ratio = total / count; const AFTER = 2;';
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).toContain('total / count');
    expect(stripped).toContain('AFTER');
  });

  it('keeps a division that follows a closing paren or bracket', () => {
    const src = 'const a = (x + y) / 2; const b = arr[0] / 3; const AFTER = 2;';
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).toContain('(x + y) / 2');
    expect(stripped).toContain('arr[0] / 3');
    expect(stripped).toContain('AFTER');
  });

  it('reads a regex that follows a keyword where an expression begins', () => {
    const src = 'function f() { return /a\\/b/.test(s); } const AFTER = 2;';
    const { stripped } = stripCommentsAndStrings(src);
    expect(stripped).toContain('AFTER');
  });

  // ── A JSX closing tag is not a regex literal ───────────────────────
  //
  // `</div>` puts a slash after `<`, which the expression-expected arm read as the
  // start of a regex literal. The scanner then swallowed every character up to the
  // next unescaped slash — in JSX, the NEXT CLOSING TAG. Measurement: the single line
  // `x = 1; </div> {flag} </p> tail` stripped to `x = 1; <> tail`, losing `{flag}`.
  // Real instance: features/sales/SalesHistoryScreen.tsx:1646 reads `detailLoading`
  // on a line that follows `</div>`, and the unread-state guard reported the flag
  // SET-BUT-NEVER-READ because of it. Introduced with the regex arm (round 26).

  it('keeps code between two JSX closing tags on one line', () => {
    const { stripped } = stripCommentsAndStrings('x = 1; </div> {flag} </p> tail');
    expect(stripped).toContain('flag');
    expect(stripped).toContain('tail');
  });

  it('keeps a read that follows a closing tag inside real JSX', () => {
    const src = ['<div>', '  </span>            {loading ? (', '    <p>x</p>', '  ) : null}', '</div>'].join('\\n');
    expect(stripCommentsAndStrings(src).stripped).toContain('loading');
  });
});

describe('sourceAudit.extractUpdaterBodies', () => {
  it('extracts expression-bodied updaters', () => {
    const sites = extractUpdaterBodies('setRedo((prev) => [...prev, historyEntry(nodes, wires)]);');
    expect(sites).toHaveLength(1);
    expect(sites[0]!.setter).toBe('setRedo');
    expect(sites[0]!.body).toContain('historyEntry(nodes, wires)');
  });

  it('extracts block-bodied updaters with nested braces and parens', () => {
    const src = 'setHistory((prev) => { const e = wrap({ a: [1] }); const next = [...prev, e]; return next; });';
    const sites = extractUpdaterBodies(src);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.setter).toBe('setHistory');
    expect(sites[0]!.body).toContain('return next;');
  });

  it('ignores direct-value setters (no updater arrow)', () => {
    expect(extractUpdaterBodies('setHistory(h); setRedo([]);')).toHaveLength(0);
  });
});

describe('sourceAudit.scanUpdaters', () => {
  it('maps site indices back to ORIGINAL source positions across removed comments', () => {
    const src = '// prose about setRedo((prev) => …)\nsetRedo((prev) => [...prev, x]);';
    const sites = scanUpdaters(src);
    expect(sites).toHaveLength(1); // the comment text must NOT produce a site
    expect(sites[0]!.index).toBeGreaterThan(1); // beyond the comment
    expect(lineNumberAt(src, sites[0]!.index)).toBe(2);
  });
});

describe('sourceAudit.collectSourceFiles', () => {
  it('walks recursively, excluding tests, node_modules, hidden dirs and .d.ts', () => {
    // A fixture-less assertion against the real tree: the walk must return
    // only production sources and must include a known editor file.
    const files = collectSourceFiles(join(__dirname, '..', '..'));
    // Windows returns backslash paths — normalize before asserting suffixes.
    const normalized = files.map((f) => f.replace(/\\/g, '/'));
    expect(normalized.length).toBeGreaterThan(100);
    expect(normalized.some((f) => f.endsWith('features/locations/NodeTopologyEditor.tsx'))).toBe(true);
    expect(normalized.some((f) => f.includes('__tests__'))).toBe(false);
    expect(normalized.some((f) => f.includes('node_modules'))).toBe(false);
    expect(normalized.some((f) => f.endsWith('.d.ts'))).toBe(false);
  });
});
