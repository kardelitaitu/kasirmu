# Four hypotheses, four negatives — and one untested guarantee worth pinning

**Round 40 · 2026-10-11 · restaurant POS · receipt settings dual write**

Round 39's lesson was that a fix adding state needs its lifecycle audited. Generalising it:
grep every setter called with `(true)` that is never called with `(false)`.

## Three negatives, and why each is correct

**37 one-way flags, and the failure-shaped subset is a single site.** Narrowing to names
containing `fail|error|warn|blocked|unavailable|invalid` left exactly one:
`StaffLoginScreen:133`'s `setFallbackSvgError(true)`. Reading it, that is an image
`onError` fallback chain (primary logo → bundled SVG → icon). Once both images have
failed, staying on the icon is right; a reset would loop. Not a defect.

**`receipt.footer` looked like a control writing a legacy key.** It is not written by hand:
`RestaurantReceiptsScreen.tsx:1246` is an argument to `markSettingsUpdated([...])`, which
announces WHICH keys changed so subscribers refetch. A change-notification, not a write.

**The dual write could have been a lost-update.** The screen writes receipt settings to two
layers, and `showFooter` lives in device-local storage while `footerNote` goes to the
scoped layout. I suspected they could contradict. They cannot, and the code says why at
`:1120` — `footer: showFooter ? footer : ''` folds the toggle INTO the text, so an empty
value already encodes "off". The two stores cannot disagree in a way that prints a
disabled footer.

## The artefact worth keeping

The dual write is **documented and untested**. `:1131-1135` states the contract:

> the SCOPED layout (the layer the printed receipt actually resolves through) ... Skipped
> when no workspace scope was resolved, so the legacy write above remains the sole
> (fallback) writer.

Both mocks existed in the screen's test file but **no case read what either write
received** — the documented guarantee had nothing checking it, the shape this plan has had
to correct repeatedly. Two cases now pin it:

1. The footer reaches **both** layers with the same text.
2. With the show-footer switch off, both get an **empty** value.

## Two harness errors caught before shipping

- My first toggle selector took the first `[aria-checked="true"]` element. This screen has
  **many** `role="switch"` controls, so it clicked the wrong one and failed on an unrelated
  control. Fixed by addressing the switch by its accessible name, and asserting
  `aria-checked` flips `true` → `false` so the empty-footer result is attributable.
- That check is what made the fix trustworthy: without the flip assertion, a test that
  clicked nothing could still have passed if the footer happened to be empty.

## Verification

| Check | Result |
|---|---|
| toggle fold-in removed (kill-test) | -> **red**, `expected 'JANGAN TAMPIL' to be ''` |
| `RestaurantReceiptsScreen.test.tsx` | **50 passed** (2 new) |
| receipt sweep (3 files) | **56 passed** |
| ESLint | **0 errors** — the 5 warnings are pre-existing, lines 42-102 |
| typecheck | clean |

## Method notes

- **Generalising last round's lesson produced three negatives and no bug — that is a
  result, not a wasted round.** Each negative was verified by reading the site, and the
  fourth look found a real untested contract. A class sweep that returns nothing is
  evidence the class is clean.
- **A screen with many similar controls needs accessible-name selectors.** Positional
  `[aria-checked]`/`querySelector` addressing silently targets the wrong one, and the
  failure looks like a product defect.
- **Assert the change you caused, not just the result.** Checking `aria-checked` went
  `true` → `false` is what separates "the toggle worked and the footer is empty" from
  "the footer was empty anyway".

> last audited 16-10-26 by docs-auditor
