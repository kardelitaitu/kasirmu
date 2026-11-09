/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
// The rule above flags the two overlays that keep a keydown handler
// while being non-interactive by ARIA defaults: the close-shift and
// open-shift confirmation dialogs (`<div role="dialog" onKeyDown>`).
// Both are valid ARIA - the rule only catches the non-interactive
// defaults. The directive came here with those two dialogs; it used to
// sit at the top of PosScreen.tsx.

// ShiftModals - the three SHIFT surfaces of the POS screen, moved
// byte-for-byte out of PosScreen.tsx: the close-shift confirmation
// dialog, the post-close summary, and the open-shift dialog. classNames,
// aria-* attributes, placeholder fallbacks and Fluent message ids are
// unchanged; only the enclosing component is new. All state still lives
// in hooks/usePosShifts - PosScreen destructures it and threads the
// values in as narrowed props, so nothing here owns behaviour beyond
// rendering, calling *Exit.requestClose(), and calling the setters it is
// handed. The `.exiting` flag is carried through the exit handle rather
// than re-derived, so the fade-out mirror classes still play.
//
// Styling: all three surfaces use the pos-close-shift-* rules from
// PosScreen.css (imported by PosScreen.tsx, their only caller). There are
// deliberately NO pos-open-shift-* rules - Open Shift borrows the
// close-shift stylesheet. That is current behaviour, not a defect to fix.
import { useLocalization } from '@fluent/react';
import { useRef, type Dispatch, type SetStateAction } from 'react';
import { Localized } from '@/components/Localized';
import { formatMoney, minorUnitExponent, parseBalanceInput } from '@/types/domain';
import type { ShiftDto } from '@/api/shifts';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';
import { isEditableTarget } from '@/utils/isEditableTarget';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// -- Close Shift confirmation ------------------------------------------

export interface CloseShiftConfirmProps {
  /** Exit handle from usePosShifts: shouldRender gates it, exiting mirrors the fade. */
  closeShiftExit: UseExitAnimationResult;
  /** The shift being closed - null means there is nothing to confirm. */
  activeShift: ShiftDto | null;
  /** Inline error banner text, or null when there is none. */
  closeShiftError: string | null;
  setCloseShiftError: Dispatch<SetStateAction<string | null>>;
  /** Counted cash in drawer, major units as typed (raw string). */
  closingBalance: string;
  setClosingBalance: Dispatch<SetStateAction<string>>;
  shiftNotes: string;
  setShiftNotes: Dispatch<SetStateAction<string>>;
  /** True while the close is in flight - disables both buttons. */
  closingShift: boolean;
  /** Snap-close used by Cancel (no fade); Escape goes through the exit handle. */
  setShowCloseShift: Dispatch<SetStateAction<boolean>>;
  handleConfirmCloseShift: () => void;
  currency?: string;
}

/**
 * Close-shift confirmation dialog: opened-at + opening balance readout,
 * counted-cash and notes inputs, Cancel / Close Shift. Escape dismisses
 * through closeShiftExit.requestClose(), Enter confirms.
 */
