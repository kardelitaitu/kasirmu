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
