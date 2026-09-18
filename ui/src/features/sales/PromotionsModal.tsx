import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { animDuration } from '@/utils/animation';
import { listPromotionsScoped, type Promotion } from '@/api/promotions';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';
import { evaluatePromotionEligibility } from './promotionEligibility';
import './PromotionsModal.css';

/** Props for the PromotionsModal — lets the cashier pick eligible promotions for the current cart. */
export interface PromotionsModalProps {
  open: boolean;
  sessionToken: string;
  /** Cart subtotal in minor units — used for min-order eligibility. */
  subtotalMinor: number;
  /** Promotion ids already applied to the cart (seeds the selection). */
  initiallySelectedIds?: string[];
  /** Called with the full promotion selection when the cashier confirms. */
  onApply: (selected: Promotion[]) => void;
  onClose: () => void;
}

/**
 * Promotions picker — multi-select over active promotions. Since PROMO-3
 * the selection rides to checkout as `promotionIds` and the backend engine
 * applies each against the post-tax sale (percentage, fixed amount, and
 * buy-x-get-y alike), so all engine kinds are selectable here.
 */
export default function PromotionsModal({
  open,
  sessionToken,
  subtotalMinor,
  initiallySelectedIds = [],
  onApply,
  onClose,
}: PromotionsModalProps) {
  const { l10n } = useLocalization();
  const ANIM_MS = animDuration(300);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      exitTimerRef.current = null;
      onClose();
    }, ANIM_MS);
  }, [onClose, ANIM_MS]);

  const [promos, setPromos] = useState<Promotion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useFocusTrap(panelRef, open, handleClose);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPromos(null);
    setLoadError(null);
    setSelectedIds(new Set(initiallySelectedIds));
    const load = listPromotionsScoped(sessionToken);
    load
      .then((list) => {
        if (cancelled) return;
        // Only currently-active promotions are pickable.
        setPromos(list.filter((p) => p.active));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(l10nErrorMessage(err, l10n, 'pos-promotions-load-failed'));
      });
    return () => {
      cancelled = true;
    };
    // Re-seed the selection whenever the modal is re-opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionToken, l10n]);

  if (!open) return null;

  const items = promos ? evaluatePromotionEligibility(promos, subtotalMinor) : null;
  const selectedPromos = (promos ?? []).filter((p) => selectedIds.has(p.id));

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div
      className={`promo-picker-overlay${exiting ? ' promo-picker-overlay--exiting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={requiredLocalized(l10n, 'pos-promotions-dialog-aria')}
    >
      <div className={`promo-picker-modal${exiting ? ' promo-picker-modal--exiting' : ''}`} ref={panelRef}>
          <button
            type="button"
            className="promo-picker-close"
            onClick={handleClose}
            aria-label={requiredLocalized(l10n, 'pos-promotions-close-aria')}
          >
            &times;
          </button>

          <Localized id="pos-promotions-title">
            <h2 className="promo-picker-title">Promotions</h2>
          </Localized>

          {loadError && (
            <div className="promo-picker-error" role="alert">
              {loadError}
            </div>
          )}

          {!items && !loadError && (
            <div className="promo-picker-loading" role="status">
              {requiredLocalized(l10n, 'pos-promotions-loading')}
            </div>
          )}

          {items && items.length === 0 && (
            <p className="promo-picker-empty">{requiredLocalized(l10n, 'pos-promotions-empty')}</p>
          )}

          {items && items.length > 0 && (
            <ul className="promo-picker-list">
              {items.map(({ promo, kind }) => {
                const checked = selectedIds.has(promo.id);
                return (
                  <li key={promo.id} className="promo-picker-item">
                    <button
                      type="button"
                      className={`promo-picker-item-btn${kind === 'eligible' ? '' : ' promo-picker-item-btn--disabled'}${checked ? ' promo-picker-item-btn--selected' : ''}`}
                      disabled={kind !== 'eligible'}
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggle(promo.id)}
                      aria-label={
                        kind === 'eligible'
                          ? l10n.getString('pos-promotions-toggle-aria', { name: promo.name })
                          : l10n.getString('pos-promotions-unavailable-aria', { name: promo.name })
                      }
                    >
                      <span className="promo-picker-item-check" aria-hidden="true">
                        {checked ? '✓' : ''}
                      </span>
                      <span className="promo-picker-item-name">{promo.name}</span>
                      <span className="promo-picker-item-value">
                        {promo.promo_type === 'percentage'
                          ? requiredLocalized(l10n, 'pos-promotions-value-percent', { value: String(promo.value_minor) })
                          : promo.promo_type === 'fixed_amount'
                            ? requiredLocalized(l10n, 'pos-promotions-value-fixed', { value: String(promo.value_minor) })
                            : requiredLocalized(l10n, 'pos-promotions-value-bxgy')}
                      </span>
                      <span className="promo-picker-item-hint">
                        {kind === 'eligible'
                          ? (promo.description || promo.name)
                          : kind === 'below-min-order'
                            ? requiredLocalized(l10n, 'pos-promotions-min-order', {
                                min: String(promo.min_order_minor),
                              })
                            : requiredLocalized(l10n, 'pos-promotions-not-applicable')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {items && items.length > 0 && (
            <div className="promo-picker-footer">
              <span className="promo-picker-count" role="status">
                {requiredLocalized(l10n, 'pos-promotions-selected-count', { count: String(selectedPromos.length) })}
              </span>
              <button
                type="button"
                className="promo-picker-apply"
                disabled={selectedPromos.length === 0}
                onClick={() => onApply(selectedPromos)}
              >
                {requiredLocalized(l10n, 'pos-promotions-apply-selected')}
              </button>
            </div>
          )}
      </div>
    </div>
  );
}
