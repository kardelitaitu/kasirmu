/**
 * SplitTenderRows — the split-tender surface of PaymentModal (slice W4-e).
 *
 * Markup only, in the shape ./CashTenderPanel and ./CardTenderPanel set: the
 * split section (title, the Split Evenly / + Add Split action row, each row's
 * method radios + "other" label + amount input + remove button, and the
 * Remaining read-out) together with the toggle that switches the modal into
 * split mode. No state, no effect and no memo moved in, and none created here.
 *
 * THE MONEY GUARD STAYED IN THE SHELL, deliberately and completely.
 * 'splits' / 'splitMode' are the shell's useState values; 'nextSplitId' is the
 * shell's useRef ID ALLOCATOR ('nextSplitId.current++' — a second allocator in
 * here would hand two rows the same React key and the same radio-group name);
 * and addSplit / removeSplit / updateSplit / autoSplitEvenly are the shell's
 * useCallback writers over that state. This component calls them, it never
 * reimplements them. The split arithmetic is likewise not here:
 * 'remainingMinor' arrives as a VALUE from ./useTenderMath
 * ('splitTotals.remaining'), the same BigInt the shell's 'splitComplete'
 * completion predicate reads — and that predicate is why 'canComplete' stays in
 * the page. Nothing in this file decides whether the sale may settle.
 *
 * Money stays i64 / Money end to end. The one amount this file renders is the
 * Remaining read-out, and it still goes through the same
 * 'formatMoney({ minor_units: Number(remainingMinor), currency } as Money)'
 * expression it used in the page — formatMoney from @/types/domain, no float
 * arithmetic, no new formatting helper. A row's amount input keeps holding the
 * decimal-literal string (s.amountMinor) exactly as before; parsing it back to
 * minor units remains the shell's and the hook's job.
 *
 * Strings: 'l10n' comes from the Fluent context here, as it does in the sibling
 * panels, and no new key is introduced — payment-split-title / -evenly / -add /
 * -method-cash / -method-card / -other-placeholder / -amount-placeholder /
 * -remove-aria / -remaining / -toggle are the ten ids the page already used.
 * Both Localized render paths are preserved: the 'attrs' form (the two inputs'
 * aria-label + placeholder) and the element form (the visible spans). The DOM
 * ids are unchanged too — #payment-split-toggle-cb and each row's
 * radio-group name.
 *
 * Class names are unchanged and are still styled by ../PaymentModal.css, which
 * the page imports once for the whole modal — the same arrangement the three
 * tender panels rely on. The JSX below is the page's lines 1647–1765 verbatim,
 * at the page's own indentation; only the nine call sites named in the props
 * differ.
 */
import { Localized, useLocalization } from '@fluent/react';
import { formatMoney, type Money } from '@/types/domain';

/**
 * Mirror of the shell's local PaymentMethod union (PaymentModal.tsx:41) and of
 * its SplitRow (PaymentModal.tsx:71), in the same "structural twin" role
 * ./useTenderMath.ts:45 already plays for the split math. Duplicated rather
 * than imported because both originals are module-local to the page that
 * imports THIS file, and a type-only cycle is the alternative. The union is the
 * shell's full set, NOT the narrower 'cash' | 'card' | 'other' a row can hold,
 * so the shell's updateSplit stays assignable to onUpdateSplit with no cast.
 */
type SplitRowMethod = 'cash' | 'card' | 'qris' | 'other' | 'open_bill' | 'credit';

/** Structural twin of the shell's SplitRow: the same four fields, same order. */
export interface SplitTenderRow {
  id: number;
  method: SplitRowMethod;
  otherLabel: string;
  amountMinor: string;
}

/** What a row edit may patch — the shell's Partial<SplitRow>. */
export type SplitTenderPatch = Partial<SplitTenderRow>;

export interface SplitTenderRowsProps {
  /** The shell's splitMode value: renders the section, checks the toggle. */
  splitMode: boolean;
  /** The shell's splits value, verbatim — this file never allocates an id. */
  splits: SplitTenderRow[];
  /** total.currency: the row's currency chip and the Remaining unit. */
  currency: string;
  /** splitTotals.remaining from useTenderMath, minor units, BigInt. */
  remainingMinor: bigint;
  /** The shell's setSplitMode. */
  onSplitModeChange: (checked: boolean) => void;
  /** The shell's addSplit — allocates the id from the page's nextSplitId ref. */
  onAddSplit: () => void;
  /** The shell's removeSplit. */
  onRemoveSplit: (id: number) => void;
  /** The shell's updateSplit. */
  onUpdateSplit: (id: number, patch: SplitTenderPatch) => void;
  /** The shell's autoSplitEvenly — the minor-units split of the payable. */
  onAutoSplitEvenly: () => void;
}

