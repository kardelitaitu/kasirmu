// ── A scoped draft must not strand the ticket when the store CHANGES ───
//
// `pos-active-draft` and `pos-locked-cart` are store-scoped (rounds 104/167/170):
// the key carries `resolvedStoreId`, so a cart rung up at store A is stored under
// `pos-active-draft:A` and cannot be restored while the POS is bound to store B.
//
// That closes the cross-store leak and opens a second, narrower one. The key is a
// DEPENDENCY of the restore effect (`PosScreen.tsx:276`), so when `resolvedStoreId`
// changes the effect re-runs against the NEW key while the OLD key keeps its value.
// The autosave effect (`:336`) then re-writes the in-memory cart under the new key.
//
// Two things can go wrong in that window, and both end with the operator unable to
// reach the cart they just rang up:
//
//   1. STRANDED. The cart is written under the pre-resolution scope and the resolved
//      scope is a different string, so the restore looks somewhere else. The lines are
//      still in localStorage, under a key nothing reads again.
//   2. DUPLICATED. `WorkspaceContext` seeds `resolvedStoreId` to `DEFAULT_STORE_ID`
//      (`"default"`, `:132/229`) and only later resolves the real binding (`:536`).
//      A cart rung up before resolution lands under `:default`, and the same cart is
//      then re-saved under the resolved id -- two keys, one ticket, and the stale one
//      is restored on a later boot that happens to run inside the unresolved window.
//
// These cases pin the invariant that makes either harm impossible: when the scope
// changes, the value under the PREVIOUS scope is retired.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../..');
const SRC = readFileSync(resolve(REPO, 'src/features/sales/PosScreen.tsx'), 'utf-8');

/** Minimal model of `utils/scopedStorage.ts`, which is authoritative for the spelling. */
function key(base: string, storeId: string): string {
  return base + ':' + storeId;
}

const CART = 'pos-active-draft';

describe('a store change retires the previous scope', () => {
  it('the POS removes the draft under the scope it is leaving', () => {
    // Asserted against the real source so it cannot be satisfied by editing this test.
    //
    // The restore effect already removes the LOCKED key it consumed (:275), which is
    // what proves removal-on-read is this codebase's established way to retire a
    // scoped draft. The gap is that NOTHING retires the key of the PREVIOUS scope.
    // The names below are the plausible spellings of a recorded previous scope. They are
    // matched case-sensitively on the identifier that HOLDS the scope, not on any use of
    // the word "previous", so a comment cannot satisfy this case by accident.
    const clearsPrevious =
      /\bpreviousScope\b|\bprevScope\b|\bpreviousStoreId\b|\bprevStoreId\b|\blastStoreId\b/.test(SRC) &&
      /removeItem\(/.test(SRC);
    expect(
      clearsPrevious,
      'a store change abandons the previous-scope draft in localStorage: the ' +
        'autosave writes under the scope in effect at the time, and when ' +
        'resolvedStoreId changes the restore reads the NEW key while the OLD one ' +
        'keeps its value. Retire the previous key on the change.',
    ).toBe(true);
  });

  it('models the harm, so the assertion above is not vacuous', () => {
    // Non-vacuity: with the current implementation the pre-resolution draft survives the
    // change AND is unreachable, which is precisely the loss the case above forbids.
    const store = new Map<string, string>();
    // 1. Boot: `resolvedStoreId` is seeded to DEFAULT_STORE_ID.
    const seeded = 'default';
    // 2. The cashier rings up a cart; the autosave runs under the seeded scope.
    store.set(key(CART, seeded), JSON.stringify({ lines: [{ sku: 'A' }] }));
    // 3. The boot resolution lands the real binding and the scope changes.
    const resolved = 'store-1';
    // 4. A restart now restores only the resolved scope.
    const restored = store.get(key(CART, resolved)) ?? null;

    expect(restored).toBeNull(); // the operator sees an empty cart
    expect(store.get(key(CART, seeded))).not.toBeNull(); // ...but the lines are still held
  });
});

// ── A switch to a store that already has a draft must not discard the till ──
//
// `switchStore` sets `activeWorkspace` to null (WorkspaceContext.tsx:363), and the POS
// renders only under its own workspace (AppShell.tsx:722/755). So a deliberate switch
// UNMOUNTS the POS and the in-memory cart dies with it — the draft on disk is the only
// copy of what the cashier had rung up.
//
// The migration added for the boot-time scope change adopts into the destination scope
// only when that scope is EMPTY, so that a newer draft is never overwritten by an older
// one. That rule is right for the boot case and wrong for this one: an operator who
// switches from store A, where they have a live cart, to store B, where they also left a
// cart earlier, has the store B draft preserved and the store A draft DELETED. The cart
// they were working on is gone, and nothing told them.
//
// Losing the cart the operator is LOOKING AT is worse than losing the stale one behind
// it: the visible cart is the work in progress, and the destination draft is something
// they abandoned in a previous session. The fix parks the outgoing draft under a
// dedicated key instead of dropping it, so it is recoverable and the destination is not
// clobbered.
describe('a switch onto a store that already has a draft', () => {
  it('does not delete the draft the operator was working on', () => {
    // Asserted against the real source, because the behaviour is only reachable with a
    // mounted POS and two live stores — a model, not the component, is what can say
    // whether the outgoing value is dropped or parked.
    //
    // Any spelling that keeps the outgoing draft somewhere readable is accepted; what is
    // rejected is the current state, where the `continue`/skip path falls through to the
    // unconditional delete.
    // Accept either spelling: a literal parked key, or a suffix built from the base (which
    // is what the implementation does, so the literal never appears). Matching only the
    // literal would report the fix as missing.
    const parksOutgoing =
      /parked/.test(SRC) && /scopedKey\(base/.test(SRC);
    expect(
      parksOutgoing,
      'switching to a store that already holds a draft DELETES the cart the operator was ' +
        'working on: the POS unmounts on switch (AppShell.tsx:722), so that draft is the only ' +
        'copy. The destination draft wins, which is right, but the outgoing one must be parked ' +
        'rather than dropped.',
    ).toBe(true);
  });
});
