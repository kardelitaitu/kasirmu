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
  onConfirmSplit: (selectedLines: CartLine[], remainingLines: CartLine[]) => Promise<void> | void;
}

export function SplitBillModal({
  isOpen,
  onClose,
  lines,
  currency,
  tableNumber,
  onConfirmSplit,
}: SplitBillModalProps) {
  const { l10n } = useLocalization();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen, onClose);

  // Map each line ID to the quantity selected to pay now (0 .. line.qty)
  const [selectedQtys, setSelectedQtys] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

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

  const toggleLineFull = useCallback((lineId: LineId, maxQty: number) => {
    setSelectedQtys((prev) => {
      const current = prev[lineId] ?? 0;
      const next = current === 0 ? maxQty : 0;
      return { ...prev, [lineId]: next };
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
        });
        selMinor += l.unit_price.minor_units * chosenQty;
      }

      if (remainingQty > 0) {
        remaining.push({
          ...l,
          qty: remainingQty,
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
    if (selectedLines.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onConfirmSplit(selectedLines, remainingLines);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [selectedLines, remainingLines, submitting, onConfirmSplit, onClose]);

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
        <div className="pos-split-modal-header">
          <h2 className="pos-split-modal-title">
            <Localized id="pos-split-modal-title">
              <span>Split Bill by Item</span>
            </Localized>
            {tableNumber && <span style={{ fontWeight: 400, marginLeft: '6px' }}>({tableNumber})</span>}
          </h2>
          <button
            type="button"
            className="pos-split-modal-close-btn"
            onClick={onClose}
            aria-label={l10n.getString('close') || 'Close'}
          >
            ✕
          </button>
        </div>

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

        <div className="pos-split-modal-actions">
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
        </div>
      </div>
    </div>
  );
}
