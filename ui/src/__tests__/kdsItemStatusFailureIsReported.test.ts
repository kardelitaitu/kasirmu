// ── A KDS item-status write failure must reach the operator ─────────────────
//
// The defect shape, twice in this feature:
//
//     const advanceItemStatus = useCallback(async (item) => {
//       try {
//         await updateKdsLineItemStatusScoped(...);
//       } catch {
//         // Silent — the backend will emit kds:orders-changed on next poll.
//       }
//     });
//
// A poll replaces the DISPLAY, not the WRITE. The cook taps "this dish is done", the
// status dot does not move, and nothing says why — so the honest response is to relaunch
// the app or tap harder. Both screens already reported the TICKET-level failure
// (KdsScreen via wrapUpdate's kds-offline-queued-update banner, ExpoScreen via
// setActionError) and swallowed the ITEM-level one, so the asymmetry was one line apart
// and easy to read past.
//
// ── Why this is a source check and not a render test ──
//
// The render-level tests for both paths live in KdsScreen.test.tsx (where the item tap is
// now driven end-to-end). ExpoScreen has no harness that mocks
// updateKdsLineItemStatusScoped, and building a second full one to re-assert the same
// sentence would be more machinery than the rule is worth. What matters here is that the
// SHAPE cannot come back a third time — and unlike the enclosing-function extraction that
// defeated an earlier attempt at this kind of check, "is there a setError/setActionError
// before the closing brace of the catch" is answerable from the source directly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');

/** The two screens that own a per-item advance over updateKdsLineItemStatusScoped. */
const SCREENS = [
  'ui/src/features/kds/KdsScreen.tsx',
  'ui/src/features/kds/ExpoScreen.tsx',
];

/**
 * Every catch block that wraps a line-item status write, verbatim.
 *
 * Deliberately NOT a character window around the call: the write and its catch are
 * separated by the voice callout in both files, so any fixed-size window is either too
 * small (misses the catch) or large enough to swallow the NEXT handler's report — the
 * false-negative and false-positive that made an earlier windowed sweep useless.
 */
function itemStatusCatches(source: string): string[] {
  const out: string[] = [];
  const CALL = 'updateKdsLineItemStatusScoped(';
  let from = 0;
  for (;;) {
    const call = source.indexOf(CALL, from);
    if (call === -1) break;
    from = call + CALL.length;
    // The catch that closes this try: the first 'catch' after the call site.
    const catchAt = source.indexOf('catch', from);
    if (catchAt === -1) continue;
    // Body of that catch, up to its matching closing brace at the same depth.
    const open = source.indexOf('{', catchAt);
    if (open === -1) continue;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    out.push(source.slice(catchAt, end + 1));
  }
  return out;
}

describe('KDS item-status write failures are reported', () => {
  it('runs against both screens (so a rename cannot make this vacuous)', () => {
    for (const rel of SCREENS) {
      const source = readFileSync(resolve(REPO, rel), 'utf8');
      expect(source, rel + ' no longer references the line-item status API — update this'
        + ' guard rather than letting it pass on an empty match').toContain(
        'updateKdsLineItemStatusScoped(',
      );
      expect(itemStatusCatches(source).length, rel + ': expected at least one catch')
        .toBeGreaterThan(0);
    }
  });

  it('every one of them reports to the operator', () => {
    const silent: string[] = [];
    for (const rel of SCREENS) {
      const source = readFileSync(resolve(REPO, rel), 'utf8');
      for (const raw of itemStatusCatches(source)) {
        // Strip comments first. Without this the check is satisfied by PROSE: the fix's
        // own comment names `setActionError`, so the kill-test passed on the comment
        // alone after the call was deleted. A guard that a sentence can satisfy is not
        // a guard.
        const body = raw
          .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
          .replace(/\/\/[^\n]*/g, '');         // line comments
        // A report is a state write the render tree reads, or a toast.
        if (!/set(Error|ActionError)\(|addToast\(/.test(body)) {
          silent.push(rel + ' :: ' + raw.replace(/\s+/g, ' ').slice(0, 120));
        }
      }
    }
    expect(silent, 'a failed item-status write was swallowed:\n' + silent.join('\n'))
      .toEqual([]);
  });
});
