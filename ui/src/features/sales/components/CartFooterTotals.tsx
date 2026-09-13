import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useLocalization } from '@fluent/react';
import { Localized } from '@/components/Localized';
import { formatMoney, type CartLine, type Money } from '@/types/domain';
import type { Promotion } from '@/api/promotions';
import type { CartTaxCacheState } from '@/hooks/useCartTax';

export interface CartFooterTotalsProps {
  lines: CartLine[];
  /** The parent guard `lines.length > 0 && subtotal &&` narrows this to non-null. */
  subtotal: Money;
  discountPercent: number;
  discountLabel: string;
  discountAmount: Money | null;
  showOptions: boolean;
  setShowOptions: Dispatch<SetStateAction<boolean>>;
  showDiscountInput: boolean;
  setShowDiscountInput: Dispatch<SetStateAction<boolean>>;
  setShowPromotions: Dispatch<SetStateAction<boolean>>;
  appliedPromotions: Promotion[];
  setAppliedPromotions: Dispatch<SetStateAction<Promotion[]>>;
  discountInput: string;
  setDiscountInput: Dispatch<SetStateAction<string>>;
  discountName: string;
  setDiscountName: Dispatch<SetStateAction<string>>;
  handleApplyDiscount: () => void;
  handleClearDiscount: () => void;
  tipPercent: number;
  setTipPercent: (percent: number) => void;
  tipAmount: Money | null;
  serviceChargeEnabled: boolean;
  serviceChargePercent: number;
  serviceChargeAmount: Money | null;
  setServiceCharge: (enabled: boolean, percent?: number) => void;
  cartTax: number;
  taxEstimated: boolean;
  taxState: CartTaxCacheState;
  retryTaxEstimate: () => void;
  children: ReactNode;
}