/** The split-tender section plus the split-mode toggle. */
export default function SplitTenderRows({
  splitMode,
  splits,
  currency,
  remainingMinor,
  onSplitModeChange,
  onAddSplit,
  onRemoveSplit,
  onUpdateSplit,
  onAutoSplitEvenly,
}: SplitTenderRowsProps) {
  const { l10n } = useLocalization();

  return (
    <>
            {splitMode && (
              <div className="payment-split-section">
                <div className="payment-split-header">
                  <Localized id="payment-split-title">
                    <span className="payment-section-title">Split Payments</span>
                  </Localized>
                  <div className="payment-split-actions">
                    <button
                      type="button"
                      className="payment-split-btn"
                      aria-label={l10n.getString('payment-split-evenly')}
                      onClick={onAutoSplitEvenly}
                    >
                      <Localized id="payment-split-evenly">
                        <span>Split Evenly</span>
                      </Localized>
                    </button>
                    <button
                      type="button"
                      className="payment-split-btn"
                      aria-label={l10n.getString('payment-split-add')}
                      onClick={onAddSplit}
                    >
                      <Localized id="payment-split-add">
                        <span>+ Add Split</span>
                      </Localized>
                    </button>
                  </div>
                </div>

                <div className="payment-split-rows">
                  {splits.map((s) => (
                    <div key={s.id} className="payment-split-row">
                      <div className="payment-split-method-group">
                        {(['cash', 'card'] as const).map((m) => (
                          <label key={m} className="payment-split-radio-label">
                            <input
                              type="radio"
                              name={`split-method-${s.id}`}
                              value={m}
                              checked={s.method === m}
                              onChange={() => onUpdateSplit(s.id, { method: m, otherLabel: '' })}
                            />
                            <span>{m === 'cash' ? l10n.getString('payment-split-method-cash') : l10n.getString('payment-split-method-card')}</span>
                          </label>
                        ))}
                        <div className="payment-split-radio-label">
                          <input
                            type="radio"
                            name={`split-method-${s.id}`}
                            value="other"
                            checked={s.method === 'other'}
                            onChange={() => onUpdateSplit(s.id, { method: 'other' })}
                          />
                            <Localized id="payment-split-other-placeholder" attrs={{ 'aria-label': true, placeholder: true }}>
                            <input
                              type="text"
                              className="payment-split-other-input"
                              value={s.otherLabel}
                              onChange={(e) => onUpdateSplit(s.id, { otherLabel: e.target.value })}
                              disabled={s.method !== 'other'}
                            />
                            </Localized>
                        </div>
                      </div>
                      <div className="payment-split-amount-group">
                        <span className="payment-split-currency">{currency}</span>
                          <Localized id="payment-split-amount-placeholder" attrs={{ placeholder: true, 'aria-label': true }}>
                            <input
                              type="text"
                              className="payment-split-amount-input"
                              inputMode="decimal"
                              value={s.amountMinor}
                              onChange={(e) => onUpdateSplit(s.id, { amountMinor: e.target.value })}
                            />
                          </Localized>
                      </div>
                      <button
                        type="button"
                        className="payment-split-remove"
                        aria-label={l10n.getString('payment-split-remove-aria')}
                        onClick={() => onRemoveSplit(s.id)}
                        disabled={splits.length <= 1}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                <div className="payment-split-remaining">
                  <Localized id="payment-split-remaining">
                    <span className="payment-split-remaining-label">Remaining</span>
                  </Localized>
                  <span
                    className={`payment-split-remaining-amount ${
                      remainingMinor !== 0n ? 'payment-split-remaining-positive' : ''
                    }`}
                  >
                    {formatMoney({
                      minor_units: Number(remainingMinor),
                      currency,
                    } as Money)}
                  </span>
                </div>
              </div>
            )}

            <div className="payment-split-toggle">
              <label className="payment-split-toggle-label" htmlFor="payment-split-toggle-cb">
                <input
                  id="payment-split-toggle-cb"
                  type="checkbox"
                  checked={splitMode}
                  onChange={(e) => onSplitModeChange(e.target.checked)}
                />
                {l10n.getString('payment-split-toggle')}
              </label>
            </div>
    </>
  );
}
