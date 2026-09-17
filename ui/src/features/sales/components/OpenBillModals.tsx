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
import type { Dispatch, SetStateAction } from 'react';
import { requiredLocalized } from '@/components';
import { formatMoney } from '@/types/domain';
import type { HeldCartRow } from '@/api/sales';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';

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
  if (!openBillInputExit.shouldRender) return null;
  return (
          <div
            className={`pos-hold-overlay${openBillInputExit.exiting ? ' pos-hold-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-open-bill-overlay-aria')}
          >
            <div className={`pos-hold-modal${openBillInputExit.exiting ? ' pos-hold-modal--exiting' : ''}`}>
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
            <div className="pos-hold-actions">
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
            </div>
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
  handleResumeOpenBill: (id: string) => Promise<void>;
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
  if (!openBillsExit.shouldRender) return null;
  return (
          <div className={`pos-hold-overlay${openBillsExit.exiting ? ' pos-hold-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('pos-open-bills-overlay-aria')}>
          <div className={`pos-held-list-modal${openBillsExit.exiting ? ' pos-held-list-modal--exiting' : ''}`}>
            <div className="pos-held-list-header">
              <h3>{l10n.getString('pos-open-bills-title')}</h3>
              <button
                type="button"
                className="pos-held-list-close"
                onClick={() => openBillsExit.requestClose()}
                aria-label={l10n.getString('pos-open-bills-close-aria')}
              >
                &times;
              </button>
            </div>
            <div className="pos-held-list-body">
              {openBills.length === 0 ? (
                <p className="pos-held-list-empty">{l10n.getString('pos-open-bills-empty')}</p>
              ) : (
                openBills.map((ob) => (
                  <div key={ob.id} className="pos-held-item">
                    <div className="pos-held-item-info">
                      <span className="pos-held-item-label">
                        {ob.customer_name || ob.label}
                      </span>
                      <span className="pos-held-item-meta">
                        {ob.item_count} item{ob.item_count !== 1 ? 's' : ''} &middot; {formatMoney({ minor_units: ob.total_minor, currency: ob.currency })} &middot; {new Date(ob.created_at).toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="pos-held-item-resume"
                      onClick={() => handleResumeOpenBill(ob.id)}
                      aria-label={`${l10n.getString('pos-open-bills-resume')} ${ob.customer_name || ob.label}`}
                    >
                      {l10n.getString('pos-open-bills-resume')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
  );
}

