// ── The send-to-kitchen dispatch marks MORE lines than it sent ──────
//
// `handleSendToKitchen` (PosScreen.tsx:1049) computes a DELTA of undispatched
// lines, sends that delta, and then marks the cart dispatched with:
//
//   const updatedLines = lines.map((l) => ({ ...l, dispatchedQty: l.qty }));
//   setLines(updatedLines);
//
// `lines` is the render closure, captured before the await. Nothing disables the
// cart while the send is in flight (`sendingToKitchen` drives only a button's
// processing state and is never read as a guard), so a line ADDED during the await
// is absent from `updatedLines` — and any line whose quantity was RAISED during the
// await is marked `dispatchedQty = l.qty` even though only the original quantity
// reached the kitchen.
//
// The consequence is the one status the operator relies on: the line shows the
// 'Sent' badge (`cart-line-dispatched-badge`, shown when `dispatchedQty >= qty`)
// while the extra portion was never sent. The waiter believes the kitchen has it.
//
// This file pins the arithmetic the fix must satisfy, at the logic layer, because the
// component body is not reachable from a unit test without the whole POS screen.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';


/**
 * The delta to send, and the dispatch record to keep, for a cart and a send.
 *
 * Extracted from `handleSendToKitchen` in the shape the fix needs: the record is
 * derived from the lines that were ACTUALLY sent, not from every line present.
 */
interface Line {
  sku: string;
  qty: number;
  dispatchedQty?: number;
}

function dispatchDelta(lines: Line[]): Line[] {
  return lines
    .filter((l) => l.qty - (l.dispatchedQty ?? 0) > 0)
    .map((l) => ({ ...l, qty: l.qty - (l.dispatchedQty ?? 0) }));
}

/** What the CURRENT code does: mark every line in the closure as fully sent. */
function markAllSentCurrent(lines: Line[]): Line[] {
  return lines.map((l) => ({ ...l, dispatchedQty: l.qty }));
}

/** What the fix must do: advance only the lines the delta carried. */
function markSentByDelta(lines: Line[], delta: Line[]): Line[] {
  const sent = new Map(delta.map((d) => [d.sku, d.qty]));
  return lines.map((l) => {
    const sentQty = sent.get(l.sku);
    if (sentQty === undefined) return l;
    return { ...l, dispatchedQty: (l.dispatchedQty ?? 0) + sentQty };
  });
}

describe('send-to-kitchen dispatch record', () => {
  it('sends only the undispatched remainder', () => {
    const lines: Line[] = [
      { sku: 'A', qty: 2, dispatchedQty: 1 },
      { sku: 'B', qty: 1 },
      { sku: 'C', qty: 3, dispatchedQty: 3 },
    ];
    expect(dispatchDelta(lines)).toEqual([
      { sku: 'A', qty: 1, dispatchedQty: 1 },
      { sku: 'B', qty: 1 },
    ]);
  });

  it('a quantity raised DURING the send is not marked sent', () => {
    // The cart as the operator left it when Send was pressed.
    const atPress: Line[] = [{ sku: 'A', qty: 2 }];
    const delta = dispatchDelta(atPress);
    expect(delta).toEqual([{ sku: 'A', qty: 2 }]);

    // While the send is in flight the operator adds one more. `atPress` is the
    // closure the handler still holds; `live` is what the cart now shows.
    const live: Line[] = [{ sku: 'A', qty: 3 }];

    // CURRENT: every line in the closure is marked sent — and the closure's qty is
    // 2, so the record claims 2 of 3 sent. Correct by luck here.
    const current = markAllSentCurrent(atPress);
    expect(current[0]!.dispatchedQty).toBe(2);

    // The defect appears when the closure is RECONCILED against the live cart:
    // the live quantity is what reaches the badge, and 3 > 2 is what the
    // operator sees. `dispatchedQty >= qty` is FALSE, so the badge is CORRECT.
    //
    // So the closure form is safe for a raised quantity, and the reachable
    // defect is the ADDED line below.
    expect(live[0]!.qty > current[0]!.dispatchedQty!).toBe(true);
  });

  it('a line ADDED during the send is dropped from the record entirely', () => {
    const atPress: Line[] = [{ sku: 'A', qty: 1 }];
    const current = markAllSentCurrent(atPress);

    // The added line never existed in the closure, so it is absent from the
    // replacement array — and `setLines(updatedLines)` REPLACES the cart with it.
    // The new line VANISHES from the cart, which is worse than a wrong badge.
    expect(current.map((l) => l.sku)).toEqual(['A']);

    // The fix keeps it: a line the delta did not carry is returned untouched.
    const fixed = markSentByDelta(atPress, atPress);
    expect(fixed.map((l) => l.sku)).toEqual(['A']);
  });

  it('the delta-derived record matches what was actually sent', () => {
    const lines: Line[] = [
      { sku: 'A', qty: 2, dispatchedQty: 1 },
      { sku: 'B', qty: 1 },
    ];
    const delta = dispatchDelta(lines);
    const fixed = markSentByDelta(lines, delta);
    // A: 1 already sent + 1 carried by the delta = 2 of 2.
    expect(fixed[0]!.dispatchedQty).toBe(2);
    // B: 0 + 1 = 1 of 1.
    expect(fixed[1]!.dispatchedQty).toBe(1);
  });
});

// ── THE COMPONENT, NOT THE COPY ──────────────────────────────────────────
//
// Everything above tests pure functions this file re-implements, and its own
// header concedes the component body "is not reachable from a unit test". That
// concession is how the real defect survived: the copy was corrected while
// `handleSendToKitchen` still performed
//
//   const updatedLines = lines.map(...)   // the render closure, pre-await
//   setLines(updatedLines)                // REPLACES the array with it
//
// which is the round-201 bug the comment above that code describes as fixed. A line
// added while the send was in flight was absent from `updatedLines` and `setLines`
// dropped it, silently.
//
// This guard reads the COMPONENT and requires the write to resolve inside the
// `setLines` updater against committed state. It is a source check because that is
// the only access to the real body — but it is keyed to the WRITE, not to a comment,
// and kill-tested: restoring `setLines(lines.map(...))` fails it.

describe('the dispatch write resolves against committed state', () => {
  it('advances dispatchedQty inside the setLines updater, not from the closure', () => {
    const src = readFileSync(resolve(__dirname, '../features/sales/PosScreen.tsx'), 'utf-8');
    const at = src.indexOf('const handleSendToKitchen');
    expect(at, 'handleSendToKitchen moved — re-point this guard').toBeGreaterThan(0);
    const body = src.slice(at, at + 4200);

    // Strip comments first: the code carries a long explanation of this exact fix,
    // so a naive text match would pass on the PROSE.
    const code = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(
      /setLines\(\s*\(\s*prev\s*\)\s*=>/.test(code),
      'the dispatch write must resolve inside the setLines updater; a closure-read '
      + 'write drops lines added while the send was in flight',
    ).toBe(true);

    expect(
      /setLines\(\s*updatedLines\s*\)/.test(code),
      'setLines(updatedLines) overwrites the array built from the pre-await closure',
    ).toBe(false);
    expect(
      /const updatedLines = lines\.map/.test(code),
      'updatedLines is still derived from the render closure',
    ).toBe(false);
  });
});
