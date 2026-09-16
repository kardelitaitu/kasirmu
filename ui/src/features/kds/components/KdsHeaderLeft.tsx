/**
 * KdsHeaderLeft — the left column of the KDS header: the screen title and
 * workspace-picker button, the filter control with its popover panel, and the
 * prepared/category filter chips.
 *
 * Extracted verbatim from KdsScreen.tsx:718-855 by KDS merged-lane slice 2.
 * The moved block is byte-identical to that range: it is the sed output with a
 * component wrapper around it, so no string, class, aria attribute or svg path
 * was retyped. Unlike the notice banners, no handler needed converting to a
 * prop closure — every callback here already exists in the screen and is
 * passed through under its own name, which is why the props below are named
 * setShowFilter/setFilterCats rather than on*.
 *
 * PRESENTATIONAL ONLY — it owns no state and touches no IPC. The filter state
 * lives in KdsScreen (useState at :118-121) because renderContent() and the
 * ticket fetch both read it; this component only receives it. Nothing in the
 * moved range referenced sessionToken, updateKdsStatusScoped, retryPending or
 * speak(), so no closure had to stay behind.
 *
 * The two keyboard handlers are passed in rather than moved: they belong to the
 * keyboard slice (plan slice 2, hooks/useKdsKeyboardShortcuts.ts) and taking
 * them here would have pulled that work into this commit.
 *
 * REGISTERED in __tests__/screenExtraction.test.ts under the KdsScreen entry's
 * additionalTsx: the classes used here are styled by kds/KdsScreen.css, which
 * that entry already lists, and without the entry the guard reads them as dead.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { requiredLocalized } from '@/frontend/shared';

export interface KdsHeaderLeftProps {
  activeTab: 'open' | 'completed';
  completedFilter: 'all' | 'dinein' | 'takeaway';
  filterCats: Set<string> | null;
  filterMode: 'all' | 'prepared';
  zones: string[];
  boardFiltered: boolean;
  filterBtnRef: RefObject<HTMLButtonElement>;
  filterPanelRef: RefObject<HTMLDivElement>;
  showFilter: boolean;
  setCompletedFilter: (f: 'all' | 'dinein' | 'takeaway') => void;
  setFilterCats: Dispatch<SetStateAction<Set<string> | null>>;
  setFilterMode: (m: 'all' | 'prepared') => void;
  setShowFilter: Dispatch<SetStateAction<boolean>>;
  goToWorkspacePicker: () => void;
  handleFilterBtnKeyDown: (e: KeyboardEvent) => void;
  handleFilterPanelKeyDown: (e: KeyboardEvent) => void;
}

export function KdsHeaderLeft({
  activeTab,
  completedFilter,
  filterCats,
  filterMode,
  zones,
  boardFiltered,
  filterBtnRef,
  filterPanelRef,
  showFilter,
  setCompletedFilter,
  setFilterCats,
  setFilterMode,
  setShowFilter,
  goToWorkspacePicker,
  handleFilterBtnKeyDown,
  handleFilterPanelKeyDown,
}: KdsHeaderLeftProps) {
  const { l10n } = useLocalization();

  return (
        <div className="kds-header-left">
          <button
            type="button"
            className="kds-btn kds-btn--icon kds-back-btn"
            onClick={goToWorkspacePicker}
            aria-label={requiredLocalized(l10n, 'kds-back-aria')}
            data-testid="kds-topbar-back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          {/* Filter dropdown — tab-aware (Open: All/Prepared/Cats, Completed: All/Dine in/Takeaway) */}
          <div className="kds-filter">
            <button
              ref={filterBtnRef}
              className={`kds-btn kds-btn--filter${!boardFiltered ? ' kds-btn--filter--all' : ' kds-btn--filter--active'}${showFilter ? ' kds-btn--filter--open' : ''}`}
              onClick={() => setShowFilter((p) => !p)}
              onKeyDown={handleFilterBtnKeyDown}
              aria-haspopup="listbox"
              aria-expanded={showFilter}
              data-testid="kds-topbar-filter"
            >
              <span>
                {activeTab === 'completed' ? (
                  completedFilter === 'dinein' ? (
                    <Localized id="kds-filter-dinein"><span>Dine in</span></Localized>
                  ) : completedFilter === 'takeaway' ? (
                    <Localized id="kds-filter-takeaway"><span>Takeaway</span></Localized>
                  ) : (
                    <Localized id="kds-filter-completed-all"><span>All</span></Localized>
                  )
                ) : filterMode === 'prepared' ? (
                  <Localized id="kds-filter-prepared"><span>Prepared</span></Localized>
                ) : filterCats && filterCats.size > 0 ? (
                  filterCats.size === 1 ? (
                    [...filterCats][0]
                  ) : (
                    requiredLocalized(l10n, 'kds-filter-selected', { count: filterCats.size })
                  )
                ) : (
                  <Localized id="kds-filter-all"><span>All Categories</span></Localized>
                )}
              </span>
              <span className="caret" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h12l-6 7z" /></svg>
              </span>
            </button>
            {showFilter && (
              <div
                ref={filterPanelRef}
                className="kds-filter-panel"
                role="listbox"
                tabIndex={-1}
                aria-multiselectable={activeTab !== 'completed'}
                aria-label={requiredLocalized(l10n, 'kds-filter-aria')}
                onKeyDown={handleFilterPanelKeyDown}
              >
                {activeTab === 'completed' ? (
                  <div className="kds-filter-modes no-sep">
                    <button
                      className={`kds-filter-option${completedFilter === 'all' ? ' checked' : ''}`}
                      role="option"
                      aria-selected={completedFilter === 'all'}
                      onClick={() => { setCompletedFilter('all'); setShowFilter(false); }}
                      data-testid="kds-filter-completed-all"
                    >
                      <Localized id="kds-filter-completed-all">All</Localized>
                    </button>
                    <button
                      className={`kds-filter-option${completedFilter === 'dinein' ? ' checked' : ''}`}
                      role="option"
                      aria-selected={completedFilter === 'dinein'}
                      onClick={() => { setCompletedFilter('dinein'); setShowFilter(false); }}
                      data-testid="kds-filter-completed-dinein"
                    >
                      <Localized id="kds-filter-dinein">Dine in</Localized>
                    </button>
                    <button
                      className={`kds-filter-option${completedFilter === 'takeaway' ? ' checked' : ''}`}
                      role="option"
                      aria-selected={completedFilter === 'takeaway'}
                      onClick={() => { setCompletedFilter('takeaway'); setShowFilter(false); }}
                      data-testid="kds-filter-completed-takeaway"
                    >
                      <Localized id="kds-filter-takeaway">Takeaway</Localized>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="kds-filter-modes">
                      <button
                        className={`kds-filter-option${filterMode === 'all' && (!filterCats || filterCats.size === 0) ? ' checked' : ''}`}
                        role="option"
                        aria-selected={filterMode === 'all' && (!filterCats || filterCats.size === 0)}
                        onClick={() => { setFilterMode('all'); setFilterCats(null); setShowFilter(false); }}
                        data-testid="kds-filter-mode-all"
                      >
                        <Localized id="kds-filter-all">All orders</Localized>
                      </button>
                      <button
                        className={`kds-filter-option${filterMode === 'prepared' ? ' checked' : ''}`}
                        role="option"
                        aria-selected={filterMode === 'prepared'}
                        onClick={() => { setFilterMode('prepared'); setFilterCats(null); setShowFilter(false); }}
                        data-testid="kds-filter-mode-prepared"
                      >
                        <Localized id="kds-filter-prepared">Prepared</Localized>
                      </button>
                    </div>
                    {zones.length > 0 && (
                      <div className="kds-filter-grid">
                        {zones.map((zone) => (
                          <button
                            key={zone}
                            className={`kds-filter-option${filterCats?.has(zone) ? ' checked' : ''}`}
                            role="option"
                            aria-selected={filterCats?.has(zone) ?? false}
                            onClick={() => {
                              setFilterMode('all');
                              setFilterCats((prev) => {
                                const next = new Set(prev ?? []);
                                if (next.has(zone)) next.delete(zone); else next.add(zone);
                                return next.size === 0 ? null : next;
                              });
                            }}
                            data-testid={`kds-filter-zone-${zone}`}
                          >
                            <span>{zone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

  );
}
