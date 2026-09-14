// -- SHARED PRIMITIVE: do not fork this from a feature lane -------------------
//
// Home of the keyed cart-tax watcher used by BOTH POS stacks:
//   features/sales/PosScreen.tsx  and  features/retail/RetailPosScreen.tsx
// Four props (sessionToken / lines / currency / onState), renders nothing
// ("return null"), and republishes CartTaxCacheState through onState. It
// lives under features/pos/ rather than under either feature because neither
// one owns it.
//
// MOVING IT HERE CHANGED NO BEHAVIOUR: the body below is byte-identical to
// the file it was copied from -- CartTaxWatcher.tsx (34 ln, 1,085 bytes,
// dffe250a5), which lived one directory over under features/sales/ and is now
// deleted. Retail still re-declares its own copy at RetailPosScreen.tsx:61;
// converging on this file is a SEPARATE commit by a separate brief.
//
// CHANGES HERE ARE A SEPARATE COMMIT BY ONE NAMED OWNER, agreed before the
// edit - never folded into a feature's refactor. Both stacks compile against
// this file, so an edit is a change to two screens. Nothing in this repo
// enforces that (no CODEOWNERS entry, no guard test); this comment is the
// whole convention, which is why it is written down rather than assumed.
import { useEffect } from 'react';
import { useCartTax, type CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';

// ── F2-3: cart-tax watcher (R36-19 / D64) ──────────────────────────
//
// The zero value every consumer starts from. Built FRESH PER CALL on
// purpose: `CartTaxCacheState` is not readonly (useCartTax.ts:71), so a
// single module-scope object handed to two screens as their `useState`
// initial value is ONE mutable reference shared by both. Nothing writes a
// field today — every `setTaxState` call replaces the whole object through
// `onState` — but a future non-copying updater, `setTaxState(s => {
// s.taxMinor = x; return s; })`, would then corrupt both POS stacks at once
// instead of the one screen it happened to be typed in.
//
// Object.freeze is deliberately not used: it turns that latent corruption
// into a strict-mode throw at whichever future call site writes first, i.e.
// a different failure, further from its cause and harder to debug.
export function createIdleTaxState(): CartTaxCacheState {
  return {
    severity: 'unknown',
    taxMinor: 0,
    hasExclusive: null,
    estimated: false,
    cacheFresh: false,
  };
}

/**
 * The shared idle VALUE, exported for tests that need to compare against it.
 *
 * ⚠ NEVER HAND THIS TO `useState` DIRECTLY. It is one object in module
 * scope, so `useState<CartTaxCacheState>(IDLE_TAX_STATE)` makes every screen
 * that does so share the same reference — seed with `createIdleTaxState()`
 * instead (the exported factory, usable as a React lazy initializer). Read
 * `IDLE_TAX_STATE` to assert against; do not initialise state from it.
 */
export const IDLE_TAX_STATE: CartTaxCacheState = createIdleTaxState();

// The hook owns the compute and the failure-window cache; the screen
// consumes its state through this keyed child. Bumping the key remounts
// the watcher and forces a fresh compute — the retry affordance for a
// failed estimate, without changing the cart or the hook contract.
export function CartTaxWatcher({
  sessionToken,
  lines,
  currency,
  onState,
}: {
  sessionToken: string | null;
  lines: CartLineTaxInput[];
  currency: string;
  onState: (state: CartTaxCacheState) => void;
}) {
  const state = useCartTax(sessionToken, lines, currency);
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}
