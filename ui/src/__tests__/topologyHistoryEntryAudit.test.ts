/**
 * History-Entry Producer Audit (coverage-style drift guard)
 *
 * Every setHistory/setRedo updater that PUSHES a new entry onto the undo or
 * redo stack must build it with `historyEntry()` (topologyHistoryIntegrity),
 * which sanitizes the entry's wires against its own node set at push time.
 * A raw `{ nodes, wires }` push is a corruption hole: a dangling wire could
 * enter the stack and depend entirely on the restore-boundary guard.
 *
 * This is a static source audit, same approach as
 * noiseDitherCompliance.test.ts / themeTokenCompliance.test.ts — no browser
 * needed. The scanner primitives (comment/string stripping, balanced
 * updater extraction, whole-tree walk) live in the shared
 * test-utils/sourceAudit helper; this file owns the domain rule: every
 * undo/redo-stack entry-creation site across ALL of ui/src must route
 * through historyEntry or be declared in DOCUMENTED_EXCEPTIONS. The
 * topology editor family's four sanitized sites (three in the editor,
 * one in the pointer hook — see ENTRY_CREATOR_SITES) are the only
 * non-exempt producers; a NEW raw push anywhere in the tree — especially
 * a future graph editor's own stack — fails until it is routed through
 * historyEntry or explicitly declared.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { relative, resolve } from 'path';
import { collectSourceFiles, lineNumberAt, scanUpdaters } from '@/__tests__/test-utils/sourceAudit';

/* ── Paths ───────────────────────────────────────────────────── */

const UI_SRC = resolve(__dirname, '..');
const EDITOR_REL = 'features/locations/NodeTopologyEditor.tsx';
const POINTER_REL = 'features/locations/nodeTopologyEditorPointer.ts';
const EDITOR_SRC = resolve(UI_SRC, EDITOR_REL);

/* ── Drift-guard baseline ─────────────────────────────────────── */
// Every undo/redo entry-creation site must route through historyEntry().
//
// Baseline: 4 entry-creating updaters in the topology editor family.
// After the 3.4 gesture/hook extractions the producers no longer all
// live in the editor, so each row names the file that owns it TODAY:
//   1. pushHistory          — setHistory block body (every mutation path)
//   2. popUndo              — setRedo push (current state → redo branch)
//   3. popRedo              — setHistory push (current state → history)
//   4. commitDuplicateDrag  — setHistory block body (the filtered entry):
//        moved editor → pointer hook in 59d37d6c1 (slice 3.4c-2)
//      (e9e0f0ef0's keyboard hook owns NO creator — it only calls
//       popUndo/popRedo — verified: its diff moves no setHistory/setRedo
//       updater lines.)
//
// When a new history-entry producer is added, route it through
// historyEntry() AND add a row here. When one is removed, refactored, or
// moved to a hook, re-point/remove its row — the whole-tree test pins the
// exact per-file multiset, so a silent move fails until attributed here.
const ENTRY_CREATOR_SITES: { creator: string; file: string }[] = [
  { creator: 'pushHistory', file: EDITOR_REL },
  { creator: 'popUndo', file: EDITOR_REL },
  { creator: 'popRedo', file: EDITOR_REL },
  { creator: 'commitDuplicateDrag', file: POINTER_REL },
];
const EXPECTED_ENTRY_CREATORS = ENTRY_CREATOR_SITES.length;
const EDITOR_SCOPED_CREATORS = ENTRY_CREATOR_SITES.filter(
  (s) => s.file === EDITOR_REL,
).length;

/* ── Documented exceptions (whole-tree scan) ──────────────────── */
// Undo-stack entry creators that deliberately do NOT go through
// historyEntry(). historyEntry sanitizes graph wires against the entry's
// node set — an invariant that only exists where entries carry
// cross-references. A flat item-undo stack has no such invariant, so it is
// exempt by design; any OTHER creator must use historyEntry.
const DOCUMENTED_EXCEPTIONS: { file: string; setter: string; reason: string }[] = [
  {
    file: 'features/retail/RetailPosScreen.tsx',
    setter: 'setUndoStack',
    reason: 'cart-item undo (removed-line LIFO) — entries carry no cross-references, so the graph wire/node invariant has no analogue',
  },
];

/** An undo/redo-stack entry creator: a History/Redo/Undo-named setter whose
 *  updater pushes by spreading `prev` into a new array (append or prepend). */
