# The kitchen chit is reachable, and the label is not its control (round 265)

## Round 264's question, answered

Round 264 established the gate is `hasKdsFeature && kitchenConnection !== 'disabled'` (`:2853`) with
`hasKdsFeature` **true** — so the chit is blocked by a SETTING this screen owns, not by an
entitlement. That made it a test to write rather than a gap to explain.

**4 passed, desktop and tablet.**

| Case | Asserts |
|---|---|
| the gate | a disabled kitchen printer offers **no** chit test, and configuring one **reveals** it |
| the diagnostic | pressing it reports its own pre-flight result, carrying a code |

**Kill-tested**: dropping the `kitchenConnection !== 'disabled'` clause fails the first case.
Restored byte-identical.

The first case is a pair in the round-230 sense — asserting only that the button appears would pass
on a control that always rendered, and the seeded state is precisely the disabled one.

## The control is the TRIGGER, and the LABEL is a decoy

Round 264's own probe failed here: a `label[for=...]` click timed out. The reason is mechanical and
measured:

```
#resto-hw-kitchen-conn    y 1242, box 1x1      <- the NATIVE select, offscreen
button[aria-haspopup]     three on this screen, reading "USB", "80 mm", "Disabled"
```

`SettingsSelect` (`SettingsSelect.tsx:267-277`) renders a styled `<button aria-haspopup="listbox">`
for the operator and keeps a real `<select>` for form semantics, sized 1x1 and parked offscreen.
**The `<label htmlFor>` points at the select, so clicking the label presses nothing.**

That is the opposite of the `role=switch` pattern this session has met seven times — there the
**input** is styled out and the label is the way in. Here the button is the visible thing and the
label is aimed at a hidden select. **Two opposite patterns on the same screen**, and both true.

The trigger is addressed by its ARIA contract plus the value it currently shows, since it carries
no testid — a shape worth recording because it is the third way this session has located a control.

### The three ways a control has been found

| Surface | Handle | Round |
|---|---|---|
| `role=switch` inputs | the LABEL's `htmlFor` — input styled out | 148, 170, 179, 228, 242 |
| `SettingsSelect` triggers | `button[aria-haspopup="listbox"]` filtered by its current text | **265** |
| `role=option` lists | the portal the dropdown opens | 225, 230 |

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed |
| `RestaurantReceiptsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Receipts coverage, behaviourally complete

| Surface | Round |
|---|---|
| save + token guard | 164 |
| preview documents | 178 |
| test print and its ladder | 222 |
| F4 load failure + retry | 223 |
| cash drawer, kitchen chit (preview twin) | 248 |
| memo clearance for the preview column | 255 |
| **kitchen chit (settings side)** | **265** |

What is left on that screen is `restaurant-receipts-back-btn`, `-header` and `-icon` — static
chrome, which is where a screen is worth calling behaviourally closed. **The receipts screen is
there.**