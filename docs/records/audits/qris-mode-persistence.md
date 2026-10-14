# The QRIS mode control, and the round-183 hazard it now pins (round 191)

## Why this control, on a screen at 7/32

Round 190 covered the custom-rail form and noted the remaining payments testids are
dominated by gateway credential inputs. The QRIS mode segmented control is the last operator
setting there that is neither a credential nor a plain toggle.

Why it matters operationally: static vs dynamic QRIS changes how a sale settles. **Static
shows a fixed EMVCo payload; dynamic issues a per-sale charge.** A till left on the wrong one
either asks every guest to scan a code that cannot carry the total, or issues a charge the
operator did not intend. The setting is stored in the qris rail's `parameters.mode`.

## What the spec pins — 4 passed

| Case | Asserts |
|---|---|
| mode switching | both options render, exactly one is active at a time, and clicking switches the active class |
| persistence | choosing Dynamic arms Save, the save completes, and the qris rail params carry `mode: dynamic` |

## The kill-test is the round-183 hazard itself

The spec exists partly to pin a regression round 183's sanitiser would allow: **`qris` is NOT
on `RAIL_PARAM_ALLOWLIST`**, so its parameters pass through and `mode` survives. If a later
change added `qris: [...]` to the allow-list without `mode`, the control would silently stop
persisting.

Kill-tested exactly that — adding `qris: ['static_qr_payload']` to the allow-list **fails the
persistence case**. Restored, byte-identical to HEAD.

## A second round-179 instance, and the pattern

The first draft read the first scope with a `qris` rail and returned `null` — the
`legal_entity` default also holds a qris rail, has no `mode`, and is enumerated first.
Dumping the slice showed `location:store-1` carrying `mode: dynamic` correctly.

**This is round 179's scope-order bug for the second time, and it is now a named pattern:**
when the mock's rail slice is read, scan EVERY scope for the field you want, and take the
first hit that HAS it — not the first entry that has the rail.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed |
| Kill-test (qris allow-listed without mode) | 1 failed — the intended hazard binds |
| paymentRailsLogic.ts | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |