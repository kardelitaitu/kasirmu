# The KDS and Tables rows are feature-gated, and the preview does not enable them (round 262)

## What the round set out to check

Round 261 closed `CartPanel` by declaring its remaining three ids architecturally blocked: two
need a second terminal, and `pos-cart-kds-btn` is absent by design in the restaurant tier on the
strength of `sidebarOwnsTerminalActions`.

Applying this session's own rule - a blocked claim is a measurement waiting to be made - this round
checked it. The claim was right in its conclusion and incomplete in its reason, and the
incompleteness matters for whoever picks it up next.

## What was measured

`pos-cart-kds-btn` navigates to the KDS screen:

```tsx
onClick={() => onNavigate?.('kds')}   // CartPanel.tsx:688
```

So the useful question is whether the JOURNEY it offers is reachable another way. It is not:

```
the sidebar, genuinely open (aria-expanded=true, 9 rows):
  close-shift, history, menu-editor, receipts, payments, settings, drawer, lock, exit
  - NO Kitchen Display row     - NO Tables row
```

Both are gated on the same `isEnabled(...)` expression, and the feature flags behind them are not
enabled for this profile in the dev-mock.

## The reason, and why it is not a defect

`PosScreen.tsx:1813` and `:1831-1833`:

```tsx
showTables:          isEnabled(FEATURES.TABLE_MANAGEMENT),
showKitchenDisplay:  isEnabled(FEATURES.KITCHEN_DISPLAY) &&
                      isPageAccessible(getPage('kds'), session?.role_name ?? '', ...)
```

**That expression is already pinned** by `ui/src/__tests__/kdsRowFeatureGate.test.ts` (round 128),
which pins the symmetry AND pins that the `isPageAccessible` half is inert for this route - so the
feature flag is the gate that actually varies. The flag is the entitlement; the preview's session
does not carry it. **Nothing is broken: the row is hidden because the plan does not include it.**

What that means for coverage is that `pos-cart-kds-btn` is DOUBLY gated - the workspace branch round
261 recorded, and the feature entitlement this round found - which is why it has never been
reachable in any spec across this session's 262 rounds.

## A probe that reported a false negative, and the round-260 rule catching it

The first measurement of this round concluded `TABLES_ROW=0` and read it as evidence that the sidebar
had no tables row at all. The next probe showed why: `aria-expanded` was still `false` - **the sidebar
had never opened**, so of course nothing was in it.

`TABLES_ROW=0` was reported as a fact about the screen when it was a fact about the probe. The tell
was the round-245 spec, which drives that same screen to its tables view and passes - so the row
cannot have been missing. **One probe that contradicts a passing spec is a probe to distrust before
anything else**, which is the same reading round 226's taxonomy prescribes.

## Verified

| Item | Result |
|---|---|
| The sidebar, open | 9 rows; neither Kitchen Display nor Tables present |
| pos-cart-kds-btn | gated twice - workspace branch AND feature entitlement |
| The gate expression | already pinned by kdsRowFeatureGate.test.ts |
| Probes | 5, all removed |
| Source changed | none |
| New tests | zero |

## What this settles

`CartPanel`'s uncovered set is now fully characterised rather than merely asserted:

| Id | Why | Actionable? |
|---|---|---|
| pos-cart-conflict-alert + takeover | needs a second terminal - getConflict requires lease.terminalId !== currentTerminalId | no |
| pos-cart-kds-btn | feature-gated AND workspace-gated | no |
| the two deduction ids | relocated to the sidebar by design, covered there | YES - round 243 |

**The screen is closed in the strongest available sense: none of its remaining gaps is missing
behaviour, and every one of them has a named cause.**

## The next round's first step

Nothing on `CartPanel`. The remaining open surface by the same measure is the payments screen's
Midtrans and Stripe credential fields - 17 ids, deliberately deferred twice, and the same question
applies as applied here: are they gated by an entitlement rather than by a missing test?

> last audited 15-10-26 by docs-auditor
