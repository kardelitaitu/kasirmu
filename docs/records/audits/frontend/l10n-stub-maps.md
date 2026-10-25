# l10n stub maps: why a passing test can still be unlabelled

*Written 2026-11-06 (round 226). Every number below was measured, and each one is
reproducible with the command named beside it.*

## The defect

Production copy moves into Fluent continuously. A move changes one thing the
types do not carry: a literal that was inline becomes
`l10n.getString('some-key')`. A vitest file that mocks `@fluent/react` and
answers `getString` from a **hand-maintained object literal** is not updated by
that move, so `getString` returns the RAW KEY.

Two consequences, and the second is the dangerous one:

* a test asserting English copy fails with `some-key` where `Premium` was
  expected — loud, confusing, but it fails;
* a test that never asserts that string **passes while the UI is unlabelled**.
  An `aria-label` becomes `lsp-nav-aria`; a heading becomes
  `ds-section-colors`.

## Measured population

```
python scripts/check-l10n-test-maps.py
```

* 826 test files read
* hand-maintained maps judged (a run of >= 3 `'key': 'value',` pairs whose
  miss lands back on the id, i.e. `map[id] ?? id`)
* every key a component renders that the map does not carry. The count lives ONLY
  in `scripts/l10n-map-baseline.json`, never in prose: a total written into a
  paragraph is a number nothing will tell you is stale.

Recorded in `scripts/l10n-map-baseline.json` as a ratchet. The gate refuses a
NEW hole, and refuses to stay silent when a known hole is fixed (the baseline
must shrink). Both directions were mutation-tested.

## The anti-pattern this exposed

34 test files contain at least one query whose NAME is a raw FTL key
(`name: 'topology-...'` or `getByText('some-key')`), e.g.

```ts
screen.getByRole('button', { name: 'topology-branch-delete' })
```

`ui/src/__tests__/TopologyScreen.test.tsx` does this 31 times. Its map is empty,
so every string falls through to the id and the queries match. Seeding even ONE
key broke three tests:

```
$ # seed 'topology-branch-delete': 'Delete Branch' in the stub map
Tests  3 failed | 68 passed (71)
```

So that suite passes *because* the UI is unlabelled. Seeding 49 keys broke 23 of
71 tests. Reverting was correct; changing the queries was out of scope.

The gate therefore excludes this case rather than reporting it, and the
exclusion is a known blind spot, not a clean bill of health.

## Repairing one is not the same as proving it

Two fixes attempted this round were **not load-bearing**, and a green suite would
not have told me:

1. `FeatureToggleScreen.test.tsx` was given `lsp-nav-aria` /
   `lsp-workspaces-aria`. But `FeatureToggleScreen.test.tsx:112` mocks
   `LiveSetupPreview` wholesale, so those strings can never render. Test still
   passed with the keys removed. Reverted in `9d42cf17e`.
2. The same file's keys were reachable only transitively, which is why the
   ratchet never saw a hole there in the first place.

The rule: **a fix to a stub map is earned by mutating the map and watching a
test change.** Adding the key and seeing green proves nothing, because the
pre-fix state was also green.

## The ratchet had to be taught to refuse (round 227)

The first version of --write-baseline was a RESET BUTTON, and an independent
audit proved it end to end rather than arguing about it:

    # delete a real key from a stub map, then ask the gate
    gate             -> exit 1   (correctly red)
    --write-baseline -> exit 0   (wrote 595 entries)
    gate again       -> exit 0   OK, no new holes

One command converted a real defect into a known one. A stale-entry check that
the same command clears is not a ratchet. --write-baseline now REFUSES to grow the
set: it prints the new holes, names the file, and exits 1. Growing needs
--allow-growth, a separate token that appears in a diff where a reviewer can see
it. Shrinking stays free, because that is what a repair should do.

Two detector defects were closed the same round, both by widening a matcher that
had been too literal:

| shape | before | after |
|---|---|---|
| lookup[key] ?? key | not a fallback (matched a literal [id]) | recognised |
| vars[key] ?? ... above a real return result || id | short-circuited to none | keeps looking |

The second mattered because SessionLockScreen formats placeholders with
vars[key] ?? ..., and that FORMATTING expression was vetoing the real fallback
eight lines below it; two suites were invisible for it.

