import { useCallback, useEffect, useState } from 'react';
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
   * (`sales.id.ftl:778`) — so an Indonesian operator read English on this path
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

  const { claimLease, releaseLease } = useTabLeases();

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
      // dine_in) and the recall path at :356 already restores it, so the rule has
      // everything it needs here.
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
      setOpeningBill(false);
    }
  }, [activeShift, lines, subtotal, customerName, openBillName, tableNumber, guestCount, tipPercent, serviceChargeEnabled, serviceChargePercent, orderType, discountPercent, discountLabel, resetCart, setTableNumber, setCustomerName, setGuestCount, activeOpenBillId, loadOpenBills, addToast, openBillInputExit, sessionToken, setAppliedPromotions, l10nRef, dispatchOnTabSave, onDispatchKitchen, releaseLease]);

  const handleResumeOpenBill = useCallback(async (id: string) => {
    try {
      const full = await getHeldCartScoped(sessionToken, id);
      if (!full) return;
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
        }) => ({
          id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
          sku: l.sku as Sku,
          name: l.name,
          category: l.category,
          qty: l.qty,
          unit_price: l.unit_price,
          // Restaurant coursing: carried through the hold so a resumed bill
          // keeps its assignments (validated by the CourseId type below).
          ...(l.courseId ? { courseId: l.courseId } : {}),
          ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
          ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
          ...(l.note ? { note: l.note } : {}),
          ...(typeof l.dispatchedQty === 'number' ? { dispatchedQty: l.dispatchedQty } : {}),
        })));
      }
      if (typeof data.discountPercent === 'number') {
        setDiscount(data.discountPercent, data.discountLabel || '');
      }
      if (typeof data.tableNumber === 'string') {
        setTableNumber(data.tableNumber);
      }
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
      await claimLease(id, data.tableNumber);
      openBillsExit.requestClose();
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'pos-toast-bill-resume-failed'), type: 'error' });
    }
  }, [setLines, setDiscount, setTableNumber, setCustomerName, setGuestCount, setTipPercent, setServiceCharge, setOrderType, addToast, openBillsExit, sessionToken, claimLease, l10nRef]);

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
