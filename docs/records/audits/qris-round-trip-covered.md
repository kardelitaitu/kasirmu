# The QRIS round trip, and bisecting by removal (round 286)

## Round 285's plan, executed

Round 285 named the method: **replace the locator waits with the probe's fixed delay and assert
ONLY the round trip; if it passes, add the guards back one at a time and the failing one names
itself.** That is what this round did, and it worked on the first run.

**2 passed, desktop and tablet.**

## What the minimal version showed

```
COUNT=1     the field IS found with the fixed delay
AFTER=ERR   ... and inputValue() threw afterwards
```

**`AFTER=ERR` was not the save.** The probe that followed measured the save directly:

```
BEFORE_HEADER=1   AFTER_HEADER=1   AFTER_PAYLOAD=1   AFTER_EXPAND_BTN=1
TOASTS=["Settings saved successfully", ...]
VALUE_AFTER_SAVE=PROBE-X
```

The save works, the card stays mounted, and the typed value is still in the field afterwards. **The
`ERR` came from the EXPAND CLICK the minimal probe performed after the save** — the same click
round 285's bisect had already shown collapses the card.

## So three measured facts, and rounds 284 and 285 each mistook one

| # | Fact | Who got it wrong |
|---|---|---|
| 1 | the field mounts LATE — absent when the helper returns, present ~1.2s later | round 284 read the delay as absence |
| 2 | the card is ALREADY expanded; a toggle click COLLAPSES it | round 284 clicked the toggle |
| 3 | **save does not unmount the card** — no reopen is needed at all | round 285 read its own post-save expand click as the save failing |

The third is the one that cost the extra round, and the shape is worth naming: **a probe performed
an action after the step it was testing, and read that action's effect as the step's failure.**

## The spec

Two assertions, and the second is what makes the first mean anything:

```ts
await expect(payload, 'the payload must survive a save').toHaveValue(typed, { timeout: TIMEOUT });
await expect(page.getByText(/saved successfully/i).first(),
  'the save must report itself, or the value above proves nothing').toBeVisible({ timeout: TIMEOUT });
```

**Without the second, the case passes on a save button that does nothing** — the field would simply
keep the local value it already had. That pairing is the round-229/230 rule, applied here for the
fourth time.

**Kill-tested**: dropping the write from `writeStaticQrPayload` fails the case. Restored,
`RESTORED_TO_HEAD`.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | 1 failed |
| `local-payment.ts` | restored, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |
| Probes | 3, all removed |

## Coverage

```
payments      23/32   23/32     6    3
```

`none` is down to **3** on the payments screen: the icon, `stripe-currency-select` and
`stripe-reader-select` — both selects writing through `updateRailParams`, whose allow-list round
183 pins. **Across all seven surfaces the `none` column is now 7, and every one is a glyph, a
title, or a field whose write boundary is unit-tested.**

## The method note

Round 285 proposed bisecting by removal over bisecting by hypothesis, and it was right: the minimal
version isolated the failing step in one run after two rounds of guessing. **The corollary this
round adds is to stop the probe at the step being tested** — an assertion or action placed after it
will be read as its result.

> last audited 15-10-26 by docs-auditor
