// ─── OpenBillModals ──────────────────────────────────
// The last two inline modals of the POS cart surface, moved out of
// PosScreen.tsx byte-for-byte: the open-bill name input and the open-bills
// (held carts) list. classNames, aria-* attributes, placeholders and Fluent
// message ids are unchanged; only the enclosing component is new. All state
// and every action still live in hooks/usePosHeldCarts - PosScreen
// destructures it and threads the values in as narrowed props, so neither
// component owns behaviour beyond rendering, calling its *Exit setter,
// clearing the typed name and calling handleOpenBill / handleResumeOpenBill.
// The shouldRender gate that used to wrap each block in the shell is now an
// early return inside each component, which renders the same subtree under
// the same condition. The .exiting flag is carried through the exit handle
// rather than re-derived, so the fade-out mirror classes still play.
//
// Styling: both surfaces use the pos-hold-* and pos-held-list-* /
// pos-held-item-* rules from PosScreen.css (700 lines), which stays imported
// by PosScreen.tsx - their only caller. No CSS moved here.
import { useLocalization } from '@fluent/react';
import { useRef, type Dispatch, type SetStateAction } from 'react';
import { requiredLocalized } from '@/components';
import { formatMoney } from '@/types/domain';
import type { HeldCartRow } from '@/api/sales';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// -- Open Bill Input ------------------------------------------------------

export interface OpenBillInputProps {
  /** Exit handle from usePosHeldCarts: shouldRender gates it, exiting mirrors the fade. */
  openBillInputExit: UseExitAnimationResult;
  /** The bill name being typed - owned by the hook, not by this input. */
  openBillName: string;
  setOpenBillName: Dispatch<SetStateAction<string>>;
  /** True while the hold is in flight - disables both buttons and swaps the label. */
  openingBill: boolean;
  /** Async hold-a-bill from the hook; used as a fire-and-forget click handler. */
  handleOpenBill: () => Promise<void>;
}

/**
 * Open-bill name dialog: asks for the customer/table label, then holds the
 * current cart as an open bill. Cancel fades out through openBillInputExit
 * and clears the typed name, exactly as it did inline.
 */
export function OpenBillInput({
  openBillInputExit,
  openBillName,
  setOpenBillName,
  openingBill,
  handleOpenBill,
}: OpenBillInputProps) {
  const { l10n } = useLocalization();
  // Every sibling sales modal installs this — `useFocusTrap` in ItemModifierModal,
  // SplitBillModal (both under `sales/components/`) and PromotionsModal, RefundModal,
  // PriceOverrideModal, StockShortfallDialog (all three directly under `sales/`; the
  // paths were previously implied to be the components dir, which is wrong for these).
  // Anchored by the `useFocusTrap(` call rather than a line per file: of the six numbers
  // this note carried, two were right and four had rotted, one of them past EOF.
  // These two were the only `aria-modal="true"` dialogs without it, so a
  // keyboard operator got no autofocus into the dialog, Tab walked out into the page
  // still rendered behind it, and Escape did nothing. Measured before the fix:
  // activeElement was <body>, Tab reached an outside button, and Escape did not call
  // requestClose.
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    panelRef,
    openBillInputExit.shouldRender && !openBillInputExit.exiting,
    () => openBillInputExit.requestClose(),
  );
  if (!openBillInputExit.shouldRender) return null;
  return (
          <div
            className={`pos-hold-overlay${openBillInputExit.exiting ? ' pos-hold-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-open-bill-overlay-aria')}
          >
            <div ref={panelRef} className={`pos-hold-modal${openBillInputExit.exiting ? ' pos-hold-modal--exiting' : ''}`}>
            <h3 className="pos-hold-title">{l10n.getString('pos-open-bill-title')}</h3>
            <p className="pos-hold-desc">
              {l10n.getString('pos-open-bill-desc')}
            </p>
            <input
              type="text"
              className="pos-hold-input"
              placeholder={l10n.getString('pos-open-bill-placeholder')}
              value={openBillName}
              onChange={(e) => setOpenBillName(e.target.value)}
              aria-label={l10n.getString('pos-open-bill-name-aria')}
            />
            <footer className="pos-hold-actions">
              <button
                type="button"
                className="pos-hold-cancel-btn"
                onClick={() => {
                  openBillInputExit.requestClose();
                  setOpenBillName('');
                }}
                disabled={openingBill}
              >
                {requiredLocalized(l10n, 'pos-hold-cancel')}
              </button>
              <button
                type="button"
                className="pos-hold-confirm-btn"
                onClick={handleOpenBill}
                disabled={openingBill}
              >
                <span>{l10n.getString(openingBill ? 'pos-open-bill-saving' : 'pos-open-bill-save')}</span>
              </button>
            </footer>
          </div>
        </div>
  );
}

// -- Open Bills panel -----------------------------------------------------

export interface OpenBillsPanelProps {
  /** Exit handle from usePosHeldCarts: shouldRender gates it, exiting mirrors the fade. */
  openBillsExit: UseExitAnimationResult;
  /** Held-cart rows, already loaded by the hook - this component never fetches. */
  openBills: HeldCartRow[];
  /** Async recall of one held cart by id; used as a fire-and-forget click handler. */
  /**
   * Returns whether the cart was actually replaced — the resume REFUSES when a
   * different tab is already open (usePosHeldCarts round 96), and a caller that
   * pre-set state must know which happened.
   */
  handleResumeOpenBill: (id: string) => Promise<boolean>;
}

/**
 * Open-bills list: the held-cart table with a resume button per row and the
 * empty message when the bill list comes back empty. Closing is a plain fade
 * request through openBillsExit - no logic lives here.
 */
export function OpenBillsPanel({
  openBillsExit,
  openBills,
  handleResumeOpenBill,
}: OpenBillsPanelProps) {
  const { l10n } = useLocalization();
  // Same trap as the input dialog above; the close button is the first focusable
  // element, so focus lands somewhere meaningful inside the list.
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    panelRef,
    openBillsExit.shouldRender && !openBillsExit.exiting,
    () => openBillsExit.requestClose(),
  );
  if (!openBillsExit.shouldRender) return null;
  return (
          <div className={`pos-hold-overlay${openBillsExit.exiting ? ' pos-hold-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('pos-open-bills-overlay-aria')}>
          <div ref={panelRef} className={`pos-held-list-modal${openBillsExit.exiting ? ' pos-held-list-modal--exiting' : ''}`}>
            <header className="pos-held-list-header">
              <h3>{l10n.getString('pos-open-bills-title')}</h3>
              <button
                type="button"
                className="pos-held-list-close"
                onClick={() => openBillsExit.requestClose()}
                aria-label={l10n.getString('pos-open-bills-close-aria')}
              >
                &times;
              </button>
            </header>
            <div className="pos-held-list-body">
              {/*
                R21 (owner, 2026-09-20): the EMPTY ARM of this list was deleted rather
                than left dead. The overlay's only opener gates on
                `openBills.length > 0` — `CartPanel.tsx:1144` is the single
                `setShowOpenBills(true)` call site — so at zero bills the list cannot be
                opened and its empty state was unreachable UI: unverifiable and
                impossible to regression-test. The string and the class went with it.
              */}
              {openBills.map((ob) => (
                <div key={ob.id} className="pos-held-item">
                  <div className="pos-held-item-info">
                    <span className="pos-held-item-label">
                      {ob.label || ob.customer_name}
                    </span>
                    <span className="pos-held-item-meta">
                      {l10n.getString('retail-cart-items', { count: ob.item_count }, `${ob.item_count} items`)} &middot; {formatMoney({ minor_units: ob.total_minor, currency: ob.currency })} &middot; {new Date(ob.created_at).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="pos-held-item-resume"
                    onClick={() => handleResumeOpenBill(ob.id)}
                    aria-label={`${l10n.getString('pos-open-bills-resume')} ${ob.label || ob.customer_name}`}
                  >
                    {l10n.getString('pos-open-bills-resume')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
  );
}

