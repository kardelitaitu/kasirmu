# `createSettingsApiMock` was missing `setSettingScoped` (round 94)

## The gap, and why it was not visible

`mockFactorySurface.test.ts` keeps a ledger of every runtime export a factory mock does
NOT define, so a suite routing through the factory fails at BUILD-named call sites rather
than silently. `setSettingScoped` was listed as a known gap:

```
'@/api/settings <- createSettingsApiMock': [
  'getDeploymentInfo', 'getHardwareSettingsScoped',
  'getSetting', 'onSettingsUpdated', 'seedDefaultRolesScoped',
  'setSetting', 'setSettingScoped', 'setSettingsScoped',   // <- 8 names
],
```

That ledger is honest, and the gap was still harmful. Eight production files call
`setSettingScoped` -- `RestaurantMenu` among them. A suite that mocks the module through
this factory and then triggers a path that writes a setting throws
`[vitest] No "setSettingScoped" export is defined on the "@/api/settings" mock`.

**The throw is at the CALL SITE, and in a React event dispatch it is UNCAUGHT.** In
`PosScreenCoreFlow` it surfaced as:

```
Error: Uncaught [Error: [vitest] No "setSettingScoped" export is defined ...]
  at innerInvokeEventListeners (jsdom)
  at captureCommitPhaseError (react-dom)
```

An uncaught commit-phase error puts the screen into its ERROR BOUNDARY. Every later
assertion in that case then fails against a boundary card -- which is what made a case
report `Unable to find [data-testid="cart-panel-line-item"]` for reasons unrelated to what
it tested.

## Why it stayed hidden

Vitest runs in DECLARATION order by default, and the error only fires when a case reaches
the write path. Cases that did not reach it never threw; the ones that did failed for a
reason nothing in their own text named. `--sequence.shuffle.tests` moved the write-path
case in front of others and made the uncaught error reproducible.

## Fixed

`createSettingsApiMock` now defines `setSettingScoped`, mirroring the real signature
(`api/settings.ts:337`, `(token, key, value) => Promise<void>`), resolving void. The real
one REJECTS on a null token (`:342`); a test needing that passes an override, which is the
same contract `getSettingScoped` documents at `mocks/api.ts:209-213`.

The `mockFactorySurface` ledger entry was REMOVED -- the deletion direction that map is
built to force a visible edit for, and it failed the suite until the entry was deleted.

## What this did NOT fix

**Two shuffled seeds still fail** (`--sequence.shuffle.tests --sequence.seed=2` and `=13`),
on `ignores a slower course-firing read from the previous store`:

```
AssertionError: the scanned product never reached the cart
```

Instrumented, and this is where it stands:

* `handleBarcode code=BARCODE-CF` DOES fire -- the scan reaches the handler exactly once;
* the lookup implementation the case installs is never reached by the probe, so the call
  does not get that far, or a different implementation is in force;
* the barcode scanner's `onProductFound` is a SINGLE module-level slot, so a stale
  registration is a live hypothesis -- gating the scan on a fresh registration was tried
  and did NOT change the outcome, so it is not the whole story.

Seeds 7 and 99 pass. Left as an open finding rather than papered over: the two-round
investigation removed a genuine defect (this one) and did not crack the remaining one.

## Re-verify

  cd ui
  npx vitest run src/__tests__/mockFactorySurface.test.ts
  npx vitest run --sequence.shuffle.tests --sequence.seed=7 src/__tests__/PosScreenCoreFlow.test.tsx