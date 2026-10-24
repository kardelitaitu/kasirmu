// ── ABANDONED SCAFFOLD ───────────────────────────────────────────
// Nothing imports this file. It has no `@/api` imports at all, and the `useCart.ts` its own
// header promises below was never written -- so this is not a superseded screen, it is a
// screen that was never finished. `census-orphan-modules.py` reports it on every run.
//
// Kept because deleting it is an owner decision (todo-orphan-module-dispositions.md), not
// because anything renders it.
// ─────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { formatMoney, type CartLine, type Money } from '@/types/domain';

interface CartScreenProps {
  lines?: readonly CartLine[];
  total?: Money | null;
  onAddSample?: () => void;
}

/**
 * Cart screen. Presentational: takes data and callbacks, renders
 * accessible markup with Fluent IDs. State and IPC live in
 * `useCart.ts` (added in the next scaffold pass).
 */
export default function CartScreen({
  lines = [],
  total = null,
  onAddSample,
}: CartScreenProps) {
  const { l10n } = useLocalization();
  const [busy, setBusy] = useState(false);

  const handleAddSample = () => {
    setBusy(true);
    onAddSample?.();
    // Reset on the next tick so the button doesn't stay disabled.
    setTimeout(() => setBusy(false), 250);
  };

  return (
    <section aria-labelledby="cart-title">
      <h1 id="cart-title">
        <Localized id="cart-title">
          <span>Cart</span>
        </Localized>
      </h1>

      {lines.length === 0 ? (
        <p role="status">
          <Localized id="cart-empty">
            <span>Cart is empty</span>
          </Localized>
        </p>
      ) : (
        <ul>
          {lines.map((line) => (
            <li key={line.id}>
              <span>
                {line.sku} × {line.qty} @ {formatMoney(line.unit_price)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {total && (
        <p>
          <Localized id="cart-total-label">
            <span>Total</span>
          </Localized>
          : {formatMoney(total)}
        </p>
      )}

      <button
        type="button"
        onClick={handleAddSample}
        disabled={busy}
        aria-busy={busy}
        aria-label={l10n.getString('add-sample-line-aria')}
      >
        <Localized id="sale-pay-button">
          <span>Pay</span>
        </Localized>
      </button>
    </section>
  );
}
