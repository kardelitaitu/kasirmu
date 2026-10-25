import { useCallback, useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatMoney, minorUnitExponent, type Money } from '@/types/domain';
import {
  listCustomerReceivablesScoped,
  recordReceivablePaymentScoped,
  writeOffReceivableScoped,
  type Receivable,
} from '@/api/receivables';
import { printKasbonSettlementSlipScoped } from '@/api/hardware';
import type { CustomerDto } from '@/api/customers';
import './KasbonSettlementModal.css';

export interface KasbonSettlementModalProps {
  customer: CustomerDto;
  sessionToken: string;
  onClose: () => void;
  numLocale?: string;
}

export default function KasbonSettlementModal({
  customer,
  sessionToken,
  onClose,
  numLocale = 'en-US',
}: KasbonSettlementModalProps) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, true, onClose);

  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingTarget, setPayingTarget] = useState<Receivable | null>(null);
  const [paymentAmountMajor, setPaymentAmountMajor] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const [printReceipt, setPrintReceipt] = useState(true);
  /** The row awaiting write-off confirmation; null closes the dialog. */
  const [confirmTarget, setConfirmTarget] = useState<Receivable | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [writingOffId, setWritingOffId] = useState<string | null>(null);

  const loadReceivables = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCustomerReceivablesScoped(sessionToken, customer.id);
      setReceivables(data);
    } catch (err) {
      console.error('Failed to load receivables for customer', customer.id, err);
      addToast({
        message: l10n.getString('kasbon-modal-empty', null, 'Failed to load receivables'),
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [customer.id, sessionToken, addToast, l10n]);

  useEffect(() => {
    void loadReceivables();
  }, [loadReceivables]);

  const totalOwedMinor = receivables
    .filter((r) => r.status === 'open' || r.status === 'partial')
    .reduce((sum, r) => sum + r.balance.minor_units, 0);

  const currency = receivables[0]?.amount.currency ?? 'IDR';

  // Re-entry guard. `submitting` is React state and commits on the NEXT render, so the
  // second dispatch of a real double tap still enters `handlePaymentSubmit`. This is the
  // WORST instance of the class in the tree, and it is not a misreported error — it is
  // money. `record_receivable_payment` reads the balance BEFORE opening its transaction
  // (receivables.rs:242-289) and its compare-and-set is on STATUS, which stays
  // 'open'/'partial' after a partial payment. So with a partial amount BOTH calls pass the
  // overpayment check, both INSERT a receivable_payments row, and the second overwrites
  // paid_minor with a stale sum: the customer is recorded as having paid twice, with no
  // error at all. With the defaulted FULL balance the second call is refused by the CAS —
  // and then reports 'Failed to record repayment' over a payment that landed.
  const paymentPendingRef = useRef(false);

  const startPayment = (r: Receivable) => {
    setPayingTarget(r);
    const exp = minorUnitExponent(r.amount.currency);
    const majorVal = r.balance.minor_units / Math.pow(10, exp);
    setPaymentAmountMajor(String(majorVal));
    setPaymentMethod('cash');
    setPaymentNote('');
    setPrintReceipt(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingTarget) return;

    const exp = minorUnitExponent(payingTarget.amount.currency);
    const amountVal = parseFloat(paymentAmountMajor);
    if (isNaN(amountVal) || amountVal <= 0) return;

    const minorUnits = Math.round(amountVal * Math.pow(10, exp));
    if (minorUnits > payingTarget.balance.minor_units) return;
    // Taken AFTER the refusals above, which return before the `finally` that clears it.
    if (paymentPendingRef.current) return;
    paymentPendingRef.current = true;

    setSubmitting(true);
    try {
      await recordReceivablePaymentScoped(sessionToken, {
        receivableId: payingTarget.id,
        amount: {
          minor_units: minorUnits,
          currency: payingTarget.amount.currency,
        },
        method: paymentMethod,
        ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      });

      addToast({
        message: l10n.getString('kasbon-toast-payment-success', null, 'Repayment recorded successfully'),
        type: 'success',
      });

      if (printReceipt) {
        try {
          await printKasbonSettlementSlipScoped(sessionToken, {
            date: new Date().toLocaleString(numLocale),
            settlementNumber: `PAY-${Date.now().toString().slice(-6)}`,
            customerName: customer.name,
            customerPhone: customer.phone,
            receivableReference: payingTarget.reference || payingTarget.id,
            paymentMethod,
            previousBalance: {
              minorUnits: payingTarget.balance.minor_units,
              currency: payingTarget.amount.currency,
            },
            amountPaid: {
              minorUnits,
              currency: payingTarget.amount.currency,
            },
            remainingBalance: {
              minorUnits: Math.max(0, payingTarget.balance.minor_units - minorUnits),
              currency: payingTarget.amount.currency,
            },
            note: paymentNote.trim() || undefined,
          });
          addToast({
            message: l10n.getString('kasbon-toast-print-success', null, 'Settlement receipt printed successfully'),
            type: 'success',
          });
        } catch (printErr) {
          console.warn('printKasbonSettlementSlipScoped failed (non-blocking)', printErr);
          addToast({
            message: l10n.getString('kasbon-toast-print-failed', null, 'Could not print receipt (check printer connection)'),
            type: 'warning',
          });
        }
      }

      setPayingTarget(null);
      await loadReceivables();
    } catch (err) {
      console.error('recordReceivablePaymentScoped failed', err);
      addToast({
        message: l10n.getString('kasbon-toast-payment-failed', null, 'Failed to record repayment'),
        type: 'error',
      });
    } finally {
      paymentPendingRef.current = false;
      setSubmitting(false);
    }
  };

  // Confirmed through ConfirmDialog (state below) rather than window.confirm,
  // which renders OS chrome the design system cannot style or localise fully.
  // Same re-entry defect as the payment path, with a different cost: `write_off_receivable`
  // CASes `WHERE status IN ('open','partial')` and flips to 'written_off'
  // (receivables.rs:381-394), so the replay is REFUSED — and the catch below reports
  // 'Failed to write off receivable' over a write-off that landed. No money is lost; the
  // operator is simply told the wrong thing about a receivable they must now reason about.
  const writeOffPendingRef = useRef(false);

  const handleWriteOffConfirmed = async () => {
    if (!confirmTarget) return;
    if (writeOffPendingRef.current) return;
    writeOffPendingRef.current = true;
    setWritingOffId(confirmTarget.id);
    try {
      await writeOffReceivableScoped(sessionToken, confirmTarget.id);
      addToast({
        message: l10n.getString('kasbon-toast-writeoff-success', null, 'Receivable written off successfully'),
        type: 'info',
      });
      await loadReceivables();
    } catch (err) {
      console.error('write_off_receivable_scoped failed', err);
      addToast({
        message: l10n.getString('kasbon-toast-writeoff-failed', null, 'Failed to write off receivable'),
        type: 'error',
      });
    } finally {
      writeOffPendingRef.current = false;
      setWritingOffId(null);
      setConfirmTarget(null);
    }
  };

  return (
    <div
      className="kasbon-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="kasbon-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kasbon-modal-title"
      >
        <header className="kasbon-modal-header">
          <div>
            <h2 id="kasbon-modal-title" className="kasbon-modal-title">
              <Localized id="kasbon-modal-title">
                <span>Kasbon / Accounts Receivable</span>
              </Localized>
            </h2>
            <p className="kasbon-modal-subtitle">{customer.name}</p>
          </div>
          <div className="kasbon-modal-header-right">
            <div className="kasbon-modal-total-pill">
              <Localized id="kasbon-modal-total-owed">
                <span className="kasbon-modal-total-label">Total Owed:</span>
              </Localized>
              <span className="kasbon-modal-total-val">
                {formatMoney({ minor_units: totalOwedMinor, currency } as Money)}
              </span>
            </div>
            <button
              type="button"
              className="kasbon-modal-close-btn"
              onClick={onClose}
              aria-label={l10n.getString('kasbon-modal-close', null, 'Close')}
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        </header>

        <div className="kasbon-modal-body">
          {loading && (
            <div className="kasbon-modal-state" role="status">
              <Localized id="kasbon-modal-loading">
                <p>Loading receivables…</p>
              </Localized>
            </div>
          )}

          {!loading && receivables.length === 0 && (
            <div className="kasbon-modal-state">
              <Localized id="kasbon-modal-empty">
                <p>No receivables recorded for this customer.</p>
              </Localized>
            </div>
          )}

          {!loading && receivables.length > 0 && (
            <div className="kasbon-table-wrapper">
              <table className="kasbon-table">
                <thead>
                  <tr>
                    <th>
                      <Localized id="kasbon-modal-col-date">
                        <span>Date</span>
                      </Localized>
                    </th>
                    <th>
                      <Localized id="kasbon-modal-col-ref">
                        <span>Reference</span>
                      </Localized>
                    </th>
                    <th>
                      <Localized id="kasbon-modal-col-due">
                        <span>Due Date</span>
                      </Localized>
                    </th>
                    <th className="kasbon-num-col">
                      <Localized id="kasbon-modal-col-amount">
                        <span>Amount</span>
                      </Localized>
                    </th>
                    <th className="kasbon-num-col">
                      <Localized id="kasbon-modal-col-paid">
                        <span>Paid</span>
                      </Localized>
                    </th>
                    <th className="kasbon-num-col">
                      <Localized id="kasbon-modal-col-balance">
                        <span>Balance</span>
                      </Localized>
                    </th>
                    <th>
                      <Localized id="kasbon-modal-col-status">
                        <span>Status</span>
                      </Localized>
                    </th>
                    <th className="kasbon-actions-col">
                      <Localized id="kasbon-modal-col-actions">
                        <span>Actions</span>
                      </Localized>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((r) => {
                    const isOwed = r.status === 'open' || r.status === 'partial';
                    return (
                      <tr key={r.id} className={r.isOverdue ? 'kasbon-row--overdue' : ''}>
                        <td>{new Date(r.createdAt).toLocaleDateString(numLocale)}</td>
                        <td>
                          <span className="kasbon-ref-tag">{r.reference || r.source}</span>
                        </td>
                        <td>{r.dueDate ?? '\u2014'}</td>
                        <td className="kasbon-num-col">
                          {formatMoney({ minor_units: r.amount.minor_units, currency: r.amount.currency } as Money)}
                        </td>
                        <td className="kasbon-num-col">
                          {formatMoney({ minor_units: r.paid.minor_units, currency: r.paid.currency } as Money)}
                        </td>
                        <td className="kasbon-num-col kasbon-col-balance">
                          {formatMoney({ minor_units: r.balance.minor_units, currency: r.balance.currency } as Money)}
                        </td>
                        <td>
                          <span className={`kasbon-status-badge kasbon-status--${r.status}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="kasbon-actions-col">
                          {isOwed && (
                            <div className="kasbon-row-btns">
                              <button
                                type="button"
                                className="kasbon-btn-pay"
                                onClick={() => startPayment(r)}
                              >
                                <Localized id="kasbon-modal-action-pay">
                                  <span>Pay</span>
                                </Localized>
                              </button>
                              <button
                                type="button"
                                className="kasbon-btn-writeoff"
                                disabled={writingOffId === r.id}
                                onClick={() => setConfirmTarget(r)}
                              >
                                <Localized id="kasbon-modal-action-writeoff">
                                  <span>Write Off</span>
                                </Localized>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {payingTarget && (
            <div className="kasbon-pay-drawer">
              <div className="kasbon-pay-drawer-header">
                <Localized id="kasbon-modal-payment-title">
                  <h3 className="kasbon-pay-drawer-title">Record Repayment</h3>
                </Localized>
                <span className="kasbon-pay-drawer-ref">{payingTarget.reference || payingTarget.id}</span>
              </div>
              <form onSubmit={(e) => void handlePaymentSubmit(e)} className="kasbon-pay-form">
                <div className="kasbon-form-field">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                  <label htmlFor="kasbon-pay-amount">
                    <Localized id="kasbon-modal-payment-amount">
                      <span>Amount</span>
                    </Localized>
                  </label>
                  <input
                    id="kasbon-pay-amount"
                    type="number"
                    step="any"
                    min="0"
                    required
                    className="kasbon-input"
                    value={paymentAmountMajor}
                    onChange={(e) => setPaymentAmountMajor(e.target.value)}
                  />
                </div>

                <div className="kasbon-form-field">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                  <label htmlFor="kasbon-pay-method">
                    <Localized id="kasbon-modal-payment-method">
                      <span>Payment Method</span>
                    </Localized>
                  </label>
                  <select
                    id="kasbon-pay-method"
                    className="kasbon-select"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="cash">{l10n.getString('payment-method-cash')}</option>
                    <option value="qris">{l10n.getString('payment-method-qris')}</option>
                    <option value="bank_transfer">{l10n.getString('payment-method-bank-transfer')}</option>
                  </select>
                </div>

                <div className="kasbon-form-field">
                  <label htmlFor="kasbon-pay-note">{l10n.getString('kasbon-pay-note')}</label>
                  <input
                    id="kasbon-pay-note"
                    type="text"
                    className="kasbon-input"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    placeholder={l10n.getString('kasbon-pay-note-placeholder')}
                  />
                </div>

                <div className="kasbon-form-field kasbon-checkbox-field">
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                  <label className="kasbon-checkbox-label">
                    <input
                      type="checkbox"
                      checked={printReceipt}
                      onChange={(e) => setPrintReceipt(e.target.checked)}
                    />
                    <Localized id="kasbon-modal-print-receipt">
                      <span>Print Receipt</span>
                    </Localized>
                  </label>
                </div>

                <div className="kasbon-pay-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setPayingTarget(null)}
                    disabled={submitting}
                  >
                    <Localized id="kasbon-modal-payment-cancel">
                      <span>Cancel</span>
                    </Localized>
                  </Button>
                  <Button variant="primary" type="submit" loading={submitting}>
                    <Localized id="kasbon-modal-payment-submit">
                      <span>Confirm Payment</span>
                    </Localized>
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => void handleWriteOffConfirmed()}
        variant="danger"
        loading={writingOffId !== null}
        title={l10n.getString('kasbon-modal-writeoff-title', null, 'Write off debt?')}
        message={l10n.getString(
          'kasbon-modal-writeoff-confirm',
          null,
          'Are you sure you want to write off this debt? This cannot be undone.',
        )}
      />
    </div>
  );
}
