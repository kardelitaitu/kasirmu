/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import { useCallback, useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Localized } from '@/components/Localized';
import { useLocalization } from '@fluent/react';
import { formatMoney, type CartLine, type LineId } from '@/types/domain';
import { animDuration } from '@/utils/animation';
import { triggerInteraction } from '@/utils/interaction';
import { useSwipe } from '@/hooks/useSwipe';
import { lineThumbnail } from '../utils/cartCalculations';

// ── Swipeable cart line item ──────────────────────────────────────────

/** Minus icon SVG */
function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Plus icon SVG */
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export interface CartLineItemProps {
  line: CartLine;
  onRemove: (line: CartLine) => void;
  onDecreaseQty: (line: CartLine) => void;
  onIncreaseQty: (line: CartLine) => void;
  onOverride?: (line: CartLine) => void;
  /**
   * Registers the line DOM node so the parent can move focus during
   * keyboard navigation (↑ / ↓). When omitted the line is rendered
   * focusless (e.g. in unit-test environments that don't render a DOM).
   */
  registerRef?: (lineId: LineId, el: HTMLDivElement | null) => void;
}

export function CartLineItem({
  line,
  onRemove,
  onDecreaseQty,
  onIncreaseQty,
  onOverride,
  registerRef,
}: CartLineItemProps) {
  const { l10n } = useLocalization();
  const [revealed, setRevealed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [qtyFlash, setQtyFlash] = useState(false);
  const prevQty = useRef(line.qty);
  const swipe = useSwipe({
    onSwipeLeft: () => setRevealed(true),
    onSwipeRight: () => setRevealed(false),
  });
  // Compute once per render.
  const thumbnail = lineThumbnail(String(line.sku));

  const MS_200 = animDuration(200);

  // When exit animation starts, remove the line after it completes.
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onRemove(line), MS_200);
    return () => clearTimeout(timer);
  }, [exiting, onRemove, line, MS_200]);

  // Flash + click on qty change.
  useEffect(() => {
    if (prevQty.current !== line.qty) {
      prevQty.current = line.qty;
      setQtyFlash(true);
      triggerInteraction('qty-change');
      const timer = setTimeout(() => setQtyFlash(false), 350);
      return () => clearTimeout(timer);
    }
  }, [line.qty]);

  const handleRemove = useCallback(() => {
    setExiting(true);
    setRevealed(false);
    triggerInteraction('remove-item');
  }, []);

  return (
    <div
      className={`pos-cart-line-wrap ${revealed ? 'pos-cart-line-wrap--revealed' : ''} ${exiting ? 'pos-cart-line-wrap--exiting' : ''} ${qtyFlash ? 'pos-cart-line-wrap--qty-flash' : ''}`}
      {...swipe}
    >
      <div
        className="pos-cart-line"
        ref={(el) => registerRef?.(line.id, el)}
        tabIndex={0}
        data-line-id={line.id}
        data-testid="cart-panel-line-item"
        role="group"
        aria-label={l10n.getString('pos-cart-line-aria', { sku: String(line.sku), qty: String(line.qty), amount: formatMoney(line.unit_price) })}
      >
        {/* 1 — Thumbnail */}
        <span
          className="pos-cart-line-thumb"
          style={{ '--thumb-hue': thumbnail.hue } as CSSProperties}
          aria-hidden="true"
        >
          {thumbnail.initial}
        </span>

        {/* 2 — Name + price */}
        <div className="pos-cart-line-info">
          <div className="pos-cart-line-name">{line.name ?? line.sku}</div>
          <div className="pos-cart-line-price">
            <span className="pos-cart-line-price-at">@</span> {formatMoney(line.unit_price)}
          </div>
          {onOverride && (
            <button
              type="button"
              className="pos-cart-line-override"
              onClick={() => onOverride(line)}
              aria-label={l10n.getString('pos-cart-line-override-aria', { name: line.name ?? line.sku }, 'Override price')}
            >
              <Localized id="pos-cart-line-override">Override</Localized>
            </button>
          )}
        </div>

        {/* 3 — Qty controls */}
        <div className="pos-cart-line-controls">
          <button
            type="button"
            className="pos-cart-qty-btn"
            onClick={() => onDecreaseQty(line)}
            disabled={line.qty <= 1}
            aria-label={l10n.getString('pos-cart-line-decrease-aria', { sku: String(line.sku) })}
          >
            <MinusIcon />
          </button>
          <span className="pos-cart-qty-value" aria-label={l10n.getString('pos-cart-line-qty-aria', { qty: String(line.qty) })}>
            {line.qty}
          </span>
          <button
            type="button"
            className="pos-cart-qty-btn"
            onClick={() => onIncreaseQty(line)}
            aria-label={l10n.getString('pos-cart-line-increase-aria', { sku: String(line.sku) })}
          >
            <PlusIcon />
          </button>
        </div>

        {/* 4 — Remove button */}
        <button
          type="button"
          className="pos-cart-line-remove"
          onClick={handleRemove}
          aria-label={l10n.getString('pos-cart-line-remove-aria', { sku: String(line.sku) })}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Category ribbon */}
        {line.category && (
          <span
            className="pos-cart-line-ribbon"
            style={{ '--thumb-hue': thumbnail.hue } as CSSProperties}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Revealed swipe action */}
      <div className="pos-cart-line-swipe-action" aria-hidden={!revealed}>
        <button
          type="button"
          className="pos-cart-line-swipe-remove"
          onClick={handleRemove}
          aria-label={l10n.getString('pos-cart-line-swipe-remove-aria', { sku: String(line.sku) })}
        >
          <Localized id="pos-cart-remove">
            <span>Remove</span>
          </Localized>
        </button>
      </div>
    </div>
  );
}
