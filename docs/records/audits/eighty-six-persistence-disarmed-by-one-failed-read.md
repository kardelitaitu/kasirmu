# 86 persistence silently disarmed for the life of the mount by one failed read

**Date:** 2026-10-11 · **Round:** 45 (session) · **Status:** FIXED
**Area:** `ui/src/features/restaurant/RestaurantMenu.tsx` — the `unavailable` (86) list

## The workflow this breaks

"86'ing" a dish is how the expediter tells every terminal a dish is off. The list is
cross-terminal: it lives in the server setting `restaurant.unavailable.<locationId>`.
A terminal that 86's an item must push the new list; a terminal that opens later must read
it. Both directions matter all service.

## The guard, and why it exists

The server write is gated on `unavailableLoadedRef` (:517):

```ts
if (sessionToken && unavailableLoadedRef.current && typeof settingsApi.setSettingScoped === 'function') {
  void settingsApi.setSettingScoped(sessionToken, unavailableSettingKey, JSON.stringify([...unavailable])).catch(() => {});
}
```

The gate means *"the local set was successfully read back from the server"*, NOT *"a read
was attempted"*. Until it is true, `unavailable` holds only the empty seed (:290), and
pushing that would overwrite the real 86'd list with `[]` — wiping it for every terminal.
The guard is correct and the reasoning behind it is sound.

## The defect

The gate was flipped in **exactly one place**: the initial fetch's success branch (:306).

`refetchUnavailable` (:333) is the documented recovery path — it exists so another
terminal's 86 turns up within seconds of refocusing. It parses the payload into state
(:354-361) but **never touched the gate**.

So after one transient initial-read failure:

1. the first read rejects → gate stays shut (correct — nothing was read);
2. the visibility re-poll **succeeds** and loads the authoritative list → the UI now
   correctly shows the other terminal's 86'd dish;
3. the terminal has therefore *demonstrably read the server list* — but the gate is still
   shut, so every subsequent 86 stays local. The tile greys out, and nothing ever reaches
   the server or any other terminal.

That third step is the expensive one: not an error message, but a **silent divergence**.
The cashier sees the dish go grey locally and believes every terminal knows. The expediter
keeps selling a dish the kitchen cannot make. Nothing in the UI ever says otherwise.

The blast radius is exactly the situation the re-poll was built to handle — a flaky first
read — so the recovery mechanism recovered the *display* and left the *write* permanently
dead.

## Fix

Both branches of the re-poll now open the gate, because reaching them proves a read
succeeded:

- non-empty payload → `unavailableLoadedRef.current = true;` (:354) alongside the existing
  parse/apply
- success returning `null`/empty → `unavailableLoadedRef.current = true;` then return
  (:342). This is a real answer — the server list is genuinely empty — and without it the
  gate could only ever be re-armed by a *non-empty* remote list.

The hazard the gate guards against cannot occur on either path: the gate opens only inside
a success handler, and both failure handlers still leave it shut.

## Evidence

New test in `RestaurantMenu.test.tsx`:

> *keeps 86 persistence armed when the FIRST read failed but a later re-poll succeeded*

It rejects the first `getSettingScoped`, asserts nothing was written, then resolves the
re-poll with `['ES-TEH']`, asserts the tile is now `aria-disabled` (proving the read
landed), and finally 86's a second dish and asserts `setSettingScoped` is called.

**RED before the fix** — failed at the final assertion with
`expected "vi.fn()" to be called at least once`; the two preceding assertions passed, which
is what proves the read landed while the write was dead.

**Kill-tested** by removing only the gate-opening line on the non-empty branch: it went red
again, then green on restore.

- `RestaurantMenu.test.tsx` **61 passed** (was 60)
- menu triplet (+ `RestaurantMenuModifiersAndLocation`, `MenuItemTileUnavailableFeedback`)
  **72 passed**
- full UI suite **784 files, 12,438 passed**
- `typecheck` clean · `eslint` no new findings · no i18n changes

## Comment drift fixed in the same commit

The gate's own doc claimed it "is flipped ONLY in the success handler of a successful
`getSettingScoped`" and the module header said the fetch effect flips it "ONLY on a
successful read". Both described the single-call-site world the defect lived in, and would
have read as an invitation to re-introduce it. Both now name all three sites and say why
the re-poll's matters.

## The opposite direction is already pinned

`RestaurantMenuModifiersAndLocation.test.tsx:274` asserts a **rejected** read still leaves
the gate shut (`setSettingScoped` not called). That test guards the hazard this fix must not
re-open, and it stayed green throughout — which is the check that this change widened the
gate rather than removed it.

> last audited 11-10-26 by docs-auditor
