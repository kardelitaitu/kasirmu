# The shared switch component, and why adoption is left to each owner (round 181)

## Following round 180's conclusion

Round 180's finding was a shape, not just a fact: **the missing `aria-checked` appeared where a
control was hand-written outside the shared helper.** This round tested that by finding the
helper the control should have used.

The markup — `<span class=settings-toggle>` / `<label class=settings-toggle-switch>` /
`<input role=switch>` / `<span class=settings-toggle-slider aria-hidden>` — is written out by
hand in **twelve files across three features**:

```
features/restaurant/screens/RestaurantPaymentsScreen.tsx        2 copies (rail, cash kick)
features/restaurant/screens/RestaurantSettingsScreen.tsx        1, behind `SettingRow`
features/settings/**                                             9
```

The two restaurant copies are the interesting pair: the rail switch sets `aria-checked`, the
cash-kick switch did not. **One file, two copies, and only one of them remembered.**

## What landed, and what deliberately did not

`ui/src/components/SwitchToggle.tsx` — 67 lines, one `role=switch` control with the state
exposed both ways, plus `required`-ish defaults for `disabled` and `testId`.

**No call site was migrated, and that is the decision this round records.** Adoption is one
line per site, but twelve sites span three features with three owners. A sweep touching all
twelve at once would be exactly the kind of wide, low-context change that rounds 152 and 175
showed goes wrong; each screen's owner moving its own copy keeps the diff reviewable. What
makes that mechanical rather than per-site re-reasoning is the test file, not the component.

## The tests, and the one that matters

`ui/src/__tests__/SwitchToggle.test.tsx` — **4 passed**:

| Case | Why |
|---|---|
| `aria-checked` follows `checked`, both directions | round 179's defect, pinned |
| reachable and named by role; slider is `aria-hidden` | the raw input is styled out, so the visible sibling must not be announced |
| change reports the new value | the handler contract |
| **disabled keeps announcing its state** | a disabled switch must not become an unknown one |

**Kill-tested**: removing `aria-checked` fails **2 of 4** — the state case AND the disabled
case, because a disabled switch with no state is exactly the silent-control shape.

## Verified

| Item | Result |
|---|---|
| New component | 67 lines, `tsc` and `eslint` clean |
| New tests | **4 passed** |
| Kill-test | **2 of 4 failed** |
| Full UI suite | 12,698 passed (up 4) |
| Call sites migrated | **0**, deliberately — see above |

## The state this leaves

The duplicate markup is still in all twelve files. What is new is that a shared alternative
exists, is tested, and carries a docblock naming the exact defect the duplicates caused — so
the next person touching any of them has somewhere to move to rather than a twelfth copy to
maintain.