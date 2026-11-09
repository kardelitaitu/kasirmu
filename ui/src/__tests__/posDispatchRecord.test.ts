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
  /**
   * The LINE identity. `sku` cannot serve: `addProduct` merges only lines that
   * agree on course, coursing status, note AND modifiers (usePosState.ts:94-102), so
   * the same dish as a main and as a dessert is TWO lines sharing ONE sku.
   */
  id: string;
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
  // ⚠️ KEYED BY `id`, NOT `sku`.
  //
  // The first version of this helper used the SKU, and so did the component it
  // mirrors. That is wrong for a reachable cart: `addProduct` keeps two lines apart
  // when they differ in course, coursing status, note or modifiers (usePosState.ts:94-102),
  // so one dish ordered as a main AND as a dessert is two lines with one SKU. A
  // SKU-keyed map collapses them, and `prev.map` then applies the sent quantity to
  // EVERY matching line — including a sibling that was never sent:
  //
  //   A (main):    qty 2, dispatched 0  -> in the delta, qty 2
  //   B (dessert): qty 1, dispatched 1  -> NOT in the delta
  //   sentBySku = { SKU: 2 }  =>  B becomes dispatched 3 of 1
  //
  // A dispatchedQty ABOVE qty is the badge lying in its worst form, and the tab
  // persists that value, so the corruption outlives the session.
  const sent = new Map(delta.map((d) => [d.id, d.qty]));
  return lines.map((l) => {
    const sentQty = sent.get(l.id);
    if (sentQty === undefined) return l;
    return { ...l, dispatchedQty: (l.dispatchedQty ?? 0) + sentQty };
  });
}

