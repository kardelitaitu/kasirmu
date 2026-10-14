# Thirteen switches, twenty-seven roles, zero missing attributes (round 180)

## Why this round

Round 179 found a `role="switch"` with no `aria-checked` on the cash-drawer-kick toggle. One
instance is a defect; **two would be a class**, and the answer decides whether the restaurant
surface needs a systematic pass or a one-line fix. This round measured it.

## The sweep, and the two false positives that shaped it

First pass, window-matching `role="..."` against a required-attribute table: **14 switches, 0
missing** — and then **2 hits** on `role="tab"` and `role="option"`.

Both were the scanner's fault, and both for the same reason:

| Site | What the scanner matched |
|---|---|
| `MenuCategoryTabBar.tsx:40` | `querySelectorAll('button[role="tab"]')` — a **selector string**, not an attribute |
| `ItemModifierModal.tsx:336` | a **comment** reading *"NOT `role=\"option\"`"* — and the real code at `:342-343` sets `role` AND `aria-checked` correctly |

Round 175's lesson, again: **a regex sees text, not syntax.** Fixed by skipping comment lines
and by rejecting a `role=` whose line position sits inside an odd number of quotes.

## The corrected result

**27 real `role="..."` sites across restaurant, sales and tables. Zero missing a required
attribute.** Every `switch`/`checkbox`/`radio` carries `aria-checked`, every `tab` carries
`aria-selected`.

The second half of the class — controls that LOOK interactive with no role at all — is also
clean: **0 clickable `div`/`span` without `role` or `tabIndex`** across restaurant and tables.

## Conclusion

**Round 179's missing `aria-checked` was the exception, not a family.** The one file with 14
switches sets it on all of them; the one that did not was the single switch written inline
rather than through the shared helper. That is a useful shape to know: the defect appeared
where a control was hand-written beside a consistent set, which is where to look next time
rather than sweeping the whole surface.

## Verified

| Item | Result |
|---|---|
| `role="switch"` sites | 14, all with `aria-checked` |
| All tracked ARIA role sites | 27, **0** missing a required attribute |
| Clickable `div`/`span` without `role`/`tabIndex` | **0** |
| Scanner false positives | 2, both identified and excluded |
| Tree | no source changed this round |