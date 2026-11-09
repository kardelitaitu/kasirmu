# A failed per-item KDS write was silently dropped, one line from a path that reported it

**Date:** 2026-10-11 · **Round:** 47 (session) · **Status:** FIXED (both screens)
**Area:** `ui/src/features/kds/KdsScreen.tsx`, `ui/src/features/kds/ExpoScreen.tsx`

## The two taps on the same ticket

Both KDS screens let the cook advance a whole ticket **and** a single dish on it. Before
this round the two taps had opposite failure behaviour, one line apart in the same file:

| Tap | Write | On failure |
|---|---|---|
| ticket (`advanceStatus`) | `updateKdsStatusScoped` | via `wrapUpdate`: queued for retry, optimistic status projected into the offline cache, **`kds-offline-queued-update` banner raised** |
| dish (`advanceItemStatus`) | `updateKdsLineItemStatusScoped` | bare `try/catch` with an **empty body** |

`KdsScreen.tsx:250-258`:

```ts
    } catch {
      // Silent — the backend will emit kds:orders-changed on next poll.
    }
```

`ExpoScreen.tsx:306-316` was identical, and the evidence was inside the same file — `:300-302`
reported the ticket failure through `setActionError(...)` while `:314` swallowed the item one.

## Why the comment was wrong, not just terse

"The backend will emit `kds:orders-changed` on next poll" repairs the **display**, not the
**write**. A poll re-reads the board; it cannot tell the server about a dish the cook marked
done. So the failure mode was: the cook taps "this dish is done", the status dot does not
move, and nothing on screen says why. The natural response is to relaunch the app or tap
harder — and the dish's real state stays unknown to the front of house.

## Fix

Both item catches now report, each through the surface its own screen already owns:

- **`KdsScreen`** — `setError(requiredLocalized(l10n, 'kds-offline-queued-update'))`. The
  offline queue is keyed on `(orderId, targetStatus)` with no item-level action type, so it
  cannot be reused verbatim here; the operator needs the same *signal*, so the same string
  is reused rather than inventing a second wording for one situation.
- **`ExpoScreen`** — `console.error(...)` plus `setActionError(l10nErrorMessage(e, l10n,
  'kds-error-update-failed'))`, mirroring the ticket path immediately above it.

## Evidence

**Render test** (`KdsScreen.test.tsx`) — *TELLS THE KITCHEN when a per-ITEM status write
fails, instead of swallowing it*. It drives the real item tap with a rejecting
`updateKdsLineItemStatusScoped` and requires an operator-facing message. **RED before the
fix**, with the captured DOM showing exactly the silent state: `1×BurgerPending` — the row
unchanged after the failed tap, no banner anywhere.

Kill-tested by deleting only the `setError(...)` call: red again, green on restore.

**Structural guard** (`kdsItemStatusFailureIsReported.test.ts`) — pins both screens and
fails if a catch wrapping a line-item write has no `setError`/`setActionError`/`addToast`. It
also asserts the scan is not vacuous (both files must still reference the API), so a rename
cannot turn it green. **Kill-tested twice** — see below.

- `KdsScreen.test.tsx` **58 passed** (was 57)
- KDS quartet (`KdsScreen`, `ExpoScreen`, guard, `KdsStatusAdvance`) **93 passed**
- full UI suite **807 files, 12,808 passed**
- `typecheck` clean · `eslint` no new findings · no i18n changes

## Two things this round is worth recording for

### The first version of the guard was satisfiable by prose

The kill-test initially passed *with the fix removed*, because the fix's own comment names
`setActionError` — and the guard was matching the comment. The guard now strips comments
before matching, and was re-kill-tested to confirm it catches the deleted **call**. A guard a
sentence can satisfy is not a guard.

### My own change broke a pre-existing gate, correctly

To drive the item tap I added `listKdsLineItemsScoped` to the `@/api/kds` mock. That key
exists **nowhere** in the codebase, and `mockSurfaceStatic.test.ts` — which forbids *a dead
mock key whose live twin is also absent*, precisely the shape that leaves a real call
unmocked — failed and named the file. Two tests red, straight to the cause, both fixed by
removing one line I did not need. Worth stating plainly: the gate worked, and the failure was
mine.

### Why `updateKdsLineItemStatusScoped` was never mocked

The `@/api/kds` mock in `KdsScreen.test.tsx` covered the queue, the ticket status, and the
product-picker writes, but not the per-item write. So no test in that file could ever drive
the item tap — the same blind spot that hid round 46's hardware-load lockout behind a green
suite of 50 tests. Both rounds point the same way: **a failure path with no fixture is a
failure path with no coverage**, and the suite's pass rate says nothing about it.

## Related

Round 46's finding (`hardware-load-failure-pinned-save-shut.md`) was also a pair of adjacent
paths where one reported and the other was mute. Two rounds have now turned up the same
shape in different features, which is the argument for the class-level sweeps rather than
more file-by-file reading.

> last audited 11-10-26 by docs-auditor