function historyEntryCreators(src: string) {
  return scanUpdaters(src).filter(
    (u) => /History|Redo|Undo/i.test(u.setter) && u.body.includes('...prev'),
  );
}

/* ── Editor-scoped audit (line-precise messages) ───────────────── */

describe('history-entry producer audit', () => {
  const source = readFileSync(EDITOR_SRC, 'utf-8');
  const creating = historyEntryCreators(source);

  it('every entry-creating setHistory/setRedo updater goes through historyEntry', () => {
    for (const site of creating) {
      expect(
        site.body,
        `${site.setter} entry creation at line ${lineNumberAt(source, site.index)} must build the entry with ` +
          'historyEntry() (topologyHistoryIntegrity) — a raw { nodes, wires } push is a ' +
          'corruption hole that skips push-time wire sanitization.',
      ).toContain('historyEntry');
    }
  });

  it('the number of entry-creation sites matches the drift-guard baseline', () => {
    const sites = creating.map((u) => `${u.setter} (line ${lineNumberAt(source, u.index)})`).join('\n  ');
    expect(
      creating.length,
      `expected exactly ${EDITOR_SCOPED_CREATORS} entry-creation site(s) in the editor file, ` +
        `found ${creating.length}:\n  ` +
        sites +
        '\nProducers that moved to a hook are attributed in ENTRY_CREATOR_SITES and covered ' +
        'by the whole-tree audit. Every new producer must use historyEntry() and the ' +
        'baseline table must be updated (see its comment in this test).',
    ).toBe(EDITOR_SCOPED_CREATORS);
  });
});

/* ── Whole-tree audit ──────────────────────────────────────────── */

describe('history-entry producer audit — whole ui/src', () => {
  interface TreeSite {
    setter: string;
    body: string;
    file: string;
    line: number;
  }

  const treeSites: TreeSite[] = [];
  for (const file of collectSourceFiles(UI_SRC)) {
    const src = readFileSync(file, 'utf-8');
    for (const site of historyEntryCreators(src)) {
      treeSites.push({
        setter: site.setter,
        body: site.body,
        file: relative(UI_SRC, file).replace(/\\/g, '/'),
        line: lineNumberAt(src, site.index),
      });
    }
  }

  const isExempt = (site: TreeSite) =>
    DOCUMENTED_EXCEPTIONS.some((e) => e.file === site.file && e.setter === site.setter);

  it('every undo/redo entry creator in ui/src uses historyEntry or is a documented exception', () => {
    for (const site of treeSites) {
      const exempt = isExempt(site);
      expect(
        exempt || site.body.includes('historyEntry'),
        `${site.file}:${site.line} — ${site.setter} pushes an undo/redo entry without ` +
          'historyEntry() sanitization. Route it through historyEntry() (topologyHistoryIntegrity) ' +
          'or declare it in DOCUMENTED_EXCEPTIONS with a reason.',
      ).toBe(true);
    }
  });

  it("the only non-exempt entry creators are the topology family's sanitized sites, at their declared hook homes", () => {
    const nonExempt = treeSites.filter((s) => !isExempt(s));
    const listing = nonExempt.map((s) => `${s.file}:${s.line} ${s.setter}`).join('\n  ');
    expect(
      nonExempt.length,
      `expected the topology family's ${EXPECTED_ENTRY_CREATORS} sanitized sites as the only ` +
        `non-exempt creators, found ${nonExempt.length}:\n  ${listing}`,
    ).toBe(EXPECTED_ENTRY_CREATORS);
    // Exact per-file multiset: a producer that silently moves between the
    // editor and a hook fails here until ENTRY_CREATOR_SITES is re-pointed.
    const expectedByFile = new Map<string, number>();
    for (const site of ENTRY_CREATOR_SITES) {
      expectedByFile.set(site.file, (expectedByFile.get(site.file) ?? 0) + 1);
    }
    const actualByFile = new Map<string, number>();
    for (const site of nonExempt) {
      actualByFile.set(site.file, (actualByFile.get(site.file) ?? 0) + 1);
    }
    const sorted = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(
      sorted(actualByFile),
      'entry creators drifted from their declared homes; expected per-file counts ' +
        JSON.stringify(sorted(expectedByFile)) +
        ', got ' +
        JSON.stringify(sorted(actualByFile)),
    ).toEqual(sorted(expectedByFile));
    for (const site of nonExempt) {
      expect(site.body).toContain('historyEntry');
    }
  });
});
