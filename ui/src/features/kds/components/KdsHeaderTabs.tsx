/**
 * KdsHeaderTabs — the middle column of the KDS header: the Open/Completed tab
 *   track, its animated indicator pill and the two tab buttons.
 *
 * Extracted verbatim from KdsScreen.tsx:487-515 by the KDS merged-lane header
 * TABS slice. The moved block is byte-identical in structure — same classes,
 * same `role`/`aria-*` attributes, same `data-testid`s, same order, same
 * conditional class expressions — and its reads became props. The Fluent ids
 * (`kds-tablist-aria`, `kds-tab-open`, `kds-tab-completed`) already exist in
 * kds.ftl; none was added.
 *
 * PRESENTATIONAL ONLY — it owns no state and calls no api. The four refs are
 * PROPS, not locals: `useKdsTabIndicator` is still CALLED by the screen
 * (KdsScreen.tsx:363) and hands `tabsTrackRef`, `tabOpenRef`,
 * `tabCompletedRef`, `tabIndicatorRef` and the measured `tabIndicator` back
 * out, exactly as `filterBtnRef`/`filterPanelRef` are handed to
 * KdsHeaderLeft. That is a deliberate choice, not an unfinished one: React
 * flushes CHILD effects before PARENT effects, so moving the hook call into
 * this file would have run the measure effect and registered the `resize`
 * listener earlier in the commit than they run today, and would have narrowed
 * the re-render `setTabIndicator` triggers from the whole screen to this
 * subtree. Both are behaviour changes, and this slice is a move. So the
 * `isTabMountedRef` latch, the `animate()` keyframes and the add/remove
 * listener pair stay exactly where the hook put them.
 *
 * `setActiveTab` is passed under its own name (the KdsHeaderLeft /
 * KdsHeaderRight convention) rather than as an `onSelect` closure, so the two
 * `onClick` bodies move verbatim. The state itself must stay in the screen:
 * the swipe pager (:338, :342), the keyboard shortcuts and the completed view
 * (:439) all read or write it. `openCount` is `filteredOrders.length` — the
 * count the Open tab prints — passed as a number so no filter state crosses.
 *
 * REGISTERED in __tests__/screenExtraction.test.ts under the KdsScreen entry's
 * additionalTsx. The four classes used here (kds-tabs, kds-tab,
 * kds-tab-indicator, kds-tab-count) are still styled by kds/KdsScreen.css,
 * which that entry already lists; without the registration the reachability
 * guard reads all four as dead CSS while every other suite stays green.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { requiredLocalized } from '@/components';

export interface KdsHeaderTabsProps {
  /** Which tab is active — read for the class + aria-selected, never written here. */
  activeTab: 'open' | 'completed';
  /** The screen's tab setter; the swipe pager and shortcuts write it too. */
  setActiveTab: Dispatch<SetStateAction<'open' | 'completed'>>;
  /** `filteredOrders.length`, printed inside the Open tab. */
  openCount: number;
  /** The measured pill position, applied as an inline style by the indicator span. */
  tabIndicator: { left: number; width: number };
  /** The `.kds-tabs` track the pill is absolutely positioned inside. */
  tabsTrackRef: RefObject<HTMLDivElement>;
  tabOpenRef: RefObject<HTMLButtonElement>;
  tabCompletedRef: RefObject<HTMLButtonElement>;
  /** The animated `.kds-tab-indicator` span. */
  tabIndicatorRef: RefObject<HTMLSpanElement>;
}

/** The prototype Open/Completed tab bar, with its sliding indicator pill. */
export function KdsHeaderTabs({
  activeTab,
  setActiveTab,
  openCount,
  tabIndicator,
  tabsTrackRef,
  tabOpenRef,
  tabCompletedRef,
  tabIndicatorRef,
}: KdsHeaderTabsProps) {
  const { l10n } = useLocalization();

  return (
    // Open/Completed tabs — prototype .kds-tabs
    <div className="kds-tabs" ref={tabsTrackRef} role="tablist" aria-label={requiredLocalized(l10n, 'kds-tablist-aria')}>
      <span
        ref={tabIndicatorRef}
        className="kds-tab-indicator"
        style={{ left: tabIndicator.left, width: tabIndicator.width }}
      />
      <button
        ref={tabOpenRef}
        className={`kds-tab${activeTab === 'open' ? ' active' : ''}`}
        onClick={() => setActiveTab('open')}
        role="tab"
        aria-selected={activeTab === 'open'}
        data-testid="kds-tab-open"
      >
        <Localized id="kds-tab-open"><span>Open</span></Localized>
        <span className="kds-tab-count">{openCount}</span>
      </button>
      <button
        ref={tabCompletedRef}
        className={`kds-tab${activeTab === 'completed' ? ' active' : ''}`}
        onClick={() => setActiveTab('completed')}
        role="tab"
        aria-selected={activeTab === 'completed'}
        data-testid="kds-tab-completed"
      >
        <Localized id="kds-tab-completed"><span>Completed</span></Localized>
      </button>
    </div>
  );
}
