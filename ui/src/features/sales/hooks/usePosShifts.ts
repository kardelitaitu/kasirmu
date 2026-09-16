import { useCallback, useEffect, useRef, useState } from 'react';
import type { useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import {
  getActiveShiftScoped,
  openShiftScoped,
  closeShiftScoped,
  type ShiftDto,
} from '@/api/shifts';
import type { CartLine } from '@/types/domain';

/** Structural twin of the caller's useRef(l10n) result — non-null current, same bundle type. */
type L10nRef = { current: ReturnType<typeof useLocalization>['l10n'] };

export interface UsePosShiftsParams {
  sessionToken: string;
  userId: string;
  /** Live cart lines — read only to enforce "cart must be empty to close". */
  lines: CartLine[];
  /** Bundle ref, threaded in so the callbacks keep their stable dep chain. */
  l10nRef: L10nRef;
}

/**
 * Shift lifecycle for the POS screen: the active shift, its load-on-mount /
 * on-session-change fetch, the live elapsed-shift clock, and everything the
 * open-shift and close-shift flows own (modal visibility, exit animations,
 * form fields, in-flight flags, the inline error banner and the four
 * handlers that drive them).
 *
 * Moved verbatim out of PosScreen.tsx — same names, same logic, same memo
 * dependencies, same 60s tick interval, same error text.
 */
export function usePosShifts({ sessionToken, userId, lines, l10nRef }: UsePosShiftsParams) {
  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);
  const activeShiftRef = useRef(activeShift);
  activeShiftRef.current = activeShift;
  const [shiftLoading, setShiftLoading] = useState(true);
  // Live elapsed-shift clock: while a shift is open, tick every minute so
  // the header can show a running "2h 15m" instead of the bare opening
  // time (which read like a wall clock). The interval stops when the
  // shift closes — activeShift → null runs the effect's cleanup.
  const [shiftNow, setShiftNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeShift) return;
    // Rebase the elapsed anchor the instant a shift becomes active so the
    // first render is accurate even if the screen was mounted long before.
    setShiftNow(Date.now());
    const id = window.setInterval(() => setShiftNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [activeShift]);

  const [showCloseShift, setShowCloseShift] = useState(false);
  const [showOpenShift, setShowOpenShift] = useState(false);
  // Fade the open-shift modal out before the parent setter flips
  // showOpenShift to false. Used by Cancel + Escape + Open-success.
  const openShiftExit = useExitAnimation(
    showOpenShift,
    () => setShowOpenShift(false),
  );
  const [closingBalance, setClosingBalance] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [closingShift, setClosingShift] = useState(false);
  const [openingShift, setOpeningShift] = useState(false);
  const [closeShiftError, setCloseShiftError] = useState<string | null>(null);
  const [closedShiftSummary, setClosedShiftSummary] = useState<ShiftDto | null>(null);
  // Fade the inline shift-error banner out. The error is set when
  // the cashier tries to close the shift while the cart is not empty.
  // Dismiss via × fades with a 200ms height-opacity mirror before
  // clearing the error string.
  const shiftErrorExit = useExitAnimation(
    !!closeShiftError && !showCloseShift,
    () => setCloseShiftError(null),
  );

  // Fade the close-shift confirmation modal out before the parent
  // state flips. Used by Cancel + Escape. The confirm-success path
  // that swaps to the summary view intentionally SNAPS (no fade on
  // the confirmation) because the new summary has its own entry
  // animation — adding an exit fade on the old one would visually
  // double up with the new entry.
  const closeShiftExit = useExitAnimation(
    showCloseShift && !closedShiftSummary,
    () => {
      setShowCloseShift(false);
      setCloseShiftError(null);
    },
  );
  // Fade the close-shift success summary out before clearing all
  // three related states. Used by the Done button.
  const shiftSummaryExit = useExitAnimation(
    !!closedShiftSummary,
    () => {
      setClosedShiftSummary(null);
      setShowCloseShift(false);
      setCloseShiftError(null);
    },
  );

  // Load active shift on mount and when session changes.
  useEffect(() => {
    if (!userId) {
      setActiveShift(null);
      setShiftLoading(false);
      return;
    }
    setShiftLoading(true);
    getActiveShiftScoped(sessionToken)
      .then((shift) => { setActiveShift(shift); })
      .catch(() => { setActiveShift(null); })
      .finally(() => setShiftLoading(false));
  }, [userId, sessionToken]);

  const handleCloseShiftClick = useCallback(() => {
    setCloseShiftError(null);
    setClosedShiftSummary(null);
    // Enforce: cart must be empty before closing shift.
    if (lines.length > 0) {
      setCloseShiftError(l10nRef.current.getString('pos-close-shift-cart-error'));
      return;
    }
    setClosingBalance('');
    setShiftNotes('');
    setShowCloseShift(true);
  }, [lines, l10nRef]); // l10n via ref - the ref itself is now a listed, stable dep

  const handleConfirmCloseShift = useCallback(async () => {
    if (!activeShift) return;
    // Whole-number minor units — reject fractional input instead of
    // silently truncating it via parseInt.
    const balance = Number(closingBalance);
    if (!Number.isInteger(balance) || balance < 0) return;

    setClosingShift(true);
    setCloseShiftError(null);
    try {
      const closed = await closeShiftScoped(sessionToken, activeShift.id, balance, shiftNotes.trim() || null);
      setClosedShiftSummary(closed);
      setActiveShift(null); // no longer active
    } catch (err) {
      const msg = l10nErrorMessage(err, l10nRef.current, 'pos-close-shift-failed');
      setCloseShiftError(msg);
    } finally {
      setClosingShift(false);
    }
  }, [activeShift, closingBalance, shiftNotes, sessionToken, l10nRef]); // l10n via ref - stable dep, see above

  const handleOpenShiftClick = useCallback(() => {
    setOpeningBalance('');
    setShowOpenShift(true);
  }, []);

  const handleConfirmOpenShift = useCallback(async () => {
    const balance = Number(openingBalance);
    const safeBalance = !Number.isNaN(balance) && Number.isInteger(balance) && balance >= 0 ? balance : 0;

    setOpeningShift(true);
    try {
      const shift = await openShiftScoped(sessionToken, safeBalance);
      setActiveShift(shift);
      openShiftExit.requestClose();
    } catch (err) {
      // A refused open is NOT rare and was silently swallowed: the backend
      // rejects a second open shift for the signed-in user
      // (crates/oz-core/src/db/shifts.rs:64-75), so before this line the click
      // simply did nothing visible — no toast, no error, modal left standing.
      // Same surfacing idiom the close path uses two callbacks above
      // (setCloseShiftError + l10nErrorMessage), whose inline banner is
      // role="alert" in CartPanel and renders while no close modal is open —
      // so it shows on top of the open-shift modal, which deliberately STAYS
      // open so the cashier can correct the balance and retry.
      setCloseShiftError(l10nErrorMessage(err, l10nRef.current, 'retail-toast-failed-open-shift'));
    } finally {
      setOpeningShift(false);
    }
  }, [openingBalance, openShiftExit, sessionToken, l10nRef, setCloseShiftError]);

  return {
    activeShift,
    activeShiftRef,
    shiftLoading,
    shiftNow,
    setShowCloseShift,
    openShiftExit,
    closingBalance,
    setClosingBalance,
    openingBalance,
    setOpeningBalance,
    shiftNotes,
    setShiftNotes,
    closingShift,
    openingShift,
    closeShiftError,
    setCloseShiftError,
    closedShiftSummary,
    shiftErrorExit,
    closeShiftExit,
    shiftSummaryExit,
    handleCloseShiftClick,
    handleConfirmCloseShift,
    handleOpenShiftClick,
    handleConfirmOpenShift,
  };
}
