# The Apply button could be stranded `disabled` after a revision conflict (2026-10-14)

## What CI saw

`ci` run 38539683789, job 115771171869 (PR #121), `ui vitest`:

```
❯ src/__tests__/NodeTopologyEditorDevMock.test.tsx:175:11
     await waitFor(() => expect(screen.getAllByText('Authoritative Branch').length)...
TestingLibraryElementError: Unable to find an element with the text: Authoritative Branch
```

1 failed / 12677 passed. The dumped DOM is the evidence that matters: the editor rendered
with the **FREE TIER** badge, **no canvas nodes**, and the header's Apply button carrying
`aria-disabled="true"`. So the assertion failed because Apply was **disabled**, not because
the reload produced the wrong graph.

## The mechanism

`nodeTopologyEditorSaveState.ts` is a four-phase reducer — `loading | ready | applying |
load-error` — and `busy` is derived as `phase === 'applying'`, which is what disables the
button (`topologyHeader.tsx`: `disabled={!canSave || saving || !onSaveAvailable}`).

The `load-success` arm deliberately preserves an in-flight Apply:

```ts
case 'load-success':
  // A settled reload never interrupts an in-flight Apply (the post-save
  // reload lands while `applying`); it only refreshes the revision.
  return { phase: state.phase === 'applying' ? state.phase : 'ready', revision: action.revision };
```

That is correct for the **post-save** reload and is covered by its own case. The consequence
is that `applying` has exactly **two** exits: `apply-success` and `apply-failure`.

The **conflict** path in `nodeTopologyEditorApplyPanel.ts` dispatched both of its updates in
one tick, in the wrong order:

```ts
failApply();                       // apply-failure -> ready
setReloadKey((k) => k + 1);        // triggers the load effect
```

React batches those. The reload's `load-success` is dispatched from the load effect's promise
chain, and against the **dev-mock** that promise settles with **no network** — so it can be
flushed inside the same window, before the `apply-failure` state update is observable. When
it wins, `load-success` sees phase `applying` and **preserves** it. The button is then
disabled with no path back to `ready` for the rest of the test.

## Why it is a race and not a deadlock

`apply-failure` IS an exit, so if the dispatch is merely ordered after the reload the phase
still recovers. The stranded state needs the failure dispatch to be **lost** relative to the
reload — which is what the batched ordering allows. Both halves are now pinned in
`nodeTopologyEditorStateMachines.test.ts`, so a future edit that reorders the caller fails
there rather than in CI.

## The fix

Write the failure **first**, and defer the reload by one tick so no load can race it:

```ts
failApply();
skipNextLoadRef.current = false;
setTimeout(() => setReloadKey((k) => k + 1), 0);
```

The comment in the source states the ordering requirement and why, so the next reader does not
restore the batched form as a tidy-up.

## Reproduced locally: NO, and that is recorded rather than glossed

**16 local runs pass** — 12 of the failing file alone, 4 with its sibling topology suites at
the config's own 24 threads. The failure was not observed here. What identifies the mechanism
is the CI DOM dump (Apply `aria-disabled`, no nodes) plus the reducer's documented
load-success behaviour; the interleaving is stated and pinned, not observed.

So the honest claim is: **a real ordering defect, pinned by test, whose exact CI trigger is
inferred rather than reproduced.** If CI still fails after this, the next suspect is the
`settled`/`load-error` interaction, not this path.

## Verified

| Item | Result |
|---|---|
| `nodeTopologyEditorStateMachines` | 76 passed (2 new cases pin the interleaving) |
| Affected topology suites, 6 consecutive runs | 242 passed, 0 failures |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | **787 files, 12,680 passed** (3 skipped, 3 todo) |
