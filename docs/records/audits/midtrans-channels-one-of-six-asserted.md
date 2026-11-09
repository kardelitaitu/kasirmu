# Six Midtrans channels, one asserted, and a template id that hides five (round 291)

## The axis for this round

Rounds 288 and 290 both found controls no test names. This round ran the same instrument over
the remaining restaurant surfaces to see whether the axis was exhausted or merely narrow:

| Surface | `data-testid` literals | Unasserted |
|---|---|---|
| `ui/src/features/sales/**` (CartPanel, CartLineItem, CartActionBar, ...) | 43 | **0** |
| `ui/src/features/tables/**` (TableManagementScreen) | 21 | **0** |
| restaurant + sales, all ids | 143 | 4 (settings cards and glyphs, all with reasons) |

**Both remaining surfaces are fully covered.** That is the useful result: the id-coverage axis
is now closed across the restaurant POS, not merely on the payments screen. Whatever the next
gap is, it is not "an id nothing asserts".

## What remained, and why it was still a gap

The payments screen's Midtrans card has **six payment channels**, addressed through a TEMPLATE
testid:

```tsx
data-testid={`midtrans-channel-${ch.key}`}     // RestaurantPaymentsScreen.tsx:1394
```

Only `gopay` was asserted anywhere - one `aria-pressed` flip in the
"interacts with Midtrans and Stripe configuration buttons" case. Five channels
(`shopeepay`, `bca_va`, `mandiri_va`, `bni_va`, `bri_va`) were reachable by no test, and
their key strings were typed nowhere.

The template-literal class is the one the coverage scanner itself records getting wrong: round
224 missed `qris-mode-static` because the spec wrote the id as a template literal. An id
derived from data cannot be seen by a scan looking for a literal, so it has to be addressed
by a test that reads the data.

## What the existing assertion could not see

`aria-pressed` flipping proves the button updates. It does not prove the choice survives.
The chips feed:

```tsx
const next = { ...midtransChannels, [ch.key]: !midtransChannels[ch.key] };
setMidtransChannels(next);
updateRailParams('midtrans', { channels: next });
```

That map crosses `handleSave` through the `midtrans: ['channels']` allow-list into the rail
parameters, and the load path at `:447` does `setMidtransChannels(p.channels)` - a wholesale
replace from the seed. **So a toggle that DELETED the key instead of storing `false` would
flip the button correctly, save a map with the key missing, and have the next load re-seed that
channel's default.** For `gopay`/`shopeepay`/`bca_va` the default is `true`, so a merchant who
turned a channel OFF would find it ON again after a reload.

Nothing in the repo would have caught it. `paymentRailsParams.test.ts` proves the allow-list
keeps `channels`, but it calls the sanitizer directly with a literal it supplies itself - it
cannot see what the chip built.

## The test

One case, `derives all six channel chips from the source and persists every one of them`,
which reads the key list AND the defaults from the source file rather than typing either:

1. **The six keys are parsed** out of the array literal, and `.toBe(6)` fails if the parser
   breaks or a seventh channel is added - so a channel cannot be added silently.
2. **Each chip is asserted present and in its default state**, with the default also parsed
   from the `useState` seed. Three channels start ON and three OFF; asserting without knowing
   which would pass against a flipped default (the `guest_count` class this plan recorded).
3. **Every channel is flipped once**, and the expected resulting state is derived from its
   default rather than hardcoded.
4. **The SAVED PAYLOAD is compared with `toEqual`, not `objectContaining`.** A key dropped
   from the map is invisible to a partial matcher and is exactly the shape that re-seeds a
   default. This is the assertion that carries the case.

## Kill-tested against the regression it names

Replacing the toggle's merge with one that deletes the key when turning OFF:

```
- Expected
-   "bca_va": false,
    "bni_va": true,
    "bri_va": true,
-   "gopay": false,
    "mandiri_va": true,
-   "shopeepay": false,
  }
```

**1 failed**, and the missing keys are precisely the three whose defaults are ON - the ones a
merchant would find restored. Restored; `git diff` on the source file is **empty**.

## A note on the process, since it cost four attempts

The first three edit attempts produced a broken file (a test closed prematurely, then a
duplicated block). Each was caught by reading the file back rather than by the test run, and the
final state was verified against git before proceeding. Worth recording because the failure mode
is specific: **inserting a block that already contains its own closing brace after an anchor that
is the last line of a function** leaves the original function's tail orphaned. The fix is to
anchor on the line before the closing brace, which is what worked.

## Verified

| Item | Result |
|---|---|
| New channel case | **1 passed** |
| Kill-test (toggle deletes key) | **1 failed**, then restored byte-identical |
| `RestaurantPaymentsScreen` suite | **48 passed** |
| Restaurant/payment suites | **675 passed, 48 files, 0 failed** (was 673) |
| `npm run typecheck` | **exit 0** |
| eslint on the edited file | 0 |
| Sales surface id coverage | 43/43 asserted |
| Tables surface id coverage | 21/21 asserted |
| Source changed | **none** - kill-test only, restored |

## State of the objective

**Coverage**: the restaurant POS id-coverage axis is closed on all three surfaces measured.
The Midtrans channel set - the last control group addressed through a template id - is now
derived from the source and asserted end to end through the save.

**Reliability**: a dropped channel key now fails a test. That bug would have silently restored
three payment channels a merchant had disabled, on the payment surface of all places.

**Not verified**: e2e. Docker Desktop is still not running on this machine, and the other
session's files (`receiptLogic.ts`, `posDispatchRecord.test.ts`) are still uncommitted in the
same directory - untouched, per the shared-index rules.

> last audited 15-10-26 by docs-auditor
