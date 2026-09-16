/**
 * KdsMainContent — the KDS board below the banners: the initial-loading
 *   skeleton columns, and the Open/Completed swipe track that hosts
 *   KdsLayoutMasonry and KdsCompletedView.
 *
 * Extracted verbatim from KdsScreen.tsx:390-451 — the `renderContent` closure,
 * which the KDS census measured as the largest remaining self-contained block of
 * the screen. The moved markup is byte-identical except for a uniform two-space
 * de-indent and five reads that became props (`onAdvance`, `onAdvanceItem`,
 * `onSaveItems`, `onAddItems`, `onReopen`).
 *
 * PRESENTATIONAL ONLY — it owns no state, runs no effect and calls no api.
 * Every piece of machinery the region touches stayed in the screen:
 *   - `usePullToRefresh` and `useSwipe` are still CALLED there, because the pull
 *     state and distance also drive the indicator markup at
 *     KdsScreen.tsx:572-584, which did not move. Only their spread objects came
 *     across, as `pullRefreshProps` / `swipeProps`.
 *   - `advanceStatus`, `advanceItemStatus` and `handleSaveItems` are the
 *     screen's own callbacks (they close over sessionToken, l10n, setError and
 *     the scoped api wrappers), passed as `onAdvance` / `onAdvanceItem` /
 *     `onSaveItems`.
 *   - `filteredOrders`, `boardFiltered`, `newOrderIds`, `slaThresholds`,
 *     `selectedOrderId` and `activeTab` are screen memos/state; the child reads.
 *   - The region writes in exactly two places and each got ONE prop:
 *     `onAddItems` is the screen's `setPickerOrderId`, and `onReopen` is the
 *     narrow `() => setActiveTab('open')` behind the Completed pane's reopen
 *     button. No per-key setter crossed the boundary, and nothing had to move.
 *
 * REGISTERED in __tests__/screenExtraction.test.ts under the KdsScreen entry's
 * additionalTsx. Every class used here — kds-loading-container/columns/column/
 * header/card/line (with its --short/--medium/--long modifiers),
 * kds-main-viewport, kds-main-track with the `active-` pair, kds-main-pane with
 * --open/--completed, kds-content-wrap and kds--compact — is still styled by
 * kds/KdsScreen.css, which that entry already lists. The CSS did NOT travel:
 * without the registration the guard reads all of them as dead classes while
 * every other suite stays green.
 */
import { useLocalization } from '@fluent/react';
import type { HTMLAttributes } from 'react';
import { LoadingStatus, requiredLocalized } from '@/frontend/shared';
import { KdsLayoutMasonry } from '@/features/kds/KdsLayoutMasonry';
import { KdsCompletedView } from '@/features/kds/KdsCompletedView';
import type { KdsLineItem, KdsOrder } from '@/api/kds';
import type { KdsSettings } from '@/features/kds/kdsSettingsModel';
import type { KdsPreferences } from '@/features/kds/hooks/useKdsPreferences';
import type { SlaThresholds } from '@/features/kds/hooks/useTicketSla';

export interface KdsMainContentProps {
  /** True until the first queue fetch settles — renders the skeleton branch. */
  initialLoading: boolean;
  /** The screen's tab state; drives the track transform and the aria-hidden pair. */
  activeTab: 'open' | 'completed';
  /** The screen's settings object, read for `density` (the compact class). */
  settings: KdsSettings;
  /** The screen's per-user station prefs, read for the two display toggles. */
  prefs: KdsPreferences;
  /** `usePullToRefresh().containerProps` — the screen owns the hook call. */
  pullRefreshProps: HTMLAttributes<HTMLDivElement>;
  /** `useSwipe()`'s touch handlers — the screen owns the hook call and its state. */
  swipeProps: HTMLAttributes<HTMLDivElement>;
  /** Open orders after mode/category filtering — the screen's own memo. */
  filteredOrders: KdsOrder[];
  /** True when a filter is active, so the board reads "no match", not "no orders". */
  boardFiltered: boolean;
  onAdvance: (order: KdsOrder) => void;
  onAdvanceItem: (item: KdsLineItem) => void;
  onSaveItems: (orderId: string, itemsSummary: string, itemCount: number) => void;
  /** The screen's `setPickerOrderId`: opens the 3f product picker for a ticket. */
  onAddItems: (orderId: string) => void;
  /** Narrow dispatch behind the Completed pane's reopen-to-Open path. */
  onReopen: () => void;
  /** Keyboard-selected order, owned by the screen via useKdsShortcuts. */
  selectedOrderId: string | null;
  sessionToken: string;
  newOrderIds: ReadonlySet<string>;
  slaThresholds: SlaThresholds;
  completedFilter: 'all' | 'dinein' | 'takeaway';
}

export function KdsMainContent({
  initialLoading,
  activeTab,
  settings,
  prefs,
  pullRefreshProps,
  swipeProps,
  filteredOrders,
  boardFiltered,
  onAdvance,
  onAdvanceItem,
  onSaveItems,
  onAddItems,
  onReopen,
  selectedOrderId,
  sessionToken,
  newOrderIds,
  slaThresholds,
  completedFilter,
}: KdsMainContentProps) {
  const { l10n } = useLocalization();

  if (initialLoading) {
    // LOAD-05: the skeleton columns are decorative; the localized
    // status line (role=status) is what screen readers announce.
    return (
      <LoadingStatus className="kds-loading-container" label={requiredLocalized(l10n, 'kds-loading')}>
          <div className="kds-loading-columns">
            {['pending', 'preparing', 'ready'].map((status) => (
              <div key={status} className="kds-loading-column">
                <div className="kds-loading-header" />
                {[1, 2, 3].map((i) => (
                  <div key={i} className="kds-loading-card">
                    <div className="kds-loading-line kds-loading-line--short" />
                    <div className="kds-loading-line kds-loading-line--long" />
                    <div className="kds-loading-line kds-loading-line--medium" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </LoadingStatus>
      );
  }

  return (
    <div className="kds-main-viewport" {...swipeProps}>
      <div className={`kds-main-track active-${activeTab}`}>
        <div
          className="kds-main-pane kds-main-pane--open"
          aria-hidden={activeTab !== 'open'}
        >
          <div className={`kds-content-wrap${settings.density <= 2 ? ' kds--compact' : ''}`} {...pullRefreshProps}>
            <KdsLayoutMasonry
              orders={filteredOrders}
              filtered={boardFiltered}
              onAdvance={onAdvance}
              showOrderId={prefs.showOrderId}
              showTableNumber={prefs.showTableNumber}
              selectedOrderId={selectedOrderId}
              sessionToken={sessionToken}
              onSaveItems={onSaveItems}
              onAdvanceItem={onAdvanceItem}
              onAddItems={onAddItems}
              newOrderIds={newOrderIds}
              slaThresholds={slaThresholds}
            />
          </div>
        </div>
        <div
          className="kds-main-pane kds-main-pane--completed"
          aria-hidden={activeTab !== 'completed'}
        >
          <KdsCompletedView
            onReopen={onReopen}
            completedFilter={completedFilter}
            active={activeTab === 'completed'}
          />
        </div>
      </div>
    </div>
  );
}
