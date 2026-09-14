/**
 * Split-tender row state - the split-mode flag and the rows it owns.
 *
 * Slice W5-c of the PaymentModal extraction campaign: the splitMode flag, the
 * splits rows, the id counter behind "+ Add Split", and the three callbacks
 * that write them, moved verbatim out of PaymentModal.tsx - same names, same
 * logic, same body order. The seed array is the same two rows (cash, card)
 * with the same ids, and nextSplitId still starts at 3.
 *
 * Why these four items move together and nothing else does: they are one state
 * machine with one invariant - a row is addressed by the id it was created
 * with, ids are never reused, and at least one row always survives.
 * removeSplit's "length <= 1" floor and nextSplitId's monotonic counter are
 * load-bearing halves of that invariant and are only meaningful in one file.
 *
 * ZERO parameters, and that is the point: nothing here reads a shell value.
 * The fourth callback that used to sit beside these three - autoSplitEvenly -
 * is the one item of the cluster that stayed in the shell, because it is the
 * only one whose inputs are produced DOWNSTREAM of the state it writes. It
 * needs effectiveTotalInCartCurrency (returned by ./useTenderMath, which takes
 * splits as an INPUT at its call site) and cartCurrency (returned by
 * ./useMultiCurrency). The seam is therefore circular by construction: the
 * money hook consumes the rows, the distributor needs the money hook's total.
 * Moving it would cost either a ref-threaded total - which changes WHEN the
 * value is read, not merely where - or a second hook call for one callback.
 * Neither is a mechanical move, so autoSplitEvenly stays where it is and keeps
 * writing these rows through setSplits, which this hook hands back for exactly
 * that purpose.
 *
 * What stayed in the shell, on purpose:
 *  - autoSplitEvenly, as above. The residual rule it implements - integer
 *    floor division, baseMinor to every row and baseMinor + remainderMinor to
 *    the LAST row only - is pinned by the characterisation suite
 *    ui/src/__tests__/PaymentModalSplitTenderState.test.tsx (T8-T14) through
 *    the rendered modal, so whoever moves it next has a falsifiable target.
 *  - the modal's open-reset effect, which re-seeds the rows and clears
 *    splitMode. It writes through the two setters returned here instead of
 *    owning a second copy of the state, and it already omits them from its dep
 *    array for the reason documented at that effect: a useState dispatcher
 *    never changes identity, and the array is evaluated during render.
 *  - canComplete / splitComplete: a gate reading seven values, four of them
 *    payment-method form state nothing else here needs - the same arithmetic
 *    that kept it inside useTenderMath.
 *  - every JSX line, including <SplitTenderRows>. No markup moved, so the CSS
 *    registrations in focusVisibleCompliance / touchTargetSizing are untouched.
 *
 * MONEY: none is computed here. amountMinor is the decimal STRING the row's
 * input holds - the same string the shell parses through parseMinorUnits at the
 * explicit currency exponent - and this hook only appends the empty string,
 * copies a patch onto one row, or drops a row. No float, no rounding, no scale.
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Structural twin of the shell's PaymentMethod (PaymentModal.tsx:44), in the
 * same role the row twins already play in ./SplitTenderRows.tsx and
 * ./useTenderMath.ts: the extracted file names the union it stores without
 * importing the component that still owns the display switch over it.
 */
type SplitRowMethod = 'cash' | 'card' | 'qris' | 'other' | 'open_bill' | 'credit';

/** One split-tender row. amountMinor is the input's decimal string, not minor units. */
export interface SplitRow {
  id: number;
  method: SplitRowMethod;
  otherLabel: string;
  amountMinor: string;
}

export interface UseSplitTenderStateResult {
  /** Split-payment checkbox. False = the single-tender path. */
  splitMode: boolean;
  setSplitMode: Dispatch<SetStateAction<boolean>>;
  /** The rows, in on-screen order. Never empty - see removeSplit. */
  splits: SplitRow[];
  /** Handed back for the shell's open-reset only; no row edit goes through it. */
  setSplits: Dispatch<SetStateAction<SplitRow[]>>;
  /** Appends an empty cash row with a fresh id. */
  addSplit: () => void;
  /** Removes by id - never by index - and refuses to empty the list. */
  removeSplit: (id: number) => void;
  /** Patches one row by id, so method and otherLabel survive an amount edit. */
  updateSplit: (id: number, patch: Partial<SplitRow>) => void;
}

export function useSplitTenderState(): UseSplitTenderStateResult {
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>([
    { id: 1, method: 'cash', otherLabel: '', amountMinor: '' },
    { id: 2, method: 'card', otherLabel: '', amountMinor: '' },
  ]);
  const nextSplitId = useRef(3);

  const addSplit = useCallback(() => {
    setSplits((prev) => [
      ...prev,
      { id: nextSplitId.current++, method: 'cash', otherLabel: '', amountMinor: '' },
    ]);
  }, []);

  const removeSplit = useCallback((id: number) => {
    setSplits((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const updateSplit = useCallback((id: number, patch: Partial<SplitRow>) => {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  return {
    splitMode,
    setSplitMode,
    splits,
    setSplits,
    addSplit,
    removeSplit,
    updateSplit,
  };
}
