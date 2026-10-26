import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { useToast } from '@/components/Toast';
import { useWorkspaceScope } from '@/contexts/WorkspaceContext';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { requiredLocalized } from '@/components';
import { parseAppError } from '@/utils/app-error';
import { listen } from '@/api/tauri';
import { useTabLeases } from '@/features/sales/hooks/useTabLeases';

/** The shape `requiredLocalized` accepts, matching `usePosCartActions`. */
type L10nRef = { current: Parameters<typeof requiredLocalized>[0] };
import {
  holdCartScoped,
  listOpenBillsScoped,
  getHeldCartScoped,
  deleteHeldCartScoped,
  type HeldCartRow,
} from '@/api/sales';
import type { Promotion } from '@/api/promotions';
import type { ShiftDto } from '@/api/shifts';
import type { CartLine, LineId, Money, Sku } from '@/types/domain';
import { bareTableNumber, heldCartLabel, extractCustomerNameFromTableBill } from '@/features/sales/utils/tableLabel';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];

export interface UsePosHeldCartsParams {
  sessionToken: string;
  addToast: AddToast;
  /**
   * Localization, as a ref rather than a value.
   *
   * The shift refusal below is a TOAST, and its string used to be a hardcoded
   * English literal while `sales.ftl` already carried
   * `retail-toast-open-shift-first` and the Indonesian translation for it
   * (`sales.id.ftl:863`) — so an Indonesian operator read English on this path
   * and Indonesian on the retail one. A ref, matching `usePosCartActions`, keeps
   * the callback identity stable while always reading the current bundle.
   */
  l10nRef: L10nRef;
  /** Pass-through from usePosShifts: holding a bill requires an open shift. */
  activeShift: ShiftDto | null;
  lines: CartLine[];
  subtotal: Money | null;
  discountPercent: number;
  discountLabel: string;
  resetCart: () => void;
  setAppliedPromotions: (promotions: Promotion[]) => void;
  setLines: (lines: CartLine[]) => void;
  setDiscount: (percent: number, label: string) => void;
  tableNumber?: string;
  setTableNumber: (table: string) => void;
  customerName?: string;
  setCustomerName?: (name: string) => void;
  guestCount?: string;
  setGuestCount?: (count: string) => void;
  tipPercent?: number;
  setTipPercent?: (tip: number) => void;
  serviceChargeEnabled?: boolean;
  serviceChargePercent?: number;
  setServiceCharge?: (enabled: boolean, percent: number) => void;
  orderType?: 'dine_in' | 'takeaway' | 'delivery';
  setOrderType?: (orderType: 'dine_in' | 'takeaway' | 'delivery') => void;
  dispatchOnTabSave?: boolean | null;
  onDispatchKitchen?: (deltaLines: CartLine[]) => Promise<void>;
  /** ADR-19 §5.1 / §6.3 locked inventory station ref. */
  deductionLocationIdRef?: MutableRefObject<string | null>;
  /** Callback to restore location display state on bill resume. */
  onRestoreDeductionLocation?: (locationId: string | null) => void;
}

/**
 * Held-cart ("open bill") lifecycle for the POS screen: the held-bill list and
 * its badge count, the two modal surfaces with their exit animations, the
 * hold-a-cart handler (holdCartScoped), the recall handler
 * (getHeldCartScoped) and the refresh that fires when the list is opened.
 *
 * Moved verbatim out of PosScreen.tsx — same names, same logic, same memo
 * dependencies. Deleting a held cart after checkout stays with the caller
 * (it is part of handlePaymentComplete).
 */
