# The :303 assertion chases a class that no longer exists — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 169 - status: the round-167 scroll
     defect is ESCALATED (hypothesis space exhausted, three structural candidates refuted);
     1 SOLID finding delivered: the second failing assertion is unambiguously stale - branch:
     0.0.41 - commit: none (no production file changed) -->

<!- - Scope: round 168 said the next probe must be structural and that a third failed round
     means escalate rather than grind. Both halves were honoured. -->

## Finding 1 (SOLID): `:303` queries a class that does not exist

`measureHistoryTier` (`narrow-shell.spec.ts:160`) throws
`'sales-history tier surfaces missing'` when any of three selectors is absent. One of them is
`.sales-history-filter-group`. Measured against the whole tree:

```
grep sales-history-filter-group ui/src  ->  0 hits
```

The only `filter-group` in `ui/src` is `log-filter-group` (Audit Log, a different screen). So
the element is not missing at THIS viewport — it was **deleted** by `f5772454c`, the same commit
that replaced the wrapped filter design with the compact scrolling bar. Its successor is
`.sales-history-search-group` (`SalesHistoryScreen.tsx:1229`).

That settles the question round 167 raised as needing an owner decision. `:303` does not need a
judgement about which design is right — it is querying a removed class and cannot pass against
any rendering of the current screen. Its other expectations (`min-width: 0px`, the input taking
the whole row) describe the same superseded design; `min-width: 0` now appears nowhere in
`SalesHistoryScreen.css`.

This is a test-only repair (update the selectors and expectations to the shipped compact bar, or
delete the case if the property it guards no longer exists) and it is now specified rather than
speculative.

## Finding 2 (ESCALATED): the 197px scroll range — hypothesis space exhausted

Round 168 tabulated 14 `overflow`/`contain`/`min-width` candidates. This round took the
structural route it named, and the three candidates it implied are all refuted:

**The rendered ancestor trees differ, and it does not matter.**

```
RETAIL        retail-pos -> workspace-fullscreen (ovx hidden) -> body
SALES HISTORY sales-history -> app-content-inner (ovx VISIBLE) -> app-content (hidden)
```

So retail has an immediately-clipping parent and sales-history has a `visible` wrapper before
its first clipped ancestor — a real structural asymmetry, and the obvious suspect. Refuted:
wrapping `.sales-history` in a plain `overflow: hidden` div, and in a real
`.workspace-fullscreen` element, both leave `scrollX 197`. Setting `display: block`,
`min-width: 0` or `max-width: 100vw` on `app-content-inner` also all leave 197.

**Width is not the cause either.** Retail's overflowing scrollers are 192px wide; the
sales-history bar is 452px. Narrowing the bar to 192px — retail's exact width — still leaks
197. Setting it to 400px: 197. `100%` + `border-box`: 197.

**And the containment is already correct.** `.sales-history` reports
`scrollWidth == clientWidth == 480` in every state tested, and `document.body.scrollWidth` is
480. Only `document.documentElement.scrollWidth` is 677.

Combined with round 168's finding that the page does NOT auto-scroll (`scrollX 0` on load,
`activeElement BODY`, still 0 after 1.2s), the honest summary is: **there is a 197px scroll range
on the document that nothing observed triggers, from a source that is not ancestor overflow, not
container width, and not any `overflow` or `contain` value on the boxes involved.** That is a
narrower and stranger statement than round 167 made, and I am not going to guess a declaration
for it to close the round.

## Why I stopped here

Three rounds on one defect with no fix is enough. My round-168 carry-forward set the rule — do
the structural probe, and if it fails, escalate instead of burning a third round — and this
round both ran it and honoured the rule. The remaining value is in the escalation being CLEAN:
the refuted space is tabulated (14 declarations last round, 6 structural edits plus 4 width
edits this round) so whoever picks it up does not re-walk any of it.

A hypothesis worth recording for that handoff, offered as a suspicion and NOT as a finding: the
root scroll range may come from the `position: fixed` overlay this sheet carries (the detail and
void modals) interacting with `container-type: inline-size` on `.sales-history`. The sheet's own
comment at `SalesHistoryScreen.css:12-17` records that fixed descendants are "safe here" against a
`container-type` box, measured 2026-09-22 — but that measurement checked the box's CONTENT
rect, not whether a fixed child can extend the ROOT scroll area. Untested; named so the next
attempt starts there rather than on overflow again.

## Evidence

- `grep sales-history-filter-group ui/src` -> 0 (the solid finding; the only `filter-group` hits
  are `log-filter-group`). Successor class confirmed at `SalesHistoryScreen.tsx:1229`.
- 5 probes this round, all deleted; verified 0 `zz-*` remain and both sales-history source files
  clean against HEAD.
- The refutation table is measurement output: wrapping in `overflow: hidden` and in
  `.workspace-fullscreen` -> 197 each; bar at 192px/400px/100%-border-box -> 197 each.
- **No production file changed.** Nothing to commit but this record.

## Carried forward

1. `:303` is now specified: update the selectors (`sales-history-search-group` replaces
   `sales-history-filter-group`) and the expectations to the compact bar, or delete the case.
   This is a contained change I can land next round if nobody owns it.
2. Do NOT re-test `overflow`/`contain`/`min-width`/`width` on the bar or its ancestors, and do
   NOT re-test the ancestor chain or the clipping wrapper. All refuted and tabulated.
3. The next scroll probe should target the fixed-position overlays as the suspicion above
   states.

> last audited 18-10-26 by docs-auditor
