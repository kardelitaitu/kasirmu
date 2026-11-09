# Scoping the cart key closed a leak and opened a stranded ticket — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 158 - status: 1 real defect fixed
     (a draft stranded under the pre-resolution store scope), 2 cases added, 1 suite made
     able to see a transition at all - branch: 0.0.41 - commits: 5b826de0e ff4e0e1d3 -->

<!- - Scope: restaurant POS reliability and usability, per the active goal. This is the
     class the previous round named as next: one with no automated check rather than a
     sweep that had already reached zero. -->

## The scoping was right, and it left a hole

Rounds 104, 167 and 170 store-scoped the POS keys. The reason was sound: `pos-active-draft`
and `pos-locked-cart` carry `tableNumber`, `customerName`, `guestCount`, `orderType` and the
lines -- all store-specific -- so a flat key showed one store's cart while the terminal was
bound to another. Scoping the KEY rather than validating a field is also the better call, and
the comment at `PosScreen.tsx:188-197` argues why: a key cannot be forgotten.

What the change did not account for is that the scope is not stable. `WorkspaceContext` SEEDS
`resolvedStoreId` to `DEFAULT_STORE_ID` (`"default"`, `:132/229`) and replaces it with the real
device binding only when `resolveBootStore` returns (`:536`). So on a normal boot the scope
CHANGES -- this is not only the deliberate `switchStore` path the scoping was written against.

In that window two keys hold one ticket:

- Before resolution the autosave writes under `pos-active-draft:default`.
- After resolution the same cart is re-saved under `pos-active-draft:<real id>`.

Nothing removed the first key. It is not read on that boot, which is the point of the scoping,
but it survives until the operator next boots inside the unresolved window -- the very case the
scoping exists to prevent -- and the restore then walks `LOCKED_CART_KEY ?? ACTIVE_DRAFT_KEY`
(`:216`) in the scope it is in, so the earlier cart can be presented ahead of the current one.

## The fix migrates rather than abandoning

A new effect records the scope in a ref and, when it changes, carries both keys across and
deletes the one being left (`PosScreen.tsx:229-251`). Carrying is deliberate: the cart is the
cashier's unsaved work and the store it belongs to has not changed -- only the knowledge of
which store that is has. Deleting without carrying would empty the till mid-order, which is a
worse bug than a leak that is closed one boot later.

The adoption is guarded: it writes into the resolved scope only when that key is EMPTY. A draft
already saved there is the newer one, because the autosave has been running against it since the
scope moved; overwriting it would move the cart backwards in time. This is the same
newest-wins rule the round-153 restore work reached, applied in the other direction.

## Why no existing suite could have caught it

Every POS suite in the repo mocks `resolvedStoreId` as a frozen literal -- `'default'` appears
in twenty test files. A constant cannot express a transition, so the entire class was invisible
to 130+ passing POS cases. `posDraftStoreScoping.test.ts` does assert the key is scoped, and it
is correct; it stops exactly where the new defect begins.

So the integration harness had to be made able to see one. The workspace mock now reads
`resolvedStoreId` from a mutable holder, every other case in the file still sees the literal it
always did, and one behavioural case moves the holder and re-renders through
`rerenderWithProviders` -- the helper that keeps the provider stack intact, which a raw
`rerender` would not.

## Evidence

- Behavioural red/green: with the un-fixed `HEAD` copy of `PosScreen.tsx` restored, the case
  fails with `expected '{"lines":[{"sku":"TEST-001"' to be null' -- the seeded key still
  holds the ticket. With the fix, 80/80 in the file. Source restored byte-identical after the
  kill-test by sha256.
- Source-level red/green: the new file's other case fails on an un-fixed tree and passes on a
  fixed one, so it is not merely restating the code it reads.
- A fixture error found rather than accepted: the first behavioural version used an EMPTY cart
  and failed on the second assertion, because the autosave REMOVES the draft key when the
  cart is empty (`:334`). An empty fixture would have made the case assert the fixture's fate
  instead of the fix's. Recorded in the case so the next editor does not re-introduce it.
- Regression sweep: 6 POS suites, 149 passed | 1 skipped (150) -- including the suites that
  assert the scoping this change builds on.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS (0 after
  importing the missing `afterEach` -- the first run was red with TS2304, which is the gate
  doing its job), `npm run lint:i18n` PASS (0).
- Commits: `5b826de0e` (fix + integration case) and `ff4e0e1d3` (the new test file), each
  verified with `git show --name-only`. The new file needed the chained add form; the commit
  hook's `--staged-only` warning confirms it is outside the bundle-parity roots and is
  informational, not a failure.

## Carried forward

The scope-constant-in-tests pattern is the reusable finding: a suite that mocks a scope as a
literal cannot observe a transition, so every class of bug that lives in the CHANGE -- the
migration, the cleanup, the stale reader -- is invisible to it. Other scoped keys read the same
way: `readScoped`/`writeScoped` in `utils/scopedStorage.ts` back 30 sites in
`RestaurantReceiptsScreen`, and they carry a legacy ADOPTION path that no suite exercises with a
changing store id. That adoption is the next class worth a round.

> last audited 18-10-26 by docs-auditor
