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
import type { Dispatch, SetStateAction } from 'react';
import { Localized } from '@/components/Localized';
import { formatMoney } from '@/types/domain';
import type { ShiftDto } from '@/api/shifts';
import type { UseExitAnimationResult } from '@/hooks/useExitAnimation';

// -- Close Shift confirmation ------------------------------------------

export interface CloseShiftConfirmProps {
  /** Exit handle from usePosShifts: shouldRender gates it, exiting mirrors the fade. */
  closeShiftExit: UseExitAnimationResult;
  /** The shift being closed - null means there is nothing to confirm. */
  activeShift: ShiftDto | null;
  /** Inline error banner text, or null when there is none. */
  closeShiftError: string | null;
  setCloseShiftError: Dispatch<SetStateAction<string | null>>;
  /** Counted cash in drawer, minor units as typed (raw string). */
  closingBalance: string;
  setClosingBalance: Dispatch<SetStateAction<string>>;
  shiftNotes: string;
  setShiftNotes: Dispatch<SetStateAction<string>>;
  /** True while the close is in flight - disables both buttons. */
  closingShift: boolean;
  /** Snap-close used by Cancel (no fade); Escape goes through the exit handle. */
  setShowCloseShift: Dispatch<SetStateAction<boolean>>;
  handleConfirmCloseShift: () => void;
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
}: CloseShiftConfirmProps) {
  const { l10n } = useLocalization();
  if (!closeShiftExit.shouldRender || !activeShift) return null;
  return (
          <div
            className={`pos-close-shift-overlay${closeShiftExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-close-shift-overlay-aria')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                closeShiftExit.requestClose();
                setCloseShiftError(null);
              }
              if (e.key === 'Enter') handleConfirmCloseShift();
            }}
          >
            <div className={`pos-close-shift-modal${closeShiftExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
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
                <span>{formatMoney({ minor_units: activeShift.openingBalanceMinor, currency: 'USD' })}</span>
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
                  className="pos-close-shift-input"
                  min="0"
                  placeholder="e.g. 15000 for $150.00"
                  value={closingBalance}
                  onChange={(e) => {
                    // Whole number only — ignore fractional in-progress input
                    // instead of silently truncating it via parseInt.
                    const v = Number(e.target.value);
                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                      setClosingBalance(e.target.value);
                    }
                  }}
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

            <div className="pos-close-shift-actions">
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
                  !closingBalance ||
                  !Number.isInteger(Number(closingBalance)) ||
                  Number(closingBalance) < 0
                }
              >
                <Localized id={closingShift ? 'pos-close-shift-closing' : 'pos-close-shift-confirm'}>
                  <span>{closingShift ? 'Closing…' : 'Close Shift'}</span>
                </Localized>
              </button>
            </div>
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
}

/**
 * Post-close summary: total / cash / card sales, expected cash against
 * counted, the signed difference with its over/short tag, and any notes.
 */
export function ShiftSummary({
  shiftSummaryExit,
  closedShiftSummary,
}: ShiftSummaryProps) {
  const { l10n } = useLocalization();
  if (!shiftSummaryExit.shouldRender || !closedShiftSummary) return null;
  return (
          <div
            className={`pos-close-shift-overlay${shiftSummaryExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-close-shift-summary-aria')}
          >
            <div className={`pos-close-shift-modal pos-close-shift-summary${shiftSummaryExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
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
                  {formatMoney({ minor_units: closedShiftSummary.totalSalesMinor, currency: 'USD' })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-cash-sales">
                  <span className="pos-close-shift-summary-label">Cash Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalCashMinor, currency: 'USD' })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-card-sales">
                  <span className="pos-close-shift-summary-label">Card Sales</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {formatMoney({ minor_units: closedShiftSummary.totalCardMinor, currency: 'USD' })}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-expected-cash">
                  <span className="pos-close-shift-summary-label">Expected Cash</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {closedShiftSummary.expectedCashMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.expectedCashMinor, currency: 'USD' })
                    : '—'}
                </span>
              </div>
              <div className="pos-close-shift-summary-item">
                <Localized id="pos-shift-counted">
                  <span className="pos-close-shift-summary-label">Counted</span>
                </Localized>
                <span className="pos-close-shift-summary-value">
                  {closedShiftSummary.closingBalanceMinor !== null
                    ? formatMoney({ minor_units: closedShiftSummary.closingBalanceMinor, currency: 'USD' })
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
                    ? formatMoney({ minor_units: closedShiftSummary.cashDifferenceMinor, currency: 'USD' })
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
  /** Opening drawer float, minor units as typed (raw string). */
  openingBalance: string;
  setOpeningBalance: Dispatch<SetStateAction<string>>;
  /** True while the open is in flight - disables both buttons. */
  openingShift: boolean;
  handleConfirmOpenShift: () => void;
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
}: OpenShiftModalProps) {
  const { l10n } = useLocalization();
  if (!openShiftExit.shouldRender) return null;
  return (
          <div
            className={`pos-close-shift-overlay${openShiftExit.exiting ? ' pos-close-shift-overlay--exiting' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={l10n.getString('pos-open-shift-overlay-aria')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') openShiftExit.requestClose();
              if (e.key === 'Enter') handleConfirmOpenShift();
            }}
          >
            <div className={`pos-close-shift-modal${openShiftExit.exiting ? ' pos-close-shift-modal--exiting' : ''}`}>
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
                  className="pos-close-shift-input"
                  min="0"
                  placeholder="e.g. 500 for $5.00"
                  value={openingBalance}
                  onChange={(e) => {
                    // Whole number only — ignore fractional in-progress input
                    // instead of silently truncating it via parseInt.
                    const v = Number(e.target.value);
                    if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                      setOpeningBalance(e.target.value);
                    }
                  }}
                  aria-label={l10n.getString('pos-open-shift-balance-aria')}
                />
              </Localized>
            </div>

            <div className="pos-close-shift-actions">
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
                disabled={openingShift}
              >
                <Localized id={openingShift ? 'pos-open-shift-opening' : 'pos-open-shift-title'}>
                  <span>{openingShift ? 'Opening…' : 'Open Shift'}</span>
                </Localized>
              </button>
            </div>
          </div>
        </div>
  );
}
