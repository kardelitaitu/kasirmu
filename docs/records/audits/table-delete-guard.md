# The delete guard that protects a table mid-service (round 194)

## Why this round

Round 193 made the release confirmation reachable by seeding a bill from the spec itself. That
fixture answers a second question the same detail panel raises, which nothing had asked: **what
happens when an operator presses Delete on a table that is in use?**

The answer is at `TableManagementScreen.tsx:1194`:

```tsx
<Button
  data-testid="tables-delete-table-btn"
  disabled={Boolean(activeBill || selected.status === 'occupied')}
  onClick={() => setShowDeleteConfirm(true)}
>
```

Not a prompt — a **disabled control**. Deleting the table a guest is sitting at would take the
floor plan out from under an open service, so the guard stops the action rather than confirming
it. That is a stronger property than a confirmation and worth its own case.

## What is pinned — 8 passed (4 cases x desktop/tablet)

Two cases were added to `restaurant-table-release.spec.ts`:

| Case | Asserts |
|---|---|
| occupied table cannot be deleted | the Delete button is present but DISABLED, and no confirmation banner exists — the guard blocks upstream, which is what makes it a rule rather than a prompt |
| available table can be deleted | the inverse: Delete is enabled, opens its confirmation, and the table survives until the confirmation is accepted |

The second half matters as much as the first. A guard that disabled Delete for EVERY table would
pass the first case and make the screen unusable — the pair is what pins the condition rather
than the button.

**Kill-tested**: replacing the gate with `disabled={false}` fails the occupied case. Restored,
byte-identical to HEAD.

## Verified

| Item | Result |
|---|---|
| Spec | 8 passed |
| Kill-test | 1 failed, the intended case |
| `TableManagementScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,703 passed |

## Table coverage after two rounds

| Surface | State |
|---|---|
| table form + Save gate | rounds 165, 167 |
| floor plan live | round 177 |
| release confirmation | round 193 |
| delete guard | round 194 |

The destructive edges of this screen are now pinned in both directions, which is where the
operator cost of a regression is highest.