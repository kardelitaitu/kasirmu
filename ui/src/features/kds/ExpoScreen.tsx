// ui/src/features/kds/ExpoScreen.tsx
//
// Expediter (Expo) screen — todo-kds-agents-3, Phase 3.2.
//
// The bird's-eye counterpart to KdsScreen: instead of one kitchen's board,
// it aggregates every prep station (partitioned by `kitchen_zone`) so the
// expediter watching the pass can see which tickets are complete across ALL
// stations. "Ready to Serve" here means the ticket-level status reached
// 'ready' — i.e. every station working the ticket bumped its part and the
// kitchen marked the order up. The Serve action (ready → served) is the
// expediter's own turn on the same forward-only ladder the kitchen uses.
//
// Data flow (polling-only, per the work-order constraint that this screen
// must not add IPC commands):
//   • `list_kds_orders_scoped` (unfiltered) is polled every EXPO_POLL_MS and
//     split client-side: active tickets (pending/preparing/ready) drive the
//     station columns; recently `served` tickets feed the recall dialog.
//     One call per tick instead of a queue call + a served call, because the
//     unfiltered list is a superset of both.
//   • `kds:orders-changed` push (the existing Tauri event) triggers an
//     immediate refresh so the common path is still event-driven; the
//     interval is the backstop for missed pushes (LAN events are being built
//     separately — see todo-kds-agents-2 — and this screen must work without
//     them).
//   • LIMITATION (stamped): there is no per-bump *history* command in
//     ui/src/api/kds.ts. The 15-minute recall window is therefore computed
//     from `served_at` of orders still in 'served' status. A ticket served
//     inside the window and then re-served/edited keeps working, but a
//     ticket whose served_at the backend never records shows no recall row.
//     A true bump-by-bump audit trail would need a new read command that
//     only the backend (Agent 2's event work) can add.
//   • LIMITATION (stamped): the recall Restore action calls
//     `update_kds_status_scoped(id, 'ready')`, a backward transition. The
//     frontend ladder (`kdsStatus.ts`) is forward-only, so this deliberately
//     bypasses it; whether the Rust side accepts served → ready could not be
//     verified from the UI (no existing screen performs a reverse move — the
//     Completed tab's Reopen only switches tabs). If the backend rejects it,
//     the operator sees `kds-expo-recall-failed` and nothing else changes.
//
// Line items (course groups + modifier badges) come for free: each ticket is
// a KdsTicketCard, the same component the kitchen board renders (which in
// turn lazy-fetches `get_kds_order_lines_scoped` per card, exactly like the
// kitchen board — the Expo view does not add a per-ticket polling fan-out
// beyond what the kitchen board already pays for the same orders).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { listen } from '@/api/tauri';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace, useWorkspaceScope } from '@/contexts/WorkspaceContext';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSound } from '@/components/useSound';
import { requiredLocalized, LoadingStatus } from '@/components';
import { l10nErrorMessage } from '@/utils/app-error';
import {
  listKdsOrdersScoped,
  updateKdsStatusScoped,
  updateKdsLineItemStatusScoped,
  type KdsLineItem,
  type KdsOrder,
} from '@/api/kds';
import { nextKdsStatus } from '@/features/kds/kdsStatus';
import { sameOrders } from '@/features/kds/kdsOrdersDiff';
import { readExpoStation, writeExpoStation } from '@/features/kds/kdsStationPrefs';
import { KdsTicketCard } from '@/features/kds/components/KdsTicketCard';
import { StationSelectorModal, type StationOption } from '@/features/kds/components/StationSelectorModal';
import { KdsCardColorsProvider } from '@/features/kds/KdsCardColorsContext';
import { KdsScreenFooter } from '@/features/kds/KdsScreenFooter';
import './KdsScreen.css';
import './ExpoScreen.css';

/** Refresh backstop interval when no push event arrives. */
export const EXPO_POLL_MS = 5000;

/** Recall window: tickets served within this many minutes can be brought back. */
export const RECALL_WINDOW_MS = 15 * 60 * 1000;

/** One station column: kitchen zone (null = tickets with no zone). */
export interface ExpoStationColumn {
  zone: string | null;
  orders: KdsOrder[];
}

/**
 * Partition active tickets into per-station columns, zones alphabetical and
 * the no-zone bucket last. Exported for tests.
 */
