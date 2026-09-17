import { Fragment, useRef } from 'react';
import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import { formatMoney, type Money, type LineId } from '@/types/domain';
import type { CustomerDto } from '@/api/customers';
import type { HeldCartRow, SaleDetail } from '@/api/sales';
import type { ShiftDto } from '@/api/shifts';
import type { StoreSettingsDto, CreditSaleDto } from '@/api/settings';
import type { ProductDto, CategoryDto } from '@/api/products';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { RETAIL_HELP_SHORTCUTS } from './retailShortcuts';
import PriceOverrideModal from '@/features/sales/PriceOverrideModal';
import { EditProductModal } from './EditProductModal';
import { AddCategoryModal } from './AddCategoryModal';
import { AddProductModal } from './AddProductModal';
import RefundModal from '@/features/sales/RefundModal';

// ── Exit animation helper type ─────────────────────────────────────

export interface ExitAnim {
  shouldRender: boolean;
  exiting: boolean;
  requestClose: () => void;
}

// ── Props interface ────────────────────────────────────────────────

export interface RetailModalsProps {
  // ADR #36 D7: whether the session may view/edit product cost (HPP).
  canEditCost: boolean;

  // ── Shift modals ────────────────────
  shift: {
    activeShift: ShiftDto | null;
    openShiftExit: ExitAnim;
    closeShiftExit: ExitAnim;
    shiftSummaryExit: ExitAnim;
    closedShiftSummary: ShiftDto | null;
    openingBalance: string;
    closingBalance: string;
    shiftNotes: string;
    openingShift: boolean;
    closingShift: boolean;
    closeShiftError: string | null;
    storeSettings: Pick<StoreSettingsDto, 'currency'>;
    onOpeningBalanceChange: (v: string) => void;
    onClosingBalanceChange: (v: string) => void;
    onShiftNotesChange: (v: string) => void;
    onOpenShift: () => void;
    onCloseShift: () => void;
  };

  // ── Discount modal ──────────────────
  discount: {
    exit: ExitAnim;
    tab: 'pct' | 'rp';
    input: string;
    rpInput: string;
    onTabChange: (t: 'pct' | 'rp') => void;
    onInputChange: (v: string) => void;
    onRpInputChange: (v: string) => void;
    onApplyPct: () => void;
    onApplyRp: () => void;
    onCancel: () => void;
  };

  // ── Customer search ─────────────────
  customer: {
    exit: ExitAnim;
    query: string;
    results: CustomerDto[];
    loading: boolean;
    selected: CustomerDto | null;
    onQueryChange: (v: string) => void;
    onSelect: (c: CustomerDto) => void;
    onClear: () => void;
    onClose: () => void;
  };

  // ── Qty picker ──────────────────────
  qtyPicker: {
    exit: ExitAnim;
    product: { name: string; price: Money } | null;
    input: string;
    onInputChange: (v: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
  };

  // ── Held carts ──────────────────────
  heldCarts: {
    exit: ExitAnim;
    list: HeldCartRow[];
    onResume: (id: string) => void;
    onDelete: (id: string) => void;
    onClose: () => void;
  };

  // ── Credit list ─────────────────────
  credit: {
    exit: ExitAnim;
    sales: CreditSaleDto[];
    settlingId: string | null;
    onSettle: (saleId: string) => void;
    onClose: () => void;
  };

  // ── Quick return ────────────────────
  quickReturn: {
    exit: ExitAnim;
    barcode: string;
    loading: boolean;
    onBarcodeChange: (v: string) => void;
    onSubmit: () => void;
    onClose: () => void;
  };

  // ── Generics ────────────────────────
  clearConfirm: {
    exit: ExitAnim;
    lineCount: number;
    onConfirm: () => void;
    onClose: () => void;
  };
  /** Confirm dialog before deleting a held cart (P1-3). */
  deleteHeldCartConfirm: {
    exit: ExitAnim;
    label: string;
    onConfirm: () => void;
    onClose: () => void;
  };
  shortcuts: {
    exit: ExitAnim;
    onClose: () => void;
  };

  // ── Override / Edit / Add modals ────
  override: {
    target: { id: LineId; name: string; unit_price: Money } | null;
    onConfirm: (minor: number) => Promise<void>;
    onClose: () => void;
  };
  editProduct: {
    product: ProductDto | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (p: ProductDto) => void;
  };
  addCategory: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (c: CategoryDto) => void;
  };
  addProduct: {
    categories: CategoryDto[];
    isOpen: boolean;
    onClose: () => void;
    onSave: (p: ProductDto) => void;
  };

