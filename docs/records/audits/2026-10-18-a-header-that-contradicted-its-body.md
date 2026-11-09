# A component header that contradicted its own body — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 197 · status: swept the 13 comments that
     assert their own test coverage; 12 verified true and 1 was stale, contradicting the file
     own NOTE 50 lines below it · branch: 0.0.41 · commit: b796a6a43 -->

<!-- Scope: round-196 carry-forward — a comment claiming coverage is a claim to verify. -->

## The sweep

Round 196 found one docstring asserting its own coverage while the tests mocked it away. That
raised an obvious question: **how many other comments make that claim?** Grepping for the
phrasings — "pinned by", "the tests pin", "covered by ... test" — found **13** in
`src/features`.

Twelve check out. The class-name claims (`restaurant-grid`, `restaurant-search-input`,
`restaurant-hamburger-*`) all appear in tests; the named-file claims resolve; and the two
counted claims are right too — `CategoryCard.tsx:3` says the tab strip is *"pinned by four
tests"*, and `REP-06` does appear in exactly four test files.

## The one that was wrong, and the shape of it

`MenuItemContextMenu.tsx` line 17 read:

```
// the restaurant-context-* class names and role="menu"/menuitem semantics
// are pinned by RestaurantMenu.test.tsx.
```

**Its own body contradicts it.** Fifty lines below, at `:64`:

```
// NOTE (2026-10-12): these queries used `button[role="menuitem"]`. The
// menuitem role is gone — the container is role="dialog", because a menu may
// only hold menuitem-family children and this popup also holds the colour
// strip (axe aria-required-children).
```

And `:181` sets `role="dialog"`. Confirmed by grep: `RestaurantMenu.test.tsx`
contains **no** `role="menu"` assertion at all — so "menu/menuitem semantics are pinned" was
describing a role this component deliberately stopped using.

**How the drift happened is entirely ordinary.** The header was written when the popup was a
menu. The role changed on 2026-10-12 to satisfy an axe rule, the NOTE was added at the change
site, and the summary at the top was never revisited. The file ended up recording a decision it
no longer followed, in two places that disagree.

The correction names the real coverage instead: the class name
(`.restaurant-context-menu`, `:783`) and the keyboard behaviour that replaced the role
— Shift+F10 focus, ArrowUp/ArrowDown roving, and the walk from the last action into the colour
swatches (`:871-936`). All of that genuinely exists and is genuinely pinned.

## The carry-forward file, resolved without action

`RestaurantShortcutsHelp.tsx` (3KB, one reference) was the last thin file from round 196
scan. It exports a props interface and one component, and contains **no** `useState`,
`useEffect`, `useRef`, `useCallback` or `useMemo` — presentational, like
`KdsMainContent`. Nothing to cover.

## A harness bug that produced five false negatives

My first bulk check of the 13 claims reported five test files as **NOT FOUND**, which would have
been a much larger finding. The cause was mine: `Object.entries([...tests.entries()])` double-
wraps, so the lookup compared against the wrong shape and found nothing. Every "NOT FOUND" was
an artefact.

This is the **fourth** empty-answer-from-a-broken-query this session (filename-scoped glob in
round 195, the unescaped regex class in round 186, and now a double-wrapped entries call). The
pattern is stable enough to state as a rule: **before reporting a negative result, make the
positive control fire.** One known-true claim in the same batch would have caught this instantly —
and in this case the global class-name count did exactly that, which is why I did not write up
five phantom missing test files.

## Verified

| check | result |
|---|---|
| 13 coverage claims swept | 12 true, 1 stale |
| `RestaurantMenu.test.tsx` | **61 passed** |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors; the one extra warning is another lane file, not this one |
| the corrected claim | verified against `:64`, `:181` and a grep of the named test |

## Carried forward

1. The 13-claim sweep is closed: 12 verified, 1 corrected. Do not re-run it without a new reason.
2. **Two comments in one file disagreeing is the detectable form of this class.** A grep for a
   role or symbol the file claims to use, checked against the file actual `role=` attributes,
   would catch it mechanically — worth doing if a third instance appears.

> last audited 18-10-26 by docs-auditor