export function groupByStation(orders: KdsOrder[]): ExpoStationColumn[] {
  const map = new Map<string | null, KdsOrder[]>();
  for (const order of orders) {
    const zone = order.kitchen_zone;
    if (!map.has(zone)) map.set(zone, []);
    map.get(zone)!.push(order);
  }
  const zones = [...map.keys()].filter((z): z is string => z !== null).sort();
  const columns: ExpoStationColumn[] = zones.map((zone) => ({ zone, orders: map.get(zone)! }));
  const unzoned = map.get(null);
  if (unzoned) columns.push({ zone: null, orders: unzoned });
  return columns;
}

/** Tickets at the pass waiting to be served (status 'ready'). Exported for tests. */
export function readyToServe(orders: KdsOrder[]): KdsOrder[] {
  return orders.filter((o) => o.status === 'ready');
}

/** Minutes elapsed since the ticket was served (negative future clock → 0). */
export function minutesSinceServed(order: KdsOrder, nowMs: number): number {
  const ref = order.served_at ?? order.received_at;
  return Math.max(0, Math.floor((nowMs - new Date(ref).getTime()) / 60_000));
}

/**
 * Recall candidates: served tickets whose served_at falls inside the recall
 * window, newest bump first. A served order without `served_at` cannot be
 * placed in the window, so it is excluded rather than guessed at.
 * Exported for tests.
 */
export function recallCandidates(
  orders: KdsOrder[],
  nowMs: number,
  windowMs: number = RECALL_WINDOW_MS,
): KdsOrder[] {
  return orders
    .filter((o) => o.status === 'served' && o.served_at !== null)
    .filter((o) => nowMs - new Date(o.served_at!).getTime() < windowMs)
    .sort((a, b) => new Date(b.served_at!).getTime() - new Date(a.served_at!).getTime());
}

