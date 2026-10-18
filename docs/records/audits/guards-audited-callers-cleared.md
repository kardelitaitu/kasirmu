# Auditing the guards themselves: two callers cleared, and one that is safe by design (round 300)

## What this round did

Rounds 297-299 each turned on the same question and each found a defect: *when a refusal is added,
ask whether refusing is right at EVERY caller.* This round applied the question to the guards I had
added myself, systematically, instead of waiting for the next instance to surface on its own.

**It found no defect.** That is the result, and it is worth recording as one rather than dressing
up. What follows is which callers were checked, and why each is cleared — because "I looked and it
is fine" is only useful if the looking is named.

## The guards under audit

| Commit | Guard | Blocks |
|---|---|---|
| `7255231e5` (round 6) | close-shift refuses when a tab is outstanding | `handleCloseShiftClick` |
| `ee8b8e23e` (round 5) | create-before-delete on held-cart replacement | nothing — reorders, never refuses |
| `5c629de3a` (round 12) | resume continues, lease left intact | nothing |

Only the first refuses anything, so only it can produce the round-297/299 dead-end shape.

## Its three callers, checked one by one

`handleCloseShiftClick` is referenced from three production sites:

**1. `RestaurantSidebar` — the Close Shift row** (`PosScreen.tsx:1870`).
Refusing is correct: this IS the cash-reconciliation control. An outstanding tab is exactly what
should block it. No further route is needed from here, because the operator asked to reconcile cash.

**2. `PosScreen.handleRequestExit` — Exit Terminal.** This was round 297's defect: Exit diverted
into the guard. Fixed there — Exit is now pure navigation and always available. Verified end to end
by `restaurant-exit-terminal.spec.ts`, which asserts the dialog appears with a tab outstanding AND
that confirming actually leaves.

**3. `CartPanel.tsx:616` — the cart's own close-shift button.** ⚠️ This one had not been examined in
any round, including round 297, which grepped `handleRequestExit` and not the guard's callers.

It is cleared, and the reason is a gate rather than luck:

```tsx
{!sidebarOwnsTerminalActions && (
  <button onClick={handleCloseShiftClick} ...>
```

`sidebarOwnsTerminalActions` is `activeWorkspace === 'restaurant-pos'` (`CartPanel.tsx:441`), and
`CartPanel` is mounted **only** by `PosScreen` (`:1973`, `:2004`) — retail uses its own
`RetailCartPanel` and has no `activeOpenBillId` at all. So:

| Workspace | Button renders? | Can the tab guard fire? |
|---|---|---|
| restaurant-pos | **no** — the sidebar owns terminal actions | n/a — the control does not exist |
| store-pos | yes | **no** — retail has no open tabs, and Exit is always available |

So the third caller cannot dead-end in either workspace, and the round-9 Exit fix is what makes the
store-pos case safe rather than merely unlikely.

## The wider claim, and what backs it

**Applying round 12's rule to the guards this session added: none removes a capability.** Every
refusal has a route out — Exit from the shift guard, Clear from the cart guard, Take Over from the
lease guard, and resume-continues from the round-12 fix.

## End-to-end state of the restaurant surface

Recorded because the accumulated changes across twelve rounds deserve one full measurement rather
than an inference:

| Check | Result |
|---|---|
| **Full UI vitest suite** | **798 files, 12,736 passed, 0 failed** |
| **Restaurant e2e fleet, desktop** | **144 passed, 0 failed** (64 spec files) |
| `npm run typecheck` | exit 0 |
| eslint | 0 |

The unit total is up 8 from the 12,728 measured in round 6, which is the tests this session added;
nothing regressed in the other 12,728.

## What this round did NOT do

No code changed, no test added, no commit beyond this record. A round that reports a negative
result should be explicit that it is one, so the next reader does not go looking for a fix.

## The state of the objective

**Coverage**: the restaurant POS id-coverage axis closed in round 291; the guards added since are
now audited for the one failure mode they can produce.

**Reliability**: three real defects found and fixed across rounds 294-299 (shift close with an open
tab; Exit Terminal dead-ending; resume stealing a lease), plus this session's earlier work on
create-before-delete ordering. All verified at both the unit and browser layer, and the full
restaurant surface is green.

**What is left unverified**: the API-level e2e specs (`api.spec.ts` and the ten skips that gate on
the backend) still need the Docker stack, which this machine does not have. Everything reachable
without it has now been run. That remains the honest boundary: **all UI e2e verified; API e2e not.**

> last audited 15-10-26 by docs-auditor
