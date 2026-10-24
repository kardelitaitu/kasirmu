import { useCallback, useEffect, useRef, useState } from 'react';
import { requiredLocalized } from '@/components';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { useOptionalToast, type ToastContextValue } from '@/components/Toast';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';
import { asArray } from '@/utils/ipc-payload';
import { formatMoney, type CartLine } from '@/types/domain';
import {
  listOpenBillsScoped,
  getHeldCartScoped,
  holdCartScoped,
  deleteHeldCartScoped,
  printSalesReceipt,
  type HeldCartRow,
} from '@/api/sales';
import { getSettingScoped, setSettingScoped } from '@/api/settings';
import {
  listTablesScoped,
  listSectionsScoped,
  updateTableStatusScoped,
  releaseTableScoped,
  createTableScoped,
  updateTableScoped,
  deleteTableScoped,
  type Table,
} from '@/api/tables';
import { listen } from '@/api/tauri';
import { useTabLeases } from '@/features/sales/hooks/useTabLeases';
import { matchesTableBill, bareTableNumber, heldCartLabel } from '@/features/sales/utils/tableLabel';
import { buildPreCheckoutBillReceipt } from '@/features/sales/payment/completedSale';
import './TableManagementScreen.css';

export interface TableModalState {
  id?: string;
  name: string;
  capacity: number;
  section: string;
  shape: string;
}

export interface TableReservationModalState {
  table: Table;
  guestName: string;
  phone: string;
  partySize: number;
  time: string;
  notes: string;
}

export interface ReservationDetails {
  guestName: string;
  phone?: string | undefined;
  partySize?: number | undefined;
  time?: string | undefined;
  notes?: string | undefined;
}

/** Vector Grid icon for empty floor plan state */
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="32" height="32" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/** TBL-07: finite status enum → localized Fluent message id. Unknown values fall back to a safe localized label. */
const STATUS_LABEL_IDS: Record<string, string> = {
  available: 'tables-available',
  occupied: 'tables-occupied',
  reserved: 'tables-reserved',
  cleaning: 'tables-cleaning',
};

export interface TableManagementScreenProps {
  /** Optional callback when a table is selected for assigning to the active cart / order. */
  onSelectTable?: (tableName: string) => void;
  /** Optional callback to navigate back to POS */
  onBack?: () => void;
}

