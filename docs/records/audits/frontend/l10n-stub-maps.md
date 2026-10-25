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
* 23 hand-maintained maps judged (a run of >= 3 `'key': 'value',` pairs whose
  miss lands back on the id, i.e. `map[id] ?? id`)
* **586 keys** that a component renders and the map does not carry

Recorded in `scripts/l10n-map-baseline.json` as a ratchet. The gate refuses a
NEW hole, and refuses to stay silent when a known hole is fixed (the baseline
must shrink). Both directions were mutation-tested.

## The anti-pattern this exposed

34 test files address elements **by their raw FTL key**, e.g.

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