export function CloseShiftConfirm({
  closeShiftExit,
  activeShift,
  closeShiftError,
  setCloseShiftError,
  closingBalance,
  setClosingBalance,
  shiftNotes,
  setShiftNotes,
  closingShift,
  setShowCloseShift,
  handleConfirmCloseShift,
  currency,
}: CloseShiftConfirmProps) {
  const { l10n } = useLocalization();
  const storeCurrency = currency ?? 'IDR';
  // Focus management. Escape is owned HERE and removed from the overlay's own
  // onKeyDown below, so exactly one handler closes the dialog: the hook listens on
  // document and the overlay keydown bubbled to it as well, and two closers would
  // double-fire requestClose and the error reset. Enter stays on the overlay.
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    panelRef,
    closeShiftExit.shouldRender && !!activeShift && !closeShiftExit.exiting,
    () => { closeShiftExit.requestClose(); setCloseShiftError(null); },
  );
  if (!closeShiftExit.shouldRender || !activeShift) return null;
  return (
          <div
            className={`pos-close-shift-overlay${closeShiftExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-close-shift-overlay-aria')}
            onKeyDown={(e) => {
              // Escape is handled by useFocusTrap above (single owner).
              // Enter confirms — but NOT from a text field. This handler sits on the
              // overlay, so a keydown inside the notes <textarea> or the counted-cash
              // <input> bubbles here: measured, pressing Enter to add a line to the
              // shift note called handleConfirmCloseShift and closed the shift. A
              // textarea is precisely where a multi-line note gets typed, and Shift is
              // not required, so the keystroke that should insert a newline committed
              // the action instead. Same guard the POS hotkey handler uses
              // (PosScreen/RetailPosScreen via isEditableTarget).
              // AND `!closingShift` — the guard the CONFIRM button below carries, as
              // `closingShift || …` inside its `disabled`. (Anchored by that expression: the
              // line numbers this note has carried all pointed elsewhere, most recently at the
              // CANCEL button's markup.) `closingShift` is set the moment the hook starts
              // its write and cleared only in its `finally`, so without this a cashier who
              // pressed Enter while the dialog read "Closing…" issued a SECOND
              // `closeShiftScoped` while the first was still in flight. Closing a shift is
              // a money event, and the button's `disabled` cannot cover it: a keydown on
              // the overlay never consults the button's state.
              if (e.key === 'Enter' && !isEditableTarget(e.target) && !closingShift) {
                handleConfirmCloseShift();
              }
            }}
          >
            <div ref={panelRef} className={`pos-close-shift-modal${closeShiftExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
              <Localized id="pos-close-shift-title">
              <h3 className="pos-close-shift-title">Close Shift</h3>
            </Localized>

            {closeShiftError && (
              <div className="pos-close-shift-error">
                {closeShiftError}
              </div>
            )}

            <div className="pos-close-shift-info">
              <div className="pos-close-shift-info-row">
                <Localized id="pos-close-shift-opened">
                  <span>Opened</span>
                </Localized>
                <span>{new Date(activeShift.openedAt).toLocaleString()}</span>
              </div>
              <div className="pos-close-shift-info-row">
                <Localized id="pos-close-shift-opening-balance">
                  <span>Opening balance</span>
                </Localized>
                <span>{formatMoney({ minor_units: activeShift.openingBalanceMinor, currency: storeCurrency })}</span>
              </div>
            </div>

            <div className="pos-close-shift-field">
              <Localized id="pos-close-shift-counted-label">
                <label htmlFor="closing-balance" className="pos-close-shift-label">
                  Counted cash in drawer
                </label>
              </Localized>
              <Localized id="pos-close-shift-counted-placeholder" attrs={{ placeholder: true }}>
                <input
                  id="closing-balance"
                  type="number"
                  step="any"
                  className="pos-close-shift-input"
                  min="0"
                  placeholder={minorUnitExponent(storeCurrency) > 0 ? "e.g. 150.00" : "e.g. 150000"}
                  value={closingBalance}
                  onChange={(e) => setClosingBalance(e.target.value)}
                  aria-label={l10n.getString('pos-close-shift-balance-aria')}
                />
              </Localized>
            </div>

            <div className="pos-close-shift-field">
              <Localized id="pos-close-shift-notes-label">
                <label htmlFor="shift-notes" className="pos-close-shift-label">
                  Notes (optional)
                </label>
              </Localized>
              <Localized id="pos-close-shift-notes-placeholder" attrs={{ placeholder: true }}>
                <textarea
                  id="shift-notes"
                  className="pos-close-shift-textarea"
                  rows={3}
                  placeholder="Any notes about this shift…"
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                  aria-label={l10n.getString('pos-close-shift-notes-aria')}
                />
              </Localized>
            </div>

            <footer className="pos-close-shift-actions">
              <Localized id="cancel">
                <button
                  type="button"
                  className="pos-close-shift-cancel-btn"
                  onClick={() => {
                    setShowCloseShift(false);
                    setCloseShiftError(null);
                  }}
                  disabled={closingShift}
                >
                  Cancel
                </button>
              </Localized>
              { }
              <button
                type="button"
                className="pos-close-shift-confirm-btn"
                onClick={handleConfirmCloseShift}
                disabled={
                  closingShift ||
                  !closingBalance.trim() ||
                  parseBalanceInput(closingBalance, storeCurrency) === null ||
                  (parseBalanceInput(closingBalance, storeCurrency) ?? -1) < 0
                }
              >
                <Localized id={closingShift ? 'pos-close-shift-closing' : 'pos-close-shift-confirm'}>
                  <span>{closingShift ? 'Closing…' : 'Close Shift'}</span>
                </Localized>
              </button>
            </footer>
          </div>
        </div>
  );
}

// -- Close Shift success summary ---------------------------------------

export interface ShiftSummaryProps {
  /** Exit handle from usePosShifts; the Done button dismisses through requestClose(). */
  shiftSummaryExit: UseExitAnimationResult;
  /** The shift that just closed - null until a close succeeds. */
  closedShiftSummary: ShiftDto | null;
  currency?: string;
}

/**
 * Post-close summary: total / cash / card sales, expected cash against
 * counted, the signed difference with its over/short tag, and any notes.
 */
export function ShiftSummary({
  shiftSummaryExit,
  closedShiftSummary,
  currency,
}: ShiftSummaryProps) {
  const { l10n } = useLocalization();
  const storeCurrency = currency ?? 'IDR';
  // Focus management. This dialog has no keydown handler of its own, so the hook also
  // supplies Escape — without it the summary had no keyboard dismiss at all.
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    panelRef,
    shiftSummaryExit.shouldRender && !!closedShiftSummary && !shiftSummaryExit.exiting,
    () => shiftSummaryExit.requestClose(),
  );
  if (!shiftSummaryExit.shouldRender || !closedShiftSummary) return null;
  return (
          <div
            className={`pos-close-shift-overlay${shiftSummaryExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-close-shift-summary-aria')}
          >
            <div ref={panelRef} className={`pos-close-shift-modal pos-close-shift-summary${shiftSummaryExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
            <Localized id="pos-shift-closed-title">
              <h3 className="pos-close-shift-title">
                Shift Closed
              </h3>
            </Localized>

            <div className="pos-close-shift-summary-grid">
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-total-sales">
                  <span className="pos-close-shift-summary-label">Total Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalSalesMinor, currency: storeCurrency })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-cash-sales">
                  <span className="pos-close-shift-summary-label">Cash Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalCashMinor, currency: storeCurrency })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-card-sales">
                  <span className="pos-close-shift-summary-label">Card Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalCardMinor, currency: storeCurrency })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-expected-cash">
                  <span className="pos-close-shift-summary-label">Expected Cash</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {closedShiftSummary.expectedCashMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.expectedCashMinor, currency: storeCurrency })
                    : '—'}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-counted">
                  <span className="pos-close-shift-summary-label">Counted</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {closedShiftSummary.closingBalanceMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.closingBalanceMinor, currency: storeCurrency })
                    : '—'}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-difference">
                  <span className="pos-close-shift-summary-label">Difference</span>
                </Localized>
                <span
                  className={`pos-close-shift-summary-value ${
                    closedShiftSummary.cashDifferenceMinor !== null && closedShiftSummary.cashDifferenceMinor < 0
                      ? 'pos-close-shift-diff--negative'
                      : closedShiftSummary.cashDifferenceMinor !== null && closedShiftSummary.cashDifferenceMinor > 0
                        ? 'pos-close-shift-diff--positive'
                        : ''
                  }`}
                >
                  {closedShiftSummary.cashDifferenceMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.cashDifferenceMinor, currency: storeCurrency })
                    : '—'}
                  {closedShiftSummary.cashDifferenceMinor !== null && closedShiftSummary.cashDifferenceMinor !== 0 && (
                    <span className="pos-close-shift-diff-tag">
                      <Localized id={closedShiftSummary.cashDifferenceMinor > 0 ? 'pos-shift-over' : 'pos-shift-short'}>
                        <span>{closedShiftSummary.cashDifferenceMinor > 0 ? 'Over' : 'Short'}</span>
                      </Localized>
                    </span>
                  )}
                </span>
              </div>
            </div>

            {closedShiftSummary.notes && (
              <div className="pos-close-shift-notes-display">
                <Localized id="pos-shift-notes">
                  <span className="pos-close-shift-summary-label">Notes</span>
                </Localized>
                <p>{closedShiftSummary.notes}</p>
              </div>
            )}            <Localized id="pos-shift-summary-done">
              <button
                type="button"
                className="pos-close-shift-dismiss-btn"
                onClick={() => shiftSummaryExit.requestClose()}
              >
                Done
              </button>
            </Localized>
          </div>
        </div>
  );
}