A third shape was CLOSED the next round: maps built from an IMPORTED CONSTANT
(topologyEditorTestHarness.tsx TOPOLOGY_EN, whose fallback lives in its
consumers) used to be skipped as "0 maps" -- the gate was blind to its own
motivating case. It is now judged by resolving the identifier to the module
that DECLARES it and scanning the test's direct imports.

Two more detector defects surfaced while proving that, and both matter more
than they look:

- A COMMENT BLOCK SPLIT ONE MAP INTO TWO. Six lines of explanation exceeded
  KEY_BLOCK_GAP and divided a 170-key object into 46 + 71 + 56. The halves then
  reported each other's keys as missing. Deleting only the comment changed no
  behaviour and dropped the count.
- A MULTI-LINE VALUE DID THE SAME. A value on the line after its key starts
  with a quote, so it read as a new entry. That is the likeliest shape in any
  hand-written map and it was invisible.

Both are guarded now, and each is proven BOTH ways: a comment inside a map
keeps it one map, and a }; between two key lines still splits it.

Scoping was the last known limit, and it is now closed. An imported map used
to be graded against the test's DIRECT imports only, while an inline map was
graded against the one-level nested graph as well. That asymmetry was added to
suppress a 169-finding over-report which turned out to be the map-splitting bug
above -- the narrowing outlived its cause and hid real copy.

Measured on one suite: `NodeTopologyEditor` is genuinely rendered, pulls 57
nested modules, and 79 of their keys were absent from the harness map. Both
paths now scan the same graph, and those 79 are in the map.

A rule that two paths through the same gate apply differently is a blind spot,
not a conservatism. The lesson is narrower than "be thorough": the earlier
narrowing was justified by a measurement that later proved to be an artifact,
and nothing re-checked that justification when the artifact was fixed.
## Seeding a map: three ways to get the value wrong

Adding a missing key looks mechanical and is not. Measured 2026-11-07 across
~200 seeded keys, three distinct traps, each of which produced a GREEN test
against a string the UI never renders:

1. **The placeable form is per-stub.** Stubs in this tree substitute either
   `{ $name }`, or `{name}`, or both -- it is whatever the file's own
   `replace()` call does. A value written in the wrong form never resolves, so
   the seeded string still contains `$name` literally. Two suites failed on
   exactly this (`PIN: 0 of 4 digits entered` in SessionLockScreen, `1 / 3
   selected` in CustomReportScreen) because they use the FTL `{ $x }` form.

2. **Flattening strips the braces.** A naive "join the continuation lines and
   drop the punctuation" turns `4 items { $amount }` into `4 items $amount`.
   Nine values were seeded that way and all nine passed their own tests.
   `check-l10n-test-maps.py` now flags a value carrying a `$name` OUTSIDE a
   brace pair for this reason. The first version of that check flagged every
   CORRECT `{ $x }` value -- a false positive on the legitimate form -- so the
   regex is deliberately blind to `$name` inside braces, and a must-not-flag
   case now pins it.

3. **`.attr` messages live on the continuation line.** For an FTL message that
   is only an attribute request (`key =` followed by `  .aria-label = ...`),
   a parse that reads just the `=` line yields an EMPTY string. Eight
   `appearance-*-aria` values were read correctly only because the call site
   was checked first.

4. **The key may not live in the file you are reading.** Grepping one FTL
   file for the key returns nothing and looks like a missing message;
   `sync-conflicts-loading` is in `sync.ftl`, not `settings.ftl`, although every
   neighbouring `sync-conflicts-*` key is in `settings.ftl`. Always search the
   whole `shared-ui/locales/` directory, never a guessed file, or a real key
   reads as absent and gets either skipped or invented.
The general rule: **read the stub before choosing the value.** The stub, not
the FTL, decides which form is correct -- and a test that passes is not
evidence that the value is right, because the assertion may be matching the
unsubstituted literal.
## Commands

```
python scripts/check-l10n-test-maps.py               # the ratchet
python scripts/check-l10n-test-maps.py --self-test   # 4 cases, must exit 0
python scripts/check-l10n-test-maps.py --write-baseline
```

`--write-baseline` regenerates after a repair. The gate exits 2, never 0, when
it reads zero maps — the empty-population refusal exists because the detector's
own bug (an eight-key identity window) silently reported `judged 0 maps` while
looking like a clean run.

> last audited 07-11-26 by docs-auditor
