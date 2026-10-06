import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { l10nErrorMessage } from '@/utils/app-error';
import { asArray } from '@/utils/ipc-payload';
import { formatMoney } from '@/types/domain';
import { listOpenBillsScoped, type HeldCartRow } from '@/api/sales';
import {
  listTablesScoped,
  listSectionsScoped,
  updateTableStatusScoped,
  releaseTableScoped,
  type Table,
} from '@/api/tables';
import { listen } from '@/api/tauri';
import './TableManagementScreen.css';

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
  const [sections, setSections] = useState<string[]>([]);
  const [openBills, setOpenBills] = useState<HeldCartRow[]>([]);
  const [selected, setSelected] = useState<Table | null>(null);
  const [section, setSection] = useState<string | null>(null);
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
  // Request-generation guard (TBL-02): a stale response from an earlier
  // section/token/refresh can never overwrite a fresher result.
  const loadSeqRef = useRef(0);
  // TBL-06: dialog panel + the trigger that opened it (for focus restoration).
  const detailRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Match table with active open bill/tab
  const getTableBill = useCallback(
    (tableName: string): HeldCartRow | undefined => {
      const lowerName = tableName.toLowerCase();
      return openBills.find((b) => {
        if (b.label.toLowerCase().includes(`table ${lowerName}`)) return true;
        if (b.customer_name?.toLowerCase().includes(`table ${lowerName}`)) return true;
        return false;
      });
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
        if (!cancelled) setSections(data);
      })
      .catch(() => {
        if (!cancelled) setSections([]);
      });
    return () => {
      cancelled = true;
    };
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
      setTables(asArray<typeof tableData[number]>(tableData));
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
    let cancelled = false;

    listen<Table>('tables:status-changed', (event) => {
      const updated = event.payload;
      if (updated && updated.id) {
        setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
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
    };
  }, []);

  const retry = useCallback(() => setRefreshKey((k) => k + 1), []);

  // TBL-06: opening the dialog remembers the trigger so focus can be restored
  // on close. The shared useFocusTrap provides initial focus, Tab trapping,
  // Escape-to-close, and body scroll lock.
  const openDetail = useCallback((t: Table) => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setActionError(null);
    setShowReleaseConfirm(false);
    setSelected(t);
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setActionError(null);
    setShowReleaseConfirm(false);
    triggerRef.current?.focus();
  }, []);

  useFocusTrap(detailRef, selected !== null, closeDetail);

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

  return (
    <div className="tables" role="region" aria-label={l10n.getString('tables-management-label')}>
      <div className="tables-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--space-3)' }}>
        {onBack && (
          <button
            type="button"
            className="restaurant-settings-back-btn"
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
        <h1 className="tables-title" style={{ margin: 0 }}><Localized id="tables-title">Table Management</Localized></h1>
      </div>
      <div className="tables-sections">
        <Button variant="ghost" size="sm" className={`tables-section-btn ${section === null ? 'active' : ''}`}
          onClick={() => setSection(null)}><Localized id="tables-all">All</Localized></Button>
        {sections.map(s => (
          <Button variant="ghost" size="sm" key={s} className={`tables-section-btn ${section === s ? 'active' : ''}`}
            onClick={() => setSection(s)}>{s}</Button>
        ))}
      </div>

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

      <div className="tables-floorplan" role="list" aria-label={l10n.getString('tables-floorplan-label')}>
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
            <p className="tables-empty-desc"><Localized id="tables-empty-desc">Add tables from the settings screen to build your floor plan.</Localized></p>
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
          return (
            <Button variant="ghost" size="sm" key={t.id} className={`tables-table tables-table--${t.status} tables-table--${shape}${bill ? ' tables-table--has-bill' : ''}`}
              onClick={() => openDetail(t)}
              // TBL-05: the context-menu shortcut opens the accessible detail
              // panel (the visible, keyboard-operable actions menu) instead of
              // mutating directly, so every operator path goes through the same
              // confirmed, error-aware action.
              onContextMenu={(e) => { e.preventDefault(); openDetail(t); }}
              disabled={pendingId === t.id}
              style={{
                left: `${t.pos_x}%`, top: `${t.pos_y}%`,
                width: `${w}%`, height: `${h}%`,
              }}
              aria-label={l10n.getString('tables-table-label', { name: t.name, status: statusLabel(t.status) })}
            >
              <span className="tables-table-name">{t.name}</span>
              <span className="tables-table-status">
                {bill ? `${bill.item_count} items` : statusLabel(t.status)}
              </span>
            </Button>
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
              <div
                className="tables-active-bill-info"
                style={{
                  background: 'var(--color-bg-subtle, rgba(255, 255, 255, 0.05))',
                  border: '1px solid var(--color-border)',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  margin: '12px 0',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-fg)' }}>
                  Active Tab: {activeBill.label}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)', marginTop: '4px' }}>
                  {activeBill.item_count} items · {formatMoney({ minor_units: activeBill.total_minor, currency: activeBill.currency })}
                </div>
              </div>
            )}

            {actionError && (
              <p className="tables-action-error" role="alert">
                <Localized id="tables-action-error">Could not update this table.</Localized>
                <span className="tables-action-error-detail">{actionError}</span>
              </p>
            )}

            {showReleaseConfirm && activeBill && (
              <div
                style={{
                  background: 'var(--color-danger-subtle, rgba(239, 68, 68, 0.1))',
                  border: '1px solid var(--color-danger, #ef4444)',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  margin: '12px 0',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-fg)',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--color-danger, #ef4444)', marginBottom: '4px' }}>
                  ⚠️ Table has an active tab ({formatMoney({ minor_units: activeBill.total_minor, currency: activeBill.currency })})
                </div>
                <div>
                  Releasing will mark the table as available without closing or settling this unpaid bill. Are you sure?
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <Button
                    variant="danger"
                    size="sm"
                    state={pendingId === selected.id ? 'processing' : 'ready'}
                    onClick={() => {
                      setShowReleaseConfirm(false);
                      void statusAction(selected);
                    }}
                  >
                    Confirm Release
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowReleaseConfirm(false)}>
                    Cancel
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
                  <Localized id="tables-assign-to-order">
                    <span>{activeBill ? 'Resume Tab / Order' : 'Select for Order'}</span>
                  </Localized>
                </Button>
              )}
              {!showReleaseConfirm && (
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
              )}
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                <Localized id="close">Close</Localized>
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