export function CartFooterTotals({
  lines,
  subtotal,
  discountPercent,
  discountLabel,
  discountAmount,
  showOptions,
  setShowOptions,
  showDiscountInput,
  setShowDiscountInput,
  setShowPromotions,
  appliedPromotions,
  setAppliedPromotions,
  discountInput,
  setDiscountInput,
  discountName,
  setDiscountName,
  handleApplyDiscount,
  handleClearDiscount,
  tipPercent,
  setTipPercent,
  tipAmount,
  serviceChargeEnabled,
  serviceChargePercent,
  serviceChargeAmount,
  setServiceCharge,
  cartTax,
  taxEstimated,
  taxState,
  retryTaxEstimate,
  children,
}: CartFooterTotalsProps) {
  const { l10n } = useLocalization();

  return (
    <div className="pos-cart-footer">
      {/* ── Section 3: Sub total with options (collapsible) ──── */}
      <div className="pos-cart-options-section">
        {/* Toggle header: subtotal + collapse button */}
        <button
          type="button"
          className="pos-cart-options-toggle"
          onClick={() => setShowOptions((v) => !v)}
          aria-expanded={showOptions}
          aria-label={l10n.getString(showOptions ? 'pos-cart-options-collapse-aria' : 'pos-cart-options-expand-aria')}
        >
          <Localized id="pos-cart-subtotal">
            <span className="pos-cart-subtotal-label">Subtotal</span>
          </Localized>
          <span className="pos-cart-subtotal-amount">
            {formatMoney(subtotal)}
          </span>
          <span
            className={`pos-cart-options-chevron${showOptions ? ' pos-cart-options-chevron--open' : ''}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </span>
        </button>

        {/* Collapsible body: discount + tip + service charge */}
        <div
          className={`pos-cart-options-collapse${showOptions ? ' pos-cart-options-collapse--open' : ''}`}
        >
          <div className="pos-cart-options-body">
            {/* Discount */}
            <div className="pos-cart-discount-area">
              {discountPercent > 0 ? (
                <div className="pos-cart-discount-row">
                  <span className="pos-cart-discount-label">
                    <Localized id="pos-cart-discount-label" vars={{ label: discountLabel || `${discountPercent}%` }}>
                      <span>Discount ({discountLabel || `${discountPercent}%`})</span>
                    </Localized>
                  </span>
                  <span className="pos-cart-discount-amount">
                    -{discountAmount ? formatMoney(discountAmount) : ''}
                  </span>
                  <button
                    type="button"
                    className="pos-cart-discount-clear"
                    onClick={handleClearDiscount}
                    aria-label={l10n.getString('pos-cart-discount-remove-aria')}
                  >
                    &times;
                  </button>
                </div>
              ) : !showDiscountInput ? (
                <div className="pos-cart-discount-actions">
                  <Localized id="pos-cart-add-discount">
                    <button
                      type="button"
                      className="pos-cart-discount-btn"
                      onClick={() => setShowDiscountInput(true)}
                    >
                      + Add Discount
                    </button>
                  </Localized>
                  <Localized id="pos-cart-add-promotion">
                    <button
                      type="button"
                      className="pos-cart-discount-btn pos-cart-promotion-btn"
                      onClick={() => setShowPromotions(true)}
                      disabled={!subtotal}
                    >
                      + Promotions
                    </button>
                  </Localized>
                </div>
              ) : null}

              {/* PROMO-3: applied promotion chips (engine-applied at
                  checkout; the amount shows in the payment modal). */}
              {appliedPromotions.length > 0 && (
                <div className="pos-cart-promotion-row">
                  {appliedPromotions.map((p) => (
                    <span key={p.id} className="pos-cart-promotion-chip">
                      <span className="pos-cart-promotion-chip-name">{p.name}</span>
                      <button
                        type="button"
                        className="pos-cart-promotion-chip-clear"
                        aria-label={l10n.getString('pos-cart-promotion-remove-aria', { name: p.name })}
                        onClick={() => setAppliedPromotions(appliedPromotions.filter((x) => x.id !== p.id))}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Discount input form */}
              {showDiscountInput && (
                <div className="pos-cart-discount-form">
                  <div className="pos-cart-discount-input-row">
                    <Localized id="pos-cart-pct-placeholder" attrs={{ placeholder: true }}>
                      <input
                        type="number"
                        className="pos-cart-discount-pct"
                        min="1"
                        max="100"
                        placeholder="%"
                        value={discountInput}
                        onChange={(e) => {
                          // Whole number only — ignore fractional in-progress input
                          // instead of silently truncating it via parseInt.
                          const v = Number(e.target.value);
                          if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                            setDiscountInput(e.target.value);
                          }
                        }}
                        aria-label={l10n.getString('pos-cart-discount-pct-aria')}
                      />
                    </Localized>
                    <Localized id="pos-cart-label-placeholder" attrs={{ placeholder: true }}>
                      <input
                        type="text"
                        className="pos-cart-discount-name"
                        placeholder="Label (optional)"
                        value={discountName}
                        onChange={(e) => setDiscountName(e.target.value)}
                        aria-label={l10n.getString('pos-cart-discount-label-aria')}
                      />
                    </Localized>
                    <Localized id="pos-cart-apply">
                      <button
                        type="button"
                        className="pos-cart-discount-apply"
                        onClick={handleApplyDiscount}
                        disabled={!discountInput || !Number.isInteger(Number(discountInput)) || Number(discountInput) < 1 || Number(discountInput) > 100}
                      >
                        Apply
                      </button>
                    </Localized>
                    <Localized id="pos-cart-cancel">
                      <button
                        type="button"
                        className="pos-cart-discount-cancel"
                        onClick={() => {
                          setShowDiscountInput(false);
                          setDiscountInput('');
                          setDiscountName('');
                        }}
                        aria-label={l10n.getString('pos-cart-discount-cancel-aria')}
                      >
                        Cancel
                      </button>
                    </Localized>
                  </div>
                </div>
              )}
            </div>

            {/* ── Tip segment ──────────────────── */}
            <div className="pos-cart-tip-area">
              <Localized id="pos-cart-tip-label">
                <span className="pos-cart-money-row-label">Add Tip</span>
              </Localized>
              <div
                className="pos-cart-tip-bar"
                role="group"
                aria-label={l10n.getString('pos-cart-tip-aria')}
              >
                {[0, 15, 18, 20].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className="pos-cart-tip-segment"
                    onClick={() => setTipPercent(pct)}
                    aria-pressed={tipPercent === pct}
                    aria-label={
                      pct === 0
                        ? l10n.getString('pos-cart-tip-segment-zero-aria')
                        : l10n.getString('pos-cart-tip-segment-aria', { percent: pct })
                    }
                  >
                    {pct === 0 ? (
                      <Localized id="pos-cart-tip-none"><span>None</span></Localized>
                    ) : (
                      `${pct}%`
                    )}
                  </button>
                ))}
              </div>
              {tipAmount && (
                <div className="pos-cart-tip-preview-row">
                  <Localized id="pos-cart-tip-line" vars={{ percent: tipPercent }}>
                    <span>Tip ({tipPercent}%)</span>
                  </Localized>
                  <span className="pos-cart-money-row-amount">
                    +{formatMoney(tipAmount)}
                  </span>
                </div>
              )}
            </div>

            {/* ── Service charge toggle ─────────── */}
            <div className="pos-cart-service-area">
              <button
                type="button"
                className={`pos-cart-service-toggle ${serviceChargeEnabled ? 'pos-cart-service-toggle--on' : ''}`}
                onClick={() => setServiceCharge(!serviceChargeEnabled)}
                aria-pressed={serviceChargeEnabled}
                aria-label={l10n.getString('pos-cart-service-toggle-aria')}
              >
                <span className="pos-cart-service-toggle-knob" aria-hidden="true" />
                <Localized
                  id="pos-cart-service-toggle-label"
                  vars={{ percent: serviceChargePercent }}
                >
                  <span>Add {serviceChargePercent}% service charge</span>
                </Localized>
              </button>
              {serviceChargeAmount && (
                <div className="pos-cart-service-preview-row">
                  <Localized
                    id="pos-cart-service-line"
                    vars={{ percent: serviceChargePercent }}
                  >
                    <span>Service ({serviceChargePercent}%)</span>
                  </Localized>
                  <span className="pos-cart-money-row-amount">
                    +{formatMoney(serviceChargeAmount)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tax line (live preview; F2-3 estimated marker) ── */}
      {cartTax > 0 && (
        <div className="pos-cart-tax-row">
          <span>PPN</span>
          <span className={taxEstimated ? 'pos-cart-money-row-amount pos-cart-tax-estimated' : 'pos-cart-money-row-amount'}>
            {formatMoney({ minor_units: cartTax, currency: subtotal?.currency ?? 'IDR' })}
          </span>
        </div>
      )}
      {lines.length > 0 && taxState.severity !== 'ok' && (
        <div className="pos-cart-tax-row" role="status">
          {/* Localized text is the accessible name; no aria-label
              attribute so the i18n attribute audit stays empty. */}
          <Localized id="retry">
            <button type="button" onClick={retryTaxEstimate}>Retry</button>
          </Localized>
        </div>
      )}

      {/* ── Section 4: Charge button ──────────────────────── */}
      {/* Action buttons row */}
      {children}

    </div>
  );
}
