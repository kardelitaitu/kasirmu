# Held-cart replacement: the whole class, not the sites I visited

**Round 22 · 2026-10-11 · restaurant POS + retail POS · UI**

## Why this exists

Rounds 292 and 308 fixed three held-cart *replacers* in
`ui/src/features/tables/TableManagementScreen.tsx` (move, merge, seat-reserved-guests)
that ran the DELETE before the CREATE. Every one of those records closed by naming
the *next* call site to check — which is how `handleSeatReservedGuests` stayed
missed for sixteen rounds: each fix ended with a guess about where the bug would
be next, rather than an enumeration of the class it belonged to.

The lesson, applied here: **list the members of the class, not the sites you
happened to visit.**

## The class

Every `holdCartScoped(` / `deleteHeldCartScoped(` pair under `ui/src/features`.
Enumerated by grep, not by memory:

| Site | Order | Verdict |
|---|---|---|
| `tables/TableManagementScreen.tsx` 604→616 (move) | hold → delete | safe (round 292) |
| `tables/TableManagementScreen.tsx` 689→703/704 (merge) | hold → delete ×2 | safe |
| `tables/TableManagementScreen.tsx` 756→818 wait, seat | hold → delete | safe (round 308) |
| `sales/PosScreen.tsx` 968→980 (split bill) | hold → delete | safe (round 293) |
| `sales/PosScreen.tsx` 1183→1196 (send to kitchen) | hold → delete | safe (round 293) |
| `sales/PosScreen.tsx` 808 (release open bill) | delete only | not a replacer |
| `sales/PaymentModal.tsx` 1293 | hold only | not a replacer |
| `retail/RetailPosScreen.tsx` 1264→1285 | see below | **unguarded delete** |
| `retail/RetailPosScreen.tsx` 1330 (resume) | delete only | by design |
| `retail/RetailPosScreen.tsx` 1360 (explicit delete) | delete only | by design |
| `sales/hooks/usePosHeldCarts.ts` 287→291 | delete → hold | deliberate (round 299) |

## Three findings

### 1. `retail/RetailPosScreen.tsx:1285` — the swallowed delete (FIXED, round 21)

```ts
await deleteHeldCartScoped(sessionToken, cartId).catch(() => {});
```

This is byte-for-byte the shape already fixed in `usePosHeldCarts.ts:287`, where
round 299's record explains why swallowing is fatal: **the delete is what prevents
a duplicate**, so a rejected delete followed by the hold creates the second record
the comment claims to prevent. Here it guards a corrupt-cart cleanup path, so the
consequence is a stale row rather than a duplicated bill — lower severity, same
class. The fix removes the `.catch`, making the failure fatal to the cleanup so
the caller's existing catch reports it.

### 2. `retail/RetailPosScreen.tsx:1330` — a delete-only commit (NOT a bug)

`handleResumeCart`'s final act is an unguarded delete with **no create step**:

```ts
await deleteHeldCartScoped(sessionToken, cartId);
setHeldCartId(null);
setShowHeldCartsList(false);
```

Tempting to file as "delete before create". It is not: there is no replacement
record, so the create-before-delete invariant does not apply. The delete *is* the
commit of the resume. Verified by driving the real path (see below).

### 3. `usePosHeldCarts.ts:287→291` — deliberate delete-first (unchanged)

Re-confirmed against round 299's record rather than re-litigated: this site
deletes first by design, and round 299 measured the consequence and left it.

## The fix's verification — and a test that proved nothing

A failing-first test was written for finding 2 ("does NOT claim a held cart was
resumed when deleting it fails"). Reaching the code at all took four attempts,
each one a wrong assumption about the harness:

1. `F4` opened nothing. Cause: the shared `usePosState` mock defaults to an
   **empty cart**, and `handleHold` opens with `if (lines.length === 0) return;`
   (`RetailPosScreen.tsx:1256`) — so F4 is a silent no-op on the default.
2. Seeding one line still opened nothing: F4's binding is
   `if (heldCartId) handleResume(); else handleHold();` (:1513), and a seeded
   cart takes the **hold** path, which never lists.
3. Seeding two holds still opened nothing, for the same reason — `handleHold`
   holds, it does not list. The sibling delete-confirm test only reaches the modal
   because the *previous* test (`focuses SKU input when F5 is pressed`) leaves
   `heldCartId` set via leaked mock state.
4. The fix that worked: hold the seeded cart first (setting `heldCartId`), then
   press F4 again to resume.

Finally green — and **green without touching the source**, which is the warning
sign. A kill-test was run: relaxing the assertion to `alerts.length > 0` still
passed, proving the original assertion was vacuous. Direct instrumentation of the
click then settled what the code actually does:

```
clickedRow= "Hold #3001 1 item · Rp 5.000"  deleteCalls= 1  getCalls= 1
alerts= ["Order held", "Failed to resume order"]  modalOpen= true
```

`getCalls=1` proves the click drove the real `handleResumeCart`; `deleteCalls=1`
proves one rejected attempt; the alerts prove the failure **is** reported and that
**no success toast** follows. So finding 2 is genuinely not a defect, and the test
is genuinely load-bearing: it fails on a "resumed" success toast and on a silent
retry. It is kept as a regression guard.

## Method notes

- A passing test written against a defect you have not reproduced proves nothing.
  Kill-test the assertion before believing a green.
- Reading the harness beat guessing at it four times over. The probes that
  settled each question were `listCalls`, the `keydown` event path, the
  `usePosState` mock's returned `lines`, and finally `getCalls`/`deleteCalls`
  at the click.
- `usePosState`'s shared mock returning an empty cart means **every** retail POS
  test that exercises F4 is exercising `handleHold`'s early return unless it
  overrides `lines`. Worth remembering when a hotkey test looks inert.

> last audited 16-10-26 by docs-auditor
