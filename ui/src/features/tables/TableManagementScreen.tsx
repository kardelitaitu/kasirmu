import { useCallback, useEffect, useRef, useState } from 'react';
import { requiredLocalized } from '@/components';
import { Button } from '@/components/Button';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
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
import { getSettingScoped } from '@/api/settings';
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
  const [tables, setTables] = useState<Table[]>([]);
  const [tablePool, setTablePool] = useState<Table[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [openBills, setOpenBills] = useState<HeldCartRow[]>([]);
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
  const [arrangeMode, setArrangeMode] = useState(false);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const floorplanRef = useRef<HTMLDivElement | null>(null);
  const dragStartPos = useRef<{
    pointerX: number;
    pointerY: number;
    tableX: number;
    tableY: number;
  } | null>(null);
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

  // TBL-07: localized label for a raw status value, with unknown fallback.
  const statusLabel = useCallback(
    (status: string) => l10n.getString(STATUS_LABEL_IDS[status] ?? 'tables-status-unknown'),
    [l10n],
  );

  // TBL-09: sections are stable metadata loaded independently of the table
  // page, so selecting a section never makes the other filters disappear and
  // empty sections stay representable. Non-fatal — the floor plan still works
  // if section loading fails.
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    listSectionsScoped(sessionToken)
      .then((data) => {
        if (!cancelled) setSections(asArray<typeof data[number]>(data));
      })
      .catch(() => {
        if (!cancelled) setSections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

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
      const [tableData, billData] = await Promise.all([
        listTablesScoped(sessionToken, section ?? undefined),
        listOpenBillsScoped(sessionToken).catch(() => []),
      ]);
      if (seq !== loadSeqRef.current) return;
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
    // effect at :204 already lists loadTables for exactly this reason; this one was
    // the outlier. Same for `section`: the reload used the section it mounted with.
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

  const handleSaveTableModal = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken) {
      // Reported, not dropped: the operator presses Save and nothing happens.
      addToast({ message: requiredLocalized(l10n, 'pos-toast-auth-required'), type: 'warning' });
      return;
    }
    if (!tableModal || !tableModal.name.trim()) return;
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

  const showEmpty = !loading && !error && tables.length === 0;

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
        cartCurrency: full.currency || 'IDR',
        subtotal: { minor_units: full.total_minor, currency: full.currency || 'IDR' },
        total: { minor_units: full.total_minor, currency: full.currency || 'IDR' },
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
  }, [getTableBill, sessionToken, addToast, l10n]);

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

      await deleteHeldCartScoped(sessionToken, activeBill.id);
      await holdCartScoped(sessionToken, {
        label: newLabel,
        cart_data: JSON.stringify(parsed),
        item_count: full.item_count,
        total_minor: full.total_minor,
        currency: full.currency,
        bill_type: 'open_bill',
        customer_name: parsed.customerName || (destTable.name ? `Table ${bareTableNumber(destTable.name)}` : ''),
      });

      await releaseTableScoped(sessionToken, moveTableModal.id);
      await updateTableStatusScoped(sessionToken, destTable.id, 'occupied');
      await loadTables();

      addToast({
        message: l10n.getString('tables-toast-moved', { from: moveTableModal.name, to: destTable.name }),
        type: 'success',
      });
      setMoveTableModal(null);
      closeDetail();
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'tables-toast-move-failed'),
        type: 'error',
      });
    } finally {
      setMovingTable(false);
    }
  }, [moveTableModal, selectedDestTableId, sessionToken, activeTableList, getTableBill, loadTables, addToast, l10n, closeDetail]);

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

      let srcParsed: { lines?: unknown[]; customerName?: string; tableNumber?: string } = {};
      let destParsed: { lines?: unknown[]; customerName?: string; tableNumber?: string } = {};
      try { srcParsed = JSON.parse(srcFull.cart_data); } catch { srcParsed = {}; }
      try { destParsed = JSON.parse(destFull.cart_data); } catch { destParsed = {}; }

      const srcLines = Array.isArray(srcParsed.lines) ? srcParsed.lines : [];
      const destLines = Array.isArray(destParsed.lines) ? destParsed.lines : [];
      const combinedLines = [...destLines, ...srcLines];

      const combinedTotalMinor = destFull.total_minor + srcFull.total_minor;
      const combinedItemCount = destFull.item_count + srcFull.item_count;

      destParsed.tableNumber = destTable.name;
      destParsed.lines = combinedLines;

      const newLabel = heldCartLabel(destTable.name, destParsed.customerName) ?? `Table ${destTable.name}`;

      await Promise.all([
        deleteHeldCartScoped(sessionToken, srcBill.id),
        deleteHeldCartScoped(sessionToken, destBill.id),
      ]);

      await holdCartScoped(sessionToken, {
        label: newLabel,
        cart_data: JSON.stringify(destParsed),
        item_count: combinedItemCount,
        total_minor: combinedTotalMinor,
        currency: destFull.currency || 'IDR',
        bill_type: 'open_bill',
        customer_name: destParsed.customerName || (destTable.name ? `Table ${bareTableNumber(destTable.name)}` : ''),
        ...(destFull.deduction_location_id ? { deduction_location_id: destFull.deduction_location_id } : {}),
      });

      await releaseTableScoped(sessionToken, mergeTableModal.id);
      await loadTables();

      addToast({
        message: l10n.getString('tables-toast-merged', { from: mergeTableModal.name, to: destTable.name }),
        type: 'success',
      });
      setMergeTableModal(null);
      closeDetail();
    } catch (err) {
      addToast({
        message: l10nErrorMessage(err, l10n, 'tables-toast-merge-failed'),
        type: 'error',
      });
    } finally {
      setMergingTable(false);
    }
  }, [mergeTableModal, selectedMergeDestTableId, sessionToken, activeTableList, getTableBill, loadTables, addToast, l10n, closeDetail]);

  const handlePointerDownTable = useCallback((e: React.PointerEvent<HTMLButtonElement>, t: Table) => {
    if (!arrangeMode) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setDraggingTableId(t.id);
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
        addToast({
          message: l10nErrorMessage(err, l10n, 'tables-action-error'),
          type: 'error',
        });
      }
    }
  }, [arrangeMode, draggingTableId, sessionToken, addToast, l10n]);

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

        {!showEmpty && tables.map((t) => {
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
              className={`tables-table tables-table--${t.status} tables-table--${shape}${bill ? ' tables-table--has-bill' : ''}${isSlaWarn ? ' tables-table--sla-warn' : ''}${arrangeMode ? ' tables-table--arranging' : ''}${draggingTableId === t.id ? ' tables-table--dragging' : ''}`}
              onClick={() => {
                if (arrangeMode) return;
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
                {bill ? (
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
                      <span className={`tables-table-timer${isSlaWarn ? ' tables-table-timer--warn' : ''}`}>
                        ⏱️ {elapsedMinutes}m
                      </span>
                    )}
                  </span>
                ) : (
                  statusLabel(t.status)
                )}
              </span>
            </Button>
            </div>
          );
        })}
      </div>

      {selected && (() => {
        const activeBill = getTableBill(selected.name);
        return (
          <div className="tables-detail" ref={detailRef} role="dialog" aria-modal="true" aria-label={l10n.getString('tables-detail-label')}>
            <h2>{selected.name}</h2>
            <p><Localized id="tables-capacity-label" vars={{ capacity: selected.capacity }}><span>Capacity: {selected.capacity}</span></Localized></p>
            <p><Localized id="tables-status-label" vars={{ status: statusLabel(selected.status) }}><span>Status: {statusLabel(selected.status)}</span></Localized></p>
            <p><Localized id="tables-section-label" vars={{ section: selected.section || '—' }}><span>Section: {selected.section || '—'}</span></Localized></p>

            {activeBill && (
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
                  <Button
                    variant={selected.status === 'occupied' ? 'danger' : 'primary'}
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
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                <Localized id="close">Close</Localized>
              </Button>
            </div>
          </div>
        );
      })()}

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
    </div>
  );
}
