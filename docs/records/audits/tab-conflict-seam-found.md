# The tab-conflict "needs a second terminal" blocker is soft, and half of it is proven (round 277)

## What this round set out to do

Round 276 named the honest next step: stop running coverage rounds and test whether the two
second-terminal items could be made reachable, the way `?plan=empty` made the plan-empty state
reachable in round 268.

**The premise of that blocker looked wrong**, and the reason is worth stating plainly: the lease is
not hardware state.

## What the lease actually is

```ts
// useTabLeases.ts:26
let memoryLeases: Record<string, TabLease> = {};   // module-level, this window
```

and the hook's ONLY external write path is a documented DOM event (`:141`):

```ts
window.addEventListener('kasirmu:tabs:lease-acquired', domAcquired);
// domAcquired (:126-132) writes memoryLeases[detail.tabId] = detail, then notifies.
```

which `broadcastEvent` (`:65-81`) dispatches as `CustomEvent(kasirmu:${eventName})` **plus** the Tauri
cross-webview emit. **The DOM half lets a spec simulate the second terminal exactly** — one dispatch
of the event the hook already listens for.

**Measured: it works.** `LISTENER_HITS=1` on a plain dispatch from `page.evaluate`, in a single
browser, on the running app.

So `getConflict`'s `lease.terminalId !== currentTerminalId` guard (`:199`) — cited in four rounds as
the blocker — is not what makes it unreachable. **It is satisfied by construction, because the spec
picks a terminalId that is not ours.**

## The other half, and where the round stopped

The alert's gate is `activeOpenBillId && tabConflict` (`CartPanel.tsx:775`). The first half comes from
a kitchen dispatch (`PosScreen.tsx:1160`), which is an ordinary action — **but its entry point is
gated on a table number**:

```tsx
{hasLines && (Boolean(tableNumber?.trim()) || Boolean(activeOpenBillId)) && (
  <button data-testid="pos-cart-send-kitchen-btn" ... />
)}
```

(`CartActionBar.tsx:210`.)

**So the spec needs a prerequisite round 263's specs already know how to meet** — setting the table
number before dispatching. That is the next concrete step, and it is a step, not a wall.

## Verified

| Item | Result |
|---|---|
| The lease mechanism | module state + a documented DOM event, not hardware |
| A dispatch takes effect | **LISTENER_HITS=1** in one browser |
| The terminalId guard | satisfiable by choosing an id that is not ours |
| The incomplete spec | removed — nothing unproven was committed |
| Source changed | none |
| New tests | zero |
| Probes | 2, both removed |

## What the four rounds of "blocked" cost, and the generalisation

The claim was verified in round 258 and re-asserted in 262 and 263, each time by reading
`useTabLeases.ts:199` and stopping — **which reads the guard, not the mechanism.**

This is now the third time this session has found a seam behind a "needs another X" blocker:

| Blocker | Seam | Round |
|---|---|---|
| the memo stack with 3 bubbles | `?memos=3` | 255 |
| the plan-empty floor plan | `?plan=empty` | 267-268 |
| a second terminal leasing a tab | `kasirmu:tabs:lease-acquired` | **this one** |

**All three are the same mistake: reading the guard that makes the rare case rare and concluding the
case is unreachable.** A guard expresses a precondition, not an impossibility — and this session's
standing method, "prove the guarded state is reachable", had been applied to every other control on
this screen except the one the summary called blocked.

> last audited 15-10-26 by docs-auditor