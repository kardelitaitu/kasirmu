import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  createPurchaseOrder,
  listSuppliers,
  type SupplierDto,
  type CreatePurchaseOrderArgs,
} from '@/api/purchasing';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { minorUnitExponent } from '@/types/domain';
import './PurchaseOrderForm.css';

interface LineItem {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost_minor: number;
}

interface Props {
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Purchase order creation / editing form — supplier selection, line items with SKU, quantity, unit cost, and expected delivery date. */
export default function PurchaseOrderForm({ editingId, onClose, onSaved }: Props) {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { currency } = useCurrency();
  const poExp = minorUnitExponent(currency);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [poNumber, setPoNumber] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([
    { sku: '', product_name: '', qty: 1, unit_cost_minor: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, !saving, onClose);

  useEffect(() => {
    listSuppliers(sessionToken).then(setSuppliers)    .catch(() => {
      addToast({ message: requiredLocalized(l10nRef.current, 'po-form-error-suppliers-failed'), type: 'error' });
    });
  }, [addToast, sessionToken]); // l10n via ref — stable dep chain

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, { sku: '', product_name: '', qty: 1, unit_cost_minor: 0 }]);
  }, []);

  const removeLine = useCallback((idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateLine = useCallback((idx: number, field: keyof LineItem, value: string | number) => {
    setLines((prev) => prev.map((line, i) => (i === idx ? { ...line, [field]: value } : line)));
  }, []);

  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unit_cost_minor, 0);

  const handleSave = useCallback(async () => {
    if (!poNumber.trim()) { setError(l10nRef.current.getString('po-form-error-po-required')); return; }
    if (!supplierId) { setError(l10nRef.current.getString('po-form-error-supplier-required')); return; }
    if (lines.length === 0 || lines.some((l) => !l.sku.trim())) {
      setError(l10nRef.current.getString('po-form-error-sku-required'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const args: CreatePurchaseOrderArgs = {
        po_number: poNumber.trim(),
        supplier_id: supplierId,
        lines: lines.map((l) => ({
          sku: l.sku.trim(),
          product_name: l.product_name.trim(),
          qty: l.qty,
          unit_cost_minor: l.unit_cost_minor,
        })),
      };
      if (expectedDate) args.expected_date = expectedDate;
      if (notes) args.notes = notes;
      await createPurchaseOrder(sessionToken, args);
      onSaved();
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'po-form-error-generic'));
    } finally {
      setSaving(false);
    }
  }, [poNumber, supplierId, expectedDate, notes, lines, onSaved, sessionToken]); // l10n via ref — stable dep chain

  return (
    <div className="po-form-overlay" role="dialog" aria-modal="true" aria-label={l10n.getString('po-form-aria-label')}>
      <div className="po-form-modal" ref={panelRef}>
        <div className="po-form-header">
          <h2>
            <Localized id={editingId ? 'po-form-edit-title' : 'po-form-new-title'}>
              <span>{editingId ? 'Edit Purchase Order' : 'New Purchase Order'}</span>
            </Localized>
          </h2>
          <button type="button" className="po-form-close" onClick={onClose} aria-label={l10n.getString('po-form-close-aria')}>&times;</button>
        </div>

        <div className="po-form-body">
          <div className="po-form-row">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- input is nested inside label */}
            <label className="po-form-field">
              <Localized id="po-form-po-number-label">
                <span className="po-form-label">PO Number *</span>
              </Localized>
              <Localized id="po-form-po-number-placeholder" attrs={{ placeholder: true }}>
                <input className="po-form-input" type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-001" />
              </Localized>
            </label>
            <label className="po-form-field">
              <Localized id="po-form-supplier-label">
                <span className="po-form-label">Supplier *</span>
              </Localized>
              <select className="po-form-input po-form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{l10n.getString('po-form-supplier-select')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </label>
          </div>

          <div className="po-form-row">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- input is nested inside label */}
            <label className="po-form-field">
              <Localized id="po-form-expected-date-label">
                <span className="po-form-label">Expected Date</span>
              </Localized>
              <input className="po-form-input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </label>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- input is nested inside label */}
            <label className="po-form-field">
              <Localized id="po-form-notes-label">
                <span className="po-form-label">Notes</span>
              </Localized>
              <Localized id="po-form-notes-placeholder" attrs={{ placeholder: true }}>
                <input className="po-form-input" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
              </Localized>
            </label>
          </div>

          <div className="po-form-section">
            <div className="po-form-section-header">
              <Localized id="po-form-line-items">
                <span className="po-form-label">Line Items</span>
              </Localized>
              <Localized id="po-form-add-line">
                <Button variant="secondary" size="sm" onClick={addLine}>+ Add Line</Button>
              </Localized>
            </div>

            <table className="po-form-lines-table" aria-label={l10n.getString('po-form-table-aria')}>
              <thead>
                <tr>
                  <Localized id="po-form-sku"><th>SKU</th></Localized>
                  <Localized id="po-form-product-name"><th>Product Name</th></Localized>
                  <Localized id="po-form-qty"><th>Qty</th></Localized>
                  <Localized id="po-form-unit-cost"><th>Unit Cost</th></Localized>
                  <Localized id="po-form-line-total"><th>Line Total</th></Localized>
                  <th aria-label={l10n.getString('po-form-actions-label')}> </th>
                </tr>
              </thead>
              <tbody>{lines.map((line, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        className="po-form-input po-form-input--sm"
                        type="text"
                        aria-label={l10n.getString('po-form-sku')}
                        value={line.sku}
                        onChange={(e) => updateLine(idx, 'sku', e.target.value)}
                        placeholder={l10n.getString('po-form-sku')}
                      />
                    </td>
                    <td>
                      <input
                        className="po-form-input po-form-input--sm"
                        type="text"
                        aria-label={l10n.getString('po-form-product-name')}
                        value={line.product_name}
                        onChange={(e) => updateLine(idx, 'product_name', e.target.value)}
                        placeholder={l10n.getString('po-form-product-name')}
                      />
                    </td>
                    <td>
                      <input
                        className="po-form-input po-form-input--sm po-form-input--num"
                        type="number"
                        min={0}
                        aria-label={l10n.getString('po-form-qty')}
                        value={line.qty}
                        onChange={(e) => {
                          // Whole number only — ignore fractional in-progress input
                          // instead of silently truncating it via parseInt.
                          const v = Number(e.target.value);
                          if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                            updateLine(idx, 'qty', e.target.value === '' ? 0 : v);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="po-form-input po-form-input--sm po-form-input--num"
                        type="number"
                        min={0}
                        aria-label={l10n.getString('po-form-unit-cost')}
                        value={line.unit_cost_minor}
                        onChange={(e) => {
                          // Whole number only — ignore fractional in-progress input
                          // instead of silently truncating it via parseInt.
                          const v = Number(e.target.value);
                          if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                            updateLine(idx, 'unit_cost_minor', e.target.value === '' ? 0 : v);
                          }
                        }}
                        placeholder={l10n.getString('po-form-unit-cost-placeholder')}
                      />
                    </td>
                    <td className="po-form-line-total">
                      {(line.qty * line.unit_cost_minor / 10 ** poExp).toFixed(poExp)}
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <button type="button" className="po-form-remove-line" onClick={() => removeLine(idx)} aria-label={l10n.getString('po-form-remove-line-aria')}>&times;</button>
                      )}
                    </td>
                  </tr>
                ))}
</tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="po-form-total-label">
                    <Localized id="po-form-subtotal"><span>Subtotal</span></Localized>
                  </td>
                  <td className="po-form-total-value">{(subtotal / 10 ** poExp).toFixed(poExp)}</td>
                  { }
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {error && <div className="po-form-error" role="alert">{error}</div>}
        </div>

        <div className="po-form-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            <Localized id="po-form-cancel-btn"><span>Cancel</span></Localized>
          </Button>
          <Button variant="primary" loading={saving} disabled={!poNumber.trim() || !supplierId} onClick={handleSave}>
            <Localized id="po-form-create-btn"><span>Create PO</span></Localized>
          </Button>
        </div>
      </div>
    </div>
  );
}
