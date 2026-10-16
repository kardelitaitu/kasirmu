# Three test files for one hook — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 117 · status: NO DEFECT in production;
     1 measured test duplication consolidated (27 cases -> 12) · branch: 0.0.41 ·
     commit: `3df211739` -->

<!- - Scope: executing the expo serve/recall path, per round 116's recommendation to try an
     unexercised flow. Tree verified green at 813/813 (12,905 passed) going in. -->

## The flows were sound

Both directions of the expo pass were read in full:

- **serve** (`advanceStatus`) reports failures through `setActionError`, and the card wraps
  the call in `createCooldownWrapper(..., 200)` (`KdsTicketCard.tsx:273`) — a deliberate
  guard against the accidental double-tap.
- **recall** (`restoreOrder`) is the only BACKWARD transition, and carries a per-row
  `recallBusy` Set: `if (recallBusy.has(order.id)) return` (`:329`) plus
  `disabled={busy}` and `aria-busy={busy}` on the button (`:589-590`).

I first read the absent guard on `advanceStatus` as the round-105 asymmetry — two screens,
same operation, different protection. **It is not**: the two live in different contexts
(a card footer vs a modal list) and each has the guard its context needs. Withdrawn.

I also checked the cooldown's actual limit: it is TIME-based, not completion-based, so a
deliberate second tap more than 200ms later still advances. That is correct — the card has
shown the cook the new status by then, and a cook who presses again is asking for the next
rung, not repeating one.

## What the sweep did find: the hook had three test files

```
useActionCooldown.test.ts     10 cases
useActionCooldown.test.tsx    12 cases
KdsUseActionCooldown.test.ts   7 cases
```

Classifying all 27 case names against eight distinct behaviours showed **four of the eight
asserted in all three files** — "fires on first call", "blocks within the cooldown",
"allows after the window", "forwards arguments" — and exactly **one case unique to any
file** ("does not interfere with a different wrapper instance").

Each deleted file was confirmed a strict subset on BOTH assertion style (call-count only)
and import surface before removal, so nothing was lost. The surviving file carries a header
recording the measurement, the deletion, and where a new behaviour belongs.

## Verification — the arithmetic, because a deletion must prove it removed only duplicates

```
files: 813 -> 811        (2 deleted)
tests: 12,905 -> 12,888  (-17)
deleted files had:       10 + 7 = 17 cases
surviving file:          12, unchanged
```

- **Full suite: 811/811 files, 12,888 passed, 0 failed.**
- **Kill test:** removing the cooldown gate in `createCooldownWrapper` fails 2 surviving
  cases — the consolidated coverage is load-bearing, not merely smaller.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.
- The five other `M` entries under `ui/src/__tests__/` are the session's known
  phantom-modified set — `git hash-object` equals `git rev-parse :`, so they are untouched.

## Standing rule

> A deleted test must be PROVED a duplicate, not assumed one: compare assertion style and
> import surface, then check the suite delta equals the deleted case count. Consolidation
> that cannot show that arithmetic is coverage loss wearing a cleanup's clothes.

> last audited 18-10-26 by autonomous-goal-round-117

