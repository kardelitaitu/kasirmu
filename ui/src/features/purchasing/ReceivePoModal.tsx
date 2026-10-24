import { useState, useCallback, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { requiredLocalized } from '@/components';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useCurrency } from '@/contexts/CurrencyContext';
import { minorUnitExponent } from '@/types/domain';
import { receivePurchaseOrderScoped, type PurchaseOrderDto } from '@/api/purchasing';
import { createPayableScoped } from '@/api/payables';
import './ReceivePoModal.css';

interface Props {
  po: PurchaseOrderDto;
  sessionToken: string;
  onClose: () => void;
  onReceived: () => void;
}

export default function ReceivePoModal({ po, sessionToken, onClose, onReceived }: Props) {
  const { l10n } = useLocalization();
  const { currency } = useCurrency();
  const exp = minorUnitExponent(currency);
  const panelRef = useRef<HTMLDivElement>(null);

  const [paymentTerm, setPaymentTerm] = useState<'cash' | 'on_account'>('cash');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0] ?? '';
  });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  /** Synchronous mirror of `saving` — see the re-entry guard in `handleSubmit`. */
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(panelRef, !saving, onClose);

  const formattedAmount = (po.total_minor / 10 ** exp).toLocaleString(undefined, {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });

  const handleSubmit = useCallback(async () => {
    // Re-entry guard. The Confirm Receipt button shows a loading spinner but is not
    // disabled, so two taps inside one tick both pass `saving === false`. The replay is
    // NOT idempotent here, and it fails badly:
    //   - receivePurchaseOrderScoped refuses it (only an 'approved' PO can be received),
    //     so the catch reports po-error-receive over a receipt that landed;
    //   - on the On-Account path the FIRST call already created the payable, so the
    //     operator is told the receipt failed while a debt against the supplier exists.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // 1. Mark PO as received and adjust inventory
      await receivePurchaseOrderScoped(sessionToken, po.id);

      // 2. If purchased on account (Beli Tempo), record payable debt
      if (paymentTerm === 'on_account') {
        await createPayableScoped(sessionToken, {
          supplierId: po.supplier_id,
          poId: po.id,
          source: 'po_receive',
          amount: { minor_units: po.total_minor, currency },
          ...(invoiceRef.trim() ? { reference: invoiceRef.trim() } : {}),
          ...(dueDate ? { dueDate } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }

      onReceived();
      onClose();
    } catch {
      setError(requiredLocalized(l10n, 'po-error-receive'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [sessionToken, po, paymentTerm, invoiceRef, dueDate, note, currency, onReceived, onClose, l10n]);

  return (
    <div className="receive-po-backdrop" role="dialog" aria-modal="true" aria-labelledby="receive-po-title">
      <div className="receive-po-modal" ref={panelRef}>
        <div className="receive-po-header">
          <Localized id="po-receive-modal-title">
            <h2 id="receive-po-title" className="receive-po-title">Receive Purchase Order</h2>
          </Localized>
          <button
            type="button"
            className="receive-po-close-btn"
            onClick={onClose}
            disabled={saving}
            aria-label={l10n.getString('po-form-close-aria')}
          >
            &times;
          </button>
        </div>

        <div className="receive-po-body">
          <div className="receive-po-summary">
            <div className="receive-po-summary-row">
              <Localized id="po-receive-number-label">
                <span className="receive-po-summary-label">PO Number</span>
              </Localized>
              <span className="receive-po-summary-value">{po.po_number}</span>
            </div>
            <div className="receive-po-summary-row">
              <Localized id="po-receive-supplier-label">
                <span className="receive-po-summary-label">Supplier</span>
              </Localized>
              <span className="receive-po-summary-value">{po.supplier_name || po.supplier_id}</span>
            </div>
            <div className="receive-po-summary-row">
              <Localized id="po-receive-total-label">
                <span className="receive-po-summary-label">Total Amount</span>
              </Localized>
              <span className="receive-po-summary-value receive-po-summary-value--amount">
                {currency} {formattedAmount}
              </span>
            </div>
          </div>

          <div className="receive-po-terms-group">
            <Localized id="po-receive-payment-terms-label">
              <span className="receive-po-terms-label">Payment Terms</span>
            </Localized>
            <div className="receive-po-terms-options">
              <div
                className={`receive-po-term-card ${paymentTerm === 'cash' ? 'receive-po-term-card--selected' : ''}`}
                onClick={() => setPaymentTerm('cash')}
                role="radio"
                aria-checked={paymentTerm === 'cash'}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') setPaymentTerm('cash');
                }}
              >
                <Localized id="po-receive-term-cash">
                  <span className="receive-po-term-title">Cash (Paid Now)</span>
                </Localized>
                <Localized id="po-receive-term-cash-desc">
                  <span className="receive-po-term-desc">Stock received and paid immediately</span>
                </Localized>
              </div>

              <div
                className={`receive-po-term-card ${paymentTerm === 'on_account' ? 'receive-po-term-card--selected' : ''}`}
                onClick={() => setPaymentTerm('on_account')}
                role="radio"
                aria-checked={paymentTerm === 'on_account'}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') setPaymentTerm('on_account');
                }}
              >
                <Localized id="po-receive-term-on-account">
                  <span className="receive-po-term-title">On Account (Beli Tempo)</span>
                </Localized>
                <Localized id="po-receive-term-on-account-desc">
                  <span className="receive-po-term-desc">Record vendor debt to be paid later</span>
                </Localized>
              </div>
            </div>
          </div>

          {paymentTerm === 'on_account' && (
            <div className="receive-po-on-account-fields">
              <div className="receive-po-field">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label className="receive-po-field-label">
                  <Localized id="po-receive-invoice-ref-label">
                    <span>Vendor Invoice / Reference</span>
                  </Localized>
                  <input
                    type="text"
                    className="receive-po-input"
                    value={invoiceRef}
                    onChange={(e) => setInvoiceRef(e.target.value)}
                    placeholder={l10n.getString('po-receive-invoice-ref-placeholder')}
                  />
                </label>
              </div>

              <div className="receive-po-field">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label className="receive-po-field-label">
                  <Localized id="po-receive-due-date-label">
                    <span>Payment Due Date</span>
                  </Localized>
                  <input
                    type="date"
                    className="receive-po-input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="receive-po-field">
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label className="receive-po-field-label">
                  <Localized id="po-receive-note-label">
                    <span>Note / Remarks</span>
                  </Localized>
                  <input
                    type="text"
                    className="receive-po-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={l10n.getString('po-receive-note-placeholder')}
                  />
                </label>
              </div>
            </div>
          )}

          {error && (
            <div className="receive-po-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="receive-po-footer">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            <Localized id="po-receive-cancel-btn">
              <span>Cancel</span>
            </Localized>
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSubmit}>
            <Localized id="po-receive-confirm-btn">
              <span>Confirm Receipt</span>
            </Localized>
          </Button>
        </div>
      </div>
    </div>
  );
}