/** Props kept to a single internal screen — ExpoScreen takes no props (routed page). */
export default function ExpoScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const workspaceScope = useWorkspaceScope();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { speak } = useSound();
  const { session } = useAuth();
  const userId = session?.user_id ?? '';

  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallBusy, setRecallBusy] = useState<Set<string>>(new Set());
  // Station focus: '' = all stations (same sentinel as useKdsPreferences.kdsZone).
  // Persisted per user (kdsStationPrefs) so a shared pass terminal remembers
  // the last station it expedited across reloads.
  const [station, setStation] = useState(() => readExpoStation(userId));
  const [stationPickerOpen, setStationPickerOpen] = useState(false);
  // A clock tick, refreshed with every poll, so the recall countdown and the
  // 15-minute window expiry move without their own timer.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const all = await listKdsOrdersScoped(sessionToken);
      const activeStoreId = workspaceScope?.storeId;
      let filtered = all;
      if (activeStoreId) {
        filtered = filtered.filter((order) =>
          !order.store_id || order.store_id === activeStoreId,
        );
      }
      // Cancelled tickets are terminal history on every KDS surface.
      filtered = filtered.filter((order) => order.status !== 'cancelled');
      // PERF-KDS-01 parity: keep object identity when nothing changed so
      // every ticket card's memo (and its 1 Hz SLA timer) stays put.
      setOrders((prev) => (sameOrders(prev, filtered) ? prev : filtered));
      setNowMs(Date.now());
      setLoadError(null);
    } catch (e) {
      // ERR-10: never surface e.message — localized fallback via l10nErrorMessage.
      console.error('ExpoScreen load failed', e);
      setLoadError(l10nErrorMessage(e, l10n, 'kds-expo-load-failed'));
    } finally {
      setInitialLoading(false);
    }
  }, [sessionToken, workspaceScope?.storeId, l10n]);

  // Event + poll subscriptions must survive `load` identity changes without
  // tearing down the listener (same WebView2 IPC cost lesson as KdsScreen).
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<null>('kds:orders-changed', () => {
      void loadRef.current();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {
      /* event plugin unavailable (e.g. plain browser) — push is optional */
    });

    const id = setInterval(() => {
      // A hidden webview cannot see the board; don't spend IPC on it.
      if (!document.hidden) void loadRef.current();
    }, EXPO_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) void loadRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Fetch on mount and whenever the query inputs change (session, store).
  useEffect(() => {
    void load();
  }, [load]);

  // ── Derived board ─────────────────────────────────────────────────
  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'served'),
    [orders],
  );
  const readyOrders = useMemo(() => readyToServe(activeOrders), [activeOrders]);
  const recallable = useMemo(
    () => recallCandidates(orders, nowMs, RECALL_WINDOW_MS),
    [orders, nowMs],
  );
  // The selector always offers every zone present on the board, even while
  // a station filter is active — otherwise choosing a station would make
  // the other options vanish and the modal couldn't switch away from it.
  const stationOptions = useMemo<StationOption[]>(
    () =>
      groupByStation(activeOrders)
        .filter((c): c is { zone: string; orders: KdsOrder[] } => c.zone !== null)
        .map((c) => ({ zone: c.zone, tickets: c.orders.length })),
    [activeOrders],
  );
  // Station filter applied AFTER the active/served split (recall is global).
  const visibleOrders = useMemo(
    () => (station === '' ? activeOrders : activeOrders.filter((o) => o.kitchen_zone === station)),
    [activeOrders, station],
  );
  const stations = useMemo(() => groupByStation(visibleOrders), [visibleOrders]);

  const changeStation = useCallback((zone: string) => {
    setStation(zone);
    writeExpoStation(userId, zone);
  }, [userId]);

  // ── Actions (expediter side of the shared ladder) ─────────────────
  const advanceStatus = useCallback(async (order: KdsOrder) => {
    const nextStatus = nextKdsStatus(order.status);
    if (!nextStatus) return;
    try {
      await updateKdsStatusScoped(sessionToken, order.id, nextStatus);
      if (nextStatus === 'ready') {
        speak(`${requiredLocalized(l10n, 'kds-order-up-tts')} ${order.display_number} ${requiredLocalized(l10n, 'kds-ready-tts')}!`);
      }
      setActionError(null);
    } catch (e) {
      console.error('ExpoScreen advance failed', e);
      setActionError(l10nErrorMessage(e, l10n, 'kds-error-update-failed'));
    }
  }, [sessionToken, speak, l10n]);

  const advanceItemStatus = useCallback(async (item: KdsLineItem) => {
    const nextStatus = nextKdsStatus(item.item_status);
    if (!nextStatus) return;
    try {
      await updateKdsLineItemStatusScoped(sessionToken, item.id, nextStatus);
      if (nextStatus === 'ready') {
        speak(`${requiredLocalized(l10n, 'kds-order-up-tts')} ${item.display_name} ${requiredLocalized(l10n, 'kds-ready-tts')}!`);
      }
    } catch {
      // Silent — the next poll refresh replaces the board anyway.
    }
  }, [sessionToken, speak, l10n]);

  // Recall: put a wrongly-served ticket back on the pass. This is a BACKWARD
  // transition (served → ready) that the forward-only UI ladder never emits;
  // see the file header's stamped limitation.
  const restoreOrder = useCallback(async (order: KdsOrder) => {
    if (recallBusy.has(order.id)) return;
    setRecallBusy((prev) => {
      const next = new Set(prev);
      next.add(order.id);
      return next;
    });
    try {
      await updateKdsStatusScoped(sessionToken, order.id, 'ready');
      await load();
      setActionError(null);
    } catch (e) {
      console.error('ExpoScreen recall failed', e);
      setActionError(l10nErrorMessage(e, l10n, 'kds-expo-recall-failed'));
    } finally {
      setRecallBusy((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  }, [sessionToken, recallBusy, load, l10n]);

  // ── Recall dialog chrome (focus trap + Escape) ────────────────────
  const recallRef = useRef<HTMLDivElement>(null);
  const closeRecall = useCallback(() => setRecallOpen(false), []);
  useFocusTrap(recallRef, recallOpen, closeRecall);

  const bannerError = loadError ?? actionError;
  const stationName = (zone: string | null): string =>
    zone ?? requiredLocalized(l10n, 'kds-expo-no-station');

  const renderContent = () => {
    if (initialLoading) {
      return (
        <LoadingStatus className="kds-expo-loading" label={requiredLocalized(l10n, 'kds-loading')}>
          <div className="kds-expo-stations">
            <div className="kds-expo-station" />
          </div>
        </LoadingStatus>
      );
    }
    if (stations.length === 0) {
      // EMPTY-04: a station filter that removed everything must not claim
      // the board itself is empty.
      return (
        <p className="kds-expo-empty" role="status">
          <Localized id={station === '' ? 'kds-no-orders' : 'kds-no-orders-filtered'}>
            <span>{station === '' ? 'No orders yet' : 'No orders in this status'}</span>
          </Localized>
        </p>
      );
    }
    return (
      <div className="kds-expo-stations" role="region" aria-label={requiredLocalized(l10n, 'kds-expo-board-aria')}>
        {stations.map((column) => {
          const columnReady = readyToServe(column.orders).length;
          return (
            <section
              key={column.zone ?? '__none__'}
              className="kds-expo-station"
              aria-label={stationName(column.zone)}
              data-testid={column.zone ? `kds-expo-station-${column.zone}` : 'kds-expo-station-none'}
            >
              <header className="kds-expo-station-header">
                <h2 className="kds-expo-station-name">{stationName(column.zone)}</h2>
                <span className="kds-expo-station-meta">
                  <Localized id="kds-column-count" vars={{ count: column.orders.length }}>
                    <span>{column.orders.length}</span>
                  </Localized>
                </span>
                {columnReady > 0 && (
                  <span
                    className="kds-expo-station-ready"
                    aria-label={requiredLocalized(l10n, 'kds-expo-ready-ratio-aria', {
                      ready: columnReady,
                      total: column.orders.length,
                    })}
                    data-testid={`kds-expo-station-ready-${column.zone ?? 'none'}`}
                  >
                    {`${columnReady}/${column.orders.length}`}
                  </span>
                )}
              </header>
              {column.orders.map((order) => {
                const isReady = order.status === 'ready';
                return (
                  <div
                    key={order.id}
                    className={`kds-expo-ticket-slot${isReady ? ' kds-expo-ticket-slot--ready' : ''}`}
                    data-testid={`kds-expo-slot-${order.display_number ?? order.id}`}
                  >
                    <KdsTicketCard
                      order={order}
                      onAdvance={advanceStatus}
                      showOrderId={true}
                      showTableNumber={true}
                      sessionToken={sessionToken}
                      onAdvanceItem={advanceItemStatus}
                    />
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    );
  };

  return (
    <KdsCardColorsProvider>
      <div className="kds-expo" role="region" aria-label={requiredLocalized(l10n, 'kds-expo-screen-aria')}>
        <div className="kds-expo-header">
          <button
            type="button"
            className="kds-expo-back"
            onClick={goToWorkspacePicker}
            aria-label={requiredLocalized(l10n, 'kds-back-aria')}
            data-testid="kds-expo-back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="kds-expo-title">
            <Localized id="kds-expo-title"><span>Expo</span></Localized>
          </h1>
          <button
            type="button"
            className="kds-expo-station-btn"
            onClick={() => setStationPickerOpen(true)}
            aria-label={requiredLocalized(l10n, 'kds-expo-station-button-aria')}
            data-testid="kds-expo-station-open"
          >
            <span className="kds-expo-station-btn-name">
              {station === ''
                ? <Localized id="kds-expo-station-all"><span>All stations</span></Localized>
                : station}
            </span>
            <span className="kds-expo-station-btn-caret" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h12l-6 7z" /></svg>
            </span>
          </button>
          <button
            type="button"
            className="kds-expo-recall-btn"
            onClick={() => setRecallOpen(true)}
            aria-label={
              recallable.length > 0
                ? requiredLocalized(l10n, 'kds-expo-recall-count-aria', { count: recallable.length })
                : requiredLocalized(l10n, 'kds-expo-recall-aria')
            }
            data-testid="kds-expo-recall-open"
          >
            <Localized id="kds-expo-recall"><span>Recall</span></Localized>
            {recallable.length > 0 && (
              <span className="kds-expo-recall-badge" aria-hidden="true">
                {recallable.length > 99 ? '99+' : recallable.length}
              </span>
            )}
          </button>
        </div>

        {/* Ready-to-serve pass strip — polite live region so arriving
            completions are announced without stealing the alert role. */}
        {readyOrders.length > 0 && (
          <div className="kds-expo-ready-strip" role="status" data-testid="kds-expo-ready-strip">
            <Localized id="kds-expo-ready-banner" vars={{ count: readyOrders.length }}>
              <span>{`${readyOrders.length} ready to serve`}</span>
            </Localized>
          </div>
        )}

        {bannerError && (
          <div className="kds-expo-error-banner" role="alert" data-testid="kds-expo-error">
            <span className="kds-expo-error-text">{bannerError}</span>
            <button
              type="button"
              className="kds-expo-error-retry"
              onClick={() => {
                setActionError(null);
                void load();
              }}
              aria-label={requiredLocalized(l10n, 'kds-error-retry-aria')}
              data-testid="kds-expo-error-retry"
            >
              <Localized id="kds-offline-retry"><span>Retry</span></Localized>
            </button>
          </div>
        )}

        {renderContent()}

        {/* ── Station selector (dedicated station view entry point) ── */}
        <StationSelectorModal
          isOpen={stationPickerOpen}
          options={stationOptions}
          selected={station}
          onSelect={changeStation}
          onClose={() => setStationPickerOpen(false)}
        />

        {/* ── Recall dialog ─────────────────────────────────────────── */}
        {recallOpen && (
          <div
            className="kds-expo-modal-backdrop"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeRecall();
            }}
            onKeyDown={(e) => { if (e.key === 'Escape') closeRecall(); }}
          >
            <div
              ref={recallRef}
              className="kds-expo-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="kds-expo-recall-title"
              aria-describedby="kds-expo-recall-hint"
              data-testid="kds-expo-recall-dialog"
            >
              <h2 className="kds-expo-modal-title" id="kds-expo-recall-title">
                <Localized id="kds-expo-recall-title"><span>Recently served</span></Localized>
              </h2>
              <p className="kds-expo-modal-hint" id="kds-expo-recall-hint">
                <Localized id="kds-expo-recall-hint" vars={{ minutes: RECALL_WINDOW_MS / 60_000 }}>
                  <span>Tickets served in the last 15 minutes can be brought back to the pass.</span>
                </Localized>
              </p>
              {recallable.length === 0 ? (
                <p className="kds-expo-recall-empty" role="status">
                  <Localized id="kds-expo-recall-empty"><span>No tickets served recently</span></Localized>
                </p>
              ) : (
                <ul className="kds-expo-recall-list">
                  {recallable.map((order) => {
                    const busy = recallBusy.has(order.id);
                    const minutes = minutesSinceServed(order, nowMs);
                    return (
                      <li key={order.id} className="kds-expo-recall-row">
                        <span className="kds-expo-recall-row-main">
                          <span className="kds-expo-recall-order">{`#${order.display_number ?? order.id.slice(0, 8)}`}</span>
                          {order.table_number && (
                            <span className="kds-expo-recall-table">{order.table_number}</span>
                          )}
                          <span className="kds-expo-recall-station">{stationName(order.kitchen_zone)}</span>
                        </span>
                        <span className="kds-expo-recall-summary">{order.items_summary}</span>
                        <span className="kds-expo-recall-ago">
                          {minutes < 1
                            ? requiredLocalized(l10n, 'kds-time-ago-now')
                            : requiredLocalized(l10n, 'kds-time-ago', { minutes })}
                        </span>
                        <button
                          type="button"
                          className="kds-expo-recall-restore"
                          onClick={() => { void restoreOrder(order); }}
                          disabled={busy}
                          aria-busy={busy}
                          aria-label={requiredLocalized(l10n, 'kds-expo-recall-restore-aria', { number: order.display_number ?? 0 })}
                          data-testid={`kds-expo-recall-restore-${order.id}`}
                        >
                          <Localized id="kds-expo-recall-restore"><span>Bring back</span></Localized>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="kds-expo-modal-actions">
                <button
                  type="button"
                  className="kds-expo-btn kds-expo-btn--muted"
                  onClick={closeRecall}
                  aria-label={requiredLocalized(l10n, 'kds-expo-recall-close-aria')}
                  data-testid="kds-expo-recall-close"
                >
                  <Localized id="kds-confirm-cancel"><span>Cancel</span></Localized>
                </button>
              </div>
            </div>
          </div>
        )}

        <KdsScreenFooter />
      </div>
    </KdsCardColorsProvider>
  );
}
