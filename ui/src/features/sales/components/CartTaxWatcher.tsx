import { useEffect } from 'react';
import { useCartTax, type CartTaxCacheState } from '@/hooks/useCartTax';
import type { CartLineTaxInput } from '@/api/tax';

// ── F2-3: cart-tax watcher (R36-19 / D64) ──────────────────────────
// The hook owns the compute and the failure-window cache; the screen
// consumes its state through this keyed child. Bumping the key remounts
// the watcher and forces a fresh compute — the retry affordance for a
// failed estimate, without changing the cart or the hook contract.
export const IDLE_TAX_STATE: CartTaxCacheState = {
  severity: 'unknown',
  taxMinor: 0,
  hasExclusive: null,
  estimated: false,
  cacheFresh: false,
};

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