describe('send-to-kitchen dispatch record', () => {
  it('sends only the undispatched remainder', () => {
    const lines: Line[] = [
      { id: 'A', sku: 'A', qty: 2, dispatchedQty: 1 },
      { id: 'B', sku: 'B', qty: 1 },
      { id: 'C', sku: 'C', qty: 3, dispatchedQty: 3 },
    ];
    expect(dispatchDelta(lines)).toEqual([
      { id: 'A', sku: 'A', qty: 1, dispatchedQty: 1 },
      { id: 'B', sku: 'B', qty: 1 },
    ]);
  });

  it('a quantity raised DURING the send is not marked sent', () => {
    // The cart as the operator left it when Send was pressed.
    const atPress: Line[] = [{ id: 'A', sku: 'A', qty: 2 }];
    const delta = dispatchDelta(atPress);
    expect(delta).toEqual([{ id: 'A', sku: 'A', qty: 2 }]);

    // While the send is in flight the operator adds one more. `atPress` is the
    // closure the handler still holds; `live` is what the cart now shows.
    const live: Line[] = [{ id: 'A', sku: 'A', qty: 3 }];

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
    const atPress: Line[] = [{ id: 'A', sku: 'A', qty: 1 }];
    const current = markAllSentCurrent(atPress);

    // The added line never existed in the closure, so it is absent from the
    // replacement array — and `setLines(updatedLines)` REPLACES the cart with it.
    // The new line VANISHES from the cart, which is worse than a wrong badge.
    expect(current.map((l) => l.sku)).toEqual(['A']);

    // The fix keeps it: a line the delta did not carry is returned untouched.
    const fixed = markSentByDelta(atPress, atPress);
    expect(fixed.map((l) => l.sku)).toEqual(['A']);
  });

  // ── Two lines, one SKU: the record must key on the LINE ────────────────
  //
  // Reachable, and the reason this file's fixture now carries an `id`: `addProduct`
  // merges only lines agreeing on course, coursing status, note AND modifiers
  // (usePosState.ts:94-102), so the same dish as a MAIN and as a DESSERT is two lines
  // with one SKU. Both the component and this helper keyed the sent-map by SKU, which
  // collapses them and then applies one line's quantity to the other:
  //
  //   A (main):    qty 2, dispatched 0  -> in the delta with qty 2
  //   B (dessert): qty 1, dispatched 1  -> nothing outstanding, NOT in the delta
  //
  //   SKU-keyed:  sent = { S: 2 }  =>  B: 1 + 2 = 3 on a line of qty 1
  //   id-keyed:   sent = { A: 2 }  =>  B untouched at 1
  //
  // A dispatchedQty ABOVE qty is the 'Sent' badge lying in its worst form, and the
  // held tab persists the value (the dispatch fix made it persist the real one), so
  // the corruption outlives the session.
  it('does not apply one line\'s send to a sibling sharing its SKU', () => {
    const lines: Line[] = [
      { id: 'A', sku: 'SAME', qty: 2 },
      { id: 'B', sku: 'SAME', qty: 1, dispatchedQty: 1 },
    ];

    const delta = dispatchDelta(lines);
    // Only A has anything outstanding.
    expect(delta.map((d) => [d.id, d.qty])).toEqual([['A', 2]]);

    const fixed = markSentByDelta(lines, delta);
    expect(fixed[0]!.dispatchedQty, 'A was fully sent').toBe(2);
    expect(
      fixed[1]!.dispatchedQty,
      'B was NOT sent — a SKU-keyed map would have made it 3 of 1',
    ).toBe(1);
    // And the invariant that makes the badge trustworthy.
    for (const l of fixed) {
      expect(
        (l.dispatchedQty ?? 0) <= l.qty,
        `${l.id}: dispatchedQty must never exceed qty`,
      ).toBe(true);
    }
  });

  it('the delta-derived record matches what was actually sent', () => {
    const lines: Line[] = [
      { id: 'A', sku: 'A', qty: 2, dispatchedQty: 1 },
      { id: 'B', sku: 'B', qty: 1 },
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
    // A CHARACTER WINDOW THAT HAD SILENTLY GONE BLIND.
    //
    // This was `at + 4200`, sized before the dispatch fixes added their own comments
    // to the same function. The comments are STRIPPED below but the window is taken
    // FIRST, so the slice stopped before `const cartData` — and the assertion further
    // down, which reads that block, had nothing to match and passed vacuously.
    // Widened to cover the whole callback, and the assertion below now FAILS if the
    // block is not inside the window at all.
    const body = src.slice(at, at + 9000);

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

    // ⚠️ AND THE SENT-MAP MUST KEY ON THE LINE, NOT THE SKU.
    //
    // The helper in this file was SKU-keyed, and so was the component it mirrors — so
    // the copy and the code were WRONG IN THE SAME WAY and the pure-logic cases passed.
    // Only re-keying the helper by `id` exposed it. A cart can hold two lines with one
    // SKU (addProduct separates them on course/status/note/modifiers), and a SKU-keyed
    // map applies one line's send to its sibling, driving dispatchedQty above qty.
    //
    // The source guard is the only thing that reads the COMPONENT, which is why this
    // belongs here and not in the cases above.
    // ⚠️ AND THE PERSISTED PAYLOAD MUST NOT READ THE PRE-AWAIT CLOSURE.
    //
    // `handleSendToKitchen` awaits the dispatch (:1169) and then writes the hold's
    // `cartData` (:1256-1277) by mapping `lines` — the render closure captured BEFORE
    // that await. The `setLines` write was fixed to resolve against committed state,
    // so LIVE state is right; the persisted record then saves the STALE
    // `dispatchedQty`, which is the pre-send value.
    //
    //   cart: A qty 2, dispatchedQty 0
    //   Send to kitchen -> setLines advances A to 2   (live state correct)
    //   Save tab       -> cartData records A dispatchedQty 0
    //   Resume tab     -> A shows as NOT sent, though the kitchen has it
    //
    // The opposite error from the over-record this file was written for, and the same
    // root cause: reading a snapshot instead of the committed value.
    //
    // WHY THE SIBLING HOOK IS NOT THE SAME CASE: `usePosHeldCarts` recomputes
    // `linesToSave` as `dispatchedQty: l.qty` after its own dispatch (:226-228), so
    // its record INTENDS to mark what it just sent and is internally consistent.
    // `PosScreen` copies `l.dispatchedQty` from the stale array and never reconciles.
    // The window must actually cover the persist block, or the assertion below is
    // vacuous — which is what the old 4200-char bound had become.
    expect(
      code.includes('const cartData'),
      'the persist block is outside the scanned window — widen it rather than letting '
      + 'this guard pass on an empty match',
    ).toBe(true);
    expect(
      /cartData[\s\S]{0,400}?lines:\s*lines\.map/.test(code),
      'the hold payload maps the pre-await closure, so a tab saved right after a '
      + 'kitchen send records the PRE-send dispatchedQty',
    ).toBe(false);
    expect(
      /sentBy(Id|LineId)/.test(code) && !/sentBySku/.test(code),
      'the dispatch record must key on the line id — a SKU-keyed map lets two lines '
      + 'sharing one SKU corrupt each other\'s dispatchedQty',
    ).toBe(true);
  });
});
