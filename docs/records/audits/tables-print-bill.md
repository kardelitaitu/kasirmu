# Print Bill, and the failure arm the injection seam made testable (round 221)

## Why this round

`tables-print-bill-btn` was the last reachable action on the tables screen after round 220's
edit form. It is the button an operator presses **with a guest standing there**, which makes its
failure arm the interesting half: a print that silently does nothing leaves them handing over a
bill that was never produced.

## What the spec pins — 6 passed, both projects

| Case | Asserts |
|---|---|
| the gate | a FREE table offers no Print Bill at all; a BILLED one does |
| success | the print reports itself |
| failure | an injected failure is REPORTED rather than swallowed |

The first is a pair, on the round-219 pattern: the button is gated on `activeBill` (`:1140`), and
only asserting the billed case would pass on a button that always renders.

## The seam that made the third case possible

`window.__MOCK_FAIL` (`mockDispatcher.ts:100-134`) is a documented failure-injection mechanism,
**re-read on every invoke**, so a spec can arm it at runtime without a reload. Its own docblock
names the reason it exists: some states the UI must survive cannot be reached through the mock's
data, and can otherwise only be covered by a unit test.

**Kill-tested**: swallowing the catch fails the failure case. Restored byte-identical.

## The error this round, and it was a one-word one

The first version armed `['print_sales_receipt']`, and the print **succeeded**:

```
api/sales.ts:985  loggedInvoke<...>('print_sales_receipt_scoped', { ... })
```

The API layer calls the **scoped** variant, and the seam matches on the exact command name. So
the case looked for an error that was never raised — a test failing because it had not created the
condition it was testing. Recorded in the spec's own comment so the next reader does not re-derive
it, and worth stating plainly: **an injected failure that does not fire looks exactly like a guard
that does not work.**

## Verified

| Item | Result |
|---|---|
| New spec | 6 passed (3 cases x desktop/tablet) |
| Kill-test | 1 failed, the failure case |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## Tables coverage, seven rounds on

| Surface | Round |
|---|---|
| form + Save gate (ADD) | 165, 167 |
| floor plan live | 177 |
| release confirmation | 193 |
| delete guard | 194 |
| move a tab | 195 |
| toolbar, arrange, assign label | 219 |
| edit form + prefill | 220 |
| **Print Bill, success and failure** | **221** |

What is left there is the section badges and the tab-conflict banner, and the banner needs a
second terminal — the constraint round 216 recorded for its cart-side twin and round 218 did not
dislodge. The screen is otherwise closed.