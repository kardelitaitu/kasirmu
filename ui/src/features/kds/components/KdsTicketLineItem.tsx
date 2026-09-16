/**
 * Kds UI — one line-item row of a KDS ticket card.
 *
 * Relocated verbatim from `KdsTicketCard.tsx` (the item loop inside each
 * course group) by the Agent-2 extraction, Phase 2.1 of
 * `todo-refactor-kds-agents-2.md`: qty x name, status dot + label, the
 * served-duration stamp, the modifier-badge row, and the per-item advance
 * behind its 200 ms cooldown guard. `itemDone` and `fmtDuration` moved
 * WITH the JSX that consumes them; the card re-exports both so every
 * pre-existing importer keeps resolving from its original path.
 */
import { memo } from 'react';
import { useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import type { KdsLineItem } from '@/api/kds';
import { createCooldownWrapper } from '@/features/kds/hooks/useActionCooldown';
import { ModifierBadge } from '@/features/kds/components/ModifierBadge';

/** Format duration in seconds as a human-readable string (e.g. "3m 12s", "1h 5m"). */
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

/**
 * An item is "done" when it has been served (or cancelled — off the board).
 *
 * Takes the structural minimum rather than a full KdsLineItem: the body reads exactly one
 * field, and the wider `Pick<...>` accepts every KdsLineItem unchanged while letting callers
 * (and tests) pass a fixture without inventing unrelated fields. This is a widening, not a
 * behaviour change -- both production call sites pass real items.
 */
export function itemDone(item: Pick<KdsLineItem, 'item_status'>): boolean {
  return item.item_status === 'served' || item.item_status === 'cancelled';
}

export interface KdsTicketLineItemProps {
  /** The line item to render. */
  item: KdsLineItem;
  /** `order.display_number ?? order.id` — the shipped data-testid prefix is `${base}-item-${id}`. */
  testIdBase: string | number;
  /** Parent order's ISO `received_at`; the served-duration stamp is measured from it. */
  receivedAt: string;
  /** Called when the row is tapped to advance this item's status. */
  onAdvanceItem?: ((item: KdsLineItem) => void) | undefined;
}

/** One course-grouped row on the ticket card; see the module doc for provenance. */
export const KdsTicketLineItem = memo(function KdsTicketLineItem({
  item, testIdBase, receivedAt, onAdvanceItem,
}: KdsTicketLineItemProps) {
  const { l10n } = useLocalization();
  const done = itemDone(item);
  const canAdvanceItem = !done;
  return (
    <div className="kds-item">
      <button
        className={`kds-item-row${done ? ' done' : ''}${canAdvanceItem ? ' kds-ticket-item-row--actionable' : ''}`}
        onClick={(e) => {
          if (canAdvanceItem && onAdvanceItem) {
            e.stopPropagation();
            createCooldownWrapper(() => onAdvanceItem(item), 200)();
          }
        }}
        onKeyDown={canAdvanceItem ? (e) => {
          // role="button" handles Enter natively via onClick.
          if (e.key === 'Enter') e.stopPropagation();
        } : undefined}
        aria-label={canAdvanceItem ? `${item.display_name} — ${requiredLocalized(l10n, `kds-item-status-${item.item_status}`)}` : undefined}
        data-testid={`kds-order-card-${testIdBase}-item-${item.id}`}
      >
        <span className="kds-item-row-inner">
          <span className="kds-item-left">
            <span className="kds-item-qty">{item.qty}×</span>
            <span className="kds-item-name">{item.display_name}</span>
          </span>
          <span className={`kds-ticket-item-status-dot kds-ticket-item-status-dot--${item.item_status}`} aria-hidden="true" />
          <span className="kds-ticket-item-status-label">
            {requiredLocalized(l10n, `kds-item-status-${item.item_status}`)}
          </span>
          {done && item.served_at && (
            <span className="kds-item-done-time" aria-hidden="true">
              {fmtDuration(Math.floor((new Date(item.served_at).getTime() - new Date(receivedAt).getTime()) / 1000))}
            </span>
          )}
        </span>
        {item.modifiers.length > 0 && (
          <span className="kds-ticket-modifiers">
            {item.modifiers.map((mod, mi) => (
              <ModifierBadge key={mi} modifier={mod} />
            ))}
          </span>
        )}
      </button>
    </div>
  );
});