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

/** One masonry column: its header title and the modifier its container carries. */
interface MasonryColumn {
  /** Fluent message id for the header title. */
  titleId: string;
  /** English fallback rendered until the bundle loads. */
  title: string;
  /** Class applied to the column container. */
  className: string;
}

/**
 * The columns, in order — the single source of truth for how many there are.
 *
 * The masonry builds exactly this many columns and round-robins orders across
 * them, so a header can never index past its own table. Before 2026-11-05 the
 * count lived in three parallel arrays (the column array, `statusClasses` and
 * `COLUMN_TITLE_KEYS`) and the header fell back to `'kds-pending'` for an
 * index it could not name — the concrete-state fallback the status-mapper rule
 * forbids, since "we cannot identify this column" must not read as "Pending".
 * Deriving all three from one table deletes the fallback rather than pinning it.
 *
 * The title ids are the translated status keys (kds-pending / kds-preparing /
 * kds-ready), already in both en + id bundles, rather than the old dynamic
 * `kds-column-${ci}` ids, which matched no message and silently fell back to
 * the hardcoded English children (unlocalized in id).
 */
const COLUMNS: readonly MasonryColumn[] = [
  { titleId: 'kds-pending', title: 'Pending', className: 'kds-column--pending' },
  { titleId: 'kds-preparing', title: 'Preparing', className: 'kds-column--preparing' },
  { titleId: 'kds-ready', title: 'Ready', className: 'kds-column--ready' },
];

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
  // column grows unboundedly as new tickets arrive. The count comes from
  // COLUMNS, so the column array, the headers and the container classes
  // cannot disagree about how many columns exist.
  const columns = useMemo(() => {
    const cols: KdsOrder[][] = COLUMNS.map(() => []);
    orders.forEach((o, i) => {
      cols[i % COLUMNS.length]!.push(o);
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

  return (
    <div className="kds-main kds-columns">
      {columns.map((col, ci) => {
        // `columns` was built from COLUMNS, so it is exactly as long as it is.
        const column = COLUMNS[ci]!;
        return (
          <div key={column.titleId} className={`kds-col kds-column ${column.className}`}>
            {/* Column header with title and count — expected by E2E tests */}
            <div className="kds-column-header">
              <span className="kds-column-title">
                <Localized id={column.titleId}>
                  <span>{column.title}</span>
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
        );
      })}
    </div>
  );
}
