# Reachability, not position: a measurement error in my own layout probes

**Date:** 2026-10-16
**Scope:** the ad-hoc live-DOM usability probes used across rounds 208-213.
**Verdict:** the probe methodology was wrong and is corrected here. No product defect existed.

## What I measured, and why it was wrong

The probes counted a control as "offscreen" when its bounding rect fell outside the
viewport:

    if (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1 || ...)

On a normal app that reads fine. On a long **scrollable** settings pane it produces a
confident false positive, and it did: the Receipts screen reported **7 offscreen controls**
— `Choose Logo`, several `resto-switch-btn` toggles, and three `ssel-trigger` dropdowns.

The screen is simply taller than the viewport. Measured on the tablet project (1024x1366):

    .restaurant-settings-main   scrollHeight 3202   clientHeight 1303   scrollTop 0

Those controls sit *below the fold in a scroll container*, which is correct and expected
for a long settings page — not a layout defect. **A control outside the viewport is not
unreachable; it is merely unhit.**

## Proof they are reachable

Scrolling the deepest control (`USB`, the bottom-most `.ssel-trigger`) into view:

| Reading | Value |
|---|---|
| `boundingBox().y` after `scrollIntoViewIfNeeded` | 1056 (viewport height 1366) |
| in viewport | **true** |
| `isEnabled()` | **true** |
| container `scrollTop` | 1899 (it scrolled) |
| `Save`, positive control, before scrolling | y = 7 (pinned in the header) |

## The corrected check

A control is unreachable only when **no ancestor scroll container can bring it into
view** — so the probe now walks the ancestor chain looking for a scrollable box:

    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) { scrollable = true; break; }
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) { scrollable = true; break; }
      n = n.parentElement;
    }
    if (offViewport && !scrollable) unreachable.push(...);

It also skips elements with `offsetParent === null` (genuinely not rendered) while keeping
`position: fixed` ones, which have no offsetParent but are still real.

## Re-run with the corrected check — all four restaurant screens, tablet portrait

| Screen | Unreachable | Sub-44px | Document overflow |
|---|---|---|---|
| Menu Editor | 0 | 0 | none |
| Receipts | **0** (was 7 by the wrong check) | 0 | none |
| Payments | 0 | 0 | none |
| History | 0 | 0 | none |

## Scope correction to earlier rounds

Rounds 208 and 212 reported "zero offscreen controls" for the menu view. That reading was
**accurate for what it measured** — the menu grid does not scroll, so viewport position and
reachability coincide there — but the check could not have distinguished the two. The
restaurant screens were never covered by it, which is why this pass was worth running.
The menu-view conclusions stand; the method is now sound for scrolling surfaces too.

## Lesson

This is the fifth time in the session that a scoped or mis-specified query produced a
confident false result, and the second time the fault was in a probe of my own making
rather than in the product. **Run the positive control before reporting a zero — and when
reporting a non-zero, prove the thing is actually broken before calling it a defect.**
Both directions of the same discipline were needed here: the "7 offscreen" reading was a
non-zero that had to be disproved, not acted on.

> last audited 16-10-26 by docs-auditor
