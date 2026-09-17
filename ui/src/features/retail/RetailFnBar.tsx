import type { RefObject } from 'react';
import { requiredLocalized } from '@/components';
import { useLocalization } from '@fluent/react';
import { useFeatures, FEATURES } from '@/hooks/useFeatures';
import { getRetailShortcut } from './retailShortcuts';

/**
 * Resolve the canonical function-key label for an action from the shortcut
 * manifest (KEY-02) — the FnBar, help overlay, and keydown handler all derive
 * from the same source so they cannot drift. Falls back to the action id so a
 * missing manifest entry fails visibly.
 */
function fnKey(action: string): string {
  return getRetailShortcut(action)?.key ?? action;
}

interface RetailFnBarProps {
  linesLength: number;
  heldCartId: string | null;
  activeShift: boolean;
  onPay: () => void;
  onRequestClear: () => void;
  onShowDiscount: () => void;
  onHoldResume: () => void;
  onShowSalesHistory: () => void;
  onShowCustomerSearch: () => void;
  onShowStockInquiry: () => void;
  onToggleShift: () => void;
  onOpenSettings: () => void;
  onShowQuickReturn: () => void;
  onShowTables: () => void;
  onNavigateKds: (() => void) | undefined;
  skuInputRef: RefObject<HTMLInputElement | null>;
}

/** Function key bar (F1–F12) for the retail POS terminal. Pure presentational — all callbacks are wired in the parent. */
export default function RetailFnBar({
  linesLength,
  heldCartId,
  activeShift,
  onPay,
  onRequestClear,
  onShowDiscount,
  onHoldResume,
  onShowSalesHistory,
  onShowCustomerSearch,
  onShowStockInquiry,
  onToggleShift,
  onOpenSettings,
  onShowQuickReturn,
  onShowTables,
  onNavigateKds,
  skuInputRef,
}: RetailFnBarProps) {
  const { l10n } = useLocalization();
  const { isEnabled } = useFeatures();

  return (
    <div className="retail-fn-bar" role="toolbar" aria-label={requiredLocalized(l10n, 'retail-fn-bar-aria')}>
      <button type="button" className="retail-fn-btn" onClick={onPay} disabled={linesLength === 0} aria-keyshortcuts={fnKey('pay')}>
        <span className="retail-fn-key">{fnKey('pay')}</span> {l10n.getString('sale-pay-button')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onRequestClear} disabled={linesLength === 0} aria-keyshortcuts={fnKey('void')}>
        <span className="retail-fn-key">{fnKey('void')}</span> {l10n.getString('retail-fn-void')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onShowDiscount} disabled={linesLength === 0} aria-keyshortcuts={fnKey('discount')}>
        <span className="retail-fn-key">{fnKey('discount')}</span> {l10n.getString('retail-fn-diskon')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onHoldResume} disabled={!heldCartId && linesLength === 0} aria-keyshortcuts={fnKey('hold-resume')}>
        <span className="retail-fn-key">{fnKey('hold-resume')}</span> {heldCartId ? (requiredLocalized(l10n, 'retail-resume-button')) : (requiredLocalized(l10n, 'pos-cart-hold'))}
      </button>
      <button type="button" className="retail-fn-btn" onClick={() => skuInputRef.current?.focus()} aria-keyshortcuts={fnKey('focus-sku')}>
        <span className="retail-fn-key">{fnKey('focus-sku')}</span> {l10n.getString('retail-fn-cari')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onShowSalesHistory} aria-keyshortcuts={fnKey('sales-history')}>
        <span className="retail-fn-key">{fnKey('sales-history')}</span> {l10n.getString('retail-fn-history')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onShowCustomerSearch} aria-keyshortcuts={fnKey('customer-search')}>
        <span className="retail-fn-key">{fnKey('customer-search')}</span> {l10n.getString('retail-fn-pelanggan')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onShowStockInquiry} aria-keyshortcuts={fnKey('stock-inquiry')}>
        <span className="retail-fn-key">{fnKey('stock-inquiry')}</span> {l10n.getString('retail-fn-stok')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onToggleShift} aria-keyshortcuts={fnKey('shift')}>
        <span className="retail-fn-key">{fnKey('shift')}</span> {activeShift ? l10n.getString('pos-shift-close-btn') : l10n.getString('pos-shift-open-btn')} {l10n.getString('retail-fn-shift')}
      </button>
      <button type="button" className="retail-fn-btn" onClick={onOpenSettings} aria-keyshortcuts={fnKey('options')}>
        <span className="retail-fn-key">{fnKey('options')}</span> {l10n.getString('retail-fn-options')}
      </button>
      {isEnabled(FEATURES.QUICK_RETURN) && (
        <button type="button" className="retail-fn-btn" onClick={onShowQuickReturn} aria-keyshortcuts={fnKey('quick-return')}>
          <span className="retail-fn-key">{fnKey('quick-return')}</span> {requiredLocalized(l10n, 'retail-fn-quick-return')}
        </button>
      )}
      <button type="button" className="retail-fn-btn" onClick={onNavigateKds} disabled={!onNavigateKds} aria-keyshortcuts={fnKey('navigate-kds')}>
        <span className="retail-fn-key">{fnKey('navigate-kds')}</span> {requiredLocalized(l10n, 'kds-title')}
      </button>
      {isEnabled(FEATURES.TABLE_MANAGEMENT) && (
        <button type="button" className="retail-fn-btn" onClick={onShowTables} aria-label={requiredLocalized(l10n, 'tables-title')}>
          <span aria-hidden="true">🪑</span> {requiredLocalized(l10n, 'tables-title')}
        </button>
      )}
    </div>
  );
}
