import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { requiredLocalized, EmptyState } from '@/components';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { minorUnitExponent, parseMoneyInput } from '@/types/domain';
import {
  listPayablesScoped,
  createPayableScoped,
  recordPayablePaymentScoped,
  writeOffPayableScoped,
  type PayableDto,
} from '@/api/payables';
import { listSuppliers, type SupplierDto } from '@/api/purchasing';
import { l10nErrorMessage } from '@/utils/app-error';
import './VendorBillsScreen.css';

function formatMinor(minor: number, currency: string): string {
  const exp = minorUnitExponent(currency);
  return (minor / 10 ** exp).toLocaleString(undefined, {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  });
}

export default function VendorBillsScreen() {
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { currency } = useCurrency();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [payables, setPayables] = useState<PayableDto[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'partial' | 'paid' | 'overdue'>('all');

  // Repayment Modal state
  const [payingPayable, setPayingPayable] = useState<PayableDto | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const [payingLoading, setPayingLoading] = useState(false);
  // Write-off confirmation. This was a window.confirm, which a native blocking
  // dialog cannot be styled, localised beyond the two button labels, or driven
  // by a test; ConfirmDialog is the house replacement.
  const [writeOffTarget, setWriteOffTarget] = useState<PayableDto | null>(null);
  const [writeOffLoading, setWriteOffLoading] = useState(false);

  // Manual Add Bill Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState('');
  const [newRef, setNewRef] = useState('');
  const [newAmountInput, setNewAmountInput] = useState('');
  const [newDueDate, setNewDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0] ?? '';
  });
  const [newNote, setNewNote] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const payTrapRef = useRef<HTMLDivElement>(null);
  const addTrapRef = useRef<HTMLDivElement>(null);

  useFocusTrap(payTrapRef, !payingLoading && !!payingPayable, () => setPayingPayable(null));
  useFocusTrap(addTrapRef, !addLoading && showAddModal, () => setShowAddModal(false));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [payablesRes, suppliersRes] = await Promise.all([
        listPayablesScoped(sessionToken),
        listSuppliers(sessionToken),
      ]);
      setPayables(payablesRes);
      setSuppliers(suppliersRes);
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-error-load'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [sessionToken, addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const supplierMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suppliers) {
      map.set(s.id, s.name);
    }
    return map;
  }, [suppliers]);

  // Derived stats
  const stats = useMemo(() => {
    let totalOutstandingMinor = 0;
    let overdueCount = 0;
    let openCount = 0;

    for (const p of payables) {
      if (p.status === 'open' || p.status === 'partial') {
        totalOutstandingMinor += p.balance.minor_units;
        openCount++;
        if (p.is_overdue) {
          overdueCount++;
        }
      }
    }

    return { totalOutstandingMinor, overdueCount, openCount };
  }, [payables]);

  const filteredPayables = useMemo(() => {
    if (filter === 'all') return payables;
    if (filter === 'overdue') return payables.filter((p) => p.is_overdue && (p.status === 'open' || p.status === 'partial'));
    return payables.filter((p) => p.status === filter);
  }, [payables, filter]);

  // Open Repayment Drawer
  const handleOpenPay = useCallback((p: PayableDto) => {
    setPayingPayable(p);
    const exp = minorUnitExponent(p.balance.currency);
    setPaymentAmountInput((p.balance.minor_units / 10 ** exp).toString());
    setPaymentMethod('cash');
    setPaymentNote('');
  }, []);

  const handleConfirmPayment = useCallback(async () => {
    if (!payingPayable) return;
    setPayingLoading(true);
    try {
      const minor = parseMoneyInput(paymentAmountInput, payingPayable.balance.currency);
      if (minor === null || minor <= 0) {
        addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-error-invalid-amount'), type: 'error' });
        return;
      }
      await recordPayablePaymentScoped(sessionToken, {
        payableId: payingPayable.id,
        amount: { minor_units: minor, currency: payingPayable.balance.currency },
        method: paymentMethod,
        ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      });
      addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-payment-success'), type: 'success' });
      setPayingPayable(null);
      await loadData();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'vendor-bills-error-pay-failed'), type: 'error' });
    } finally {
      setPayingLoading(false);
    }
  }, [payingPayable, paymentAmountInput, paymentMethod, paymentNote, sessionToken, addToast, loadData]);

  // Write off debt. The operator confirms in a ConfirmDialog (state below),
  // and this handler runs only on that dialog's onConfirm.
  const handleWriteOffConfirmed = useCallback(async () => {
    if (!writeOffTarget) return;
    setWriteOffLoading(true);
    try {
      await writeOffPayableScoped(sessionToken, writeOffTarget.id);
      addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-writeoff-success'), type: 'success' });
      setWriteOffTarget(null);
      await loadData();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'vendor-bills-error-writeoff-failed'), type: 'error' });
    } finally {
      setWriteOffLoading(false);
    }
  }, [writeOffTarget, sessionToken, addToast, loadData]);

  // Add Manual Bill
  const handleCreateBill = useCallback(async () => {
    if (!newSupplierId) {
      addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-error-supplier-required'), type: 'error' });
      return;
    }
    const minor = parseMoneyInput(newAmountInput, currency);
    if (minor === null || minor <= 0) {
      addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-error-invalid-amount'), type: 'error' });
      return;
    }

    setAddLoading(true);
    try {
      await createPayableScoped(sessionToken, {
        supplierId: newSupplierId,
        source: 'manual',
        amount: { minor_units: minor, currency },
        ...(newRef.trim() ? { reference: newRef.trim() } : {}),
        ...(newDueDate ? { dueDate: newDueDate } : {}),
        ...(newNote.trim() ? { note: newNote.trim() } : {}),
      });
      addToast({ message: requiredLocalized(l10nRef.current, 'vendor-bills-create-success'), type: 'success' });
      setShowAddModal(false);
      setNewSupplierId('');
      setNewRef('');
      setNewAmountInput('');
      setNewNote('');
      await loadData();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10nRef.current, 'vendor-bills-error-create-failed'), type: 'error' });
    } finally {
      setAddLoading(false);
    }
  }, [newSupplierId, newAmountInput, currency, newRef, newDueDate, newNote, sessionToken, addToast, loadData]);

  return (
    <div className="vendor-bills-screen">
      <div className="vendor-bills-header">
        <Localized id="vendor-bills-title">
          <h1 className="vendor-bills-title">Vendor Bills (Hutang Supplier)</h1>
        </Localized>
        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          <Localized id="vendor-bills-add-btn">
            <span>+ Add Vendor Bill</span>
          </Localized>
        </Button>
      </div>

      <div className="vendor-bills-stats">
        <div className="vendor-bill-stat-card">
          <Localized id="vendor-bills-stat-outstanding">
            <span className="vendor-bill-stat-label">Total Outstanding Debt</span>
          </Localized>
          <span className="vendor-bill-stat-val">
            {currency} {formatMinor(stats.totalOutstandingMinor, currency)}
          </span>
        </div>

        <div className={`vendor-bill-stat-card ${stats.overdueCount > 0 ? 'vendor-bill-stat-card--danger' : ''}`}>
          <Localized id="vendor-bills-stat-overdue">
            <span className="vendor-bill-stat-label">Overdue Bills</span>
          </Localized>
          <span className="vendor-bill-stat-val">{stats.overdueCount}</span>
        </div>

        <div className="vendor-bill-stat-card">
          <Localized id="vendor-bills-stat-open">
            <span className="vendor-bill-stat-label">Unsettled Bills</span>
          </Localized>
          <span className="vendor-bill-stat-val">{stats.openCount}</span>
        </div>
      </div>

      <div className="vendor-bills-filters">
        {(['all', 'open', 'partial', 'paid', 'overdue'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`vendor-bills-filter-btn ${filter === f ? 'vendor-bills-filter-btn--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            <Localized id={`vendor-bills-filter-${f}`}>
              <span>{f}</span>
            </Localized>
          </button>
        ))}
      </div>

      <div className="vendor-bills-table-container">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Localized id="vendor-bills-loading">
              <span>Loading vendor bills…</span>
            </Localized>
          </div>
        ) : filteredPayables.length === 0 ? (
          <EmptyState
            title={l10n.getString('vendor-bills-empty-title')}
            description={l10n.getString('vendor-bills-empty-message')}
          />
        ) : (
          <table className="vendor-bills-table">
            <thead>
              <tr>
                <Localized id="vendor-bills-col-supplier"><th>Supplier</th></Localized>
                <Localized id="vendor-bills-col-ref"><th>Reference / Bill #</th></Localized>
                <Localized id="vendor-bills-col-status"><th>Status</th></Localized>
                <Localized id="vendor-bills-col-due"><th>Due Date</th></Localized>
                <Localized id="vendor-bills-col-amount"><th>Amount</th></Localized>
                <Localized id="vendor-bills-col-paid"><th>Paid</th></Localized>
                <Localized id="vendor-bills-col-balance"><th>Balance</th></Localized>
                <Localized id="vendor-bills-col-actions" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}>Actions</th>
                </Localized>
              </tr>
            </thead>
            <tbody>
              {filteredPayables.map((p) => {
                const sName = supplierMap.get(p.supplier_id) || p.supplier_id;
                const canPay = p.status === 'open' || p.status === 'partial';
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{sName}</td>
                    <td>{p.reference || p.source || '—'}</td>
                    <td>
                      <span className={`vendor-bill-status-badge vendor-bill-status-badge--${p.status}`}>
                        <Localized id={`vendor-bill-status-${p.status}`}>
                          <span>{p.status}</span>
                        </Localized>
                      </span>
                    </td>
                    <td>
                      {p.due_date ? p.due_date.slice(0, 10) : '—'}
                      {p.is_overdue && canPay && (
                        <Localized id="vendor-bill-badge-overdue">
                          <span className="vendor-bill-overdue-tag">OVERDUE</span>
                        </Localized>
                      )}
                    </td>
                    <td>{p.amount.currency} {formatMinor(p.amount.minor_units, p.amount.currency)}</td>
                    <td>{p.paid.currency} {formatMinor(p.paid.minor_units, p.paid.currency)}</td>
                    <td style={{ fontWeight: 700, color: canPay ? '#dc2626' : undefined }}>
                      {p.balance.currency} {formatMinor(p.balance.minor_units, p.balance.currency)}
                    </td>
                    <td>
                      <div className="vendor-bills-actions-cell">
                        {canPay && (
                          <button
                            type="button"
                            className="vendor-bill-action-btn vendor-bill-action-btn--pay"
                            onClick={() => handleOpenPay(p)}
                          >
                            <Localized id="vendor-bill-action-pay">
                              <span>Pay</span>
                            </Localized>
                          </button>
                        )}
                        {canPay && (
                          <button
                            type="button"
                            className="vendor-bill-action-btn vendor-bill-action-btn--writeoff"
                            onClick={() => setWriteOffTarget(p)}
                          >
                            <Localized id="vendor-bill-action-writeoff">
                              <span>Write Off</span>
                            </Localized>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pay Disbursement Modal */}
      {payingPayable && (
        <div className="vendor-bills-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pay-modal-title">
          <div className="vendor-bills-modal" ref={payTrapRef}>
            <div className="vendor-bills-modal-header">
              <Localized id="vendor-bills-pay-title">
                <h2 id="pay-modal-title" className="vendor-bills-modal-title">Record Vendor Payment</h2>
              </Localized>
              <button
                type="button"
                className="vendor-bills-modal-close"
                onClick={() => setPayingPayable(null)}
                disabled={payingLoading}
                aria-label={l10n.getString('po-form-close-aria')}
              >
                &times;
              </button>
            </div>
            <div className="vendor-bills-modal-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: '#f3f4f6', borderRadius: 6 }}>
                <Localized id="vendor-bills-pay-balance-label">
                  <span style={{ color: '#4b5563', fontSize: '0.9rem' }}>Remaining Balance:</span>
                </Localized>
                <span style={{ fontWeight: 700, color: '#dc2626' }}>
                  {payingPayable.balance.currency} {formatMinor(payingPayable.balance.minor_units, payingPayable.balance.currency)}
                </span>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-pay-tender-label">
                    <span>Payment Tender</span>
                  </Localized>
                  <select
                    className="receive-po-input"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="cash">{l10n.getString('payment-method-cash')}</option>
                    <option value="bank_transfer">{l10n.getString('payment-method-bank-transfer')}</option>
                    <option value="qris">{l10n.getString('payment-method-qris-ewallet')}</option>
                    <option value="card">{l10n.getString('payment-method-card-giro')}</option>
                  </select>
                </label>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-pay-amount-label">
                    <span>Amount to Pay</span>
                  </Localized>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="receive-po-input"
                    value={paymentAmountInput}
                    onChange={(e) => setPaymentAmountInput(e.target.value)}
                  />
                </label>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-pay-note-label">
                    <span>Note / Reference</span>
                  </Localized>
                  <input
                    type="text"
                    className="receive-po-input"
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    placeholder={l10n.getString('vendor-bills-pay-note-placeholder')}
                  />
                </label>
              </div>
            </div>
            <div className="vendor-bills-modal-footer">
              <Button variant="ghost" onClick={() => setPayingPayable(null)} disabled={payingLoading}>
                <Localized id="vendor-bills-btn-cancel"><span>Cancel</span></Localized>
              </Button>
              <Button variant="primary" loading={payingLoading} onClick={handleConfirmPayment}>
                <Localized id="vendor-bills-btn-confirm-pay"><span>Disburse Payment</span></Localized>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Bill Modal */}
      {showAddModal && (
        <div className="vendor-bills-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-bill-modal-title">
          <div className="vendor-bills-modal" ref={addTrapRef}>
            <div className="vendor-bills-modal-header">
              <Localized id="vendor-bills-add-modal-title">
                <h2 id="add-bill-modal-title" className="vendor-bills-modal-title">Add Vendor Bill</h2>
              </Localized>
              <button
                type="button"
                className="vendor-bills-modal-close"
                onClick={() => setShowAddModal(false)}
                disabled={addLoading}
                aria-label={l10n.getString('po-form-close-aria')}
              >
                &times;
              </button>
            </div>
            <div className="vendor-bills-modal-body">
              <div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-field-supplier">
                    <span>Supplier *</span>
                  </Localized>
                  <select
                    className="receive-po-input"
                    value={newSupplierId}
                    onChange={(e) => setNewSupplierId(e.target.value)}
                  >
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-field-ref">
                    <span>Invoice / Bill Reference</span>
                  </Localized>
                  <input
                    type="text"
                    className="receive-po-input"
                    value={newRef}
                    onChange={(e) => setNewRef(e.target.value)}
                    placeholder={l10n.getString('vendor-bills-field-ref-placeholder')}
                  />
                </label>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-field-amount" vars={{ currency }}>
                    <span>Bill Amount ({currency}) *</span>
                  </Localized>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="receive-po-input"
                    value={newAmountInput}
                    onChange={(e) => setNewAmountInput(e.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-field-due">
                    <span>Due Date</span>
                  </Localized>
                  <input
                    type="date"
                    className="receive-po-input"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                  />
                </label>
              </div>

              <div>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 500 }}>
                  <Localized id="vendor-bills-field-note">
                    <span>Notes</span>
                  </Localized>
                  <input
                    type="text"
                    className="receive-po-input"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="vendor-bills-modal-footer">
              <Button variant="ghost" onClick={() => setShowAddModal(false)} disabled={addLoading}>
                <Localized id="vendor-bills-btn-cancel"><span>Cancel</span></Localized>
              </Button>
              <Button variant="primary" loading={addLoading} onClick={handleCreateBill}>
                <Localized id="vendor-bills-btn-create-bill"><span>Save Bill</span></Localized>
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={writeOffTarget !== null}
        onCancel={() => setWriteOffTarget(null)}
        onConfirm={handleWriteOffConfirmed}
        variant="danger"
        loading={writeOffLoading}
        title={requiredLocalized(l10nRef.current, 'vendor-bills-title-writeoff')}
        message={requiredLocalized(l10nRef.current, 'vendor-bills-writeoff-confirm')}
      />
    </div>
  );
}
