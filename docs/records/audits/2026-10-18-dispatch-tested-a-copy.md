# The dispatch fix was tested on a copy, not on the component — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 102 · status: 3 defects fixed,
     1 duplicate comment block · branch: 0.0.41 · commit: `47d5c0193` -->

<!- - Scope: the send-to-kitchen dispatch and the tab it persists. Tree verified green at
     812/812 (12,889 passed) going in. -->

## What was wrong, and why it survived

`posDispatchRecord.test.ts` exists to pin a real 2026 defect: the dispatch marked MORE
lines dispatched than it sent. Its own header concedes the reason it tests pure
re-implementations rather than the component — *"the component body is not reachable from a
unit test without the whole POS screen."*

That concession is precisely how **the real defect survived**. The test file corrected its
own copy of the logic while `handleSendToKitchen` still performed:

```ts
const updatedLines = lines.map((l) => ({ ...l, dispatchedQty: ... }));
setLines(updatedLines);          // REPLACES the array with the pre-await closure
```

`lines` is the render closure captured BEFORE the await. The cart stays editable while the
send is in flight, so a line added during it is absent from `updatedLines` and
`setLines` **dropped it silently**. The comment sitting directly above the code describes
this exact defect as fixed — and it was written twice, verbatim, an accidental double-paste
that made the block look even more thoroughly addressed than it was.

The test passed. The copy was right. The component was wrong.

## Three defects, found in sequence

1. **The write.** `setLines(updatedLines)` → resolved inside the updater against committed
   state. This is the one the round-201 comment claimed was already done.
2. **The duplicate comment block.** Removed — 14 lines repeated verbatim. Worth recording
   because a doubled explanation reads as strong evidence that the code beneath it was
   reviewed.
3. **The persist block** (:1230, :1261) — found by **the typecheck**, not by reading. Once
   `updatedLines` stopped existing, `tsc` flagged two remaining references, and they hid a
   worse bug: the held tab was built from the same pre-await closure AND wrote
   `dispatchedQty: l.qty` — the WHOLE quantity — into the payload the resume reads back. So
   a resumed tab showed 'Sent' for portions the kitchen never received, and the saved bill
   disagreed with the kitchen ticket. Now it maps the live lines and carries the real
   `dispatchedQty`.

Defect 3 is the argument for fixing rather than annotating: the removal of a stale local
made two consumers visible, and only one of them was merely broken.

## A guard keyed to the WRITE, not to a comment

The pure-logic tests stay (they are good arithmetic tests). Added to the same file is a
source guard that reads the COMPONENT and requires the write to resolve inside the
`setLines` updater, and requires the old shape to be absent:

```ts
expect(/setLines\(\s*\(\s*prev\s*\)\s*=>/.test(code)).toBe(true);
expect(/setLines\(\s*updatedLines\s*\)/.test(code)).toBe(false);
expect(/const updatedLines = lines\.map/.test(code)).toBe(false);
```

Two details that make it trustworthy rather than decorative:

- **Comments are stripped before matching.** This code carries a long prose explanation of
  the fix, so a plain text match would pass on the explanation.
- **Kill-tested:** restoring the closure form fails it on the first assertion.

## Verification

- **Full suite: 812/812 files, 12,890 passed, 0 failed** (3 skipped, 3 todo).
- Kill test: restoring `setLines(updatedLines)` fails the new guard; restored
  byte-identical.
- `npm run typecheck` 0 errors — and it is what found defect 3.
- `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> When a test file re-implements the logic it tests, it verifies the COPY. A passing copy
> says nothing about the component, and a comment claiming a fix is not the fix. Where the
> component is genuinely unrendereable from a unit test, pair the pure-logic test with a
> source guard keyed to the WRITE — and strip comments before matching, or the guard will
> pass on its own explanation.

> last audited 18-10-26 by autonomous-goal-round-102