// -- Open Shift ---------------------------------------------------------

export interface OpenShiftModalProps {
  /** Exit handle from usePosShifts (a successful open runs requestClose()). */
  openShiftExit: UseExitAnimationResult;
  /** Opening drawer float, major units as typed (raw string). */
  openingBalance: string;
  setOpeningBalance: Dispatch<SetStateAction<string>>;
  /** True while the open is in flight - disables both buttons. */
  openingShift: boolean;
  handleConfirmOpenShift: () => void;
  currency?: string;
}

/**
 * Open-shift dialog: the opening-balance field plus Cancel / Open Shift.
 * Escape dismisses through openShiftExit.requestClose(), Enter confirms.
 * Styled by the pos-close-shift-* rules it reuses from PosScreen.css.
 */
export function OpenShiftModal({
  openShiftExit,
  openingBalance,
  setOpeningBalance,
  openingShift,
  handleConfirmOpenShift,
  currency,
}: OpenShiftModalProps) {
  const { l10n } = useLocalization();
  const storeCurrency = currency ?? 'IDR';
  // Focus management; Escape owned here, removed from the overlay (see the close dialog).
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    panelRef,
    openShiftExit.shouldRender && !openShiftExit.exiting,
    () => openShiftExit.requestClose(),
  );
  if (!openShiftExit.shouldRender) return null;
  return (
          <div
            className={`pos-close-shift-overlay${openShiftExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-open-shift-overlay-aria')}
            onKeyDown={(e) => {
              // Escape is handled by useFocusTrap above (single owner).
              // Same guard as the close-shift dialog above, and for the same measured
              // reason: the opening-balance <input> is a text entry point, so Enter
              // while typing there confirmed the open instead of committing the field.
              if (e.key === 'Enter' && !isEditableTarget(e.target)) handleConfirmOpenShift();
            }}
          >
            <div ref={panelRef} className={`pos-close-shift-modal${openShiftExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
              <Localized id="pos-open-shift-title">
              <h3 className="pos-close-shift-title">Open Shift</h3>
            </Localized>

            <div className="pos-close-shift-field">
              <Localized id="pos-open-shift-balance-label">
                <label htmlFor="opening-balance" className="pos-close-shift-label">
                  Opening balance
                </label>
              </Localized>
              <Localized id="pos-open-shift-balance-placeholder" attrs={{ placeholder: true }}>
                <input
                  id="opening-balance"
                  type="number"
                  step="any"
                  className="pos-close-shift-input"
                  min="0"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  aria-label={l10n.getString('pos-open-shift-balance-aria')}
                />
              </Localized>
            </div>

            <footer className="pos-close-shift-actions">
              <Localized id="cancel">
                <button
                  type="button"
                className="pos-close-shift-cancel-btn"
                onClick={() => openShiftExit.requestClose()}
                  disabled={openingShift}
                >
                  Cancel
                </button>
              </Localized>
              { }
              <button
                type="button"
                className="pos-close-shift-confirm-btn"
                onClick={handleConfirmOpenShift}
                disabled={
                  openingShift ||
                  (openingBalance.trim() !== '' &&
                    (parseBalanceInput(openingBalance, storeCurrency) === null ||
                      (parseBalanceInput(openingBalance, storeCurrency) ?? -1) < 0))
                }
              >
                <Localized id={openingShift ? 'pos-open-shift-opening' : 'pos-open-shift-title'}>
                  <span>{openingShift ? 'Opening…' : 'Open Shift'}</span>
                </Localized>
              </button>
            </footer>
          </div>
        </div>
  );
}
