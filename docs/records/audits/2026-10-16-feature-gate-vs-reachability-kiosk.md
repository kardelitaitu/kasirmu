# The feature gate hides the nav item, not the page — a wrongly disabled kiosk case

**Date:** 2026-10-16
**Scope:** `ui/e2e/retail-workflows.spec.ts`.
**Result:** one case re-enabled and green. **My own earlier disable was wrong**, and the
distinction it missed is worth keeping.

## What the kiosk probe found

Driving the kiosk at tablet portrait (1024x1366) — the orientation a customer-facing kiosk
actually runs in:

| Reading | Value |
|---|---|
| Product cards | 45 |
| Category chips | 13 |
| Dine-in / takeaway controls | 2 |
| **Staff chrome leaked to customers** (sidebar, topbar, statusbar, memo banner) | **0** |
| Unreachable / under-44px controls | 0 / 0 |
| Document overflow · error boundary · page errors | none |

The `containsStaffUI: 0` is the one that matters beyond layout: the owner ruling is that memos
are internal staff communication and must never display to customers, and the kiosk excludes
all four staff surfaces.

## The correction

`retail-workflows.spec.ts` carried a `test.fixme` on its kiosk case, added earlier in this
session, on this reasoning: `self-service-kiosk` is absent from the dev-mock's enabled set
(`system.ts:744` answers `['sales','inventory','reporting','staff','settings']`), therefore
the screen is unreachable.

**The premise is true and the conclusion does not follow.** The feature key gates the **nav
entry**. `kiosk` is registered `fullscreen: true`, and `AppShell` renders a fullscreen page at
`:669` — *before* the workspace gate at `:708` and independently of the sidebar. A hash
navigation reaches it whatever the enabled set is.

Measured 2026-10-17, desktop project, `#/kiosk`:

    { kiosk: 1, attract: 0, grid: 1, cards: 45 }

which is exactly what the disabled case asserts. Re-instated as a live test.

## The distinction the disabled block did not draw

The sibling `test.fixme` entries in this and the two other workflow specs are **correct**:
their screens (Categories, Tables, Gift Cards, Loyalty, Menu Engineering, Void Orders) are
**not** fullscreen, so with no active workspace they really do fall through to the picker and
cannot be reached by hash. The kiosk is the one that is fullscreen, and it was grouped with
them by the shared reason rather than by the property that decides reachability.

**A feature-gated route is not the same as an unreachable route.** The gate controls what the
nav offers; reachability is decided by the fullscreen flag. Conflating them disabled a test
that would have passed.

## Verification

`retail-workflows` + `remaining-workflows` + `reporting-workflows`: **8 passed / 7 skipped /
0 failed** (was 7 passed / 8 skipped / 1 failed). `tsc --noEmit` clean, `lint` 0 errors.
Committed `221b1ef03`.

> last audited 16-10-26 by docs-auditor
