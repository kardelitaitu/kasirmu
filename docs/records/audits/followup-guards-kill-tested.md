# The two follow-up guards from round 171, kill-tested and sound (round 172)

Round 171 classified 28 source-text guards and named two follow-ups it had NOT kill-tested:
`salesLiteralSingleSource` and `tabletWorkspaceGrid`, both single-spelling claims and therefore
the same shape as the weak guard round 170 found. This round closes them.

## `salesLiteralSingleSource` — 6 tests, and it PARSES rather than greps

It has `constantValues` (reads an `export const X = { … }` block's members) and `widgetGates`
(reads `registerWidget({ … requiredPermission … })` calls), so `salestLiteralSingleSource` grades
structure, not text. Plus a vacuity self-check at `:236` — *"the sales feature no longer
registers five widgets - re-measure"* — which is the pattern round 171 identified as the
model's mark.

**Kill-tested**: adding a second literal spelling of `eod-tag-over` to the same file fails
`each eod tag key literal appears at exactly one non-test source site` — the case named by its
own title. Restored, file byte-identical to HEAD.

## `tabletWorkspaceGrid` — 4 tests, and it parses CSS rather than matching strings

It reads `tablet.css` with `bodyInMedia`/`gridSelectorsInMedia`, so the claim is about which
selectors sit inside a media block.

**Kill-tested**: removing the two `.workspace-home-wrapper` selectors from the landscape block
fails **2 of 4** — the case named in its title plus `out-specifies the WorkspaceHome.css width
fallback that also matches`. The second failure is the guard catching the downstream
consequence: the fallback applies at the same time, and the wrapper's two-class selector is
what out-specifies it. Restored, file byte-identical to HEAD.

## Conclusion

Both follow-ups are sound — they parse structure and pass a kill-test. Combined with round 171's
classification, the weak-pattern guard round 170 found looks like the exception rather than a
family: the corpus-grading ones defend themselves against vacuity explicitly, and these two
single-spelling ones bind when mutated.

**The remaining unexamined 25 have been read and classified but not each kill-tested.** That
boundary stands, and is the honest extent of the audit's coverage.

## Verified

| Item | Result |
|---|---|
| `salesLiteralSingleSource` | 6 passed; kill-test **fails** the named case |
| `tabletWorkspaceGrid` | 4 passed; kill-test **fails 2** |
| Both restored | byte-identical to HEAD |
| `tsc` | 0 |
| Full UI suite | 12,688 passed |
| Tree | no source changed this round |