import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useLocalization } from '@fluent/react';
import { Localized } from '@/components/Localized';
import { Button } from '@/components/Button';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatMoney, type CartLine, type LineId, type Money } from '@/types/domain';
import './SplitBillModal.css';

export interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: CartLine[];
  currency: string;
  tableNumber?: string | undefined;
  /**
   * The order's type. The header names the table, and a table only identifies a
   * DINE-IN order — the Table field renders on restaurant POS unconditionally
   * (the context-row gate in CartPanel: `showTableNumberSetting || activeWorkspace ===
   * 'restaurant-pos'`), so a takeaway with a stray number announced a table on
   * the split dialog. Optional with a dine-in default so existing renders are
   * unchanged.
   */
  orderType?: 'dine_in' | 'takeaway' | 'delivery' | undefined;
  /**
   * Commit the split. Resolve with `false` to say the split did NOT commit —
   * the parent has already reported why — and the modal will stay OPEN with
   * the selection intact so the cashier can retry or cancel.
   *
   * This exists because resolving with nothing was ambiguous: the parent's
   * balance-the-remaining-tab failure path `return`s (the `return false;` in
   * `handleConfirmSplitBill`, the round-65 fix that stopped a double charge), and a
   * plain `return` resolves
   * the promise. The modal's `finally` then closed it, so the recovery the
   * parent promised — "keeps the cart intact and the split modal open" —
   * never happened. The toast flashed and the dialog vanished.
   */
  onConfirmSplit: (selectedLines: CartLine[], remainingLines: CartLine[]) => Promise<boolean | void> | boolean | void;
}

