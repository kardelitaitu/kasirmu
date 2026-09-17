import { useState, useCallback, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import { Localized } from '@/components/Localized';
import { processRefundScoped, type ProcessRefundScopedArgs, type SaleDetail } from '@/api/sales';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { formatMoney, type Money } from '@/types/domain';
import { Button } from '@/components/Button';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';
import './RefundModal.css';

interface RefundModalProps {
  open: boolean;
  sale: SaleDetail;
  onClose: () => void;
  onRefunded: () => void;
}

/** Refund modal — select line items to refund with quantity, reason, and note. Dispatches the refund to the backend on confirm. */
export default function RefundModal({ open, sale, onClose, onRefunded }: RefundModalProps) {
  const { l10n } = useLocalization();
  // Date follows the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const { session } = useAuth();
  const { sessionToken } = useWorkspace();
  const [selectedLines, setSelectedLines] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ refundId: string; totalMinor: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggleLine = useCallback((lineId: string, maxQty: number) => {
    setSelectedLines((prev) => {
      const current = prev[lineId] ?? 0;
      if (current > 0) {
        const next = { ...prev };
        delete next[lineId];
        return next;
      }
      return { ...prev, [lineId]: maxQty };
    });
  }, []);

  const updateQty = useCallback((lineId: string, qty: number) => {
    setSelectedLines((prev) => {
      if (qty <= 0) {
        const next = { ...prev };
        delete next[lineId];
        return next;
      }
      return { ...prev, [lineId]: qty };
    });
  }, []);

  const totalRefund = sale.lines.reduce((sum, line) => {
    const qty = selectedLines[line.id] ?? 0;
    return sum + (line.total_minor ?? 0) * qty / (line.qty ?? 1);
  }, 0);

  const hasSelection = Object.values(selectedLines).some((q) => q > 0);

  const handleRefund = useCallback(async () => {
    if (!session || !sessionToken || !hasSelection || !reason.trim()) return;
    setProcessing(true);
    setError(null);
    try {
      const lines = sale.lines
        .filter((l) => (selectedLines[l.id] ?? 0) > 0)
        .map((l) => {
          const qty = selectedLines[l.id]!;
          const unitPriceMinor = Math.round((l.total_minor ?? 0) / (l.qty ?? 1));
          return {
            saleLineId: l.id,
            sku: l.sku,
            qty,
            unitPriceMinor,
            currency: sale.total.currency,
            lineTotalMinor: unitPriceMinor * qty,
          };
        });
      const scopedArgs: ProcessRefundScopedArgs = {
        saleId: sale.id,
        reason: reason.trim(),
        note: note.trim() || null,
        lines,
      };
      const res = await processRefundScoped(sessionToken, scopedArgs);
      setResult(res);
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'refund-error'));
    } finally {
      setProcessing(false);
    }
  }, [session, sessionToken, hasSelection, reason, note, selectedLines, sale, l10n]);

 

  // Mirror the entry animations with a 200ms layered exit fade so the
  // × / Cancel / Done buttons don't snap. Mirrors PosScreen's cousin-
  // modals pattern (commit 1408992): the overlay and modal container
  // each get their own `--exiting` class so two mirrored keyframes
  // play in parallel. Declared BEFORE handleDone so the callback can
  // reference it.
  const exit = useExitAnimation(open, onClose);

  const handleDone = useCallback(() => {
    // Notify the parent FIRST (so any post-refund side effects —
    // toast, refresh ledger, etc — happen immediately, not after
    // the 200 ms fade). Then trigger the fade-out via the hook; the
    // hook will call `onClose()` (the prop) after the fade, which
    // flips the parent's `open` to false and unmounts.
    onRefunded();
    exit.requestClose();
  }, [onRefunded, exit]);

  // ── Focus trap (Escape + Tab cycling) ─────────────────────
  useFocusTrap(panelRef, open && !exit.exiting && !processing, () => exit.requestClose());

  if (!exit.shouldRender) return null;

  // Use direct aria-label rather than wrapping in <Localized attrs>.
  // Observed in jsdom tests (in this codebase) to render the dialog
  // body empty when <Localized attrs={{ 'aria-label': true }}> wraps
  // a complex overlay with deep nested children. Regardless, the
  // direct-aria-label pattern matches 124+ established usages in this
  // codebase for dialog overlays (PaymentModal, ShiftManagementScreen,
  // every *ManagementScreen modal) so it's the safer choice here.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`refund-overlay${exit.exiting ? ' refund-overlay--exiting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={l10n.getString('refund-dialog-aria')}
      onClick={(e) => { if (e.target === e.currentTarget) exit.requestClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') exit.requestClose(); }}
      tabIndex={-1}
    >
      <div
        className={`refund-modal${exit.exiting ? ' refund-modal--exiting' : ''}`}
        ref={panelRef}
      >
        {result ? (
          <div className="refund-done">
            <Localized id="refund-done-title">
              <h2 className="refund-done-title">Refund Processed</h2>
            </Localized>
            <Localized
              id="refund-done-amount"
              vars={{ amount: formatMoney({ minor_units: result.totalMinor, currency: sale.total.currency } as Money) }}
            >
              <p className="refund-done-amount">
                Refunded: {formatMoney({ minor_units: result.totalMinor, currency: sale.total.currency } as Money)}
              </p>
            </Localized>
            <Localized id="refund-done">
              <Button variant="primary" onClick={handleDone}>
                Done
              </Button>
            </Localized>
          </div>
        ) : (
          <>
            <div className="refund-header">
              <Localized id="refund-title">
                <h2 className="refund-title">Process Refund</h2>
              </Localized>
              <Localized id="refund-close-aria" attrs={{ 'aria-label': true }}>
                <button
                  type="button"
                  className="refund-close"
                  onClick={() => exit.requestClose()}
                  disabled={exit.exiting}
                  aria-label={l10n.getString('cancel-refund-aria')}
                >
                &times;
              </button>
              </Localized>
            </div>

            <div className="refund-sale-info">
              <Localized id="refund-sale-id" vars={{ id: sale.id.slice(0, 8) }}>
                <span>Sale: {sale.id.slice(0, 8)}&hellip;</span>
              </Localized>
              <Localized id="refund-sale-total" vars={{ amount: formatMoney(sale.total as Money) }}>
                <span>Total: {formatMoney(sale.total as Money)}</span>
              </Localized>
              <Localized id="refund-sale-date" vars={{ date: new Date(sale.createdAt).toLocaleDateString(numLocale) }}>
                <span>Date: {new Date(sale.createdAt).toLocaleDateString(numLocale)}</span>
              </Localized>
            </div>

            <div className="refund-lines">
              <Localized id="refund-items-title">
                <h3 className="refund-section-title">Select Items to Refund</h3>
              </Localized>
              {sale.lines.map((line) => {
                const selectedQty = selectedLines[line.id] ?? 0;
                return (
                  <div key={line.id} className={`refund-line ${selectedQty > 0 ? 'refund-line-selected' : ''}`}>
                      <label className="refund-line-label">
                        <Localized id="refund-item-aria" vars={{ sku: line.sku }} attrs={{ 'aria-label': true }}>
                          <input
                            type="checkbox"
                            checked={selectedQty > 0}
                            onChange={() => toggleLine(line.id, line.qty ?? 1)}
                            aria-label={`Refund ${line.sku}`}
                          />
                        </Localized>
                      <span className="refund-line-sku">{line.sku}</span>
                      <span className="refund-line-name">{line.name ?? line.sku}</span>
                      </label>
                    {selectedQty > 0 && (
                      <div className="refund-line-qty">
                        <Localized id="refund-qty-decrease-aria" attrs={{ 'aria-label': true }}>
                          <button
                            type="button"
                            className="refund-qty-btn"
                            onClick={() => updateQty(line.id, selectedQty - 1)}
                            disabled={selectedQty <= 1}
                            aria-label={l10n.getString('decrease-qty-aria')}
                          >−</button>
                        </Localized>
                        <span className="refund-qty-value">{selectedQty}</span>
                        <Localized id="refund-qty-increase-aria" attrs={{ 'aria-label': true }}>
                          <button
                            type="button"
                            className="refund-qty-btn"
                            onClick={() => updateQty(line.id, selectedQty + 1)}
                            disabled={selectedQty >= (line.qty ?? 1)}
                            aria-label={l10n.getString('increase-qty-aria')}
                          >+</button>
                        </Localized>
                        <span className="refund-line-total">
                          {formatMoney({
                            minor_units: Math.round((line.total_minor ?? 0) * selectedQty / (line.qty ?? 1)),
                            currency: sale.total.currency,
                          } as Money)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="refund-details">
              <label className="refund-field">
                <Localized id="refund-reason-label">
                  <span>Reason *</span>
                </Localized>
                <Localized id="refund-reason-placeholder" attrs={{ placeholder: true }}>
                  <input
                    type="text"
                    className="refund-input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    aria-label={l10n.getString('refund-reason-aria')}
                  />
                </Localized>
              </label>
              <label className="refund-field">
                <Localized id="refund-note-label">
                  <span>Note (internal)</span>
                </Localized>
                <Localized id="refund-note-placeholder" attrs={{ placeholder: true }}>
                  <input
                    type="text"
                    className="refund-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-label={l10n.getString('refund-note-aria')}
                  />
                </Localized>
              </label>
            </div>

            {error && <div className="refund-error">{error}</div>}

            <div className="refund-total-row">
              <Localized id="refund-total-label">
                <span className="refund-total-label">Refund Total</span>
              </Localized>
              <span className="refund-total-amount">
                {formatMoney({ minor_units: totalRefund, currency: sale.total.currency } as Money)}
              </span>
            </div>

            <div className="refund-actions">
              <Localized id="refund-cancel">
                <Button
                  variant="ghost"
                  onClick={() => exit.requestClose()}
                  disabled={processing || exit.exiting}
                >
                  Cancel
                </Button>
              </Localized>
              <Localized id="refund-submit">
                <Button
                  variant="primary"
                  loading={processing}
                  disabled={!hasSelection || !reason.trim()}
                  onClick={handleRefund}
                >
                  Process Refund
                </Button>
              </Localized>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
