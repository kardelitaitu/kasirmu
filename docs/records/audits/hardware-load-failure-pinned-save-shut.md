# A transient hardware-load failure pinned Save shut for the whole session

**Date:** 2026-10-11 · **Round:** 46 (session) · **Status:** FIXED
**Area:** `ui/src/features/restaurant/screens/RestaurantReceiptsScreen.tsx` — the load-failure banner and Retry

## How this was found

Round 45 fixed a gate that one failure path could open and the recovery path could not
(`eighty-six-persistence-disarmed-by-one-failed-read.md`). This round swept for the same
*class* rather than working file-by-file: enumerate every ref used as a gate, then check
whether each one has a recovery path that repairs state without repairing the gate.

## The defect

`useTerminalHardware` sets `loadFailed` when its IPC read throws and installs DEFAULT
settings in place (hooks/useTerminalHardware.ts:260-268), so a blank card beats no card.
This screen consumes that flag to REFUSE a save:

```tsx
disabled={!dirty || saving || loadFailed || hw.loadFailed || !sessionToken}
```

That refusal is correct — seeding from unconfirmed values would write defaults over the
terminal's real printer config.

**What was missing was any way back.** `hw.loadFailed` is cleared only by a *successful*
load (useTerminalHardware.ts:258), and the only thing that re-runs one is `hw.reload()`.
This screen never called it. Three sibling cards all pair the flag with that call —
`TerminalPreferencesCard.tsx:290`, `WorkspaceRestaurantPosSettings.tsx:440`,
`WorkspaceStorePosSettings.tsx:487` — so this screen was the one out of four that trapped
the operator.

Concretely: one transient IPC failure at mount disabled Save **permanently** for that
session, with no error message (the banner was gated on the *preferences* flag, which was
still `false`) and no control to press. The operator's only recourse was to leave and
re-enter the screen.

### The second gap, in the same control

The screen's existing Retry cleared `receiptInitializedRef` (:1456) but not
`hwInitializedRef`, which guards a SEPARATE effect that copies the hardware profile into
the printer fields (:647). So even once a retry re-read the profile successfully, the
printer fields would keep the failure-era defaults — the profile would land and be ignored.

## Fix

```tsx
onClick={() => {
  receiptInitializedRef.current = false;
  hwInitializedRef.current = false;
  hw.reload();
  setReloadNonce((n) => n + 1);
}}
```

- the banner condition becomes `(loadFailed || hw.loadFailed)`, so a hardware failure is
  now VISIBLE (previously it silently disabled Save)
- Retry clears **both** one-shot guards and re-runs **both** reads

## Evidence

New test in `RestaurantReceiptsScreen.test.tsx`:

> *offers a way OUT of a failed HARDWARE load, and Retry clears the one-shot hw init guard*

It rejects the first `getHardwareSettingsScoped`, asserts Save is disabled (the trap), then
resolves the re-read and asserts the call happened **twice** and the banner cleared.

**Kill-tested** by removing `hwInitializedRef.current = false; hw.reload();` and leaving only
the prefs retry: `expected "vi.fn()" to be called 2 times, but got 1 times`. Restored → green.

- `RestaurantReceiptsScreen.test.tsx` **51 passed** (was 50)
- full UI suite **784 files, 12,439 passed**
- `typecheck` clean · `eslint` no new findings · `lint:i18n` clean

## Two things worth recording for the next sweep

1. **The suite could not see this** because no test in the file ever passed `terminalId`,
   and `getHardwareSettingsScoped` was not a `vi.fn()` in the `@/api/settings` mock — the
   hardware read was simply never driven. The absence of a failure fixture is what hid a
   permanent-save-lockout bug behind a passing suite of 50 tests.
2. **`dirty` is not a valid proxy for "Save is usable"** here. The first version of this
   test asserted `Save` becomes enabled after recovery and failed: `dirty` is false until
   the operator edits something, so Save is legitimately disabled on a clean form. The
   assertion now checks the banner, which is the actual recovery signal.

## Class sweep result

The round-45 shape — a gate opened in fewer places than the paths that satisfy it — was
checked across every gate-shaped ref in `ui/src`. The remaining `hasLoadedOnceRef`-style
flags (`ProductManagementScreen`, `CustomerManagementScreen`, `CategoryManagementScreen`)
do not gate writes and have no failure path that leaves them stuck, so no further instances
of this defect were found this round.

> last audited 11-10-26 by docs-auditor
