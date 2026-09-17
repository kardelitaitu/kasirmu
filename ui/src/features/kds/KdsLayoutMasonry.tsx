import { useMemo } from 'react';
import { Localized } from '@fluent/react';
import { KdsTicketCard } from '@/features/kds/components/KdsTicketCard';
import type { KdsLayoutProps } from './KdsScreen';
import type { SlaThresholds } from './hooks/useTicketSla';
import type { KdsOrder } from '@/api/kds';

interface KdsLayoutMasonryProps extends KdsLayoutProps {
  /** True when a filter (Prepared / zone categories) is active — changes
   *  the empty-state copy to "no match" instead of "no orders yet". */
  filtered?: boolean;
  /** SLA thresholds forwarded to every card (settings panel sliders). */
  slaThresholds?: SlaThresholds;
}

// Column titles per index, wired to the translated status keys. The columns
// are built round-robin with ci in 0..2 → Pending/Preparing/Ready, and the
// same localized strings (kds-pending / kds-preparing / kds-ready) already
// exist in both en + id bundles — so the header reuses them instead of the
// old dynamic `kds-column-${ci}` ids, which matched no message and silently
// fell back to the hardcoded English children (unlocalized in id).
const COLUMN_TITLE_KEYS = ['kds-pending', 'kds-preparing', 'kds-ready'] as const;

/**
 * KdsLayoutMasonry — the single KDS view (design-language prototype:
 * see docs/specs/_active/tauri-ux-design-language-plan.md).
 *
 * All open orders flow into N equal-width columns (a JS masonry: cards
 * are distributed round-robin so each column stays roughly balanced),
 * instead of the previous kanban/focus/metro layout switching. There is
 * deliberately no per-status grouping — kitchen awareness comes from the
 * card's SLA colour, status pill, and footer actions, not columns.
 *
 * Column count is responsive: 3 on wide kitchen displays, dropping to
 * 2 / 1 as the viewport narrows.
 */
export function KdsLayoutMasonry({
  orders,
  onAdvance,
  showOrderId,
  showTableNumber,
  selectedOrderId,
  onSaveItems,
  sessionToken,
  onAdvanceItem,
  onAddItems,
  newOrderIds,
  slaThresholds,
  filtered = false,
}: KdsLayoutMasonryProps) {
  // Distribute orders round-robin across the column count so no single
  // column grows unboundedly as new tickets arrive.
  const columns = useMemo(() => {
    const count = 3;
    const cols: KdsOrder[][] = Array.from({ length: count }, () => []);
    orders.forEach((o, i) => {
      cols[i % count]!.push(o);
    });
    return cols;
  }, [orders]);

  if (orders.length === 0) {
    return (
      <div className="kds-main kds-columns empty">
        <p className="kds-empty" role="status">
          <Localized id={filtered ? 'kds-no-orders-filtered' : 'kds-no-orders'}>
            <span>{filtered ? 'No orders in this status' : 'No orders yet'}</span>
          </Localized>
        </p>
      </div>
    );
  }

  const statusClasses = ['kds-column--pending', 'kds-column--preparing', 'kds-column--ready'];

  return (
    <div className="kds-main kds-columns">
      {columns.map((col, ci) => (
        <div key={ci} className={`kds-col kds-column ${statusClasses[ci] ?? ''}`}>
          {/* Column header with title and count — expected by E2E tests */}
          <div className="kds-column-header">
            <span className="kds-column-title">
              <Localized id={COLUMN_TITLE_KEYS[ci] ?? 'kds-pending'}>
                <span>{['Pending', 'Preparing', 'Ready'][ci]}</span>
              </Localized>
            </span>
            <span className="kds-column-count">
              {/* H3/UI-15: pass a NUMBER so Fluent plural selectors can
                  actually match ([one] vs [other]) — a string bypasses
                  number formatting entirely. */}
              <Localized id="kds-column-count" vars={{ count: col.length }}>
                <span>{col.length}</span>
              </Localized>
            </span>
          </div>
          {col.map((order) => (
            <KdsTicketCard
              key={order.id}
              order={order}
              onAdvance={onAdvance}
              showOrderId={showOrderId}
              showTableNumber={showTableNumber}
              selected={selectedOrderId === order.id}
              sessionToken={sessionToken}
              isNew={newOrderIds.has(order.id)}
              {...(slaThresholds ? { slaThresholds } : {})}
              {...(onSaveItems ? { onSaveItems } : {})}
              {...(onAdvanceItem ? { onAdvanceItem } : {})}
              {...(onAddItems ? { onAddItems } : {})}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
