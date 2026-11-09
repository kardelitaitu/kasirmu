# My own fix left a warning that could never clear

**Round 39 · 2026-10-11 · restaurant POS · credit settings warning**

Round 38 added a `creditSettingsFailed` flag so a failed credit-settings read would warn
the cashier instead of failing open silently. This round audited that fix.

## The defect, in the code I had just written

```tsx
const [creditSettingsFailed, setCreditSettingsFailed] = useState(false);   // :184

getCreditSettingsScoped(sessionToken)
  .then((settings) => {
    if (!cancelled) setCreditSettings(settings);      // <-- success path
  })
  .catch((err) => {
    if (!cancelled) setCreditSettingsFailed(true);    // <-- failure path
  });
```

The failure flag had **no matching reset**. The effect re-runs on `[sessionToken, open]`,
and its success branch only set the settings — so ONE transient rejection pinned the
warning for the component's lifetime. Reopening the modal, or a later successful read
after a re-login, still told the cashier *"the store's credit limit could not be checked"*.

A warning that cannot clear is worse than the silence it replaced: it trains the operator
to ignore it, and the one time it is true looks identical to the ninety-nine when it is not.

Measured, driving a failed read then a successful one:

```
AssertionError: the credit warning survived a successful reload — it never clears:
  expected <p class="payment-credit-warning">…(1)</p> to be null
```

**Fixed** by clearing the flag in the success branch. A one-line omission with a two-round
pedigree — the fix introduced the state and the reset was never written.

## Three harness detours worth recording

Getting to that assertion took four attempts, each a different gap:

1. `renderWithFluent` in this file is a **local** helper that returned nothing, so
   `rendered.rerender` was `undefined`. Fixed by having it `return renderInAct(...)` —
   which is why no case in the file had ever re-rendered.
2. `rerender` replaces the element, so the **providers** must be re-applied: a bare
   `<PaymentModal>` lost the toast context and threw `useToast must be used within a
   ToastProvider`.
3. The effect most realistically re-runs on a **new session token** (what a re-login
   produces) rather than an `open` toggle, so the case changes `sessionToken`.

None of these changed the defect; all three would have hidden it if I had stopped at
"the test is failing, ship the fix".

## Verification

| Check | Result |
|---|---|
| reset removed (kill-test) | -> **red**, `it never clears` |
| `PaymentModalSaleFlow.test.tsx` | **67 passed** (1 new) |
| payment sweep (3 files) | **109 passed** |
| ESLint / typecheck | **0 errors** / clean |

## Method notes

- **A fix that adds state needs its lifecycle audited in the same round.** `setX(true)`
  without a matching `setX(false)` is a pattern worth grepping for after any flag is
  introduced, and here it was my own change from the previous round.
- **The round-22 lesson recurred in a new form.** Round 22 was "a green failing-first test
  proves nothing"; this is its inverse — a *red* test that is red for a harness reason
  looks the same as one that is red for the defect. Four attempts to reach the real
  assertion, and each failure message had to be read rather than assumed.
- Re-reading my own most recent commit was the highest-yield move available; the previous
  four rounds had each been spent on older code.

> last audited 16-10-26 by docs-auditor
