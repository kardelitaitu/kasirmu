# Every disabled E2E case re-checked: 14 of them, 13 justified, 1 already corrected

**Date:** 2026-10-16
**Scope:** every `test.fixme` / `test.skip` in `ui/e2e/*.spec.ts`.
**Result:** no further wrongly-disabled cases. The kiosk case corrected last round was the only
one.

## Why this sweep

Last round found that a `test.fixme` I had written rested on a wrong premise: the dev-mock's
feature gate hides the **nav item**, not the page, and a `fullscreen: true` route stays
reachable by hash regardless. That raised the obvious follow-up — **how many other disabled
cases rest on the same reasoning?** Six did, by their own comment text. So each was checked
against the property that actually decides reachability (the `fullscreen` flag), not the
reason it was disabled.

## The inventory

25 non-project-conditional `fixme`/`skip` cases across the suite:

| Group | Count | Verdict |
|---|---|---|
| `api.spec.ts` — guarded on `!serverUp` / `!licenseUp` | 10 | Correct: they need the Docker backend and self-skip without it |
| Feature-gated screens (Tables, Gift Cards, Categories, Loyalty, Void Orders, Sales Dashboard, Menu Engineering) | 6 | **Correct, and now verified rather than assumed** |
| `product.spec.ts` — archived `ProductManagementScreen` | 5 | Correct: the route is no longer registered |
| `adr22-workspace-settings` — marquee selection | 2 | Correct: they run only under the tablet project |
| `restaurant-table-move` — `test.skip(true, ...)` | 1 | Correct: guarded on an absent destination, inside a running test |
| Kiosk | 1 | **Was wrong — corrected last round** |

## The six, verified by measurement

Each was driven at its own route by hash. All seven produced identical readings:

    { home: 1, fullscreenWrap: 0, content: "" }

— the workspace-home wrapper is mounted and no screen rendered, which is the picker fallback.
**The premise that made the kiosk case wrong does not apply to these**: every one is registered
`fullscreen: false`, so with no active workspace it fails the gate at `AppShell.tsx:708` and
cannot be reached. The distinguishing property is the fullscreen flag, and these six do not have
it.

A bare-hash probe is sufficient here because that is the mechanism the disabled cases relied on.
Under a `navigateViaSidebar` path they would open — which is why their assertions remain worth
having under a mock that enables their feature keys, exactly as their comments say.

## The archived group, re-verified

`product.spec.ts`'s five cases target `ProductManagementScreen`, and the disable rests on a
fact that could have drifted since it was written. Re-read at
`features/products/register.tsx:18-22`: the `inventory` route is still absent, the comment
still says the files are "kept for reference but no longer registered as a navigable route".
Justified.

## Empirical close

Running every spec that contains a `fixme` or `skip`:

    product, remaining-workflows, reporting-workflows, retail-workflows,
    adr22-workspace-settings, restaurant-table-move

**22 passed / 14 skipped / 0 failed** — the skipped count equals the 14 `fixme` cases exactly,
so every disabled case is accounted for and none is concealing a failure.

## Lesson

A sweep is only worth running if the property it checks is the property that decides the
outcome. Re-reading the *reasons* would have confirmed all fourteen (they are well written and
one of them was mine and wrong). Driving the *routes* is what separated the kiosk from its six
neighbours, and the answer turned on one registry flag.

> last audited 16-10-26 by docs-auditor