export function SplitBillModal({
  isOpen,
  onClose,
  lines,
  currency,
  tableNumber,
  orderType = 'dine_in',
  onConfirmSplit,
}: SplitBillModalProps) {
  const { l10n } = useLocalization();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen, onClose);

  // Map each line ID to the quantity selected to pay now (0 .. line.qty)
  const [selectedQtys, setSelectedQtys] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  /** Synchronous mirror of `submitting` — see the re-entry guard in `handleConfirm`. */
  const submittingRef = useRef(false);

  // Initialize or reset selections when modal opens or lines change
  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, number> = {};
      lines.forEach((l) => {
        initial[l.id] = 0;
      });
      // By default select the first item so the user immediately sees how it works
      if (lines.length > 0 && lines[0]) {
        initial[lines[0].id] = 1;
      }
      setSelectedQtys(initial);
      setSubmitting(false);
    }
  }, [isOpen, lines]);

  const updateLineQty = useCallback((lineId: LineId, delta: number, maxQty: number) => {
    setSelectedQtys((prev) => {
      const current = prev[lineId] ?? 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [lineId]: next };
    });
  }, []);

  /**
   * Tap a line to take it all, tap it again to drop it back to nothing.
   *
   * ⚠️ THE PARTIAL CASE USED TO FALL THROUGH TO "NONE". The rule was
   * `current === 0 ? maxQty : 0`, so a line with ANY units chosen went to zero on
   * the next tap. That combined badly with the auto-selection above: the modal
   * opens with the first line set to 1, so the FIRST tap on it — the one a waiter
   * makes to take the whole item — emptied it. Measured: [1, 3] -> tap -> [0, 3].
   *
   * The rule that matches the gesture is a two-state toggle between the CEILING and
   * zero, so a partially-chosen line goes to full rather than to none:
   *
   *   current === 0  -> maxQty   (nothing chosen: take it all)
   *   0 < current < maxQty -> maxQty   (PARTIAL: take it to the ceiling — this is
   *     the case the old rule got wrong, because a partially-chosen line fell
   *     through to "take it back" and emptied it)
   *   current >= maxQty -> 0        (already full: take it back)
   *
 * The auto-selection stays — it is what shows the operator how the dialog works,
 * `initial[lines[0].id] = 1` in the seeding effect — and this change is what makes it harmless.
   */
  const toggleLineFull = useCallback((lineId: LineId, maxQty: number) => {
    setSelectedQtys((prev) => {
      const current = prev[lineId] ?? 0;
      const resolved =
        current === 0 || current < maxQty ? maxQty : 0;
      return { ...prev, [lineId]: resolved };
    });
  }, []);

  // Compute selected lines (to pay now) and remaining lines (to keep on tab)
  const { selectedLines, remainingLines, selectedTotalMinor, remainingTotalMinor } = useMemo(() => {
    const selected: CartLine[] = [];
    const remaining: CartLine[] = [];
    let selMinor = 0;
    let remMinor = 0;

    lines.forEach((l) => {
      const chosenQty = selectedQtys[l.id] ?? 0;
      const remainingQty = l.qty - chosenQty;

      if (chosenQty > 0) {
        selected.push({
          ...l,
          qty: chosenQty,
          ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: Math.min(chosenQty, l.dispatchedQty) } : {}),
        });
        selMinor += l.unit_price.minor_units * chosenQty;
      }

      if (remainingQty > 0) {
        remaining.push({
          ...l,
          qty: remainingQty,
          ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: Math.min(remainingQty, l.dispatchedQty) } : {}),
        });
        remMinor += l.unit_price.minor_units * remainingQty;
      }
    });

    return {
      selectedLines: selected,
      remainingLines: remaining,
      selectedTotalMinor: selMinor,
      remainingTotalMinor: remMinor,
    };
  }, [lines, selectedQtys]);

  const handleConfirm = useCallback(async () => {
    if (selectedLines.length === 0) return;
    // Synchronous re-entry guard. The confirm button renders `state={submitting ?
    // 'processing' : 'ready'}`, and Button derives `disabled` from that state -- but React
    // commits state on the NEXT render, so two clicks inside one tick both read `ready`
    // here. Replaying this callback bills the SAME items twice: the caller creates the
    // selected partition as its own sale.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Only an EXPLICIT `false` keeps the modal open. Every other resolution —
      // including `undefined`, which is what a parent that merely has no return
      // value produces — closes it, so this stays backward-compatible with the
      // success paths and with callers that never opted in.
      const committed = await onConfirmSplit(selectedLines, remainingLines);
      if (committed === false) return;
      onClose();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [selectedLines, remainingLines, onConfirmSplit, onClose]);

  if (!isOpen) return null;

  const selMoney: Money = { minor_units: selectedTotalMinor, currency };
  const remMoney: Money = { minor_units: remainingTotalMinor, currency };

  return (
    <div className="pos-split-modal-overlay" role="presentation">
      <div
        className="pos-split-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={l10n.getString('pos-split-modal-title') || 'Split Bill by Item'}
        data-testid="pos-split-bill-modal"
      >
        <header className="pos-split-modal-header">
          <h2 className="pos-split-modal-title">
            <Localized id="pos-split-modal-title">
              <span>Split Bill by Item</span>
            </Localized>
            {/* DINE-IN ONLY — a table only identifies a dine-in order; see the prop doc. */}
            {orderType === 'dine_in' && tableNumber && (
              <span style={{ fontWeight: 400, marginLeft: '6px' }}>({tableNumber})</span>
            )}
          </h2>
          <button
            type="button"
            className="pos-split-modal-close-btn"
            onClick={onClose}
            aria-label={l10n.getString('close') || 'Close'}
          >
            ✕
          </button>
        </header>

        <div className="pos-split-modal-list">
          {lines.map((line) => {
            const count = selectedQtys[line.id] ?? 0;
            const isSelected = count > 0;
            const lineTotal: Money = {
              minor_units: line.unit_price.minor_units * line.qty,
              currency: line.unit_price.currency,
            };

            return (
              <div
                key={line.id}
                className={`pos-split-item-row${isSelected ? ' pos-split-item-row--selected' : ''}`}
              >
                <div
                  className="pos-split-item-info"
                  onClick={() => toggleLineFull(line.id, line.qty)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleLineFull(line.id, line.qty);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="pos-split-item-name">{line.name}</div>
                  <div className="pos-split-item-price">
                    {formatMoney(line.unit_price)} × {line.qty} = {formatMoney(lineTotal)}
                  </div>
                </div>

                <div className="pos-split-qty-controls">
                  <button
                    type="button"
                    className="pos-split-qty-btn"
                    onClick={() => updateLineQty(line.id, -1, line.qty)}
                    disabled={count <= 0}
                    aria-label={`Decrease ${line.name}`}
                  >
                    −
                  </button>
                  <span className="pos-split-qty-val" aria-live="polite">
                    {count} / {line.qty}
                  </span>
                  <button
                    type="button"
                    className="pos-split-qty-btn"
                    onClick={() => updateLineQty(line.id, 1, line.qty)}
                    disabled={count >= line.qty}
                    aria-label={`Increase ${line.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pos-split-modal-summary">
          <div className="pos-split-summary-col">
            <span className="pos-split-summary-label">
              <Localized id="pos-split-modal-pay-now">
                <span>Pay Selected Now</span>
              </Localized>
            </span>
            <span className="pos-split-summary-amount pos-split-summary-amount--highlight">
              {formatMoney(selMoney)}
            </span>
          </div>

          <div className="pos-split-summary-col" style={{ textAlign: 'right' }}>
            <span className="pos-split-summary-label">
              <Localized id="pos-split-modal-remaining">
                <span>Keep on Tab</span>
              </Localized>
            </span>
            <span className="pos-split-summary-amount">
              {formatMoney(remMoney)}
            </span>
          </div>
        </div>

        <footer className="pos-split-modal-actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <Localized id="pos-split-modal-cancel">
              <span>Cancel</span>
            </Localized>
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={selectedLines.length === 0}
            state={submitting ? 'processing' : 'ready'}
            onClick={handleConfirm}
            data-testid="pos-split-modal-confirm-btn"
          >
            <Localized
              id="pos-split-modal-confirm-pay"
              vars={{ amount: formatMoney(selMoney) }}
            >
              <span>Pay Selected ({formatMoney(selMoney)})</span>
            </Localized>
          </Button>
        </footer>
      </div>
    </div>
  );
}
