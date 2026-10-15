# The view-gated split CAN hide a gap, and two guards for it do not bind (round 273)

## The argument round 272 made, and the mutation that refutes it

Round 272's instrument ledger said the view-gated split needs no self-guard because it
"only relabels ids between two printed columns, so it cannot inflate a percentage".

**It inflates the appearance of completeness**, which is what the table is for. Measured: adding a
genuinely OPEN id to `VIEW_GATED`:

```
screen        covered   used   pct
CartPanel      5/10    5/10    50%       <- IDENTICAL to before
```

Every printed number unchanged; `pos-cart-conflict-alert` gone from `missing`; **exit 0**. A reader
sees one fewer gap and nothing indicates the id was reclassified. The column that would have shown
it is the one being trusted.

The distinction round 272 drew — a percentage versus a list — is real and beside the point. **The
gap count is the finding**, and the exemption list is where a gap can be made to disappear.

## Two guards attempted, neither binds

**Attempt 1 — verify the id exists in the named source.**

```python
if gated_id not in gate_text: refuse()
```

**Survived**, because `pos-cart-conflict-alert` IS in `CartPanel.tsx` — it is simply not
relocated. The check verifies presence, not gating.

**Attempt 2 — require the id to appear after the gate marker.**

```python
gated_at = gate_text.find('data-testid="%s"' % gated_id)
if gated_at < 0 or gated_at < gate_text.find(VIEW_GATE_MARKER): refuse()
```

**Survived again**, and the reason is a fact worth keeping: the marker is a **const DECLARATION**
at `:445` (`const sidebarOwnsTerminalActions = activeWorkspace === 'restaurant-pos'`), not the
conditional it feeds. Every testid in the file sits after it:

| Id | Line | After marker |
|---|---|---|
| `deduction-location-badge` | 577 | yes |
| `deduction-override-indicator` | 589 | yes |
| `pos-cart-conflict-alert` | 776 | **yes** |

**A textual proxy for a semantic gate did not work, twice.** Both attempts were reverted;
`scripts/restaurant-coverage.py` is byte-identical to HEAD, healthy, self-test passing.

## What would actually work, and why it was not taken

The gate is the **expression** `!sidebarOwnsTerminalActions` guarding the element's JSX. Checking
it properly means walking the JSX from the testid outward to its nearest enclosing conditional — a
parser, not a regex. **The script's own header says it is a heuristic, not a parser**, and adding a
half-parser to enforce one exemption list is a larger change than the problem justifies this round.

The honest interim is the one this session has used before: **an exemption list that is small,
dated and reviewed by a human**, with the reasoning in the source. Both entries carry that today.
The failure mode is documented here so the next reader knows the list is trusted and not verified.

## Verified

| Item | Result |
|---|---|
| The mutation | hides an open id, changes no printed number, exits 0 |
| Guard attempt 1 (presence) | survived — the id IS present |
| Guard attempt 2 (marker position) | survived — the marker is a declaration, not the gate |
| Restore | byte-identical to HEAD, healthy, self-test passes |
| Source changed | none |
| New tests | zero |

## The instrument ledger, corrected

| Instrument | Guard |
|---|---|
| scan `covered` | `SELF_CHECK_ID` |
| scan `used` | `USED_FLOOR` |
| acceptance `occludedControls` | the spec, proven both ways |
| **view-gated split** | **NONE — and it can hide a gap** |

Round 272 recorded the fourth row as "argued, not guarded". The argument was wrong, **and the
dependency that justified the argument — that a relabelled id cannot hide a finding — is false.**

## The claim this leaves unproven

`deduction-location-badge` and `deduction-override-indicator` are asserted covered-by-relocation
because round 243 drives the sidebar row. **That is a true, tested claim about the CONTROL.** What
is unverified is the script's claim that these two ids *cannot render in the scanned workspace* —
and if they could, the cart-panel rendering would be uncovered and the table says otherwise.