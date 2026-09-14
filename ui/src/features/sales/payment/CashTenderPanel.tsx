/**
 * CashTenderPanel — the cash tender block of PaymentModal (slice W4-c).
 *
 * Markup only, in the shape ./QrisTenderPanel set: the tender-amount entry, the
 * quick-tender denomination row (the keypad a cashier actually taps — five
 * presets plus Exact), and the live change preview. No state, no effect and no
 * memo moved in, and none created here.
 *
 * The arithmetic did NOT come with the markup and must not be re-derived here.
 * `sufficient` and `change` arrive as VALUES from ./useTenderMath, which owns the
 * payable / tendered / change cluster; `tenderSnapshot` and `canComplete` stay in the page
 * exactly as they were. This panel reads them, it never recomputes them — the
 * parse of the tender string lives in the hook, and the hook's `tendered` input is
 * the same string this panel displays.
 *
 * What IS arithmetic in here, and deliberately so, is the denomination rounding:
 * scale a major-unit preset to minor units and round the tender UP to the next
 * multiple of it. That block crossed over BYTE-FOR-BYTE — same BigInt operands,
 * same `% denomMinor > 0n ? 1n : 0n` ceil step, same division order. It is money
 * semantics, not a style choice: a sibling slice once “tidied” an expression of
 * this shape and changed what the button tendered. Do not simplify it, do not
 * turn it into a float division, do not reorder it.
 *
 * The minor-units → decimal-literal helper is imported from ./moneyFormat, the
 * shared home both this panel and PaymentModal's `autoSplitEvenly` compile against,
 * so there stays exactly one definition of how an amount input's literal is
 * spelled. That spelling is load-bearing: the value must round-trip back through
 * `parseMinorUnits` at the same exponent, which formatMoney output (“Rp 10.000”)
 * does not.
 *
 * Strings: `l10n` comes from the Fluent context, so the ids move with the
 * markup — payment-amount-tendered / -tendered-input / -quick-tender-aria /
 * -tender-exact-aria / -tender-exact / -change / -insufficient are all still
 * referenced from the features tree, which is what pre-commit's bundle-parity
 * walk and the FTL orphan gate read. Both Localized render paths are kept: the
 * `attrs` form (the input's aria-label + placeholder, and the two button
 * aria-labels) and the element form (the Amount Tendered / Exact / Change
 * spans). The class names are unchanged and are still styled by
 * ../PaymentModal.css, which the page imports once for the whole modal — the
 * same arrangement QrisTenderPanel relies on.
 */
import { Localized, useLocalization } from '@fluent/react';
import { formatMoney, minorUnitExponent, type Money } from '@/types/domain';
import { minorUnitsToInputString } from './moneyFormat';

export interface CashTenderPanelProps {
  /** The tender input string, verbatim (the shell's `tendered` state). */
  tendered: string;
  /** Write the tender input (the shell's `setTendered`). */
  onTenderedChange: (value: string) => void;
  /** The sale total as handed to the modal; currency + minor_units drive the denomination math. */
  total: Money;
  /** Quick-tender denominations in MAJOR units; undefined → the built-in Rp notes. */
  tenderPresets: number[] | undefined;
  /** Cash tender covers the payable — from useTenderMath, never recomputed here. */
  sufficient: boolean;
  /** The change the tender earns, null while short — from useTenderMath. */
  change: Money | null;
  /** Resolved locale, for the quick-tender button labels. */
  locale: string;
}

/** The cash method panel: tender entry, quick-tender keypad, change preview. */
export default function CashTenderPanel({
  tendered,
  onTenderedChange,
  total,
  tenderPresets,
  sufficient,
  change,
  locale,
}: CashTenderPanelProps) {
  const { l10n } = useLocalization();

  return (
    <div className="payment-cash-section">
      <div className="payment-tendered-label">
        <Localized id="payment-amount-tendered">
          <span>Amount Tendered</span>
        </Localized>
          <Localized id="payment-tendered-input" attrs={{ 'aria-label': true, placeholder: true }}>
          <input
            type="text"
            className="payment-tendered-input"
            inputMode="decimal"
            value={tendered}
            onChange={(e) => onTenderedChange(e.target.value)}
          />
          </Localized>
      </div>

      <div className="payment-quick-cash">
        {(tenderPresets ?? [5000, 10000, 20000, 50000, 100000]).map((amount) => {
          // Presets are major-unit denominations (Rp 5.000 / $5). Scale the
          // face value to minor units and round the tender UP there, in exact
          // integer (BigInt) arithmetic — the amount never passes through a
          // binary float, and stays consistent with tenderedMinor's parse.
          const exp = minorUnitExponent(total.currency);
          const denomMinor = BigInt(amount) * 10n ** BigInt(exp);
          const targetMinorUnits = BigInt(Number(total.minor_units));
          const ceilStep = targetMinorUnits % denomMinor > 0n ? 1n : 0n;
          const quickMinor = Number((targetMinorUnits / denomMinor + ceilStep) * denomMinor);
          // What the tender input holds must be a decimal literal; what the
          // button shows is display money, so it goes through the formatter.
          const quickInput = minorUnitsToInputString(quickMinor, exp);
          return (
            <button
              key={amount}
              type="button"
              className="payment-quick-btn"
              aria-label={l10n.getString('payment-quick-tender-aria', { amount: quickInput }, 'Tender')}
              onClick={() => onTenderedChange(quickInput)}
            >
              {formatMoney({ minor_units: quickMinor, currency: total.currency }, locale)}
            </button>
          );
        })}
        <Localized id="payment-tender-exact-aria" attrs={{ 'aria-label': true }}>
        <button
          type="button"
          className="payment-quick-btn"
          onClick={() => {
            const exp = minorUnitExponent(total.currency);
            // Exact tender: the total itself, rendered as the input's
            // decimal literal by integer digit placement, not float division.
            onTenderedChange(minorUnitsToInputString(Number(total.minor_units), exp));
          }}
        >
          <Localized id="payment-tender-exact">
            <span>Exact</span>
          </Localized>
        </button>
        </Localized>
      </div>

      {tendered.length > 0 && (
        <div className="payment-change-preview">
          <Localized id="payment-change">
            <span className="payment-change-label">Change</span>
          </Localized>
          <span
            className={`payment-change-amount ${!sufficient ? 'payment-change-insufficient' : ''}`}
          >
            {sufficient && change
              ? formatMoney(change)
              : l10n.getString('payment-insufficient')}
          </span>
        </div>
      )}
    </div>
  );
}
