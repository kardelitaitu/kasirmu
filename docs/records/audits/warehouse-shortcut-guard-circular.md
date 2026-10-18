# A guard that asserted A ⊆ A: dead warehouse shortcut keys, and the test that could not see them

**Round 25 · 2026-10-11 · warehouse POS · UI**

## The circular guard

`warehouseShortcutParity.test.tsx` had a test named:

> *"every active shortcut must have a keydown handler (listed in ACTIVE_SHORTCUT_ACTIONS)"*

It compared `ACTIVE_SHORTCUT_ACTIONS` against `WAREHOUSE_SHORTCUTS`. But that set is
**derived from** that same manifest:

```ts
// warehouseShortcuts.ts:61-63
export const ACTIVE_SHORTCUT_ACTIONS = new Set(
  WAREHOUSE_SHORTCUTS.filter((s) => !s.placeholder).map((s) => s.action),
);
```

So the assertion was **A ⊆ A** — true by construction, for every possible edit to
`WarehouseConsole`. The test's own comment admitted the scope (*"This test asserts the
manifest side is correct"*), which is honest, but the test's *name* claims the handler
is checked. Nothing was.

**Measured, not argued.** I deleted the real `case 'print':` handler from
`WarehouseConsole.tsx` — killing F5 outright — and all **nine** tests in the file stayed
green.

## What that hid: two dead keys

With the guard unable to fail, the handler had drifted from the buttons:

| Key | FnBar button does | keydown case did |
|---|---|---|
| F5 | `addToast({type:'info', message:'Print'})` | `e.preventDefault(); break;` |
| ? | `addToast({type:'info', message:'?'})` | `e.preventDefault(); break;` |

Both keys were **advertised on their buttons** (`aria-keyshortcuts`) and listed in the
help overlay, and both were silently swallowed. Probe on the rendered console, with the
button click as the baseline:

```
PROBE afterButtonClick alerts= 1  texts= ["Print03:41:26 AM"]
PROBE afterF5       alerts= 1  changed= false
PROBE afterQuestion alerts= 1  changed= false
```

The button announces; the key does not. This is the retail-F4 shape again from the other
side: an advertised affordance that does nothing.

## The fixes

1. **The two keys call the same functions as their buttons.** `handlePrint` and
   `handleShowHelp` are now defined once and passed to both `<WarehouseFnBar>` and the
   switch cases, so the paths cannot drift again.
2. **A behavioural test that can fail.** `warehouseShortcutWiring.test.tsx` renders the
   console, clicks the FnBar button advertising a key to establish the baseline, then
   fires the key and requires its own announcement:
   `expected 1 to be greater than 1` on the old code, with the message
   *"${key} produced no announcement; the button advertising it did"*.
3. **The circular test is now labelled.** Its comment records that it cannot fail, names
   the measurement, and points at the file that does the real check — rather than being
   silently deleted, which would lose the manifest-integrity checks it *does* provide.

## Verification

Both new tests were written failing-first and failed on the assertion above.

**Both fixes kill-tested**, since the tests went green after the code changed:

| Kill-test | Result |
|---|---|
| restore `case 'print':` to `preventDefault(); break;` | test 1 → **red** |
| restore `case 'shortcut-list':` likewise | test 2 → **red** |

ESLint then caught a real stale-closure risk I introduced: `handlePrint`/`handleShowHelp`
were read inside a `[]`-dep keydown effect. Added to the dependency array (both are
`useCallback`-stable on stable `addToast`, so the listener cannot churn).

- `warehouseShortcutWiring.test.tsx` + `warehouseShortcutParity.test.tsx`: **11 passed**
- `npm run typecheck` clean; ESLint **0 errors**
- `renderWithProviders` needed `WarehouseConsole`'s full provider tree, so the
  behavioural tests live in their own file rather than widening the manifest test's
  deliberately minimal mocks.

## Method notes

- **A test whose expectation is computed from the value under test is not a test.** The
  tell was structural: `ACTIVE_SHORTCUT_ACTIONS` is used *both* to filter in the
  handler (`WarehouseConsole.tsx:242`) and as the test's expected set. One input, two
  roles, zero information.
- The cheapest way to expose it was to **delete the code the test claims to protect and
  re-run**. That took one edit and settled a question that reading the assertions
  left ambiguous. Worth doing to *every* source-parsing guard in this tree, which is
  where round 24 found the same class of gap.
- Two keys drifting identically (`print`, `shortcut-list`) is a signal: the two cases
  were written together as "preventDefault and leave the real work to the button", a
  design that only works if the button is the sole entry point. Fixing them by sharing
  one function removes the class rather than the instance.

> last audited 16-10-26 by docs-auditor
