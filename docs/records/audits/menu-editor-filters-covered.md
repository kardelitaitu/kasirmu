# The menu editor's filters, search and form fields (round 187)

## Why this surface

Rounds 163, 165, 184 and 185 covered the editor's item form SAVE, its Save gate, the bulk 86
controls and the category builder. Ten testids were still unread by any spec — among them the
**status filter tabs**, the **search box** and the **form fields**.

Those are what an operator uses to FIND an item before editing it, which makes them the
editor's actual entry point. `Hidden (86)` in particular is the triage view a kitchen lives in
during a service — if 86ing an item put it somewhere un-findable, un-86ing it would be guesswork.

## What the spec pins — 6 passed

`ui/e2e/restaurant-menu-editor-filters.spec.ts`, three cases on both projects:

| Case | Asserts |
|---|---|
| Hidden (86) filter | the tab shows exactly the cards that carry `--hidden`, and every survivor is hidden — a mixed list would mean the filter lies |
| search | narrows the list, every survivor actually matches the term, and clearing restores the whole list |
| form fields | a price is accepted and kept, and the availability toggle flips |

The last also asserts that an edit arms Save — the point of a field is that it changes something.

**Kill-tested**: disabling the hidden branch inside `filterMenuItems` (the shared logic the
screen already uses) fails the filter case. Restored, byte-identical to HEAD.

## A drafting habit that kept biting, and the fix

Two of the three cases initially relied on a literal — a fixture item name, and the search
term. Both were replaced with values READ from the DOM: the hidden count comes from the
rendered cards, and the search term is the first card's own name. A spec that reads its own
fixtures breaks the day they change, and this screen's set already changed once this session.

## Verified

| Item | Result |
|---|---|
| New spec | 6 passed (3 cases x desktop/tablet) |
| Kill-test (hidden branch disabled) | fails |
| `menuEditorLogic.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

## Editor coverage now

Form + Save gate, bulk 86, category builder, filter tabs, search, form fields — the editor is
covered across every operator surface except the icon and colour pickers, which are cosmetic.

> last audited 14-10-26 by docs-auditor
