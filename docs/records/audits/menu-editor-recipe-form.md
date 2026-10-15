# The form's recipe route, and the mutation that landed on the wrong line (round 269)

## The scan entry that turned out to be real

Round 266's summary said the menu editor was behaviourally closed. The scan listed
`restaurant-menu-editor-manage-recipe-btn` as missing, and round 258's spec covers it — so the
instinct was to call it round 224's instrument class again and move on.

It is not. Round 258's spec **names that testid in a comment** and drives the OTHER route:

```
the form button       restaurant-menu-editor-manage-recipe-btn   gated on draft.sku (:1590)
the card action       restaurant-menu-editor-recipe-<sku>         no draft needed  (:1710)
```

**Two routes into the same modal, and round 258 covered the second.** A spec that names an id in
prose does not cover it, and the scan was right all along.

## 4 passed, both profiles

| Case | Asserts |
|---|---|
| the route | an existing item's form offers Recipe (BOM), and it opens the editor naming the dish |
| the gate | a NEW item — no sku — offers no such button |

The second is the pair that makes the first a check: a button that always rendered would pass the
first alone, and the gate exists because a bill of materials cannot attach to an item that has no
identity yet.

## The kill-test that taught the round's real lesson

The first mutation **survived**: I replaced `{draft.sku && (` and the tests kept passing. Restoring
left the file `DIFFERS` from HEAD, and a second look found **two** occurrences of that exact string
— `:1245` (the SKU *badge*) and `:1590` (the button).

`String.replace` takes the **first** match. **The mutation had removed the badge's gate and called it
a kill-test of the button's.**

Editing the specific line instead bound immediately. So:

1. a mutation that should bind but does not is **as likely to be a no-op as a proof of
2. a restore that reports `DIFFERS` means the mutation is still in the file, whatever the
   replacement was supposed to be.

The round therefore has two lessons rather than one, and the second is cheaper to learn:
**verify a mutation landed by reading the line it landed on**, not by trusting the substitution.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test (line-precise) | 1 failed |
| Kill-test (first-match) | survived — the mutation landed on the wrong line |
| `RestaurantMenuEditorScreen.tsx` | restored, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Menu editor coverage

| Surface | Round |
|---|---|
| bulk controls | 184 |
| category rule | 185 |
| filters | 186 |
| modifier groups persist | 210 |
| recipe, card route | 258 |
| sort | 266 |
| **recipe, form route** | **269** |

What remains on that screen is the title and icon — static chrome, unchanged from round 266's
assessment. **The editor is closed, and the gap round 267 named was found by measuring the
summary rather than restating it.**