export function usePosHeldCarts({
  sessionToken,
  addToast,
  l10nRef,
  activeShift,
  lines,
  subtotal,
  discountPercent,
  discountLabel,
  resetCart,
  setAppliedPromotions,
  setLines,
  setDiscount,
  tableNumber = '',
  setTableNumber,
  customerName = '',
  setCustomerName,
  guestCount = '',
  setGuestCount,
  tipPercent = 0,
  setTipPercent,
  serviceChargeEnabled = false,
  serviceChargePercent = 0,
  setServiceCharge,
  orderType = 'dine_in',
  setOrderType,
  dispatchOnTabSave,
  onDispatchKitchen,
  deductionLocationIdRef,
  onRestoreDeductionLocation,
}: UsePosHeldCartsParams) {
  // An open bill is a Restaurant POS concept: `list_open_bills_scoped` — its
  // only reader — refuses every other vertical in the bridge
  // (`is_restaurant_pos_workspace`), so a call from anywhere else spends a
  // round-trip to collect a `permissionDenied` that the catch below surfaces
  // as a "Failed to load open bills" toast. `PaymentModal` gates the same
  // concept the same way, for the same reason.
  //
  // Read through `useWorkspaceScope` (nullable, not `useWorkspace`) so a hook
  // rendered outside a provider fails closed. It is also the *right* value to
  // test rather than a heuristic: the scope's `typeKey` is
  // `activeInstance?.type_key`, while the session token is minted from
  // `activeInstance ?? <admin instance>` — so this predicate is true exactly
  // when the token in hand is a restaurant-pos session, and false in the
  // admin-fallback case that produced the `permissionDenied` in the field.
  const workspaceScope = useWorkspaceScope();
  const isRestaurantPos = workspaceScope?.typeKey === 'restaurant-pos';

  const { claimLease, releaseLease, getConflict } = useTabLeases();

  // ── Open Bill state ──────────────────────────────────────────────
  const [activeOpenBillId, setActiveOpenBillId] = useState<string | null>(null);
  const [openBills, setOpenBills] = useState<HeldCartRow[]>([]);
  const [showOpenBills, setShowOpenBills] = useState(false);
  // Fade the Open Bills list modal out before the parent setter
  // flips showOpenBills to false. Used by the close button + Resume.
  const openBillsExit = useExitAnimation(
    showOpenBills,
    () => setShowOpenBills(false),
  );
  const loadOpenBills = useCallback(() => {
    if (!sessionToken) return;
    // Single choke point: this guards the mount effect, the post-hold refresh
    // and every caller of the returned `loadOpenBills`.
    if (!isRestaurantPos) return;
    listOpenBillsScoped(sessionToken)
      .then(setOpenBills)
      .catch((err: unknown) => {
        const appError = parseAppError(err);
        const kind = appError?.kind ?? (err as { kind?: string } | null)?.kind;
        const rawMessage = appError ? ('message' in appError ? appError.message : '') : String((err as Error)?.message ?? err ?? '');
        // `invalidSession` — token expired; the session refresh handler will
        // recover and re-trigger loadOpenBills automatically.
        // `permissionDenied` — the session's type_key is not restaurant-pos;
        // the isRestaurantPos guard above should have caught this, but may
        // race during session initialisation. Either way it is not
        // user-actionable, so swallow it silently.
        if (kind === 'invalidSession' || kind === 'permissionDenied' || rawMessage.includes('permission denied') || rawMessage.includes('may not list open bills')) return;
        addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-open-bills-failed'), type: 'error' });
      });
  }, [addToast, sessionToken, isRestaurantPos, l10nRef]);

  // Real-time tab sync via Tauri events or local DOM events
  useEffect(() => {
    let unlistenTabs: (() => void) | undefined;
    let cancelled = false;

    listen('tabs:changed', () => {
      loadOpenBills();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenTabs = fn;
      })
      .catch(() => {});

    const domTabsChanged = () => {
      loadOpenBills();
    };
    window.addEventListener('kasirmu:tabs:changed', domTabsChanged);

    return () => {
      cancelled = true;
      unlistenTabs?.();
      window.removeEventListener('kasirmu:tabs:changed', domTabsChanged);
    };
  }, [loadOpenBills]);

  // ── Open Bill inline state ────────────────────────────────────
  const [showOpenBillInput, setShowOpenBillInput] = useState(false);
  // Fade the Open Bill Input modal out (mirror of pos-modal-slide-up
  // via .pos-hold-modal--exiting) before the parent setter flips
  // showOpenBillInput to false. Used by cancel + Save-success.
  const openBillInputExit = useExitAnimation(
    showOpenBillInput,
    () => setShowOpenBillInput(false),
  );
  const [openBillName, setOpenBillName] = useState('');
  const [openingBill, setOpeningBill] = useState(false);
  // Re-entry guard for handleOpenBill. `openingBill` above is NOT one: it is a state
  // boolean written at the top of `handleOpenBill` and cleared in its `finally`,
  // and READ NOWHERE
  // as a condition — its only readers are the two buttons in OpenBillModals.tsx:95/103,
  // which it disables. A disabled DOM control cannot close this window: React does not
  // re-render between two clicks that land inside one await, so both calls proceed and
  // each reaches `holdCartScoped`, creating TWO open bills for one sale.
  //
  // MEASURED before this ref existed: two presses in one round-trip produced two
  // holdCartScoped calls ('expected 2 to be 1'). RetailPosScreen's own hold note cites
  // this hook as already using 'the same guard shape' it uses — it did not, which is how
  // the gap stayed invisible on the restaurant side while the retail side was protected.
  const openingBillRef = useRef(false);

  useEffect(() => {
    if (sessionToken || showOpenBills) {
      loadOpenBills();
    }
  }, [sessionToken, showOpenBills, loadOpenBills]);

  const handleOpenBill = useCallback(async () => {
    if (!activeShift) {
      addToast({
        message: requiredLocalized(l10nRef.current, 'retail-toast-open-shift-first'),
        type: 'warning',
      });
      return;
    }
    if (!subtotal || lines.length === 0) return;
    if (openingBillRef.current) return;
    openingBillRef.current = true;
    setOpeningBill(true);
    try {
      const shouldDispatch = dispatchOnTabSave !== false;
      const deltaLines = lines
        .filter((l) => (l.qty - (l.dispatchedQty ?? 0)) > 0)
        .map((l) => ({ ...l, qty: l.qty - (l.dispatchedQty ?? 0) }));

      if (shouldDispatch && deltaLines.length > 0 && onDispatchKitchen) {
        try {
          await onDispatchKitchen(deltaLines);
        } catch {
          // Non-blocking for tab persistence
        }
      }

      const linesToSave = shouldDispatch && deltaLines.length > 0
        ? lines.map((l) => ({ ...l, dispatchedQty: l.qty }))
        : lines;

      // ⚠️ DINE-IN ONLY — the EIGHTH site of this rule. The sibling builders in
      // PosScreen (split-bill and send-to-kitchen) were both fixed; this hook, which
      // is the path that actually saves a tab, still derived the table
      // unconditionally while writing `orderType` into the same record — so a
      // takeaway with a stray number in the Table field persisted
      // {"tableNumber":"T99","orderType":"takeaway"} and was labelled after a table
      // it does not own. `orderType` is a parameter of this hook (defaulting to
      // dine_in) and the recall path in `handleResumeOpenBill` already restores it, so the
      // rule has everything it needs here.
      const trimmedTable = orderType === 'dine_in' ? (tableNumber ?? '').trim() : '';
      const trimmedName = (customerName || openBillName || '').trim();
      // ⚠️ PAX IS DINE-IN ONLY, matching the table line above. The setting reads
      // "party size and number of SEATED GUESTS PER TABLE" (products.ftl:105) and
      // CartPanel.tsx:908 hides the field on a takeaway — but hiding the FIELD left
      // the VALUE in state, so this payload recorded a party size for an order with
      // no table, and a recall restored it.
      const trimmedGuest = orderType === 'dine_in' ? (guestCount ?? '').trim() : '';
      const cartData = JSON.stringify({
        lines: linesToSave.map((l) => ({
          sku: l.sku,
          name: l.name,
          qty: l.qty,
          unit_price: l.unit_price,
          // Restaurant coursing: a held bill resumes through the checkout
          // push, so the assignment must survive the hold.
          ...(l.courseId ? { courseId: l.courseId } : {}),
            ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
            ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
            ...(l.note ? { note: l.note } : {}),
            ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: l.dispatchedQty } : {}),
        })),
        discountPercent,
        discountLabel,
        ...(trimmedTable ? { tableNumber: trimmedTable } : {}),
        ...(trimmedName ? { customerName: trimmedName } : {}),
        ...(trimmedGuest ? { guestCount: trimmedGuest } : {}),
        ...(typeof tipPercent === 'number' && tipPercent > 0 ? { tipPercent } : {}),
        ...(typeof serviceChargeEnabled === 'boolean' ? { serviceChargeEnabled } : {}),
        ...(typeof serviceChargePercent === 'number' && serviceChargePercent > 0 ? { serviceChargePercent } : {}),
        ...(orderType ? { orderType } : {}),
      });
      // `heldCartLabel`, not a hand-built ternary: the stored table names already
      // read "Table 12" (see utils/tableLabel.ts), so interpolating the raw value
      // persisted the tab as "Table Table 12". The sibling site in PaymentModal.tsx
      // had the identical expression, which is why this is one function now.
      const label =
        heldCartLabel(trimmedTable, trimmedName) ?? `Open Bill #${Date.now()}`;

      // If updating an already resumed open bill, delete the previous record first so we
      // don't produce duplicate tabs.
      //
      // ⚠️ This used to end `.catch(() => {})`. Swallowing it defeated the whole line:
      // the DELETE is what prevents a duplicate, so a rejected delete followed by the
      // hold below created the SECOND open bill for the table that this comment claims
      // to prevent — and the toast still said "updated". A failure here is now fatal to
      // the operation, which the caller's existing catch turns into an error toast.
      if (activeOpenBillId) {
        await deleteHeldCartScoped(sessionToken, activeOpenBillId);
        await releaseLease(activeOpenBillId);
      }

      await holdCartScoped(sessionToken, {
        label,
        cart_data: cartData,
        item_count: linesToSave.length,
        total_minor: subtotal.minor_units,
        currency: subtotal.currency,
        bill_type: 'open_bill',
        // Same doubling as the label above, in the customer field.
        customer_name: trimmedName || (trimmedTable ? `Table ${bareTableNumber(trimmedTable)}` : ''),
        ...(deductionLocationIdRef?.current ? { deduction_location_id: deductionLocationIdRef.current } : {}),
      });
      const wasUpdating = !!activeOpenBillId;
      resetCart();
      setTableNumber('');
      setCustomerName?.('');
      setGuestCount?.('');
      setActiveOpenBillId(null);
      setAppliedPromotions([]);
      openBillInputExit.requestClose();
      setOpenBillName('');
      loadOpenBills();
      addToast({
        message: requiredLocalized(
          l10nRef.current,
          wasUpdating ? 'pos-toast-bill-updated' : 'pos-toast-bill-saved',
          { label },
        ),
        type: 'success',
      });
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-bill-save-failed'), type: 'error' });
    } finally {
      // Released on both paths: a REFUSED save must leave the cashier able to retry,
      // and the tab it refused to create is exactly what they are trying to record.
      openingBillRef.current = false;
      setOpeningBill(false);
    }
  }, [activeShift, lines, subtotal, customerName, openBillName, tableNumber, guestCount, tipPercent, serviceChargeEnabled, serviceChargePercent, orderType, discountPercent, discountLabel, resetCart, setTableNumber, setCustomerName, setGuestCount, activeOpenBillId, loadOpenBills, addToast, openBillInputExit, sessionToken, setAppliedPromotions, l10nRef, dispatchOnTabSave, onDispatchKitchen, releaseLease, deductionLocationIdRef]);

  /**
   * Load a held tab into the cart.
   *
   * RETURNS whether the cart was actually replaced, and callers that pre-set
   * state MUST await it. `PosScreen.handleSelectTableFromManagement` set the
   * table number and THEN fired this without awaiting, so a refused resume left
   * the PREVIOUS tab's lines sitting under the newly chosen table number — the
   * refusal protected the cart and mislabelled it in the same breath. The caller
   * now awaits this and only claims the table on `true`.
   */
  const handleResumeOpenBill = useCallback(async (id: string): Promise<boolean> => {
    // ── The lease is checked HERE and claimed LATER, conditionally ───────────
    //
    // Two defects have lived on this line, in opposite directions:
    //
    // 1. `claimLease` ran unconditionally at the end of the handler. It writes the
    //    lease with THIS terminal's id, and `getConflict` discards a lease whose
    //    terminal is the current one (`useTabLeases.ts:197`) — so the claim erased
    //    the other terminal's record before `CartPanel` could read it. The conflict
    //    banner (`pos-cart-conflict-alert`) could never appear on the one path it
    //    exists for. Two waitstaff edited one table's order silently.
    //
    // 2. The first fix REFUSED the resume instead. Measured in a browser:
    //      PROBE resumed=false cartBanner=false toast=true tablesRow=0
    //    Resume blocked, banner still unreachable (it needs `activeOpenBillId` set),
    //    and the Tables screen that holds the other Take Over is feature-gated off
    //    for this profile. So the refusal pointed at a control nobody could reach —
    //    a dead end, and the same class of defect as round 297's exit lock-out.
    //
    // The correct shape is neither: RESUME, but do not steal. Loading the tab sets
    // `activeOpenBillId`, which is what makes the banner renderable, and leaving the
    // foreign lease intact is what makes it true. The operator then sees who has the
    // tab and chooses — which is exactly what `forceTakeover`'s button is for.
    //
    // Claiming is therefore conditional: only when nobody else holds it. A tab already
    // held by this terminal still gets re-claimed (harmless, extends the window).
    const conflict = getConflict(id);

    // ── Never replace a LIVE cart in silence ───────────────────────────────
    //
    // The resume below is `setLines(data.lines.map(...))` — a WHOLESALE REPLACE.
    // With a non-empty cart that is a silent destruction of the order the
    // operator is building, reached by a single mis-tap in the held-tabs list:
    // MEASURED, resuming over a 2-unit live cart called setLines once and the
    // live lines were gone. No confirmation, and the undo pill cannot help —
    // it holds lines removed individually, and this was never a per-line
    // removal.
    //
    // The hook's neighbours all stop and tell the operator: holding refuses
    // without a shift, and the lease check above raises a conflict banner.
    // This one neither replaced nor reported, so it now refuses with a toast
    // and leaves the cart untouched.
    //
    // Not a silent `resetCart()` either — an un-confirmed reset is the same
    // destruction one keystroke earlier. The recovery path for an operator who
    // DOES want the tab is the Tables screen, where the held cart is listed.
    // EXEMPT two shapes, and the distinction is what makes the guard safe:
    //
    //   * the tab THIS cart already belongs to — re-opening the open bill being
    //     edited is how an operator refreshes it, and it legitimately runs with a
    //     full cart;
    //   * the FIRST resume of a session, where nothing is active yet and the cart
    //     holds an in-progress order for THIS table. That is the primary way an
    //     operator opens a tab at all, and refusing it would strand them.
    //
    // What remains is the destruction case: resuming a SECOND tab over the cart of
    // the first. Two different tabs' worth of order in one cart, with the first
    // silently discarded.
    const resumingActiveTab = !!activeOpenBillId && activeOpenBillId === id;
    const alreadyEditingATab = !!activeOpenBillId && !resumingActiveTab;
    if (lines.length > 0 && alreadyEditingATab) {
      addToast({
        message: requiredLocalized(l10nRef.current, 'pos-toast-resume-cart-not-empty'),
        type: 'warning',
      });
      return false;
    }

    try {
      const full = await getHeldCartScoped(sessionToken, id);
      if (!full) return false;
      const data = JSON.parse(full.cart_data);
      if (data.lines && Array.isArray(data.lines)) {
        setLines(data.lines.map((l: {
          sku: string;
          name?: string;
          qty: number;
          unit_price: { minor_units: number; currency: string };
          category?: string;
          courseId?: CartLine['courseId'];
          coursingStatus?: CartLine['coursingStatus'];
          modifiers?: CartLine['modifiers'];
          note?: string;
          dispatchedQty?: number;
        }) => {
          // VALIDATE, DO NOT CAST. The type annotations above describe the payload
          // this loop trusts, but `cart_data` is untrusted JSON — written by
          // holdCartScoped, round-tripped through SQLite, read back here — and a TS
          // annotation is erased at runtime, so it checks nothing. Both fields feed
          // money: `usePosState.subtotal` sums `unit_price.minor_units * qty` with no
          // guard of its own, so a non-numeric value makes the whole cart NaN minor
          // units and the pay screen reads NaN. The retail twin already does this
          // (RetailPosScreen.handleResumeCart :1483-1487); this is the same rule on
          // the path that runs on a busy floor.
          const rawQty: unknown = l.qty;
          const rawPrice: unknown = l.unit_price;
          const price = rawPrice && typeof rawPrice === 'object'
            ? (rawPrice as { minor_units?: unknown; currency?: unknown })
            : null;
          const minor = price && typeof price.minor_units === 'number' && Number.isFinite(price.minor_units)
            ? price.minor_units
            : 0;
          const currency = price && typeof price.currency === 'string' && price.currency
            ? price.currency
            : (typeof l.unit_price?.currency === 'string' ? l.unit_price.currency : 'IDR');
          const qty = typeof rawQty === 'number' && Number.isFinite(rawQty) && rawQty > 0
            ? Math.round(rawQty)
            : 1;
          return {
            id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
            sku: l.sku as Sku,
            name: l.name,
            category: l.category,
            qty,
            unit_price: { minor_units: minor, currency },
            // Restaurant coursing: carried through the hold so a resumed bill
            // keeps its assignments (validated by the CourseId type below).
            ...(l.courseId ? { courseId: l.courseId } : {}),
          ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
          ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
          ...(l.note ? { note: l.note } : {}),
          ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: l.dispatchedQty } : {}),
        }}));
      }
      if (typeof data.discountPercent === 'number') {
        setDiscount(data.discountPercent, data.discountLabel || '');
      }
      // SET-OR-CLEAR, not set-if-present.
      //
      // The conditional form left whatever table was already selected in place
      // when the resumed tab had none — and a tab legitimately has none: a
      // takeaway, or a bill held before the field existed. `OpenBillModals.tsx:180`
      // calls this straight from the held-tabs list with no table set by that
      // screen, so an operator with table 5 open who tapped a takeaway tab ended
      // up with the takeaway's items under table 5.
      //
      // THE CONSEQUENCE IS ON PAPER: completedSale.ts puts this value in the
      // printed args and derives the receipt NUMBER from it (:212), so the check
      // named a table the order did not have — the rule this file restates as
      // "DINE-IN ONLY" in nine places, reached here through the one field the
      // conditional did not read.
      setTableNumber(typeof data.tableNumber === 'string' ? data.tableNumber : '');
      // PAX is dine-in-only, and this gate is why the RECALL needs its own check
      // rather than relying on the save side: a tab persisted BEFORE 2026-10-12
      // carries guestCount even on a takeaway (the field was hidden but the value
      // was written), and orderType is applied below, so a legacy tab would
      // otherwise resurrect a party size onto a takeaway. Read the payload's own
      // orderType, not the current state, because the state is about to change.
      if (typeof data.guestCount === 'string' && data.orderType !== 'takeaway' && data.orderType !== 'delivery') {
        setGuestCount?.(data.guestCount);
      }
      if (typeof data.tipPercent === 'number') {
        setTipPercent?.(data.tipPercent);
      }
      if (typeof data.serviceChargeEnabled === 'boolean' || typeof data.serviceChargePercent === 'number') {
        setServiceCharge?.(Boolean(data.serviceChargeEnabled), Number(data.serviceChargePercent || 0));
      }
      if (data.orderType && (data.orderType === 'dine_in' || data.orderType === 'takeaway' || data.orderType === 'delivery')) {
        setOrderType?.(data.orderType);
      }
      if (typeof data.customerName === 'string') {
        setCustomerName?.(data.customerName);
      } else if (full.customer_name) {
        const cust = extractCustomerNameFromTableBill(full.customer_name);
        if (cust) {
          setCustomerName?.(cust);
        }
      }
      setActiveOpenBillId(id);
      if (deductionLocationIdRef) {
        deductionLocationIdRef.current = full.deduction_location_id ?? null;
      }
      if (full.deduction_location_id !== undefined) {
        onRestoreDeductionLocation?.(full.deduction_location_id);
      }

      // CLAIM ONLY WHEN NOBODY ELSE HOLDS IT — see the note at the top of this handler.
      //
      // Claiming over a foreign lease is what made the conflict banner unrenderable,
      // because `getConflict` ignores a lease owned by the current terminal. Skipping
      // the claim leaves the other terminal's record in place, so `CartPanel` sees it
      // and shows the warning plus its Take Over button.
      //
      // The tab is still RESUMED either way: the operator can read and work with it,
      // and is told — in the panel, not in a toast they may miss — that someone else
      // is on it.
      if (!conflict) {
        await claimLease(id, data.tableNumber);
      } else {
        addToast({
          message: requiredLocalized(
            l10nRef.current,
            'pos-toast-tab-held-by-other',
            // `terminalName` arrives over a broadcast whose shape is only asserted at
            // runtime, so the declared `string` is not guaranteed, and Fluent's args do
            // not accept `undefined`.
            { terminal: conflict.terminalName ?? 'another terminal' },
          ),
          type: 'warning',
        });
      }

      openBillsExit.requestClose();
      return true;
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-bill-resume-failed'), type: 'error' });
      return false;
    }
    // `getConflict` is a callback over lease state, so it changes whenever the
    // registry does — which is the point: the guard must read the CURRENT conflict
    // answer at resume time, not one captured when this callback was created.
  }, [setLines, setDiscount, setTableNumber, setCustomerName, setGuestCount, setTipPercent, setServiceCharge, setOrderType, addToast, openBillsExit, sessionToken, claimLease, getConflict, l10nRef, activeOpenBillId, lines.length, deductionLocationIdRef, onRestoreDeductionLocation]);

  return {
    activeOpenBillId,
    setActiveOpenBillId,
    openBills,
    setShowOpenBills,
    openBillsExit,
    loadOpenBills,
    setShowOpenBillInput,
    openBillInputExit,
    openBillName,
    setOpenBillName,
    openingBill,
    handleOpenBill,
    handleResumeOpenBill,
    releaseLease,
    claimLease,
  };
}