  // ── Refund / Scan flash / Workspace ─
  showQuickReturnRefund: boolean;
  quickReturnSale: SaleDetail | null;
  quickReturnRefundDone: () => void;
  scanFlash: boolean;
  /** Scoped session token — enables the product image editor (spec 0046b). */
  sessionToken?: string;
}

// ── Component ──────────────────────────────────────────────────────

/** All retail POS modals and overlays — each with proper dialog semantics, focus trapping, and exit animations. */
export default function RetailModals(props: RetailModalsProps) {
  const { l10n } = useLocalization();
  // Dates follow the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const {
    shift,
    discount,
    customer,
    qtyPicker,
    heldCarts,
    credit,
    quickReturn,
    clearConfirm,
    deleteHeldCartConfirm,
    shortcuts,
    override,
    editProduct,
    addCategory,
    addProduct,
    canEditCost,
    showQuickReturnRefund,
    quickReturnSale,
    quickReturnRefundDone,
    scanFlash,
    sessionToken,
  } = props;

  // ── Panel refs for focus trapping ────────────────────────────
  const openShiftPanelRef = useRef<HTMLDivElement>(null);
  const closeShiftPanelRef = useRef<HTMLDivElement>(null);
  const shiftSummaryPanelRef = useRef<HTMLDivElement>(null);
  const creditPanelRef = useRef<HTMLDivElement>(null);
  const clearPanelRef = useRef<HTMLDivElement>(null);
  const deleteHeldCartPanelRef = useRef<HTMLDivElement>(null);
  const discountPanelRef = useRef<HTMLDivElement>(null);
  const customerPanelRef = useRef<HTMLDivElement>(null);
  const qtyPanelRef = useRef<HTMLDivElement>(null);
  const heldCartsPanelRef = useRef<HTMLDivElement>(null);
  const shortcutsPanelRef = useRef<HTMLDivElement>(null);
  const quickReturnPanelRef = useRef<HTMLDivElement>(null);

  // ── Focus traps — one per modal ─────────────────────────────
  useFocusTrap(openShiftPanelRef,    shift.openShiftExit.shouldRender && !shift.openShiftExit.exiting,        () => shift.openShiftExit.requestClose());
  useFocusTrap(closeShiftPanelRef,   shift.closeShiftExit.shouldRender && !shift.closeShiftExit.exiting,      () => shift.closeShiftExit.requestClose());
  useFocusTrap(shiftSummaryPanelRef, shift.shiftSummaryExit.shouldRender && !shift.shiftSummaryExit.exiting,  () => shift.shiftSummaryExit.requestClose());
  useFocusTrap(creditPanelRef,       credit.exit.shouldRender && !credit.exit.exiting,                        () => credit.exit.requestClose());
  useFocusTrap(clearPanelRef,        clearConfirm.exit.shouldRender && !clearConfirm.exit.exiting,            () => clearConfirm.exit.requestClose());
  useFocusTrap(deleteHeldCartPanelRef, deleteHeldCartConfirm.exit.shouldRender && !deleteHeldCartConfirm.exit.exiting, () => deleteHeldCartConfirm.exit.requestClose());
  useFocusTrap(discountPanelRef,     discount.exit.shouldRender && !discount.exit.exiting,                    () => discount.exit.requestClose());
  useFocusTrap(customerPanelRef,     customer.exit.shouldRender && !customer.exit.exiting,                    () => customer.exit.requestClose());
  useFocusTrap(qtyPanelRef,          qtyPicker.exit.shouldRender && !qtyPicker.exit.exiting,                   () => qtyPicker.exit.requestClose());
  useFocusTrap(heldCartsPanelRef,    heldCarts.exit.shouldRender && !heldCarts.exit.exiting,                   () => heldCarts.exit.requestClose());
  useFocusTrap(shortcutsPanelRef,    shortcuts.exit.shouldRender && !shortcuts.exit.exiting,                   () => shortcuts.exit.requestClose());
  useFocusTrap(quickReturnPanelRef,  quickReturn.exit.shouldRender && !quickReturn.exit.exiting,              () => quickReturn.exit.requestClose());

  return (
    <>
      {/* ── Open Shift modal ────────────────── */}
      {shift.openShiftExit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-shift-overlay${shift.openShiftExit.exiting ? ' retail-shift-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('pos-open-shift-title')}
          onClick={(e) => { if (e.target === e.currentTarget) shift.openShiftExit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') shift.openShiftExit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={openShiftPanelRef}
            className={`retail-shift-modal${shift.openShiftExit.exiting ? ' retail-shift-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('pos-open-shift-title')}</h3>
            <label htmlFor="retail-opening">{l10n.getString('retail-open-shift-opening-label')}</label>
            <input
              id="retail-opening"
              type="number"
              min="0"
              value={shift.openingBalance}
              onChange={(e) => shift.onOpeningBalanceChange(e.target.value)}
            />
            <div className="retail-shift-modal-actions">
              <button type="button" onClick={() => shift.openShiftExit.requestClose()} disabled={shift.openingShift}>{l10n.getString('cancel')}</button>
              <button type="button" className="retail-shift-confirm-btn" onClick={shift.onOpenShift} disabled={shift.openingShift}>
                {shift.openingShift ? l10n.getString('retail-open-shift-opening') : l10n.getString('pos-shift-open-btn')}
              </button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Close Shift modal ───────────────── */}
      {shift.closeShiftExit.shouldRender && shift.activeShift && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-shift-overlay${shift.closeShiftExit.exiting ? ' retail-shift-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('pos-close-shift-title')}
          onClick={(e) => { if (e.target === e.currentTarget) shift.closeShiftExit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') shift.closeShiftExit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={closeShiftPanelRef}
            className={`retail-shift-modal${shift.closeShiftExit.exiting ? ' retail-shift-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('pos-close-shift-title')}</h3>
            {shift.closeShiftError && <div className="retail-shift-error">{shift.closeShiftError}</div>}
            <div className="retail-shift-opened-info">
              {l10n.getString('pos-close-shift-opened')}: {shift.activeShift ? new Date(shift.activeShift.openedAt).toLocaleString(numLocale) : ''}
            </div>
            <label htmlFor="retail-closing">{l10n.getString('pos-close-shift-counted-label')}</label>
            <input
              id="retail-closing"
              type="number"
              min="0"
              value={shift.closingBalance}
              onChange={(e) => shift.onClosingBalanceChange(e.target.value)}
            />
            <label htmlFor="retail-notes" className="retail-shift-notes-label">{l10n.getString('pos-shift-notes')}</label>
            <textarea
              id="retail-notes"
              rows={2}
              value={shift.shiftNotes}
              onChange={(e) => shift.onShiftNotesChange(e.target.value)}
            />
            <div className="retail-shift-modal-actions">
              <button type="button" onClick={() => shift.closeShiftExit.requestClose()} disabled={shift.closingShift}>{l10n.getString('cancel')}</button>
              <button type="button" className="retail-shift-confirm-btn" onClick={shift.onCloseShift} disabled={shift.closingShift}>
                {shift.closingShift ? l10n.getString('loading') : l10n.getString('pos-shift-close-btn')}
              </button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Closed Shift Summary ────────────── */}
      {(shift.shiftSummaryExit.shouldRender && shift.closedShiftSummary) && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-shift-overlay${shift.shiftSummaryExit.exiting ? ' retail-shift-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('pos-shift-closed-title')}
          onClick={(e) => { if (e.target === e.currentTarget) shift.shiftSummaryExit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') shift.shiftSummaryExit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={shiftSummaryPanelRef}
            className={`retail-shift-modal${shift.shiftSummaryExit.exiting ? ' retail-shift-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('pos-shift-closed-title')}</h3>
            <div className="retail-shift-summary">
              <div>{l10n.getString('pos-shift-total-sales')}: {formatMoney({ minor_units: shift.closedShiftSummary.totalSalesMinor, currency: shift.storeSettings.currency })}</div>
              <div>{l10n.getString('retail-shift-closed-cash-sales')} {formatMoney({ minor_units: shift.closedShiftSummary.totalCashMinor, currency: shift.storeSettings.currency })}</div>
              <div>{l10n.getString('pos-shift-expected-cash')}: {shift.closedShiftSummary.expectedCashMinor != null ? formatMoney({ minor_units: shift.closedShiftSummary.expectedCashMinor, currency: shift.storeSettings.currency }) : '—'}</div>
              <div>{l10n.getString('pos-shift-difference')}: {shift.closedShiftSummary.cashDifferenceMinor != null ? formatMoney({ minor_units: shift.closedShiftSummary.cashDifferenceMinor, currency: shift.storeSettings.currency }) : '—'}</div>
            </div>
            <div className="retail-shift-modal-actions">
              <button
                type="button"
                className="retail-shift-confirm-btn"
                onClick={() => shift.shiftSummaryExit.requestClose()}
              >{l10n.getString('pos-shift-summary-done')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Credit list overlay ─────────────── */}
      {credit.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-credit-overlay${credit.exit.exiting ? ' retail-credit-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('retail-credit-reminders-title')}
          onClick={(e) => { if (e.target === e.currentTarget) credit.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') credit.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={creditPanelRef}
            className={`retail-credit-modal${credit.exit.exiting ? ' retail-credit-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('retail-credit-reminders-title')}</h3>
            {credit.sales.length === 0 ? (
              <div className="retail-credit-empty">{l10n.getString('retail-credit-no-outstanding')}</div>
            ) : (
              <table className="retail-credit-table">
                <thead>
                  <tr>
                    <th className="retail-credit-th--left">{l10n.getString('retail-credit-col-customer')}</th>
                    <th className="retail-credit-th--right">{l10n.getString('retail-credit-col-amount')}</th>
                    <th className="retail-credit-th--center">{l10n.getString('retail-credit-col-date')}</th>
                    <th className="retail-credit-th--left"></th>
                  </tr>
                </thead>
                <tbody>{credit.sales.map((c) => (
                    <tr key={c.saleId}>
                      <td>{c.customerName || '—'}</td>
                      <td className="retail-credit-td--right">
                        {formatMoney({ minor_units: c.totalMinor, currency: c.currency })}
                      </td>
                      <td className="retail-credit-td--center">
                        {new Date(c.createdAt).toLocaleDateString(numLocale)}
                      </td>
                      <td>
                        <button
                          className="retail-credit-settle-btn"
                          onClick={() => credit.onSettle(c.saleId)}
                          disabled={credit.settlingId === c.saleId}
                        >
                          {credit.settlingId === c.saleId ? '…' : l10n.getString('retail-credit-settle')}
                        </button>
                      </td>
                    </tr>
                  ))}
</tbody>
              </table>
            )}
            <div className="retail-shift-modal-actions">
              <button type="button" className="retail-shift-confirm-btn" onClick={() => credit.exit.requestClose()}>{l10n.getString('close')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Clear confirm modal ────────────── */}
      {clearConfirm.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-clear-overlay${clearConfirm.exit.exiting ? ' retail-clear-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('retail-clear-cart-title')}
          onClick={(e) => { if (e.target === e.currentTarget) clearConfirm.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') clearConfirm.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={clearPanelRef}
            className={`retail-clear-modal${clearConfirm.exit.exiting ? ' retail-clear-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('retail-clear-cart-title')}</h3>
            <p className="retail-modal-message">
              {requiredLocalized(l10n, 'retail-clear-cart-confirm', { count: clearConfirm.lineCount })}
            </p>
            <div className="retail-shift-modal-actions">
              <button type="button" onClick={() => clearConfirm.exit.requestClose()}>{l10n.getString('cancel')}</button>
              <button type="button" className="retail-shift-confirm-btn retail-shift-confirm-btn--danger" onClick={clearConfirm.onConfirm}>{l10n.getString('retail-clear-cart-clear')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Held-cart delete confirm modal ──── */}
      {deleteHeldCartConfirm.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-clear-overlay${deleteHeldCartConfirm.exit.exiting ? ' retail-clear-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={requiredLocalized(l10n, 'retail-held-cart-delete-title')}
          onClick={(e) => { if (e.target === e.currentTarget) deleteHeldCartConfirm.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') deleteHeldCartConfirm.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={deleteHeldCartPanelRef}
            className={`retail-clear-modal${deleteHeldCartConfirm.exit.exiting ? ' retail-clear-modal--exiting' : ''}`}
          >
            <h3>{requiredLocalized(l10n, 'retail-held-cart-delete-title')}</h3>
            <p className="retail-modal-message">
              {requiredLocalized(l10n, 'retail-held-cart-delete-confirm', { label: deleteHeldCartConfirm.label })}
            </p>
            <div className="retail-shift-modal-actions">
              <button type="button" onClick={() => deleteHeldCartConfirm.exit.requestClose()}>{l10n.getString('cancel')}</button>
              <button type="button" className="retail-shift-confirm-btn retail-shift-confirm-btn--danger" data-testid="held-cart-delete-confirm" onClick={deleteHeldCartConfirm.onConfirm}>{requiredLocalized(l10n, 'retail-held-cart-delete-btn')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Discount modal ──────────────────── */}
      {discount.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-discount-overlay${discount.exit.exiting ? ' retail-discount-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('retail-discount-title')}
          onClick={(e) => { if (e.target === e.currentTarget) discount.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') discount.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={discountPanelRef}
            className={`retail-discount-modal${discount.exit.exiting ? ' retail-discount-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('retail-discount-title')}</h3>
            <div className="retail-discount-tabs">
              <button
                className={`retail-discount-tab${discount.tab === 'pct' ? ' retail-discount-tab--active' : ''}`}
                onClick={() => discount.onTabChange('pct')}
              >
                {l10n.getString('retail-discount-pct-tab')}
              </button>
              <button
                className={`retail-discount-tab${discount.tab === 'rp' ? ' retail-discount-tab--active' : ''}`}
                onClick={() => discount.onTabChange('rp')}
              >
                {l10n.getString('retail-discount-rp-tab')}
              </button>
            </div>
            {discount.tab === 'pct' ? (
              <>
                <label htmlFor="discount-pct">{l10n.getString('retail-discount-pct-label')}</label>
                <input
                  id="discount-pct"
                  type="number"
                  min="0"
                  max="100"
                  value={discount.input}
                  onChange={(e) => discount.onInputChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') discount.onApplyPct(); }}
                />
              </>
            ) : (
              <>
                <label htmlFor="discount-rp">{l10n.getString('retail-discount-rp-label')}</label>
                <input
                  id="discount-rp"
                  type="number"
                  min="0"
                  value={discount.rpInput}
                  onChange={(e) => discount.onRpInputChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') discount.onApplyRp(); }}
                />
              </>
            )}
            <div className="retail-discount-actions">
              <button type="button" onClick={discount.onCancel}>{l10n.getString('cancel')}</button>
              {discount.tab === 'pct' ? (
                <button type="button" onClick={discount.onApplyPct}>{l10n.getString('pos-cart-apply')}</button>
              ) : (
                <button type="button" onClick={discount.onApplyRp}>{l10n.getString('pos-cart-apply')}</button>
              )}
            </div>
          </div>
        </div>
      </>)}

      {/* ── Customer search modal ──────────── */}
      {customer.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-customer-overlay${customer.exit.exiting ? ' retail-customer-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('retail-customer-search-title')}
          onClick={(e) => { if (e.target === e.currentTarget) customer.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') customer.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={customerPanelRef}
            className={`retail-customer-modal${customer.exit.exiting ? ' retail-customer-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('retail-customer-search-title')}</h3>
            <input
              className="retail-customer-search-input"
              type="text"
              placeholder={l10n.getString('retail-customer-search-placeholder')}
              value={customer.query}
              onChange={(e) => customer.onQueryChange(e.target.value)}
            />
            <div className="retail-customer-search-list">
              {customer.loading ? (
                <div className="retail-customer-search-loading">{l10n.getString('retail-customer-search-loading')}</div>
              ) : customer.results.length === 0 ? (
                <div className="retail-customer-search-empty">{l10n.getString('retail-customer-search-empty')}</div>
              ) : (
                customer.results.map((c) => (
                  <button
                    key={c.id}
                    className={`retail-customer-search-item${customer.selected?.id === c.id ? ' retail-customer-search-item--selected' : ''}`}
                    onClick={() => customer.onSelect(c)}
                  >
                    <span className="retail-customer-search-item-name">{c.name}</span>
                    {(c.phone || c.email) && (
                      <span className="retail-customer-search-item-detail">{c.phone || c.email}</span>
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="retail-customer-modal-actions">
              {customer.selected && (
                <button
                  className="retail-customer-clear-btn"
                  onClick={customer.onClear}
                >
                  {l10n.getString('retail-customer-clear')}
                </button>
              )}
              <button type="button" className="retail-customer-close-btn" onClick={() => customer.exit.requestClose()}>{l10n.getString('close')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Quantity picker modal ──────────── */}
      {qtyPicker.exit.shouldRender && qtyPicker.product && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-qty-overlay${qtyPicker.exit.exiting ? ' retail-qty-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={requiredLocalized(l10n, 'retail-qty-picker-title')}
          onClick={(e) => { if (e.target === e.currentTarget) qtyPicker.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') qtyPicker.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={qtyPanelRef}
            className={`retail-qty-modal${qtyPicker.exit.exiting ? ' retail-qty-modal--exiting' : ''}`}
          >
            <h3 className="retail-qty-heading">{qtyPicker.product.name}</h3>
            <div className="retail-qty-price">{formatMoney(qtyPicker.product.price)}</div>
            <div className="retail-qty-controls">
              <button
                className="retail-qty-btn"
                onClick={() => qtyPicker.onInputChange(String(Math.max(1, (parseInt(qtyPicker.input, 10) || 1) - 1)))}
              >
                &minus;
              </button>
              <input
                className="retail-qty-input"
                type="number"
                min={1}
                value={qtyPicker.input}
                onChange={(e) => qtyPicker.onInputChange(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="retail-qty-btn"
                onClick={() => qtyPicker.onInputChange(String((parseInt(qtyPicker.input, 10) || 1) + 1))}
              >
                +
              </button>
            </div>
            <div className="retail-qty-numpad">
              {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k) => (
                k === '' ? <span key="spacer" /> : (
                  <button
                    key={String(k)}
                    className="retail-qty-num-btn"
                    onClick={() => {
                      if (k === '⌫') qtyPicker.onInputChange(qtyPicker.input.length > 1 ? qtyPicker.input.slice(0, -1) : '1');
                      else qtyPicker.onInputChange(String(Math.max(1, parseInt(qtyPicker.input + String(k), 10) || 1)));
                    }}
                    aria-label={k === '⌫' ? (requiredLocalized(l10n, 'retail-qty-backspace-aria')) : String(k)}
                  >
                    {k === '⌫' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                        <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                        <line x1="18" y1="9" x2="12" y2="15" />
                        <line x1="12" y1="9" x2="18" y2="15" />
                      </svg>
                    ) : (
                      k
                    )}
                  </button>
                )
              ))}
            </div>
            <div className="retail-qty-total">
              {l10n.getString('retail-qty-total')} {formatMoney({
                minor_units: qtyPicker.product.price.minor_units * Math.max(1, parseInt(qtyPicker.input, 10) || 1),
                currency: qtyPicker.product.price.currency,
              })}
            </div>
            <div className="retail-qty-actions">
              <button type="button" className="retail-qty-cancel" onClick={qtyPicker.exit.requestClose}>{l10n.getString('cancel')}</button>
              <button type="button" className="retail-qty-confirm" onClick={qtyPicker.onConfirm}>{l10n.getString('retail-qty-add')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Held carts list modal ──────────── */}
      {heldCarts.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-held-carts-overlay${heldCarts.exit.exiting ? ' retail-held-carts-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('retail-held-carts-title')}
          onClick={(e) => { if (e.target === e.currentTarget) heldCarts.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') heldCarts.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={heldCartsPanelRef}
            className={`retail-held-carts-modal${heldCarts.exit.exiting ? ' retail-held-carts-modal--exiting' : ''}`}
          >
            <h3>{l10n.getString('retail-held-carts-title')}</h3>
            {heldCarts.list.length === 0 ? (
              <p className="retail-held-carts-empty">{l10n.getString('retail-held-carts-empty')}</p>
            ) : (
              <div className="retail-held-carts-list">
                {heldCarts.list.map((c) => (
                  <div key={c.id} className="retail-held-cart-row">
                    <button type="button" className="retail-held-cart-info" aria-label={requiredLocalized(l10n, 'retail-held-cart-resume-aria')} onClick={() => heldCarts.onResume(c.id)}>
                      <span className="retail-held-cart-label">{c.label}</span>
                      <span className="retail-held-cart-meta">
                        {c.item_count} {l10n.getString('retail-cart-items', { count: c.item_count })} &middot; {formatMoney({ minor_units: c.total_minor, currency: c.currency })}
                      </span>
                    </button>
                    <button type="button" className="retail-held-cart-delete" data-testid="held-cart-delete" onClick={() => heldCarts.onDelete(c.id)} aria-label={l10n.getString('retail-held-cart-delete-aria')}>
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="retail-held-carts-actions">
              <button type="button" onClick={() => heldCarts.exit.requestClose()}>{l10n.getString('close')}</button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Shortcuts overlay ──────────────── */}
      {shortcuts.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-shortcuts-overlay${shortcuts.exit.exiting ? ' retail-shortcuts-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={l10n.getString('retail-shortcuts-title')}
          onClick={(e) => { if (e.target === e.currentTarget) shortcuts.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') shortcuts.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={shortcutsPanelRef}
            className={`retail-shortcuts-modal${shortcuts.exit.exiting ? ' retail-shortcuts-modal--exiting' : ''}`}
          >
            <h3 className="retail-shortcuts-heading">{l10n.getString('retail-shortcuts-title')}</h3>
            {/* Shortcut list is rendered from the typed manifest (retailShortcuts.ts)
                so the help overlay, function bar, and keydown handler cannot drift
                apart (KEY-02). F11 is listed as Quick Return — its single owner. */}
            <div className="retail-shortcuts-grid">
              {RETAIL_HELP_SHORTCUTS.map((s) => (
                <Fragment key={s.action}>
                  <span className="retail-shortcuts-key">{s.key}</span>
                  <span>{requiredLocalized(l10n, s.labelId)}</span>
                </Fragment>
              ))}
            </div>
            <button type="button" className="retail-shortcuts-close" onClick={() => shortcuts.exit.requestClose()}>{l10n.getString('close')}</button>
          </div>
        </div>
      </>)}

      {/* ── Price Override modal ───────────── */}
      {override.target && (
        <PriceOverrideModal
          open
          lineDescription={`${override.target.name} — ${formatMoney(override.target.unit_price)}`}
          currentPrice={override.target.unit_price}
          onConfirm={override.onConfirm}
          onClose={override.onClose}
        />
      )}

      {/* ── Edit Product modal ──────────────── */}
      <EditProductModal
        product={editProduct.product}
        isOpen={editProduct.isOpen}
        onClose={editProduct.onClose}
        onSave={editProduct.onSave}
        canEditCost={canEditCost}
        {...(sessionToken ? { sessionToken } : {})}
      />

      {/* ── Add Category modal ──────────────── */}
      <AddCategoryModal
        isOpen={addCategory.isOpen}
        onClose={addCategory.onClose}
        onSave={addCategory.onSave}
      />

      {/* ── Add Product modal ───────────────── */}
      <AddProductModal
        categories={addProduct.categories}
        isOpen={addProduct.isOpen}
        onClose={addProduct.onClose}
        onSave={addProduct.onSave}
        canEditCost={canEditCost}
      />

      {/* ── Quick Return modal ──────────────── */}
      {quickReturn.exit.shouldRender && (
        <>{/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className={`retail-shift-overlay${quickReturn.exit.exiting ? ' retail-shift-overlay--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={requiredLocalized(l10n, 'retail-quick-return-title')}
          onClick={(e) => { if (e.target === e.currentTarget) quickReturn.exit.requestClose(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') quickReturn.exit.requestClose(); }}
          tabIndex={-1}
        >
          <div
            ref={quickReturnPanelRef}
            className={`retail-shift-modal${quickReturn.exit.exiting ? ' retail-shift-modal--exiting' : ''}`}
          >
            <h3>{requiredLocalized(l10n, 'retail-quick-return-title')}</h3>
            <p className="retail-quick-return-desc">
              {requiredLocalized(l10n, 'retail-quick-return-desc')}
            </p>
            <input
              type="text"
              className="retail-sku-input retail-quick-return-input"
              value={quickReturn.barcode}
              onChange={(e) => quickReturn.onBarcodeChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') quickReturn.onSubmit(); }}
              placeholder={requiredLocalized(l10n, 'retail-quick-return-placeholder')}
              aria-label={requiredLocalized(l10n, 'retail-quick-return-aria')}
            />
            <div className="retail-shift-modal-actions">
              <button type="button" onClick={() => quickReturn.exit.requestClose()} disabled={quickReturn.loading}>
                {l10n.getString('cancel')}
              </button>
              <button type="button" className="retail-shift-confirm-btn" onClick={quickReturn.onSubmit} disabled={quickReturn.loading || !quickReturn.barcode.trim()}>
                {quickReturn.loading ? l10n.getString('loading') : (requiredLocalized(l10n, 'retail-quick-return-lookup'))}
              </button>
            </div>
          </div>
        </div>
      </>)}

      {/* ── Quick Return Refund modal ───────── */}
      {showQuickReturnRefund && quickReturnSale && (
        <RefundModal
          open
          sale={quickReturnSale}
          onClose={quickReturnRefundDone}
          onRefunded={quickReturnRefundDone}
        />
      )}

      {/* ── Scan flash overlay ─────────────── */}
      {scanFlash && <div className="retail-scan-flash" />}
    </>
  );
}
