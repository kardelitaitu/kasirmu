import { Localized } from '@fluent/react';
import type { CustomerDto } from '@/api/customers';
import type { CustomerReceivablesSummary } from '@/api/receivables';
import { formatMoney, type Money } from '@/types/domain';

export interface PayLaterTenderPanelProps {
  /** Selected customer record if any. */
  customer: CustomerDto | null;
  /** Callback to open the customer search overlay. */
  onOpenCustomerSearch: () => void;
  /** Summary of the customer's outstanding kasbon, or null if not yet loaded. */
  summary: CustomerReceivablesSummary | null;
  /** True while the summary is being fetched. */
  loadingSummary: boolean;
  /** Current cart total to be added to kasbon. */
  currentTotal: Money;
  /** Maximum store credit limit in minor units (0 = no limit). */
  creditLimitMinor: number;
}

/**
 * PayLaterTenderPanel - Customer kasbon / accounts receivable tender surface.
 *
 * Prompts the cashier to select a customer if none is chosen, displays current
 * outstanding receivables and open bill count, and shows a non-blocking warning
 * if the projected debt exceeds the credit limit (warn-only per Q5b).
 */
export default function PayLaterTenderPanel({
  customer,
  onOpenCustomerSearch,
  summary,
  loadingSummary,
  currentTotal,
  creditLimitMinor,
}: PayLaterTenderPanelProps) {
  if (!customer) {
    return (
      <div className="payment-pay-later-section payment-pay-later-empty" data-testid="pay-later-empty">
        <div className="payment-pay-later-prompt-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="32" height="32">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <Localized id="payment-pay-later-select-customer">
          <h3 className="payment-pay-later-title">Select Customer for Kasbon</h3>
        </Localized>
        <Localized id="payment-pay-later-customer-desc">
          <p className="payment-pay-later-desc">
            Kasbon records a receivable against an identified customer account.
          </p>
        </Localized>
        <Localized id="payment-pay-later-open-search">
          <button
            type="button"
            className="payment-pay-later-select-btn"
            onClick={onOpenCustomerSearch}
            data-testid="pay-later-select-customer-btn"
          >
            <span>Select Customer</span>
          </button>
        </Localized>
      </div>
    );
  }

  const isOverLimit =
    creditLimitMinor > 0 &&
    (summary?.outstandingTotal.minor_units ?? 0) + currentTotal.minor_units > creditLimitMinor;

  return (
    <div className="payment-pay-later-section" data-testid="pay-later-customer-details">
      <div className="payment-pay-later-customer-card">
        <div className="payment-pay-later-customer-header">
          <span className="payment-pay-later-customer-name">{customer.name}</span>
          {customer.phone && <span className="payment-pay-later-customer-phone">{customer.phone}</span>}
        </div>

        {loadingSummary && (
          <div className="payment-pay-later-loading" role="status">
            <Localized id="payment-pay-later-loading">
              <span>Loading kasbon balance...</span>
            </Localized>
          </div>
        )}

        {!loadingSummary && summary && (
          <div className="payment-pay-later-ledger-summary">
            <div className="payment-pay-later-stat-row">
              <Localized id="payment-pay-later-outstanding">
                <span className="payment-pay-later-stat-label">Current Kasbon Debt</span>
              </Localized>
              <span className="payment-pay-later-stat-value">
                {formatMoney({
                  minor_units: summary.outstandingTotal.minor_units,
                  currency: summary.outstandingTotal.currency,
                })}
              </span>
            </div>

            <div className="payment-pay-later-stat-row">
              <Localized id="payment-pay-later-invoices">
                <span className="payment-pay-later-stat-label">Open Bills</span>
              </Localized>
              <span className="payment-pay-later-stat-value">{summary.openCount}</span>
            </div>

            {summary.hasOverdue && (
              <div className="payment-pay-later-overdue-badge" role="alert">
                <Localized id="payment-pay-later-overdue">
                  <span>Has Overdue Kasbon</span>
                </Localized>
              </div>
            )}

            <div className="payment-pay-later-stat-row payment-pay-later-stat-row--total">
              <Localized id="payment-pay-later-projected">
                <span className="payment-pay-later-stat-label">New Total Debt</span>
              </Localized>
              <span className="payment-pay-later-stat-value payment-pay-later-stat-value--projected">
                {formatMoney({
                  minor_units: summary.outstandingTotal.minor_units + currentTotal.minor_units,
                  currency: currentTotal.currency,
                })}
              </span>
            </div>

            {isOverLimit && (
              <div className="payment-pay-later-warning" role="alert">
                <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <Localized id="payment-pay-later-limit-warning">
                  <span>Warning: Total kasbon exceeds customer credit limit.</span>
                </Localized>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