/** Table management screen — interactive floor-plan view for managing restaurant table status (available, occupied, reserved, cleaning). */
export default function TableManagementScreen({ onSelectTable, onBack }: TableManagementScreenProps = {}) {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const optionalSettings = useOptionalSettings();
  const storeCurrency = optionalSettings?.settings?.store?.currency || 'IDR';
  const [tables, setTables] = useState<Table[]>([]);
  const [tablePool, setTablePool] = useState<Table[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  // Carries the array a `setSections` updater produced out to the awaited
  // `setSettingScoped` write. See `handleRenameSection` for why a local
  // `let` cannot do this.
  const sectionsResultRef = useRef<string[] | null>(null);
  const [openBills, setOpenBills] = useState<HeldCartRow[]>([]);
  /** The open-bill/tab read failed, so `openBills` is NOT authoritative.
   *
   *  `listOpenBillsScoped` was `.catch(() => [])` inside the floor-plan load,
   *  which reports "no open bills" for a read that merely failed — and
   *  `openBills` is what marks a table as occupied and what `handleReserveConfirm`
   *  reads when converting a reservation to a tab. A cashier would therefore see
   *  a table with a RUNNING TAB rendered as free and could seat a walk-in over
   *  it. TBL-02 deliberately keeps known-good tables visible on a refresh
   *  failure; the bills list has no such known-good fallback, so it must say so
   *  instead of asserting empty. */
  const [billsUnknown, setBillsUnknown] = useState(false);
  const [selected, setSelected] = useState<Table | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const toastCtx = useOptionalToast();
  const toastRef = useRef(toastCtx);
  toastRef.current = toastCtx;
  const addToast = useCallback<ToastContextValue['addToast']>(
    (toast) => toastRef.current?.addToast(toast) ?? '',
    [],
  );
  const { getConflict, forceTakeover } = useTabLeases();
  const [printBillEnabled, setPrintBillEnabled] = useState<boolean | null>(null);
  const [tableTransferEnabled, setTableTransferEnabled] = useState<boolean | null>(null);
  const [moveTableModal, setMoveTableModal] = useState<Table | null>(null);
  const [selectedDestTableId, setSelectedDestTableId] = useState<string>('');
  const [movingTable, setMovingTable] = useState(false);
  const [mergeTableModal, setMergeTableModal] = useState<Table | null>(null);
  const [selectedMergeDestTableId, setSelectedMergeDestTableId] = useState<string>('');
  const [mergingTable, setMergingTable] = useState(false);
  const [reserveModal, setReserveModal] = useState<TableReservationModalState | null>(null);
  const [reservingTable, setReservingTable] = useState(false);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [showManageSections, setShowManageSections] = useState(false);
  const [newSectionInput, setNewSectionInput] = useState('');
  const [editingSectionName, setEditingSectionName] = useState<string | null>(null);
  const [editSectionInput, setEditSectionInput] = useState('');
  const [arrangeSelectedTableId, setArrangeSelectedTableId] = useState<string | null>(null);
  const [resizingTableId, setResizingTableId] = useState<string | null>(null);
  const resizeStartPos = useRef<{
    pointerX: number;
    pointerY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const resizeOriginDim = useRef<{ width: number; height: number } | null>(null);
  const floorplanRef = useRef<HTMLDivElement | null>(null);
  const dragStartPos = useRef<{
    pointerX: number;
    pointerY: number;
    tableX: number;
    tableY: number;
  } | null>(null);
  /**
   * The dragged table's position BEFORE the drag began.
   *
   * The drag writes optimistically (inside `handlePointerMoveTable`) and persists only at
   * pointer-up. If that write is refused the toast fires in the handler's `catch` — the
   * `addToast` with a `type: 'error'`, not the success toast beside it — but the table stayed
   * VISUALLY at the dropped position, because nothing put it back — and `tablesRef`
   * (declared beside `dragOriginPos`, read in the drag-apply handler) still holds the
   * refused coordinates, so a retry re-sent the
   * payload that was just rejected. The floor plan then disagrees with the server.
   */
  const dragOriginPos = useRef<{ pos_x: number; pos_y: number } | null>(null);
  const tablesRef = useRef<Table[]>([]);
  tablesRef.current = tables;
  const [printingBill, setPrintingBill] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // TBL-03: the table currently persisting a mutation; guards duplicate clicks.
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Ref mirror of pendingId so the guard is immune to stale closures: two
  // rapid clicks in the same tick must not both pass the check.
  const pendingRef = useRef<string | null>(null);
  // TBL-03: localized error surfaced inside the open detail panel.
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tableModal, setTableModal] = useState<TableModalState | null>(null);
  const [tableModalSaving, setTableModalSaving] = useState(false);
  const [tableModalError, setTableModalError] = useState<string | null>(null);
  // Request-generation guard (TBL-02): a stale response from an earlier
  // section/token/refresh can never overwrite a fresher result.
  const loadSeqRef = useRef(0);
  // TBL-06: dialog panel + the trigger that opened it (for focus restoration).
  const detailRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Match table with active open bill/tab
  const getTableBill = useCallback(
    (tableName: string): HeldCartRow | undefined => {
      return openBills.find((b) => matchesTableBill(b, tableName));
    },
    [openBills],
  );

  // Match table with active reservation details
  const getTableReservation = useCallback(
    (tableName: string): ReservationDetails | null => {
      const bill = getTableBill(tableName);
      if (!bill) return null;
      if (bill.label.includes('Res:') || bill.label.toLowerCase().includes('reservation')) {
        const guest = bill.customer_name || bill.label.split('Res:')[1]?.trim() || 'Guest';
        const timeMatch = bill.label.match(/\((\d{1,2}:\d{2})\)/);
        const partyMatch = bill.label.match(/\[(\d+)p\]/);
        return {
          guestName: guest.split('(')[0]?.split('[')[0]?.trim() || guest,
          phone: undefined,
          partySize: partyMatch ? parseInt(partyMatch[1]!, 10) : undefined,
          time: timeMatch ? timeMatch[1] : undefined,
          notes: undefined,
        };
      }
      return null;
    },
    [getTableBill],
  );

  const [selectedReservation, setSelectedReservation] = useState<ReservationDetails | null>(null);

  useEffect(() => {
    if (!selected || selected.status !== 'reserved' || !sessionToken) {
      setSelectedReservation(null);
      return;
    }
    const bill = getTableBill(selected.name);
    if (!bill) {
      setSelectedReservation(null);
      return;
    }
    const initial = getTableReservation(selected.name);
    setSelectedReservation(initial);
    let cancelled = false;
    const resPromise = getHeldCartScoped(sessionToken, bill.id);
    if (resPromise && typeof resPromise.then === 'function') {
      resPromise
        .then((full) => {
          if (cancelled || !full || !full.cart_data) return;
          try {
            const data = JSON.parse(full.cart_data);
            setSelectedReservation({
              guestName: data.customerName || initial?.guestName || 'Guest',
              phone: data.phone || initial?.phone,
              partySize: typeof data.partySize === 'number' ? data.partySize : initial?.partySize,
              time: data.reservationTime || initial?.time,
              notes: data.notes || initial?.notes,
            });
          } catch {
            // keep initial
          }
        })
        .catch(() => {
          // keep initial
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selected, sessionToken, getTableBill, getTableReservation]);

  // Match table with active joined table(s) if merged
  const getTableJoined = useCallback(
    (tableName: string): string | null => {
      const bill = getTableBill(tableName);
      if (!bill) return null;
      const str = (bill.customer_name || '') + ' ' + (bill.label || '');
      const match = str.match(/\[\+T([^\]]+)\]/);
      return match ? match[1] ?? null : null;
    },
    [getTableBill],
  );

  // TBL-07: localized label for a raw status value, with unknown fallback.
  const statusLabel = useCallback(
    (status: string) => l10n.getString(STATUS_LABEL_IDS[status] ?? 'tables-status-unknown'),
    [l10n],
  );

  // TBL-09: sections are stable metadata loaded independently of the table
  // page, so selecting a section never makes the other filters disappear and
  // empty sections stay representable. Non-fatal — the floor plan still works
  // if section loading fails.
  const loadSections = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const [data, customRaw] = await Promise.all([
        listSectionsScoped(sessionToken).catch(() => []),
        getSettingScoped(sessionToken, 'restaurant.table_sections').catch(() => null),
      ]);
      const dbSections = asArray<string>(data);
      let customSections: string[] = [];
      if (customRaw) {
        try {
          const parsed = JSON.parse(customRaw);
          if (Array.isArray(parsed)) {
            customSections = parsed.filter(
              (s): s is string => typeof s === 'string' && s.trim().length > 0,
            );
          }
        } catch {
          // ignore invalid json in custom sections
        }
      }
      const combined = Array.from(new Set(['Main', ...customSections, ...dbSections]));
      setSections(combined);
    } catch {
      setSections(['Main']);
    }
  }, [sessionToken]);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    void getSettingScoped(sessionToken, 'restaurant.print_bill_action')
      .then((raw) => { if (!cancelled) setPrintBillEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setPrintBillEnabled(null); });
    void getSettingScoped(sessionToken, 'restaurant.table_transfer')
      .then((raw) => { if (!cancelled) setTableTransferEnabled(raw === null ? null : raw === 'true'); })
      .catch(() => { if (!cancelled) setTableTransferEnabled(null); });
    return () => { cancelled = true; };
  }, [sessionToken]);

  // TBL-02: durable loading/error/retry with a seq guard. Known-good tables
  // are preserved during a refresh (the floor plan stays visible); failures
  // surface a localized error and a retry path.
  const loadTables = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      // The bills read reports its own failure rather than resolving to `[]`:
      // an empty list is a CLAIM (every table is free), and a failed read is
      // not entitled to make it. `null` keeps the load itself succeeding so the
      // floor plan still renders — see `billsUnknown` above.
      let billsFailed = false;
      const [tableData, billData] = await Promise.all([
        listTablesScoped(sessionToken, section ?? undefined),
        listOpenBillsScoped(sessionToken).catch(() => {
          billsFailed = true;
          return [] as HeldCartRow[];
        }),
      ]);
      if (seq !== loadSeqRef.current) return;
      setBillsUnknown(billsFailed);
      // asArray: see utils/ipc-payload — the render maps/finds these.
      const loadedTables = asArray<typeof tableData[number]>(tableData);
      setTables(loadedTables);
      if (section === null) {
        setTablePool(loadedTables);
      }
      setOpenBills(asArray<typeof billData[number]>(billData));
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(l10nErrorMessage(err, l10n, 'app-error-generic'));
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [sessionToken, section, l10n]);

  useEffect(() => {
    if (!sessionToken) return;
    void loadTables();
  }, [loadTables, sessionToken, refreshKey]);

  // Real-time floor plan synchronization via Tauri events (emitted locally or received via LAN forwarder)
  useEffect(() => {
    let unlistenStatus: (() => void) | undefined;
    let unlistenDeleted: (() => void) | undefined;
    let unlistenTabs: (() => void) | undefined;
    let cancelled = false;

    listen('tabs:changed', () => {
      void loadTables();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenTabs = fn;
      })
      .catch(() => {});

    listen<Table>('tables:status-changed', (event) => {
      const updated = event.payload;
      if (updated && updated.id) {
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelected((curr) => (curr && curr.id === updated.id ? updated : curr));
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenStatus = fn;
      })
      .catch(() => {});

    listen<{ id: string }>('tables:deleted', (event) => {
      const { id } = event.payload;
      if (id) {
        setTables((prev) => prev.filter((t) => t.id !== id));
        setTablePool((prev) => prev.filter((t) => t.id !== id));
        setSelected((curr) => (curr && curr.id === id ? null : curr));
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenDeleted = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlistenStatus?.();
      unlistenDeleted?.();
      unlistenTabs?.();
    };
    // ⚠️ MUST depend on loadTables. This array was `[]`, so the tabs:changed
    // handler below kept the mount-time `loadTables` — and with it that render's
    // `sessionToken` and `section`. A cashier who switched store and then had any
    // other terminal save a tab got the PREVIOUS store's floor plan written over
    // the one on screen, silently, on the screen they seat people from. The sibling
    // section effect below already lists its loader for exactly this reason; this
    // one was the outlier. Same for `section`: the reload used the section it
    // mounted with.
    //
    // Re-subscribing is the point, not a cost: the listeners are cheap, and the
    // cleanup above unregisters the previous generation before the next registers.
  }, [loadTables]);

  const retry = useCallback(() => setRefreshKey((k) => k + 1), []);

  // TBL-06: opening the dialog remembers the trigger so focus can be restored
  // on close. The shared useFocusTrap provides initial focus, Tab trapping,
  // Escape-to-close, and body scroll lock.
  const openDetail = useCallback((t: Table) => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setActionError(null);
    setShowReleaseConfirm(false);
    setShowDeleteConfirm(false);
    setSelected(t);
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setActionError(null);
    setShowReleaseConfirm(false);
    setShowDeleteConfirm(false);
    triggerRef.current?.focus();
  }, []);

  // Escape closes the panel, not the floor plan.
  //
  // It did NOT, until 2026-10-18: the key closed the panel AND the whole table view
  // behind it, losing the floor plan (measured 12 tiles -> 0). The cause was NOT this
  // trap — it was `PosScreen`'s Escape cascade running first and closing the sub-screen
  // the panel lives in. `PosScreen` now stands down when a modal is open
  // (`isAnyAriaModalOpen()`), which is the fix; pinned by
  // `e2e/restaurant-tables-toolbar.spec.ts` ('Escape closes the detail panel WITHOUT
  // taking the floor plan with it').
  //
  // Do NOT try to fix this from here by calling `stopPropagation()`: both listeners sit
  // on `document`, and propagation control does not reach a sibling listener on the SAME
  // node. That mistake was made and measured in round 189.
  useFocusTrap(detailRef, selected !== null, closeDetail);

  const openAddTableModal = useCallback(() => {
    setTableModal({
      name: '',
      capacity: 4,
      section: section || (sections[0] ?? 'Main'),
      shape: 'circle',
    });
    setTableModalError(null);
  }, [section, sections]);

  const openEditTableModal = useCallback((t: Table) => {
    setTableModal({
      id: t.id,
      name: t.name,
      capacity: t.capacity,
      section: t.section || 'Main',
      shape: t.shape || 'circle',
    });
    setTableModalError(null);
  }, []);

  // Re-entry guard that actually works. The handler below already carried
  // `if (tableModalSaving) return`, but `tableModalSaving` is React STATE: it holds the
  // value from the render that created this closure, so on the second dispatch of one
  // double tap it is still `false` and the guard passes. MEASURED in round 173 — the old
  // check let both submits through in a single act() batch.
  //
  // The cost is a real duplicate: `create_table` (kasirmu-core/src/db/tables.rs:130) is a
  // plain INSERT minting a fresh UUID, and `tables.name` carries no UNIQUE
  // (`20260813_init.sql:863`), so two tables with the same name both survive and both get
  // a floor-plan slot. The button being disabled does not cover it either: this handler is
  // the form's `onSubmit`, so Enter in the name field submits without consulting the button.
  const savePendingRef = useRef(false);

  const handleSaveTableModal = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (savePendingRef.current) return;
    if (!sessionToken) {
      // Reported, not dropped: the operator presses Save and nothing happens.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (!tableModal || !tableModal.name.trim()) return;
    // Taken AFTER the validation returns above, which never reach the `finally` that
    // clears it — the ordering trap recorded in docs/operations/agent-gates.md.
    savePendingRef.current = true;
    setTableModalSaving(true);
    setTableModalError(null);
    try {
      const trimmedName = tableModal.name.trim();
      const trimmedSection = tableModal.section.trim() || 'Main';
      const capacity = Number(tableModal.capacity) || 4;
      const shape = tableModal.shape || 'circle';

      if (tableModal.id) {
        const existing = tables.find((t) => t.id === tableModal.id);
        if (!existing) return;
        const width = (shape === 'rectangle' || shape === 'booth') && existing.shape !== 'rectangle' && existing.shape !== 'booth'
          ? Math.max(existing.width, 18)
          : existing.width;
        const height = shape === 'booth' && existing.shape !== 'booth' ? Math.max(existing.height, 14) : existing.height;
        const updated = await updateTableScoped(sessionToken, {
          ...existing,
          name: trimmedName,
          section: trimmedSection,
          capacity,
          shape,
          width,
          height,
        });
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelected((curr) => (curr && curr.id === updated.id ? updated : curr));
      } else {
        const count = tables.length;
        const pos_x = Math.min(80, 10 + (count % 4) * 22);
        const pos_y = Math.min(80, 10 + Math.floor(count / 4) * 20);
        const width = shape === 'rectangle' || shape === 'booth' ? 18 : 12;
        const height = shape === 'booth' ? 14 : 12;

        const created = await createTableScoped(sessionToken, {
          id: '',
          name: trimmedName,
          capacity,
          pos_x,
          pos_y,
          shape,
          width,
          height,
          status: 'available',
          active_sale_id: null,
          section: trimmedSection,
          active: true,
          sort_order: count + 1,
          created_at: '',
          updated_at: '',
        });
        setTables((prev) => [...prev, created]);
        setTablePool((prev) => [...prev, created]);
      }

      if (trimmedSection && !sections.includes(trimmedSection)) {
        setSections((prev) => [...prev, trimmedSection]);
      }
      setTableModal(null);
    } catch (err) {
      setTableModalError(l10nErrorMessage(err, l10n, 'tables-action-error'));
    } finally {
      savePendingRef.current = false;
      setTableModalSaving(false);
    }
  }, [tableModal, sessionToken, tables, sections, l10n, addToast]);

  const handleDeleteTable = useCallback(async (tableId: string) => {
    if (!sessionToken) {
      // Reported, not dropped. See handleSaveTableModal above.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (pendingRef.current) return;
    pendingRef.current = tableId;
    setPendingId(tableId);
    try {
      await deleteTableScoped(sessionToken, tableId);
      setTables((prev) => prev.filter((t) => t.id !== tableId));
      setTablePool((prev) => prev.filter((t) => t.id !== tableId));
      setSelected(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      setActionError(l10nErrorMessage(err, l10n, 'tables-action-error'));
    } finally {
      pendingRef.current = null;
      setPendingId(null);
    }
  }, [sessionToken, l10n, addToast]);

  // TBL-03: async, pending-guarded, error-aware status mutation. The affected
  // table is disabled while persisting; the panel stays open with a localized
  // error on failure instead of silently closing. TBL-01: `available` uses the
  // reservation hold model (occupancy requires an order assignment, which this
  // floor-plan view does not perform — a bare "occupy" is rejected server-side).
  const statusAction = useCallback(
    async (table: Table) => {
      if (pendingRef.current) return; // duplicate-click guard (ref, not state)
      pendingRef.current = table.id;
      setPendingId(table.id);
      setActionError(null);
      try {
        let updated: Table;
        if (table.status === 'available') {
          updated = await updateTableStatusScoped(sessionToken, table.id, 'reserved');
        } else if (table.status === 'occupied') {
          updated = await releaseTableScoped(sessionToken, table.id);
        } else {
          updated = await updateTableStatusScoped(sessionToken, table.id, 'available');
        }
        setSelected(updated);
        // Patch the floor plan in place so the new status shows immediately.
        // Deliberately NOT a full reload: a reload would close over this
        // render's `section`, so a section change that lands while the
        // mutation is in flight could be clobbered by the stale reload (the
        // exact TBL-02 stale-data class). Patching is also cheaper — the
        // mutation never changes `section`, so the table stays in the right
        // filtered list.
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch (err) {
        setActionError(l10nErrorMessage(err, l10n, 'app-error-generic'));
      } finally {
        pendingRef.current = null;
        setPendingId(null);
      }
    },
    [sessionToken, l10n],
  );

  // ⚠️ THE FLOOR PLAN HONOURS THE SECTION FILTER HERE, and until round 244 it did not.
  //
  // The chips computed their counts from `activeTableList`, while the grid rendered the
  // UNFILTERED `tables` (that render site has since moved; it was line 1045 when this fix
  // landed). Measured 2026-10-15: the seeded plan showed `Indoor 5/6` and the grid still
  // drew all 12 tiles.
  // ⚠️ The count/render pair is named here, not numbered: `activeTableList` for the chips,
  // `visibleTables` for the grid. Naming the two arrays states the invariant (they must
  // agree) in a form an insertion cannot break.
  // (The previous wording cited four line numbers; every one of them now points at
  // something else — the seated payload literal, a blank line, and two prose lines. They
  // are deliberately NOT reprinted here: a number written in this comment becomes a live
  // claim the moment it lands, which is the defect this paragraph replaces.)
  //
  // Two further consequences the raw list hid: `showEmpty` keyed on `tables.length`, so the
  // "no tables in this section" branch was unreachable while any table existed, and a section
  // whose every table was deleted would have shown the wrong empty message.
  const visibleTables =
    section === null ? tables : tables.filter((t) => (t.section || 'Main') === section);
  const showEmpty = !loading && !error && visibleTables.length === 0;
  const activeTableList = tablePool.length > 0 ? tablePool : tables;
  const allTotal = activeTableList.length;
  const allOccupied = activeTableList.filter((t) => t.status === 'occupied').length;

  const getSectionCounts = useCallback(
    (secName: string) => {
      const inSection = activeTableList.filter((t) => (t.section || 'Main') === secName);
      return {
        total: inSection.length,
        occupied: inSection.filter((t) => t.status === 'occupied').length,
      };
    },
    [activeTableList],
  );

  const handlePrintBillForTable = useCallback(async (t: Table) => {
    const activeBill = getTableBill(t.name);
    if (!activeBill || !sessionToken) return;
    setPrintingBill(true);
    try {
      const full = await getHeldCartScoped(sessionToken, activeBill.id);
      if (!full) throw new Error('Held cart not found');
      let parsed: { lines?: unknown[] } = {};
      try {
        parsed = JSON.parse(full.cart_data);
      } catch {
        parsed = {};
      }
      const cartLines = (Array.isArray(parsed.lines) ? parsed.lines : []) as CartLine[];
      const receipt = buildPreCheckoutBillReceipt({
        billNumber: `CHECK-${bareTableNumber(t.name) || t.name}-${Date.now().toString().slice(-4)}`,
        cartLines,
        cartCurrency: full.currency || storeCurrency,
        subtotal: { minor_units: full.total_minor, currency: full.currency || storeCurrency },
        total: { minor_units: full.total_minor, currency: full.currency || storeCurrency },
        tableNumber: t.name,
        customerName: full.customer_name ?? undefined,
      });
      await printSalesReceipt(sessionToken, receipt);
      addToast({
        message: l10n.getString('tables-toast-bill-printed', { table: t.name }),
        type: 'success',
      });
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'tables-toast-bill-print-failed'),
        type: 'error',
      });
    } finally {
      setPrintingBill(false);
    }
  }, [getTableBill, sessionToken, addToast, l10n, storeCurrency]);

  const handleOpenMoveTable = useCallback((t: Table) => {
    const available = activeTableList.filter(
      (tbl) => tbl.id !== t.id && tbl.status === 'available',
    );
    setSelectedDestTableId(available[0]?.id ?? '');
    setMoveTableModal(t);
  }, [activeTableList]);

  const handleConfirmMoveTable = useCallback(async () => {
    if (!sessionToken) {
      // Reported, not dropped: the Move dialog would otherwise sit there mute.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (!moveTableModal || !selectedDestTableId) return;
    const destTable = activeTableList.find((t) => t.id === selectedDestTableId);
    if (!destTable) return;
    const activeBill = getTableBill(moveTableModal.name);
    if (!activeBill) return;

    setMovingTable(true);
    try {
      const full = await getHeldCartScoped(sessionToken, activeBill.id);
      if (!full) throw new Error('Held cart not found');
      let parsed: { lines?: unknown[]; customerName?: string; tableNumber?: string } = {};
      try {
        parsed = JSON.parse(full.cart_data);
      } catch {
        parsed = {};
      }
      parsed.tableNumber = destTable.name;
      const newLabel = heldCartLabel(destTable.name, parsed.customerName) ?? `Table ${destTable.name}`;

      // CREATE FIRST, DELETE SECOND — the order is the whole fix.
      //
      // This read DELETE-then-HOLD, and the delete is what loses the bill: if the
      // hold then rejected (locked DB, dropped connection, lapsed session), the catch
      // below toasted "move failed" while the merchant's only copy of that open bill
      // was already gone. There is no undo for a held cart, so this is unrecoverable.
      //
      // `usePosHeldCarts` already resolved the same two-write problem in the safe
      // direction for the same data (see its "does NOT report a tab as updated when
      // deleting the previous record FAILS" case), so this matches the established
      // shape rather than inventing one. A duplicate open bill on a failed move is a
      // recoverable mess the operator can resolve by hand; a deleted one is not.
      await holdCartScoped(sessionToken, {
        label: newLabel,
        cart_data: JSON.stringify(parsed),
        item_count: full.item_count,
        total_minor: full.total_minor,
        currency: full.currency || storeCurrency,
        bill_type: 'open_bill',
        customer_name: parsed.customerName || (destTable.name ? `Table ${bareTableNumber(destTable.name)}` : ''),
        ...(full.deduction_location_id ? { deduction_location_id: full.deduction_location_id } : {}),
      });

      // Only now is it safe to remove the old record: the bill exists under the new
      // table, so a failure here leaves two rows rather than none.
      await deleteHeldCartScoped(sessionToken, activeBill.id);

      await releaseTableScoped(sessionToken, moveTableModal.id);
      try {
        await updateTableStatusScoped(sessionToken, destTable.id, 'occupied');
      } catch {
        // TBL-01 fallback: backend rejects 'occupied' without an active sale
        await updateTableStatusScoped(sessionToken, destTable.id, 'available');
      }
      await loadTables();

      addToast({
        message: l10n.getString('tables-toast-moved', { from: moveTableModal.name, to: destTable.name }),
        type: 'success',
      });
      setMoveTableModal(null);
      closeDetail();
    } catch (err) {
      // A partial failure is the WORST state to leave the dialog open in.
      //
      // The writes are sequential (hold → delete → release → status), so this catch
      // can fire AFTER the destination bill already exists: the hold succeeded and
      // only the delete/release/status step failed. `loadTables()` sat on the success
      // path only, so the floor plan kept rendering the PRE-move state — the
      // operator was told "move failed" while looking at a plan that no longer
      // described the data, with the dialog still open over it. Retrying against that
      // stale plan is what turns one duplicate bill into two.
      //
      // Refreshing makes the plan tell the truth even here, and closing the dialog
      // stops a second attempt being issued from a view the backend has moved on from.
      // The duplicate itself is the documented, hand-resolvable trade of the
      // create-first order — this is about not hiding it.
      try {
        await loadTables();
      } catch {
        // The refresh is best-effort; the toast below already reports the failure.
      }
      setMoveTableModal(null);
      closeDetail();
      addToast({
        message: l10nErrorMessage(err, l10n, 'tables-toast-move-failed'),
        type: 'error',
      });
    } finally {
      setMovingTable(false);
    }
  }, [moveTableModal, selectedDestTableId, sessionToken, activeTableList, getTableBill, loadTables, addToast, l10n, closeDetail, storeCurrency]);

  const handleOpenMergeTable = useCallback((t: Table) => {
    const candidates = activeTableList.filter(
      (tbl) => tbl.id !== t.id && Boolean(getTableBill(tbl.name)),
    );
    setSelectedMergeDestTableId(candidates[0]?.id ?? '');
    setMergeTableModal(t);
  }, [activeTableList, getTableBill]);

  const handleConfirmMergeTable = useCallback(async () => {
    if (!sessionToken) {
      // Reported, not dropped. See handleConfirmMoveTable above.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (!mergeTableModal || !selectedMergeDestTableId) return;
    const destTable = activeTableList.find((t) => t.id === selectedMergeDestTableId);
    if (!destTable) return;
    const srcBill = getTableBill(mergeTableModal.name);
    const destBill = getTableBill(destTable.name);
    if (!srcBill || !destBill) return;

    setMergingTable(true);
    try {
      const [srcFull, destFull] = await Promise.all([
        getHeldCartScoped(sessionToken, srcBill.id),
        getHeldCartScoped(sessionToken, destBill.id),
      ]);
      if (!srcFull || !destFull) throw new Error('Held carts not found');

      let srcParsed: { lines?: unknown[]; customerName?: string; tableNumber?: string; guestCount?: string } = {};
      let destParsed: { lines?: unknown[]; customerName?: string; tableNumber?: string; guestCount?: string } = {};
      try { srcParsed = JSON.parse(srcFull.cart_data); } catch { srcParsed = {}; }
      try { destParsed = JSON.parse(destFull.cart_data); } catch { destParsed = {}; }

      const srcLines = Array.isArray(srcParsed.lines) ? srcParsed.lines : [];
      const destLines = Array.isArray(destParsed.lines) ? destParsed.lines : [];
      const combinedLines = [...destLines, ...srcLines];

      const combinedTotalMinor = destFull.total_minor + srcFull.total_minor;
      const combinedItemCount = combinedLines.length;

      destParsed.tableNumber = destTable.name;
      destParsed.lines = combinedLines;

      const srcPax = parseInt(srcParsed.guestCount || '', 10);
      const destPax = parseInt(destParsed.guestCount || '', 10);
      if (!isNaN(srcPax) && srcPax > 0) {
        const combinedPax = (isNaN(destPax) || destPax <= 0 ? 0 : destPax) + srcPax;
        destParsed.guestCount = String(combinedPax);
      }

      const originalCustomer = destParsed.customerName;
      const joinedTag = `[+T${bareTableNumber(mergeTableModal.name)}]`;
      const baseCustomer = originalCustomer || (destTable.name ? `Table ${bareTableNumber(destTable.name)}` : '');
      const mergedCustomer = baseCustomer.includes(joinedTag) ? baseCustomer : `${baseCustomer} ${joinedTag}`.trim();
      destParsed.customerName = mergedCustomer;

      const newLabel = heldCartLabel(destTable.name, originalCustomer) ?? `Table ${destTable.name}`;
      const deductionLocationId = destFull.deduction_location_id || srcFull.deduction_location_id;
      const combinedCurrency = destFull.currency || srcFull.currency || storeCurrency;

      // CREATE FIRST, DELETE SECOND — same fix as handleMoveTable above.
      //
      // Here it mattered MORE: the old order deleted BOTH bills before creating the
      // combined one, so a rejected hold lost two tables' open bills at once instead of
      // one. The combined cart has to exist before either source is removed.
      await holdCartScoped(sessionToken, {
        label: newLabel,
        cart_data: JSON.stringify(destParsed),
        item_count: combinedItemCount,
        total_minor: combinedTotalMinor,
        currency: combinedCurrency,
        bill_type: 'open_bill',
        customer_name: mergedCustomer,
        ...(deductionLocationId ? { deduction_location_id: deductionLocationId } : {}),
      });

      // The combined bill now exists, so removing the two sources is safe: a failure
      // here leaves duplicate rows an operator can resolve, not lost data.
      await Promise.all([
        deleteHeldCartScoped(sessionToken, srcBill.id),
        deleteHeldCartScoped(sessionToken, destBill.id),
      ]);

      await releaseTableScoped(sessionToken, mergeTableModal.id);
      await loadTables();

      addToast({
        message: l10n.getString('tables-toast-merged', { from: mergeTableModal.name, to: destTable.name }),
        type: 'success',
      });
      setMergeTableModal(null);
      closeDetail();
    } catch (err) {
      // Same partial-failure reasoning as handleConfirmMoveTable above: the combined
      // bill can already exist when this fires, so the plan must be re-read and the
      // dialog closed rather than left showing the pre-merge floor over changed data.
      try {
        await loadTables();
      } catch {
        // Best-effort; the toast below already reports the failure.
      }
      setMergeTableModal(null);
      closeDetail();
      addToast({
        message: l10nErrorMessage(err, l10n, 'tables-toast-merge-failed'),
        type: 'error',
      });
    } finally {
      setMergingTable(false);
    }
  }, [mergeTableModal, selectedMergeDestTableId, sessionToken, activeTableList, getTableBill, loadTables, addToast, l10n, closeDetail, storeCurrency]);

  const handleConfirmReservation = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      // RE-ENTRY GUARD. The Reserving button is `disabled` while `reservingTable`, but this
      // handler is also the reserve form's `onSubmit` — pressing Enter in the guest-name
      // field submits it directly and never consults the button. Without this, a double
      // submit ran `holdCartScoped` TWICE, leaving two open bills against one table.
      // (All three numbers this note carried had drifted onto unrelated statements:
      // a closing `</div>`, the modal backdrop, and a `parseInt` in another handler.)
      // Same shape and same reason as `handleSaveTableModal` above.
      if (reservingTable) return;
      if (!sessionToken) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
        return;
      }
      if (!reserveModal || !reserveModal.guestName.trim()) return;
      setReservingTable(true);
      try {
        const table = reserveModal.table;
        const guestName = reserveModal.guestName.trim();
        const phone = reserveModal.phone.trim();
        const partySize = reserveModal.partySize || table.capacity;
        const time = reserveModal.time.trim();
        const notes = reserveModal.notes.trim();

        const reservationPayload = {
          lines: [],
          customerName: guestName,
          phone,
          partySize,
          reservationTime: time,
          notes,
          isReservation: true,
          tableNumber: table.name,
        };

        const label = `${table.name} · Res: ${guestName}${time ? ` (${time})` : ''}${partySize ? ` [${partySize}p]` : ''}`;

        await holdCartScoped(sessionToken, {
          label,
          cart_data: JSON.stringify(reservationPayload),
          item_count: 0,
          total_minor: 0,
          currency: storeCurrency,
          bill_type: 'open_bill',
          customer_name: guestName,
        });

        const updated = await updateTableStatusScoped(sessionToken, table.id, 'reserved');
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelected((curr) => (curr && curr.id === updated.id ? updated : curr));

        addToast({
          message: l10n.getString('tables-toast-reserved', { table: table.name, guest: guestName }),
          type: 'success',
        });
        setReserveModal(null);
        await loadTables();
      } catch (err) {
        // PARTIAL FAILURE — the reservation bill may already exist.
        //
        // `holdCartScoped` runs before `updateTableStatusScoped`, so this catch can fire
        // with the bill written and only the STATUS write failed. Everything that makes
        // the success visible sits below it: the table never enters the pool, the plan is
        // never re-read, and `setReserveModal(null)` never runs — so the form stays open
        // with the guest's name still in it. The operator reads that as "it did not save"
        // and presses Reserve again, and THAT is how the duplicate reservation bill the
        // re-entry guard above exists to prevent actually happens — through the failure
        // branch rather than a double submit.
        //
        // Re-reading and closing makes the screen describe what the backend holds, so a
        // retry is a deliberate act against a truthful plan rather than a blind repeat.
        try {
          await loadTables();
        } catch {
          // Best-effort; the toast below already reports the failure.
        }
        setReserveModal(null);
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      } finally {
        setReservingTable(false);
      }
    },
    [reserveModal, reservingTable, sessionToken, l10n, addToast, loadTables, storeCurrency],
  );

  const handleSeatReservedGuests = useCallback(
    async (table: Table) => {
      if (!sessionToken) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
        return;
      }
      const reservationBill = openBills.find((b) => matchesTableBill(b, table.name));
      try {
        if (reservationBill) {
          const resPromise = getHeldCartScoped(sessionToken, reservationBill.id);
          const resFull = resPromise && typeof resPromise.then === 'function' ? await resPromise.catch(() => null) : null;
          let resLines: unknown[] = [];
          let resPartySize: number | undefined;
          let resGuestCount: string | undefined;
          let resNotes: string | undefined;
          let resPhone: string | undefined;
          if (resFull?.cart_data) {
            try {
              const data = JSON.parse(resFull.cart_data);
              if (Array.isArray(data.lines)) resLines = data.lines;
              if (typeof data.partySize === 'number') resPartySize = data.partySize;
              if (typeof data.guestCount === 'string') resGuestCount = data.guestCount;
              else if (resPartySize) resGuestCount = String(resPartySize);
              if (typeof data.notes === 'string') resNotes = data.notes;
              if (typeof data.phone === 'string') resPhone = data.phone;
            } catch {
              // fallback
            }
          }
          const customerName = reservationBill.customer_name || '';
          const seatedPayload = {
            lines: resLines,
            customerName,
            tableNumber: table.name,
            orderType: 'dine_in',
            ...(resGuestCount ? { guestCount: resGuestCount } : {}),
            ...(resPartySize ? { partySize: resPartySize } : {}),
            ...(resNotes ? { notes: resNotes } : {}),
            ...(resPhone ? { phone: resPhone } : {}),
          };
          // CREATE FIRST, DELETE SECOND — the same fix as handleConfirmMoveTable and
          // handleConfirmMergeTable above, on the third handler in this file that
          // replaces a held cart.
          //
          // This ran DELETE first, so a rejected hold destroyed the reservation with
          // nothing to recreate it while the catch toasted only "seat failed" — the
          // party ends up neither booked nor seated, and the operator has no signal.
          // Round 292 fixed the other two handlers and left this one; it was found by
          // reading every held-cart write in the file rather than trusting that list.
          await holdCartScoped(sessionToken, {
            label: heldCartLabel(table.name, customerName) ?? `Table ${table.name}`,
            cart_data: JSON.stringify(seatedPayload),
            item_count: resFull?.item_count ?? resLines.length,
            total_minor: resFull?.total_minor ?? 0,
            currency: resFull?.currency || storeCurrency,
            bill_type: 'open_bill',
            customer_name: customerName,
            ...(resFull?.deduction_location_id ? { deduction_location_id: resFull.deduction_location_id } : {}),
          });
          // The seated bill exists now, so removing the reservation cannot lose data.
          await deleteHeldCartScoped(sessionToken, reservationBill.id);
        }

        let updated: Table = table;
        try {
          updated = await updateTableStatusScoped(sessionToken, table.id, 'occupied');
        } catch {
          // TBL-01 fallback: backend rejects 'occupied' without an active sale (seating
          // creates an open bill / held cart, not a completed sale).
          // Set status to 'available' with the open bill attached.
          updated = await updateTableStatusScoped(sessionToken, table.id, 'available');
        }
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelected(null);

        addToast({
          message: l10n.getString('tables-toast-guests-seated', { table: table.name }),
          type: 'success',
        });

        if (onSelectTable) {
          onSelectTable(table.name);
        }
        await loadTables();
      } catch (err) {
        // PARTIAL FAILURE — see handleConfirmReservation above for the full reasoning.
        // Here the stakes are the same and the window is wider: the hold and the DELETE
        // of the reservation both precede `updateTableStatusScoped`, so this catch can fire
        // with the reservation already gone and the seated bill in its place while the
        // table still reads `reserved` on an unrefreshed plan. The party is then neither
        // booked nor visibly seated, and the operator has no way to see which.
        try {
          await loadTables();
        } catch {
          // Best-effort; the toast below already reports the failure.
        }
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    },
    [sessionToken, openBills, onSelectTable, l10n, addToast, loadTables, storeCurrency],
  );

  const handlePointerDownTable = useCallback((e: React.PointerEvent<HTMLButtonElement>, t: Table) => {
    if (!arrangeMode) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setArrangeSelectedTableId(t.id);
    setDraggingTableId(t.id);
    dragOriginPos.current = { pos_x: t.pos_x, pos_y: t.pos_y };
    dragStartPos.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      tableX: t.pos_x,
      tableY: t.pos_y,
    };
  }, [arrangeMode]);

  const handlePointerMoveTable = useCallback((e: React.PointerEvent<HTMLButtonElement>, t: Table) => {
    if (!arrangeMode || draggingTableId !== t.id || !dragStartPos.current || !floorplanRef.current) return;
    e.preventDefault();
    const rect = floorplanRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const deltaXPercent = ((e.clientX - dragStartPos.current.pointerX) / rect.width) * 100;
    const deltaYPercent = ((e.clientY - dragStartPos.current.pointerY) / rect.height) * 100;

    const rawX = dragStartPos.current.tableX + deltaXPercent;
    const rawY = dragStartPos.current.tableY + deltaYPercent;

    const w = Math.max(t.width, 2);
    const h = Math.max(t.height, 2);

    const snappedX = Math.max(0, Math.min(100 - w, Math.round(rawX / 5) * 5));
    const snappedY = Math.max(0, Math.min(100 - h, Math.round(rawY / 5) * 5));

    setTables((prev) =>
      prev.map((item) => (item.id === t.id ? { ...item, pos_x: snappedX, pos_y: snappedY } : item)),
    );
    setTablePool((prev) =>
      prev.map((item) => (item.id === t.id ? { ...item, pos_x: snappedX, pos_y: snappedY } : item)),
    );
  }, [arrangeMode, draggingTableId]);

  const handlePointerUpTable = useCallback(async (e: React.PointerEvent<HTMLButtonElement>, t: Table) => {
    if (!arrangeMode || draggingTableId !== t.id) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setDraggingTableId(null);
    dragStartPos.current = null;

    const currentTable = tablesRef.current.find((item) => item.id === t.id);
    if (currentTable && sessionToken) {
      try {
        await updateTableScoped(sessionToken, currentTable);
      } catch (err) {
        // PUT THE TABLE BACK. The move was written optimistically on every pointermove
        // (`handlePointerMoveTable`) and only persisted here, so a refused write left the
        // table VISUALLY at the dropped position with the server holding the old one —
        // and `tablesRef` still carrying the refused coordinates, so a retry re-sent the payload
        // that was just rejected. Restoring both lists and the ref makes the floor plan
        // describe reality again and makes a retry send the ORIGINAL position.
        const origin = dragOriginPos.current;
        if (origin) {
          const restored: Table = { ...currentTable, pos_x: origin.pos_x, pos_y: origin.pos_y };
          setTables((prev) => prev.map((item) => (item.id === restored.id ? restored : item)));
          setTablePool((prev) => prev.map((item) => (item.id === restored.id ? restored : item)));
          tablesRef.current = tablesRef.current.map((item) =>
            item.id === restored.id ? restored : item,
          );
        }
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    }
    dragOriginPos.current = null;
  }, [arrangeMode, draggingTableId, sessionToken, addToast, l10n]);

  const handlePointerDownResize = useCallback((e: React.PointerEvent, t: Table) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setResizingTableId(t.id);
    resizeOriginDim.current = { width: t.width, height: t.height };
    resizeStartPos.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startW: t.width,
      startH: t.height,
    };
  }, []);

  const handlePointerMoveResize = useCallback((e: React.PointerEvent, t: Table) => {
    if (resizingTableId !== t.id || !resizeStartPos.current || !floorplanRef.current) return;
    e.preventDefault();
    const rect = floorplanRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const deltaXPercent = ((e.clientX - resizeStartPos.current.pointerX) / rect.width) * 100;
    const deltaYPercent = ((e.clientY - resizeStartPos.current.pointerY) / rect.height) * 100;

    let newW = Math.max(6, Math.min(40, Math.round((resizeStartPos.current.startW + deltaXPercent) / 2) * 2));
    let newH = Math.max(6, Math.min(40, Math.round((resizeStartPos.current.startH + deltaYPercent) / 2) * 2));

    if (t.shape === 'circle' || t.shape === 'square') {
      const maxDim = Math.max(newW, newH);
      newW = maxDim;
      newH = maxDim;
    }

    setTables((prev) =>
      prev.map((item) => (item.id === t.id ? { ...item, width: newW, height: newH } : item)),
    );
    setTablePool((prev) =>
      prev.map((item) => (item.id === t.id ? { ...item, width: newW, height: newH } : item)),
    );
  }, [resizingTableId]);

  const handlePointerUpResize = useCallback(async (e: React.PointerEvent, t: Table) => {
    if (resizingTableId !== t.id) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setResizingTableId(null);
    resizeStartPos.current = null;

    const currentTable = tablesRef.current.find((item) => item.id === t.id);
    if (currentTable && sessionToken) {
      try {
        await updateTableScoped(sessionToken, currentTable);
      } catch (err) {
        const origin = resizeOriginDim.current;
        if (origin) {
          const restored = { ...currentTable, width: origin.width, height: origin.height };
          setTables((prev) => prev.map((item) => (item.id === restored.id ? restored : item)));
          setTablePool((prev) => prev.map((item) => (item.id === restored.id ? restored : item)));
        }
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    }
    resizeOriginDim.current = null;
  }, [resizingTableId, sessionToken, addToast, l10n]);

  const handleUpdateArrangeShape = useCallback(async (newShape: string) => {
    if (!sessionToken || !arrangeSelectedTableId) return;
    const currentTable = tablesRef.current.find((item) => item.id === arrangeSelectedTableId);
    if (!currentTable) return;
    let w = currentTable.width;
    let h = currentTable.height;
    if (newShape === 'rectangle') {
      w = Math.max(16, w);
      h = Math.min(12, h);
    } else if (newShape === 'booth') {
      w = Math.max(18, w);
      h = Math.max(14, h);
    } else if (newShape === 'circle' || newShape === 'square') {
      const size = Math.max(10, Math.min(18, Math.round((w + h) / 2)));
      w = size;
      h = size;
    }
    const updated: Table = { ...currentTable, shape: newShape, width: w, height: h };
    setTables((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setTablePool((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    try {
      await updateTableScoped(sessionToken, updated);
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'tables-action-error'), type: 'error' });
    }
  }, [sessionToken, arrangeSelectedTableId, addToast, l10n]);

  const handleAdjustArrangeSize = useCallback(async (deltaW: number, deltaH: number) => {
    if (!sessionToken || !arrangeSelectedTableId) return;
    const currentTable = tablesRef.current.find((item) => item.id === arrangeSelectedTableId);
    if (!currentTable) return;
    let newW = Math.max(6, Math.min(40, currentTable.width + deltaW));
    let newH = Math.max(6, Math.min(40, currentTable.height + deltaH));
    if (currentTable.shape === 'circle' || currentTable.shape === 'square') {
      const s = Math.max(6, Math.min(40, currentTable.width + (deltaW !== 0 ? deltaW : deltaH)));
      newW = s;
      newH = s;
    }
    const updated: Table = { ...currentTable, width: newW, height: newH };
    setTables((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setTablePool((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    try {
      await updateTableScoped(sessionToken, updated);
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'tables-action-error'), type: 'error' });
    }
  }, [sessionToken, arrangeSelectedTableId, addToast, l10n]);

  const handleQuickMarkCleaned = useCallback(
    async (table: Table) => {
      if (!sessionToken) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
        return;
      }
      try {
        const updated = await updateTableStatusScoped(sessionToken, table.id, 'available');
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelected(null);
        addToast({
          message: l10n.getString('tables-toast-cleaned', { table: table.name }),
          type: 'success',
        });
        await loadTables();
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    },
    [sessionToken, addToast, l10n, loadTables],
  );

  const handleQuickSeatWalkin = useCallback(
    async (table: Table, partySize: number) => {
      if (!sessionToken) {
        addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
        return;
      }
      try {
        const customerName = `Walk-in [${partySize}p]`;
        await holdCartScoped(sessionToken, {
          label: heldCartLabel(table.name, customerName) ?? `Table ${table.name}`,
          cart_data: JSON.stringify({ lines: [], customerName, tableNumber: table.name, partySize }),
          item_count: 0,
          total_minor: 0,
          currency: storeCurrency,
          bill_type: 'open_bill',
          customer_name: customerName,
        });

        let updated: Table = table;
        try {
          updated = await updateTableStatusScoped(sessionToken, table.id, 'occupied');
        } catch {
          // TBL-01 fallback: table remains 'available' with the open bill attached
          updated = table;
        }
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setTablePool((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelected(null);

        addToast({
          message: l10n.getString('tables-toast-guests-seated', { table: table.name }),
          type: 'success',
        });

        if (onSelectTable) {
          onSelectTable(table.name);
        }
        await loadTables();
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    },
    [sessionToken, addToast, l10n, onSelectTable, loadTables, storeCurrency],
  );

  const handleAddSection = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = newSectionInput.trim();
      if (!trimmed || !sessionToken) return;
      if (sections.includes(trimmed)) {
        setSection(trimmed);
        setNewSectionInput('');
        return;
      }
      const updated = Array.from(new Set([...sections, trimmed]));
      setSections(updated);
      try {
        await setSettingScoped(sessionToken, 'restaurant.table_sections', JSON.stringify(updated));
        addToast({
          message: l10n.getString('tables-toast-section-added', { section: trimmed }),
          type: 'success',
        });
        setSection(trimmed);
        setNewSectionInput('');
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    },
    [newSectionInput, sessionToken, sections, addToast, l10n],
  );

  const handleRenameSection = useCallback(
    async (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName || !sessionToken) {
        setEditingSectionName(null);
        return;
      }
      try {
        const tablesInSection = tables.filter((t) => (t.section || 'Main') === oldName);
        if (tablesInSection.length > 0) {
          await Promise.all(
            tablesInSection.map((t) =>
              updateTableScoped(sessionToken, { ...t, section: trimmed }),
            ),
          );
        }
        // ⚠️ RESOLVED INSIDE THE UPDATER, not from the render closure. The awaits
        // above (`updateTableScoped` per table) keep the screen live, and
        // `handleAddSection` can run inside that window — a separate control on
        // the same modal that nothing disables while a rename is in flight. `sections`
        // is the closure captured BEFORE those awaits, and `setSections(updated)`
        // REPLACES the array, so a section added during the rename was absent from it
        // and was DROPPED with no message. MEASURED: add 'Teras' mid-rename, release,
        // and 'Teras' is gone.
        //
        // Same shape as the round-201 `handleSendToKitchen` defect that
        // scripts/check-state-closure-after-await.py exists to flag, and this line is
        // one of the two it reports.
        //
        // The setting write still needs the resulting array, so it is carried out
        // through `sectionsResultRef`, which the updater fills on the same pass. The
        // updater stays PURE; the ref only moves the value out for the awaited write.
        //
        // A local `let updated` is NOT safe here even though it reads as if it were:
        // `setSections` runs the updater eagerly ONLY when the fiber has no pending
        // lanes, and `JSON.stringify(updated)` on the next line is evaluated
        // regardless. If React defers the updater to the render phase, the local is
        // still `[]` and the write persists an EMPTY ARRAY, wiping every section --
        // strictly worse than the defect above. A ref is assigned only by the updater
        // that actually ran, so the payload is the array that was stored.
        //
        // MEASURED: jsdom under `act()` flushes eagerly, so BOTH forms persist the same value
        // there -- the kill-test that kept only the functional updater and restored the
        // local `let` still passed. The ref is therefore a defence against the deferred
        // case that the test suite cannot reproduce, not a behaviour it proves; say so
        // rather than implying the test covers it.
        // CLEAR BEFORE, never reuse. The ref is assigned only by the updater that
        // actually ran, so a DEFERRED updater leaves the PREVIOUS call's array in place —
        // and `?? []` does not catch that, because a stale array is not null. Without the
        // reset, a deferred rename persists the earlier rename's list and a deferred
        // delete persists whatever the last rename wrote.
        sectionsResultRef.current = null;
        setSections((prev) => {
          const next = prev.map((s) => (s === oldName ? trimmed : s));
          sectionsResultRef.current = next;
          return next;
        });
        const updated = sectionsResultRef.current ?? [];
        await setSettingScoped(sessionToken, 'restaurant.table_sections', JSON.stringify(updated));
        if (section === oldName) setSection(trimmed);
        setEditingSectionName(null);
        await loadTables();
        addToast({
          message: l10n.getString('tables-toast-section-renamed', { section: trimmed }),
          type: 'success',
        });
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    },
    // `sections` is deliberately ABSENT: both handlers now read the live array
    // through the updater, never the render closure, so depending on it would only
    // re-create the callbacks (and re-arm the very staleness this guards against).
    [sessionToken, tables, section, loadTables, addToast, l10n],
  );

  // CONSENT IS THE DESIGNED DIALOG, NOT AN OS ONE.
  //
  // This used to be `window.confirm()`, which the native-dialog guard flags for the
  // reason it states: an OS modal is off-design, unlocalized by the app's own bundles,
  // and BLOCKS the event loop. On a tablet mid-service that last property is the
  // operational one -- the whole till freezes behind the dialog.
  //
  // Split into a request and the work: `handleDeleteSection` records WHAT to delete and
  // opens the dialog; `confirmDeleteSection` runs the same body it always did once the
  // operator agrees. The work is unchanged, including the ref-carried result and the
  // state-closure reasoning it documents -- only the way consent is asked has moved.
  const [pendingSectionDelete, setPendingSectionDelete] = useState<string | null>(null);
  const [deletingSection, setDeletingSection] = useState(false);

  const confirmDeleteSection = useCallback(
    async (secName: string) => {
      if (!sessionToken || secName === 'Main') return;
      const tablesInSection = tables.filter((t) => (t.section || 'Main') === secName);
      if (tablesInSection.length > 0) {
        try {
          await Promise.all(
            tablesInSection.map((t) =>
              updateTableScoped(sessionToken, { ...t, section: 'Main' }),
            ),
          );
        } catch (err) {
          addToast({
            message: l10nErrorMessage(err, l10n, 'tables-action-error'),
            type: 'error',
          });
          return;
        }
      }
      // ⚠️ RESOLVED INSIDE THE UPDATER — same defect and same reason as
      // `handleRenameSection` above. The `updateTableScoped` awaits in that rename
      // leave the screen interactive, so a section added during them was
      // dropped by this replacement. `check-state-closure-after-await.py` reports this
      // line as its second candidate. Carried out through the same ref for the same
      // reason: see the local-`let` hazard noted in handleRenameSection.
      sectionsResultRef.current = null;
      setSections((prev) => {
        const next = prev.filter((s) => s !== secName);
        sectionsResultRef.current = next;
        return next;
      });
      const updated = sectionsResultRef.current ?? [];
      try {
        await setSettingScoped(sessionToken, 'restaurant.table_sections', JSON.stringify(updated));
        if (section === secName) setSection(null);
        await loadTables();
        addToast({
          message: l10n.getString('tables-toast-section-deleted', { section: secName }),
          type: 'success',
        });
      } catch (err) {
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    },
    // `sections` is deliberately ABSENT: both handlers now read the live array
    // through the updater, never the render closure, so depending on it would only
    // re-create the callbacks (and re-arm the very staleness this guards against).
    [sessionToken, tables, section, loadTables, addToast, l10n],
  );

  // The REQUEST half. It asks; it does not delete. Kept as its own callback so every
  // existing caller (`onClick={() => void handleDeleteSection(name)}` at the section
  // chips) keeps working unchanged while the consent step is inserted ahead of the work.
  const handleDeleteSection = useCallback((secName: string) => {
    if (secName === 'Main') return;
    setPendingSectionDelete(secName);
  }, []);

  const [showLegend, setShowLegend] = useState(false);

  return (
    <div className="tables" role="region" aria-label={l10n.getString('tables-management-label')}>
      <div className="tables-header">
        <div className="tables-header-lead">
          {onBack && (
            <button
              type="button"
              className="tables-back-btn"
              onClick={onBack}
              aria-label={l10n.getString('back') || 'Back'}
              data-testid="tables-back-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          <h1 className="tables-title"><Localized id="tables-title">Table Management</Localized></h1>
        </div>
        <div className="tables-header-actions">
          <Button
            variant="ghost"
            size="sm"
            className={`tables-legend-toggle ${showLegend ? 'active' : ''}`}
            data-testid="tables-legend-toggle-btn"
            onClick={() => setShowLegend((v) => !v)}
          >
            <span>Legend</span>
          </Button>
          <Button
            variant={arrangeMode ? 'primary' : 'ghost'}
            size="sm"
            className={`tables-arrange-toggle ${arrangeMode ? 'active' : ''}`}
            data-testid="tables-arrange-mode-btn"
            onClick={() => setArrangeMode((v) => !v)}
          >
            <Localized id={arrangeMode ? 'tables-done-arranging' : 'tables-arrange-mode'}>
              <span>{arrangeMode ? 'Done Arranging' : 'Arrange Tables'}</span>
            </Localized>
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-testid="tables-add-table-btn"
            onClick={openAddTableModal}
          >
            <Localized id="tables-add-table">
              <span>+ Add Table</span>
            </Localized>
          </Button>
        </div>
      </div>
      <div className="tables-sections">
        <Button
          variant="ghost"
          size="sm"
          className={`tables-section-btn ${section === null ? 'active' : ''}`}
          onClick={() => setSection(null)}
        >
          <span className="tables-section-label">
            <Localized id="tables-all">All</Localized>
          </span>
          {allTotal > 0 && (
            <span
              className={`tables-section-badge${allOccupied > 0 ? ' tables-section-badge--occupied' : ''}`}
              data-testid="tables-section-badge-all"
            >
              {allOccupied > 0 ? `${allOccupied}/${allTotal}` : allTotal}
            </span>
          )}
        </Button>
        {sections.map((s) => {
          const counts = getSectionCounts(s);
          return (
            <Button
              variant="ghost"
              size="sm"
              key={s}
              className={`tables-section-btn ${section === s ? 'active' : ''}`}
              onClick={() => setSection(s)}
            >
              <span className="tables-section-label">{s}</span>
              {counts.total > 0 && (
                <span
                  className={`tables-section-badge${counts.occupied > 0 ? ' tables-section-badge--occupied' : ''}`}
                  data-testid={`tables-section-badge-${s}`}
                >
                  {counts.occupied > 0 ? `${counts.occupied}/${counts.total}` : counts.total}
                </span>
              )}
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="tables-manage-sections-btn"
          data-testid="tables-manage-sections-btn"
          onClick={() => setShowManageSections(true)}
          title={l10n.getString('tables-manage-sections')}
        >
          <span>⚙️ <Localized id="tables-manage-sections"><span>Manage Sections</span></Localized></span>
        </Button>
      </div>

      {showLegend && (
        <div className="tables-legend" aria-hidden="true" data-testid="tables-legend-bar">
          <div className="tables-legend-item">
            <span className="tables-legend-dot tables-legend-dot--available" />
            <span className="tables-legend-text">{statusLabel('available')}</span>
          </div>
          <div className="tables-legend-item">
            <span className="tables-legend-dot tables-legend-dot--occupied" />
            <span className="tables-legend-text">{statusLabel('occupied')}</span>
          </div>
          <div className="tables-legend-item">
            <span className="tables-legend-dot tables-legend-dot--has-bill" />
            <span className="tables-legend-text"><Localized id="tables-active-tab-short">Open Tab</Localized></span>
          </div>
          <div className="tables-legend-item">
            <span className="tables-legend-dot tables-legend-dot--reserved" />
            <span className="tables-legend-text">{statusLabel('reserved')}</span>
          </div>
          <div className="tables-legend-item">
            <span className="tables-legend-dot tables-legend-dot--cleaning" />
            <span className="tables-legend-text">{statusLabel('cleaning')}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="tables-error" role="alert">
          <span className="tables-error-text">
            <Localized id="tables-load-error">Could not load the floor plan.</Localized>
            {error && <span className="tables-error-detail">{error}</span>}
          </span>
          <Button variant="primary" size="sm" onClick={retry}>
            <Localized id="retry">Retry</Localized>
          </Button>
        </div>
      )}

      {/* A bills-only failure: the floor plan loaded, so this must NOT claim the
          plan failed — but it must stop the empty tab list from reading as
          "every table is free". Non-blocking: the cashier can still see the
          plan while choosing to retry. */}
      {billsUnknown && !error && (
        <div className="tables-error" role="alert">
          <span className="tables-error-text">
            <Localized id="tables-bills-unknown">
              Could not check which tables have an open tab.
            </Localized>
          </span>
          <Button variant="primary" size="sm" onClick={retry}>
            <Localized id="retry">Retry</Localized>
          </Button>
        </div>
      )}

      <div
        ref={floorplanRef}
        className={`tables-floorplan${arrangeMode ? ' tables-floorplan--arranging' : ''}`}
        role="list"
        aria-label={l10n.getString('tables-floorplan-label')}
      >
        {loading && tables.length === 0 && (
          <div className="tables-loading" role="status">
            <span className="tables-loading-spinner" aria-hidden="true" />
            <Localized id="loading">Loading…</Localized>
          </div>
        )}

        {showEmpty && section === null && (
          <div className="tables-empty">
            <span className="tables-empty-icon" aria-hidden="true"><GridIcon /></span>
            <p className="tables-empty-title"><Localized id="tables-empty">No tables configured yet.</Localized></p>
            <p className="tables-empty-desc"><Localized id="tables-empty-desc">Add tables to build your floor plan.</Localized></p>
            <Button
              variant="primary"
              size="sm"
              style={{ marginTop: '12px' }}
              data-testid="tables-empty-add-table-btn"
              onClick={openAddTableModal}
            >
              <Localized id="tables-add-table">
                <span>+ Add Table</span>
              </Localized>
            </Button>
          </div>
        )}

        {showEmpty && section !== null && (
          <div className="tables-empty">
            <span className="tables-empty-icon" aria-hidden="true"><GridIcon /></span>
            <p className="tables-empty-title"><Localized id="tables-empty-filtered">No tables in this section.</Localized></p>
            <Button variant="ghost" size="sm" onClick={() => setSection(null)}>
              <Localized id="tables-all">All</Localized>
            </Button>
          </div>
        )}

        {!showEmpty && visibleTables.map((t) => {
          const shape = t.shape || 'circle';
          // TBL-08 front-end clamp: old persisted geometry could predate the
          // backend bounds check, so never render a sub-2% interactive control.
          const w = Math.max(t.width, 2);
          const h = Math.max(t.height, 2);
          const bill = getTableBill(t.name);
          const elapsedMinutes = bill?.created_at
            ? Math.max(0, Math.floor((Date.now() - new Date(bill.created_at).getTime()) / 60000))
            : null;
          const isSlaWarn = elapsedMinutes !== null && elapsedMinutes >= 60;
          const isSlaCritical = elapsedMinutes !== null && elapsedMinutes >= 90;
          const reservation = t.status === 'reserved' ? getTableReservation(t.name) : null;
          const joinedTable = getTableJoined(t.name);
          const isArrangeSelected = arrangeMode && arrangeSelectedTableId === t.id;
          return (
            // The floor plan is a role="list" (aria-label above), so each table
            // must be wrapped in a list item. It cannot be put ON the button:
            // role="listitem" is not permitted on <button> (axe
            // aria-allowed-role), so the wrapper carries it instead. Without the
            // wrapper the container advertised a list whose only children were
            // buttons, and a screen reader announced an empty list.
            <div key={t.id} role="listitem">
            <Button
              variant="ghost"
              size="sm"
              className={`tables-table tables-table--${t.status} tables-table--${shape}${bill ? ' tables-table--has-bill' : ''}${isSlaCritical ? ' tables-table--sla-critical' : isSlaWarn ? ' tables-table--sla-warn' : ''}${arrangeMode ? ' tables-table--arranging' : ''}${draggingTableId === t.id ? ' tables-table--dragging' : ''}${isArrangeSelected ? ' tables-table--selected-arrange' : ''}`}
              onClick={() => {
                if (arrangeMode) {
                  setArrangeSelectedTableId(t.id);
                  return;
                }
                openDetail(t);
              }}
              // TBL-05: the context-menu shortcut opens the accessible detail
              // panel (the visible, keyboard-operable actions menu) instead of
              // mutating directly, so every operator path goes through the same
              // confirmed, error-aware action.
              onContextMenu={(e) => {
                e.preventDefault();
                if (arrangeMode) return;
                openDetail(t);
              }}
              onPointerDown={(e) => handlePointerDownTable(e, t)}
              onPointerMove={(e) => handlePointerMoveTable(e, t)}
              onPointerUp={(e) => void handlePointerUpTable(e, t)}
              onPointerCancel={(e) => void handlePointerUpTable(e, t)}
              disabled={!arrangeMode && pendingId === t.id}
              style={{
                left: `${t.pos_x}%`, top: `${t.pos_y}%`,
                width: `${w}%`, height: `${h}%`,
              }}
              aria-label={
                t.capacity > 0
                  // Capacity is folded into the button's name: the visible badge is
                  // abbreviated ("12p") and the span carrying it is aria-hidden, so
                  // without this assistive tech never hears the seat count at all.
                  // It used to ride a native `title` on that span, which the browser
                  // renders unlocalized and on top of the app's own tooltip.
                  ? l10n.getString('tables-table-label', { name: t.name, status: statusLabel(t.status) }) + ', ' + t.capacity + ' seats'
                  : l10n.getString('tables-table-label', { name: t.name, status: statusLabel(t.status) })
              }
            >
              {t.capacity > 0 && (
                <span className="tables-table-capacity" aria-hidden="true">
                  {t.capacity}p
                </span>
              )}
              <span className="tables-table-name">{t.name}</span>
              <span className="tables-table-status">
                {reservation ? (
                  <span className="tables-table-reservation-tag" data-testid={`tables-reservation-tag-${t.name}`}>
                    📅 {reservation.guestName}{reservation.time ? ` · ${reservation.time}` : ''}
                  </span>
                ) : bill ? (
                  <span className="tables-table-bill-tag">
                    <span className="tables-table-bill-items">
                      {l10n.getString('retail-cart-items', { count: bill.item_count }, `${bill.item_count} items`)}
                    </span>
                    {bill.total_minor > 0 && (
                      <span className="tables-table-bill-amount">
                        {formatMoney({ minor_units: bill.total_minor, currency: bill.currency })}
                      </span>
                    )}
                    {elapsedMinutes !== null && (
                      <span className={`tables-table-timer${isSlaCritical ? ' tables-table-timer--critical' : isSlaWarn ? ' tables-table-timer--warn' : ''}`}>
                        ⏱️ {elapsedMinutes}m
                      </span>
                    )}
                  </span>
                ) : (
                  statusLabel(t.status)
                )}
              </span>
              {joinedTable && (
                <span className="tables-table-joined-tag" data-testid={`tables-joined-tag-${t.name}`}>
                  <Localized id="tables-table-joined-badge" vars={{ joined: joinedTable }}>
                    <span>🔗 +T{joinedTable}</span>
                  </Localized>
                </span>
              )}
              {isArrangeSelected && (
                <span
                  className="tables-table-resize-handle"
                  data-testid={`tables-resize-handle-${t.name}`}
                  onPointerDown={(e) => handlePointerDownResize(e, t)}
                  onPointerMove={(e) => handlePointerMoveResize(e, t)}
                  onPointerUp={(e) => void handlePointerUpResize(e, t)}
                  onPointerCancel={(e) => void handlePointerUpResize(e, t)}
                  aria-hidden="true"
                >
                  ↘
                </span>
              )}
            </Button>
            </div>
          );
        })}

        {arrangeMode && arrangeSelectedTableId && (() => {
          const arrangeTable = tables.find((t) => t.id === arrangeSelectedTableId);
          if (!arrangeTable) return null;
          return (
            <div className="tables-arrange-inspector" data-testid="tables-arrange-inspector">
              <div className="tables-arrange-inspector-lead">
                <span className="tables-arrange-inspector-title">
                  <Localized id="tables-arrange-selected" vars={{ table: arrangeTable.name }}>
                    <span>Editing: Table {arrangeTable.name}</span>
                  </Localized>
                </span>
              </div>
              <div className="tables-arrange-inspector-group">
                <span className="tables-arrange-inspector-label">
                  <Localized id="tables-arrange-shape"><span>Shape:</span></Localized>
                </span>
                {(['circle', 'square', 'rectangle', 'booth'] as const).map((s) => (
                  <Button
                    key={s}
                    variant="ghost"
                    size="sm"
                    className={`tables-arrange-shape-btn ${arrangeTable.shape === s ? 'active' : ''}`}
                    data-testid={`tables-arrange-shape-${s}`}
                    onClick={() => void handleUpdateArrangeShape(s)}
                  >
                    {s === 'circle' ? '⚪' : s === 'square' ? '⬛' : s === 'rectangle' ? '▬' : '🛋️'}{' '}
                    <Localized id={`tables-shape-${s}`}><span>{s}</span></Localized>
                  </Button>
                ))}
              </div>
              <div className="tables-arrange-inspector-group">
                <span className="tables-arrange-inspector-label">
                  <Localized id="tables-arrange-size"><span>Size:</span></Localized>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="tables-arrange-step-btn"
                  data-testid="tables-arrange-width-dec"
                  onClick={() => void handleAdjustArrangeSize(-2, 0)}
                  title="Decrease Width"
                >
                  W -
                </Button>
                <span className="tables-arrange-dim">{arrangeTable.width}%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="tables-arrange-step-btn"
                  data-testid="tables-arrange-width-inc"
                  onClick={() => void handleAdjustArrangeSize(2, 0)}
                  title="Increase Width"
                >
                  W +
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="tables-arrange-step-btn"
                  data-testid="tables-arrange-height-dec"
                  onClick={() => void handleAdjustArrangeSize(0, -2)}
                  title="Decrease Height"
                >
                  H -
                </Button>
                <span className="tables-arrange-dim">{arrangeTable.height}%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="tables-arrange-step-btn"
                  data-testid="tables-arrange-height-inc"
                  onClick={() => void handleAdjustArrangeSize(0, 2)}
                  title="Increase Height"
                >
                  H +
                </Button>
              </div>
            </div>
          );
        })()}
      </div>

      {selected && (() => {
        const activeBill = getTableBill(selected.name);
        const reservation = selected.status === 'reserved' ? (selectedReservation ?? getTableReservation(selected.name)) : null;
        return (
          <div className="tables-detail" ref={detailRef} role="dialog" aria-modal="true" aria-label={l10n.getString('tables-detail-label')}>
            <h2>{selected.name}</h2>
            <p><Localized id="tables-capacity-label" vars={{ capacity: selected.capacity }}><span>Capacity: {selected.capacity}</span></Localized></p>
            <p><Localized id="tables-status-label" vars={{ status: statusLabel(selected.status) }}><span>Status: {statusLabel(selected.status)}</span></Localized></p>
            <p><Localized id="tables-section-label" vars={{ section: selected.section || '—' }}><span>Section: {selected.section || '—'}</span></Localized></p>

            {reservation && (
              <div className="tables-reservation-card" data-testid="tables-reservation-card">
                <div className="tables-reservation-header">
                  <span className="tables-reservation-icon" aria-hidden="true">📅</span>
                  <div>
                    <h3 className="tables-reservation-guest">{reservation.guestName}</h3>
                    {reservation.time && (
                      <span className="tables-reservation-time">
                        {reservation.time} {reservation.partySize ? `(${reservation.partySize}p)` : ''}
                      </span>
                    )}
                  </div>
                </div>
                {reservation.phone && (
                  <div className="tables-reservation-row">
                    <span className="tables-reservation-label">{l10n.getString('tables-reserve-phone-label')}:</span>
                    <span>{reservation.phone}</span>
                  </div>
                )}
                {reservation.notes && (
                  <div className="tables-reservation-row">
                    <span className="tables-reservation-label">{l10n.getString('tables-reserve-notes-label')}:</span>
                    <span>{reservation.notes}</span>
                  </div>
                )}
              </div>
            )}

            {activeBill && !reservation && (
              <div className="tables-active-bill-info">
                <div className="tables-active-bill-title">
                  <Localized id="tables-active-tab-label" vars={{ label: activeBill.label }}>
                    <span>Active Tab: {activeBill.label}</span>
                  </Localized>
                </div>
                <div className="tables-active-bill-meta">
                  {l10n.getString('retail-cart-items', { count: activeBill.item_count }, `${activeBill.item_count} items`)} · {formatMoney({ minor_units: activeBill.total_minor, currency: activeBill.currency })}
                  {activeBill.created_at && (
                    <> · ⏱️ {Math.max(0, Math.floor((Date.now() - new Date(activeBill.created_at).getTime()) / 60000))}m</>
                  )}
                </div>
              </div>
            )}

            {activeBill && (() => {
              const conflictLease = getConflict(activeBill.id);
              if (!conflictLease) return null;
              return (
                <div className="tables-warning-banner" role="alert" data-testid="tables-tab-conflict-banner">
                  <div className="tables-warning-title">
                    <Localized id="tables-tab-conflict-warning" vars={{ terminal: conflictLease.terminalName }}>
                      <span>{conflictLease.terminalName} is currently editing this tab</span>
                    </Localized>
                  </div>
                  <div className="tables-warning-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      data-testid="tables-tab-takeover-btn"
                      onClick={async () => {
                        await forceTakeover(activeBill.id, selected.name);
                        addToast({
                          message: l10n.getString('tables-toast-takeover-success', { terminal: conflictLease.terminalName }),
                          type: 'success',
                        });
                      }}
                    >
                      <Localized id="tables-tab-takeover">
                        <span>Take Over Tab</span>
                      </Localized>
                    </Button>
                  </div>
                </div>
              );
            })()}

            {actionError && (
              <p className="tables-action-error" role="alert">
                <Localized id="tables-action-error">Could not update this table.</Localized>
                <span className="tables-action-error-detail">{actionError}</span>
              </p>
            )}

            {showReleaseConfirm && activeBill && (
              <div className="tables-warning-banner">
                <div className="tables-warning-title">
                  <Localized id="tables-release-confirm-title" vars={{ amount: formatMoney({ minor_units: activeBill.total_minor, currency: activeBill.currency }) }}>
                    <span>Table has an active tab ({formatMoney({ minor_units: activeBill.total_minor, currency: activeBill.currency })})</span>
                  </Localized>
                </div>
                <div className="tables-warning-desc">
                  <Localized id="tables-release-confirm-desc">
                    <span>Releasing will mark the table as available without closing or settling this unpaid bill. Are you sure?</span>
                  </Localized>
                </div>
                <div className="tables-warning-actions">
                  <Button
                    variant="danger"
                    size="sm"
                    state={pendingId === selected.id ? 'processing' : 'ready'}
                    onClick={() => {
                      setShowReleaseConfirm(false);
                      void statusAction(selected);
                    }}
                  >
                    <Localized id="tables-confirm-release">
                      <span>Confirm Release</span>
                    </Localized>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowReleaseConfirm(false)}>
                    <Localized id="cancel">
                      <span>Cancel</span>
                    </Localized>
                  </Button>
                </div>
              </div>
            )}

            {showDeleteConfirm && (
              <div className="tables-warning-banner">
                <div className="tables-warning-title">
                  <Localized id="tables-delete-confirm" vars={{ name: selected.name }}>
                    <span>Are you sure you want to delete table {selected.name}?</span>
                  </Localized>
                </div>
                <div className="tables-warning-actions">
                  <Button
                    variant="danger"
                    size="sm"
                    state={pendingId === selected.id ? 'processing' : 'ready'}
                    onClick={() => void handleDeleteTable(selected.id)}
                  >
                    <Localized id="delete"><span>Delete</span></Localized>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                    <Localized id="cancel"><span>Cancel</span></Localized>
                  </Button>
                </div>
              </div>
            )}

            <div className="tables-detail-actions">
              {onSelectTable && (
                <Button
                  variant="primary"
                  size="sm"
                  className="tables-primary-action-btn"
                  data-testid="tables-assign-to-order-btn"
                  onClick={() => {
                    onSelectTable(selected.name);
                    closeDetail();
                  }}
                >
                  <Localized id={activeBill ? 'tables-resume-tab' : 'tables-assign-to-order'}>
                    <span>{activeBill ? 'Resume Tab / Order' : 'Select for Order'}</span>
                  </Localized>
                </Button>
              )}
              {!showReleaseConfirm && !showDeleteConfirm && (
                <>
                  {selected.status === 'reserved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="tables-primary-action-btn"
                      data-testid="tables-seat-guests-btn"
                      onClick={() => void handleSeatReservedGuests(selected)}
                    >
                      <Localized id="tables-seat-guests">
                        <span>Seat Guests</span>
                      </Localized>
                    </Button>
                  )}
                  <Button
                    variant={selected.status === 'occupied' ? 'danger' : selected.status === 'reserved' ? 'ghost' : 'primary'}
                    size="sm"
                    state={pendingId === selected.id ? 'processing' : 'ready'}
                    onClick={() => {
                      if (selected.status === 'occupied' && activeBill) {
                        setShowReleaseConfirm(true);
                      } else {
                        void statusAction(selected);
                      }
                    }}
                  >
                    <Localized id={selected.status === 'occupied' ? 'tables-release' : selected.status === 'available' ? 'tables-mark-reserved' : 'tables-mark-available'}>
                      {selected.status === 'occupied' ? 'Release' : selected.status === 'available' ? 'Mark Reserved' : 'Mark Available'}
                    </Localized>
                  </Button>
                  {selected.status === 'available' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="tables-open-reserve-btn"
                      onClick={() => {
                        setReserveModal({
                          table: selected,
                          guestName: '',
                          phone: '',
                          partySize: selected.capacity || 4,
                          time: '',
                          notes: '',
                        });
                      }}
                    >
                      <Localized id="tables-reserve-table">
                        <span>Reserve Table</span>
                      </Localized>
                    </Button>
                  )}
                  {selected.status === 'cleaning' && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="tables-mark-cleaned-btn"
                      data-testid="tables-mark-cleaned-btn"
                      onClick={() => void handleQuickMarkCleaned(selected)}
                    >
                      <Localized id="tables-mark-cleaned-quick">
                        <span>Mark Cleaned (Available)</span>
                      </Localized>
                    </Button>
                  )}
                  {selected.status === 'available' && (
                    <div className="tables-quick-seat-row" data-testid="tables-quick-seat-row">
                      <span className="tables-quick-seat-label">
                        <Localized id="tables-quick-seat-walkin"><span>Quick Seat:</span></Localized>
                      </span>
                      <div className="tables-quick-seat-chips">
                        {[1, 2, 3, 4, 5, 6].map((size) => (
                          <Button
                            key={size}
                            variant="ghost"
                            size="sm"
                            className="tables-quick-seat-chip"
                            data-testid={`tables-quick-seat-${size}`}
                            onClick={() => void handleQuickSeatWalkin(selected, size)}
                          >
                            {size}p
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {activeBill && printBillEnabled !== false && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="tables-print-bill-btn"
                      disabled={printingBill}
                      state={printingBill ? 'processing' : 'ready'}
                      onClick={() => void handlePrintBillForTable(selected)}
                    >
                      <Localized id="tables-print-bill">
                        <span>Print Bill</span>
                      </Localized>
                    </Button>
                  )}
                  {activeBill && tableTransferEnabled !== false && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="tables-move-table-btn"
                        onClick={() => handleOpenMoveTable(selected)}
                      >
                        <Localized id="tables-move-table">
                          <span>Move Table</span>
                        </Localized>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="tables-merge-table-btn"
                        onClick={() => handleOpenMergeTable(selected)}
                      >
                        <Localized id="tables-merge-table">
                          <span>Merge Table</span>
                        </Localized>
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="tables-edit-table-btn"
                    onClick={() => {
                      openEditTableModal(selected);
                    }}
                  >
                    <Localized id="tables-edit-table">
                      <span>Edit Table</span>
                    </Localized>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="tables-delete-table-btn"
                    disabled={Boolean(activeBill || selected.status === 'occupied')}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Localized id="tables-delete-table">
                      <span>Delete Table</span>
                    </Localized>
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="tables-close-btn" onClick={closeDetail}>
                <Localized id="close">Close</Localized>
              </Button>
            </div>
          </div>
        );
      })()}

      {showManageSections && (
        <div
          className="tables-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tables-manage-sections-title"
        >
          <div className="tables-modal-dialog tables-manage-sections-dialog">
            <div className="tables-modal-header">
              <h2 id="tables-manage-sections-title">
                <Localized id="tables-manage-sections-title">
                  <span>Manage Sections</span>
                </Localized>
              </h2>
              <button
                type="button"
                className="tables-modal-close-btn"
                onClick={() => setShowManageSections(false)}
                aria-label={l10n.getString('close') || 'Close'}
              >
                ✕
              </button>
            </div>
            <div className="tables-manage-sections-content">
              <form onSubmit={handleAddSection} className="tables-add-section-form">
                <input
                  type="text"
                  value={newSectionInput}
                  onChange={(e) => setNewSectionInput(e.target.value)}
                  placeholder={l10n.getString('tables-new-section-placeholder')}
                  className="tables-section-input"
                  data-testid="tables-new-section-input"
                />
                <Button
                  variant="primary"
                  type="submit"
                  size="sm"
                  disabled={!newSectionInput.trim()}
                  data-testid="tables-add-section-btn"
                >
                  <Localized id="tables-add-section-btn">
                    <span>Add Section</span>
                  </Localized>
                </Button>
              </form>
              <div className="tables-manage-sections-list">
                {sections.map((s) => {
                  const tableCount = tables.filter((t) => (t.section || 'Main') === s).length;
                  const isEditing = editingSectionName === s;
                  return (
                    <div key={s} className="tables-manage-section-item" data-testid={`tables-manage-section-${s}`}>
                      {isEditing ? (
                        <div className="tables-manage-section-edit-row">
                          <input
                            type="text"
                            value={editSectionInput}
                            onChange={(e) => setEditSectionInput(e.target.value)}
                            className="tables-section-input"
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!editSectionInput.trim() || editSectionInput.trim() === s}
                            onClick={() => void handleRenameSection(s, editSectionInput)}
                          >
                            <Localized id="save">Save</Localized>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingSectionName(null)}
                          >
                            <Localized id="cancel">Cancel</Localized>
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="tables-manage-section-info">
                            <span className="tables-manage-section-name">{s}</span>
                            <span className="tables-manage-section-count">
                              {tableCount > 0 ? (
                                <Localized id="tables-section-table-count" vars={{ count: tableCount }}>
                                  <span>{tableCount} tables</span>
                                </Localized>
                              ) : (
                                <Localized id="tables-section-no-tables">
                                  <span>0 tables</span>
                                </Localized>
                              )}
                            </span>
                          </div>
                          <div className="tables-manage-section-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingSectionName(s);
                                setEditSectionInput(s);
                              }}
                              data-testid={`tables-rename-section-${s}`}
                            >
                              <Localized id="tables-rename-section">
                                <span>Rename</span>
                              </Localized>
                            </Button>
                            {s !== 'Main' && (
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => void handleDeleteSection(s)}
                                data-testid={`tables-delete-section-${s}`}
                              >
                                <Localized id="tables-delete-section">
                                  <span>Delete</span>
                                </Localized>
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="tables-modal-footer">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setShowManageSections(false)}
              >
                <Localized id="close">
                  <span>Close</span>
                </Localized>
              </Button>
            </div>
          </div>
        </div>
      )}

      {tableModal && (
        <div
          className="tables-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tables-modal-title"
        >
          <div className="tables-modal-dialog">
            <div className="tables-modal-header">
              <h2 id="tables-modal-title">
                <Localized id={tableModal.id ? 'tables-edit-table' : 'tables-add-table'}>
                  <span>{tableModal.id ? 'Edit Table' : 'Add Table'}</span>
                </Localized>
              </h2>
              <button
                type="button"
                className="tables-modal-close-btn"
                onClick={() => setTableModal(null)}
                aria-label={l10n.getString('close') || 'Close'}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveTableModal} className="tables-modal-form">
              <div className="tables-modal-field">
                <label htmlFor="table-modal-name">
                  {l10n.getString('tables-name-label')}
                  <input
                    id="table-modal-name"
                    type="text"
                    required
                    value={tableModal.name}
                    onChange={(e) => setTableModal({ ...tableModal, name: e.target.value })}
                    placeholder={l10n.getString('tables-name-placeholder')}
                  />
                </label>
              </div>

              <div className="tables-modal-field">
                <label htmlFor="table-modal-section">
                  {l10n.getString('tables-section-input-label')}
                  <input
                    id="table-modal-section"
                    type="text"
                    value={tableModal.section}
                    onChange={(e) => setTableModal({ ...tableModal, section: e.target.value })}
                    placeholder={l10n.getString('tables-section-placeholder')}
                  />
                </label>
                {sections.length > 0 && (
                  <div className="tables-modal-section-chips">
                    {sections.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`tables-modal-chip ${tableModal.section === s ? 'active' : ''}`}
                        onClick={() => setTableModal({ ...tableModal, section: s })}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="tables-modal-row">
                <div className="tables-modal-field" style={{ flex: 1 }}>
                  <label htmlFor="table-modal-capacity">
                    {l10n.getString('tables-capacity-input-label')}
                    <input
                      id="table-modal-capacity"
                      type="number"
                      min="1"
                      max="50"
                      value={tableModal.capacity}
                      onChange={(e) => setTableModal({ ...tableModal, capacity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    />
                  </label>
                </div>

                <div className="tables-modal-field" style={{ flex: 1 }}>
                  <label htmlFor="table-modal-shape">
                    {l10n.getString('tables-shape-label')}
                    <select
                      id="table-modal-shape"
                      value={tableModal.shape}
                      onChange={(e) => setTableModal({ ...tableModal, shape: e.target.value })}
                    >
                      <option value="circle">{l10n.getString('tables-shape-circle')}</option>
                      <option value="square">{l10n.getString('tables-shape-square')}</option>
                      <option value="rectangle">{l10n.getString('tables-shape-rectangle')}</option>
                      <option value="booth">{l10n.getString('tables-shape-booth')}</option>
                    </select>
                  </label>
                </div>
              </div>

              {tableModalError && (
                <div className="tables-action-error" role="alert">
                  <span className="tables-action-error-detail">{tableModalError}</span>
                </div>
              )}

              <div className="tables-modal-footer">
                <Button
                  variant="primary"
                  type="submit"
                  state={tableModalSaving ? 'processing' : 'ready'}
                  // ⚠️ The name is part of the gate because `handleSaveTableModal` RETURNS
                  // SILENTLY on a blank one (`if (!tableModal || !tableModal.name.trim()) return;`).
                  // Measured 2026-10-14 before this fix: + Add Table opens the modal
                  // with `name: ''`, the Save Table button rendered ENABLED, and
                  // clicking it produced no request, no error and no state change — the operator
                  // taps Save and the till does nothing without saying why. The same shape as
                  // `RestaurantMenuEditorScreen`'s item form, found in round 163.
                  //
                  // Note the contrast with the token guard above, which
                  // REPORTS rather than returning silently — consistent with that intent, the
                  // blank-name path is closed by disabling the control rather than by adding a
                  // second toast, since the field is empty and the reason is self-evident.
                  disabled={!tableModal.name.trim()}
                >
                  <Localized id="tables-save-table"><span>Save Table</span></Localized>
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setTableModal(null)}
                >
                  <Localized id="cancel"><span>Cancel</span></Localized>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {moveTableModal && (
        <div
          className="tables-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tables-move-modal-title"
        >
          <div className="tables-modal-dialog">
            <div className="tables-modal-header">
              <h2 id="tables-move-modal-title">
                <Localized id="tables-move-table-title" vars={{ from: moveTableModal.name }}>
                  <span>Move Table {moveTableModal.name}</span>
                </Localized>
              </h2>
              <button
                type="button"
                className="tables-modal-close-btn"
                onClick={() => setMoveTableModal(null)}
                aria-label={l10n.getString('close') || 'Close'}
              >
                ✕
              </button>
            </div>
            <div className="tables-modal-form">
              {(() => {
                const availableTables = activeTableList.filter(
                  (t) => t.id !== moveTableModal.id && t.status === 'available',
                );
                if (availableTables.length === 0) {
                  return (
                    <>
                      <p className="tables-empty-desc">
                        <Localized id="tables-move-table-no-available">
                          <span>No available tables to move to.</span>
                        </Localized>
                      </p>
                      <div className="tables-modal-footer">
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => setMoveTableModal(null)}
                        >
                          <Localized id="close">
                            <span>Close</span>
                          </Localized>
                        </Button>
                      </div>
                    </>
                  );
                }
                return (
                  <>
                    <div className="tables-modal-field">
                      <label htmlFor="tables-move-dest-select">
                        <Localized id="tables-move-table-select-prompt">
                          <span>Select an available destination table:</span>
                        </Localized>
                        <select
                          id="tables-move-dest-select"
                          value={selectedDestTableId}
                          onChange={(e) => setSelectedDestTableId(e.target.value)}
                        >
                          {availableTables.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.capacity} seats{t.section ? ` · ${t.section}` : ''})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="tables-modal-footer">
                      <Button
                        variant="primary"
                        type="button"
                        state={movingTable ? 'processing' : 'ready'}
                        disabled={!selectedDestTableId || movingTable}
                        onClick={() => void handleConfirmMoveTable()}
                        data-testid="tables-move-confirm-btn"
                      >
                        <Localized
                          id="tables-move-table-confirm"
                          vars={{ to: activeTableList.find((t) => t.id === selectedDestTableId)?.name ?? '' }}
                        >
                          <span>Move</span>
                        </Localized>
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => setMoveTableModal(null)}
                      >
                        <Localized id="cancel">
                          <span>Cancel</span>
                        </Localized>
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {mergeTableModal && (
        <div
          className="tables-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tables-merge-modal-title"
        >
          <div className="tables-modal-dialog">
            <div className="tables-modal-header">
              <h2 id="tables-merge-modal-title">
                <Localized id="tables-merge-table-title" vars={{ from: mergeTableModal.name }}>
                  <span>Merge Table {mergeTableModal.name}</span>
                </Localized>
              </h2>
              <button
                type="button"
                className="tables-modal-close-btn"
                onClick={() => setMergeTableModal(null)}
                aria-label={l10n.getString('close') || 'Close'}
              >
                ✕
              </button>
            </div>
            <div className="tables-modal-form">
              {(() => {
                const candidateTables = activeTableList.filter(
                  (t) => t.id !== mergeTableModal.id && Boolean(getTableBill(t.name)),
                );
                if (candidateTables.length === 0) {
                  return (
                    <>
                      <p className="tables-empty-desc">
                        <Localized id="tables-merge-table-no-occupied">
                          <span>No other occupied tables with active tabs to merge with.</span>
                        </Localized>
                      </p>
                      <div className="tables-modal-footer">
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => setMergeTableModal(null)}
                        >
                          <Localized id="close">
                            <span>Close</span>
                          </Localized>
                        </Button>
                      </div>
                    </>
                  );
                }
                return (
                  <>
                    <div className="tables-modal-field">
                      <label htmlFor="tables-merge-dest-select">
                        <Localized id="tables-merge-table-select-prompt">
                          <span>Select an occupied destination table to merge with:</span>
                        </Localized>
                        <select
                          id="tables-merge-dest-select"
                          value={selectedMergeDestTableId}
                          onChange={(e) => setSelectedMergeDestTableId(e.target.value)}
                        >
                          {candidateTables.map((t) => {
                            const b = getTableBill(t.name);
                            return (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.capacity} seats{b ? ` · ${formatMoney({ minor_units: b.total_minor, currency: b.currency })}` : ''})
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    </div>
                    <div className="tables-modal-footer">
                      <Button
                        variant="primary"
                        type="button"
                        state={mergingTable ? 'processing' : 'ready'}
                        disabled={!selectedMergeDestTableId || mergingTable}
                        onClick={() => void handleConfirmMergeTable()}
                        data-testid="tables-merge-confirm-btn"
                      >
                        <Localized
                          id="tables-merge-table-confirm"
                          vars={{ to: activeTableList.find((t) => t.id === selectedMergeDestTableId)?.name ?? '' }}
                        >
                          <span>Merge</span>
                        </Localized>
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => setMergeTableModal(null)}
                      >
                        <Localized id="cancel">
                          <span>Cancel</span>
                        </Localized>
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {reserveModal && (
        <div
          className="tables-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tables-reserve-modal-title"
        >
          <div className="tables-modal-dialog">
            <div className="tables-modal-header">
              <h2 id="tables-reserve-modal-title">
                <Localized id="tables-reserve-table-title" vars={{ table: reserveModal.table.name }}>
                  <span>Reserve Table {reserveModal.table.name}</span>
                </Localized>
              </h2>
              <button
                type="button"
                className="tables-modal-close-btn"
                onClick={() => setReserveModal(null)}
                aria-label={l10n.getString('close') || 'Close'}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleConfirmReservation} className="tables-modal-form">
              <div className="tables-modal-field">
                <label htmlFor="reserve-modal-name">
                  {l10n.getString('tables-reserve-name-label')}
                  <input
                    id="reserve-modal-name"
                    type="text"
                    required
                    value={reserveModal.guestName}
                    onChange={(e) => setReserveModal({ ...reserveModal, guestName: e.target.value })}
                    placeholder={l10n.getString('tables-reserve-name-placeholder')}
                  />
                </label>
              </div>

              <div className="tables-modal-row">
                <div className="tables-modal-field" style={{ flex: 1 }}>
                  <label htmlFor="reserve-modal-phone">
                    {l10n.getString('tables-reserve-phone-label')}
                    <input
                      id="reserve-modal-phone"
                      type="text"
                      value={reserveModal.phone}
                      onChange={(e) => setReserveModal({ ...reserveModal, phone: e.target.value })}
                      placeholder={l10n.getString('tables-reserve-phone-placeholder')}
                    />
                  </label>
                </div>

                <div className="tables-modal-field" style={{ flex: 1 }}>
                  <label htmlFor="reserve-modal-party">
                    {l10n.getString('tables-capacity-input-label')}
                    <input
                      id="reserve-modal-party"
                      type="number"
                      min="1"
                      max="50"
                      value={reserveModal.partySize}
                      onChange={(e) => setReserveModal({ ...reserveModal, partySize: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    />
                  </label>
                </div>
              </div>

              <div className="tables-modal-row">
                <div className="tables-modal-field" style={{ flex: 1 }}>
                  <label htmlFor="reserve-modal-time">
                    {l10n.getString('tables-reserve-time-label')}
                    <input
                      id="reserve-modal-time"
                      type="text"
                      value={reserveModal.time}
                      onChange={(e) => setReserveModal({ ...reserveModal, time: e.target.value })}
                      placeholder={l10n.getString('tables-reserve-time-placeholder')}
                    />
                  </label>
                </div>
              </div>

              <div className="tables-modal-field">
                <label htmlFor="reserve-modal-notes">
                  {l10n.getString('tables-reserve-notes-label')}
                  <input
                    id="reserve-modal-notes"
                    type="text"
                    value={reserveModal.notes}
                    onChange={(e) => setReserveModal({ ...reserveModal, notes: e.target.value })}
                    placeholder={l10n.getString('tables-reserve-notes-placeholder')}
                  />
                </label>
              </div>

              <div className="tables-modal-footer">
                <Button
                  variant="primary"
                  type="submit"
                  state={reservingTable ? 'processing' : 'ready'}
                  disabled={!reserveModal.guestName.trim() || reservingTable}
                  data-testid="tables-reserve-confirm-btn"
                >
                  <Localized id="tables-reserve-confirm"><span>Confirm Reservation</span></Localized>
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setReserveModal(null)}
                >
                  <Localized id="cancel"><span>Cancel</span></Localized>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consent for the destructive section delete. Replaces the `window.confirm()`
          this handler used to raise: themed, localized through the app's own bundles,
          and NON-BLOCKING, so the till stays responsive while the operator decides.
          `tables-delete-section-confirm` is the message the OS dialog used to carry,
          reused verbatim so the wording the operator already knows is unchanged. */}
      <ConfirmDialog
        open={pendingSectionDelete !== null}
        onCancel={() => setPendingSectionDelete(null)}
        onConfirm={async () => {
          const target = pendingSectionDelete;
          setPendingSectionDelete(null);
          if (target !== null) {
            setDeletingSection(true);
            try {
              await confirmDeleteSection(target);
            } finally {
              setDeletingSection(false);
            }
          }
        }}
        title={requiredLocalized(l10n, 'tables-delete-section')}
        message={requiredLocalized(l10n, 'tables-delete-section-confirm', {
          section: pendingSectionDelete ?? '',
        })}
        variant="danger"
        loading={deletingSection}
      />
    </div>
  );
}
