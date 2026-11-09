# The shift-summary is server-supplied in both screens — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 120 · status: NO DEFECT in the
     class; 1 prior round's OVERSTATED impact corrected · branch: 0.0.41 · no code
     change this round -->

<!- - Scope: the class round 118 found (a mount-only read a mutation should refresh),
     swept across the POS and retail tills. Tree verified green at 811/811 (12,889
     passed) going in. -->

## The sweep

Round 118 fixed the retail till reading the shift once at mount. The same shape was
checked in the POS:

| Surface | Read | Refresh deps |
|---|---|---|
| retail till | inline effect | `[sessionToken]` → now re-reads after a refund (round 118) |
| POS (`usePosShifts`) | `getActiveShiftScoped` (:185) | `[userId, sessionToken]` — no mutation refresh |

The POS is the same shape: no refresh after a sale. `handlePaymentComplete` re-reads
the open bills (:824) and leaves the shift alone, and `usePosShifts` exposes no refresh
function at all.

## Why the POS does not need one, and why round 118 needed less than I claimed

**The shift summary is server-supplied in BOTH screens.**

- POS: `usePosShifts.ts:255` — `setClosedShiftSummary(closed)`, where `closed` is the
  `closeShiftScoped` RESPONSE; displayed at `ShiftModals.tsx:275-332`.
- Retail: `RetailPosScreen.tsx:1164` — `setClosedShiftSummary(s)`, same shape.

So the figures a cashier reconciles against are never the client copy, stale or not.

And the retail screen reads `activeShift` in exactly two places: `activeShift.id` for
the close call (:1163) and `activeShift.openedAt` for the shift-duration display
(:1657) — **no money field is read from it anywhere.**

## The correction I made to my own round-118 record

Round 118 wrote that the cashier count "disagrees by exactly the amount they just
handed back". That is not supportable given the two facts above, and the record has
been corrected rather than left for a later reader to chase:

> The defect was **coherence** — state the till believed disagreed with what the server
> held — and the fix is right for that reason, not because a reconciliation was wrong.

The FIX stays: a refresh costs one round-trip and keeps the client honest. It was the
**justification** that was wrong, and a wrong justification for a right fix is how the
next person learns to trust reasoning that happens to be correct for the wrong reason.

## What the sweep establishes

- The POS shift is not refreshed after a sale, and that is safe — nothing reads its
  money fields before the close.
- The one place a stale shift could have mattered, a client-side reconciliation, does
  not exist in this codebase; both screens defer to the server.
- `usePosShifts` exposing no refresh is therefore a deliberate-looking absence rather
  than an oversight, and no function was added for a caller that does not need one.

## Verification

- **Full suite: 811/811 files, 12,889 passed, 0 failed** — no code changed this round.
- The round-118 record edit is docs-only; `generate-records-index.mjs --check` exits 0.

> last audited 18-10-26 by autonomous-goal-round-120
