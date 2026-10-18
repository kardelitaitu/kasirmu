# A real double-submit race, and a hypothesis the code disproved

**Round 34 · 2026-10-11 · POS till · async commit re-entrancy**

Fresh angle: async commit handlers that could fire twice before their in-flight flag
lands. The POS's most consequential commits are the ones to check — a price override, a
void, a shift close.

## The real defect: a price override could be applied twice

`PriceOverrideModal`'s PIN step submits through `attemptVerify`, which set `loading` but
guarded nothing at entry. The Enter path checks only `pinSubmitted.current` — and that ref
is set to `true` in the auto-submit **effect**, i.e. after a render. Two Enter presses
inside one frame both see `pinSubmitted.current === false`.

Measured, dispatching two Enter keydowns in a single `act()`:

```
AssertionError: a second Enter started a second login while the first was in flight:
  expected 2 to be 1
```

Two `staffLogin` calls, and `onConfirm` would have applied the new price twice.

**My first test PASSED and the defect was still there.** `fireEvent.keyDown` flushes React
between calls, so the effect had already set `pinSubmitted.current` before the second
keydown. Only dispatching both inside one `act()` — a real double-tap within a frame —
reproduced it. A green test at that point would have closed the investigation.

**Fix:** a synchronous `verifyingRef` guard at `attemptVerify`'s entry. A ref is written
immediately, so it closes the same-tick window that `loading` (batched state) cannot. The
`finally` block releases it, so a wrong PIN can still be retried.

## The hypothesis the code disproved

The same shape looked present in `VoidOrdersScreen`: the Confirm Void button is disabled by
form validity only (`!voidReason || ...`), and `handleVoid` re-checks nothing at entry. I
wrote the failing-first test, and **it passed on the first run** — the button WAS disabled
while in flight.

The reason is `Button.tsx:70-72`:

```ts
const isProcessing = state === 'processing' || loading === true;
const isDisabled = disabled || isProcessing || isSuccess;
```

The button is `<Button loading={voiding}>`, so the shared component disables it. The
`voiding` flag was doing its job through a layer I had not read.

I then checked every committing button in `features/sales` for a `loading` or `disabled`
prop, and all of them have one. The two with neither (`CartPanel:616`'s close-shift and the
`handleClose` buttons) call **synchronous** handlers that only open a dialog, so they are not
re-entrancy hazards.

**The void cases are kept, and their header says they do not reproduce a bug.** The
guarantee is real and nothing else pinned it — no existing VoidOrdersScreen test asserts the
in-flight state, so a future edit that dropped `loading={voiding}` would silently reopen the
gap.

## Verification

| Check | Result |
|---|---|
| PriceOverride guard removed (kill-test) | race case -> **red**; both controls stay green |
| `priceOverrideDoubleSubmit.test.tsx` | **3 passed** (race, single-submit control, retry-after-failure) |
| `voidOrdersDoubleSubmit.test.tsx` | **2 passed** (in-flight disable + single-submit control) |
| related sweep (9 files) | **155 passed** |
| ESLint / typecheck | **0 errors** / clean |

The two control cases matter as much as the fix: one asserts a normal submit still reaches
the server once, the other that a failed login can be retried. A guard that blocked either
would be worse than the race it fixes — the retry one in particular, since a wrong PIN
locking the operator out is a worse failure than a double submit.

## Method notes

- **A passing failing-first test is evidence about the HARNESS before it is evidence about
  the code.** The first PriceOverride version passed while the bug was live; the difference
  was entirely in how the events were dispatched. When a defect was predicted and the test
  goes green, suspect the reproduction before concluding the code is fine.
- **Read the component a prop feeds before blaming the prop's absence.** The void button
  "had no disabled" by my grep and was disabled in fact, because `loading` disables it one
  layer down. The grep measured the source; the behaviour lived in `Button.tsx`.
- **Recording a disproved hypothesis is worth the two minutes.** The next reader who greps
  for "void button not disabled" will find the test file and its header first, which is
  exactly where the correction belongs.

> last audited 16-10-26 by docs-auditor
