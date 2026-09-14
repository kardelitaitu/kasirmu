import { useEffect, useState, useCallback, useMemo, useRef, Profiler } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useSwipe } from '@/hooks/useSwipe';
import { useKdsOffline } from '@/hooks/useKdsOffline';
import { useWorkspaceScope, useWorkspace } from '@/contexts/WorkspaceContext';
import { getKdsQueueScoped, updateKdsStatusScoped, updateKdsOrderItemsScoped, updateKdsLineItemStatusScoped, getKdsOrderLinesScoped, type KdsOrder, type KdsLineItem, type CreateKdsLineItemInput } from '@/api/kds';
import { useKdsPreferences } from '@/features/kds/hooks/useKdsPreferences';
import { useNewTicketSound } from '@/features/kds/hooks/useNewTicketSound';
import { useKdsFilterNav } from '@/features/kds/useKdsFilterNav';
import { useKdsShortcuts } from '@/features/kds/useKdsShortcuts';
import { useKdsTabIndicator } from '@/features/kds/useKdsTabIndicator';
import { useKdsRealtime } from '@/features/kds/useKdsRealtime';
import type { SlaThresholds } from '@/features/kds/hooks/useTicketSla';
import { useSound } from '@/frontend/shared/useSound';
import { requiredLocalized } from '@/frontend/shared';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { KdsCardColorsProvider } from '@/features/kds/KdsCardColorsContext';
import { type KdsSettings, DEFAULT_SETTINGS } from '@/features/kds/kdsSettingsModel';
import { KdsHeaderLeft } from '@/features/kds/components/KdsHeaderLeft';
import { KdsHeaderRight } from '@/features/kds/components/KdsHeaderRight';
import { KdsHeaderTabs } from '@/features/kds/components/KdsHeaderTabs';
import { KdsNoticeBanners } from '@/features/kds/components/KdsNoticeBanners';
import { KdsZoneChips } from '@/features/kds/components/KdsZoneChips';
import { KdsMainContent } from '@/features/kds/components/KdsMainContent';
import { KdsProductPickerModal } from '@/features/kds/components/KdsProductPickerModal';
import type { ProductPickerResult } from '@/features/kds/components/KdsProductPickerModal';
import { KdsEnrollmentModal } from '@/features/kds/components/KdsEnrollmentModal';
import { KdsScreenFooter } from '@/features/kds/KdsScreenFooter';
import { nextKdsStatus } from '@/features/kds/kdsStatus';
import { isAutoAckEligible } from '@/features/kds/kdsAutoAccept';
import { sameOrders } from '@/features/kds/kdsOrdersDiff';
import './KdsScreen.css';

/** Props passed to every KDS layout component. */
export interface KdsLayoutProps {
  orders: KdsOrder[];
  onAdvance: (order: KdsOrder) => void;
  showOrderId: boolean;
  showTableNumber: boolean;
  /** Currently keyboard-selected order ID (highlighted card). */
  selectedOrderId: string | null;
  /** Called when the items on a ticket are edited. */
  onSaveItems?: (orderId: string, itemsSummary: string, itemCount: number) => void;
  /** Session token for scoped API calls (e.g., fetching line items). */
  sessionToken: string;
  /** Called when a single line item is tapped to advance its status (TODO 3e). */
  onAdvanceItem?: (item: KdsLineItem) => void;
  /** Called to open the product picker for adding items to a KDS order (TODO 3f). */
  onAddItems?: (orderId: string) => void;
  /** Set of order IDs that just arrived — used for brief highlight animation. */
  newOrderIds: ReadonlySet<string>;
  /** SLA thresholds for the escalation colours (settings panel sliders). */
  slaThresholds?: SlaThresholds;
}

/** KDS (Kitchen Display System) screen — real-time order queue in a single masonry view, with Open/Completed tabs and per-user preferences. */
export default function KdsScreen() {
  const workspaceScope = useWorkspaceScope();
  const { l10n } = useLocalization();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { sessionToken: rawToken, terminalId } = useWorkspace();
  const sessionToken = rawToken || '';
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [settings, setSettings] = useState<KdsSettings>(DEFAULT_SETTINGS);
  // H3: the offline banner's × previously cleared `error` (the other
  // banner) — a no-op. This flag gates the offline banner and resets as
  // soon as connectivity returns.
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  /** Open vs Completed view — the prototype's primary tab navigation. */
  const [activeTab, setActiveTab] = useState<'open' | 'completed'>('open');
  const [initialLoading, setInitialLoading] = useState(true);
  // Filter dropdown — view mode (All / Prepared) matching the prototype filter.
  const [filterMode, setFilterMode] = useState<'all' | 'prepared'>('all');
  const [filterCats, setFilterCats] = useState<Set<string> | null>(null);
  const [completedFilter, setCompletedFilter] = useState<'all' | 'dinein' | 'takeaway'>('all');
  const [showFilter, setShowFilter] = useState(false);
  // 3f: Product picker state — which order is being edited.
  const [pickerOrderId, setPickerOrderId] = useState<string | null>(null);
  // KDS device enrollment modal state.
  const [showEnrollment, setShowEnrollment] = useState(false);
  const pickerSavingRef = useRef(false);
  const [pickerSaving, setPickerSaving] = useState(false);
  // Shift state — tracks whether the kitchen shift is active.
  const [inShift, setInShift] = useState(false);
  // Card animations toggle — when false, adds body.no-anim to suppress spawn/move animations.
  const [cardAnimations, setCardAnimations] = useState(true);
  // Apply no-anim class to body when animations are disabled.
  useEffect(() => {
    document.body.classList.toggle('no-anim', !cardAnimations);
    return () => { document.body.classList.remove('no-anim'); };
  }, [cardAnimations]);
  // Confirm modal state — generic confirmation dialog for destructive actions.
  const [confirm, setConfirm] = useState<{ title: string; message: string; onOk: () => void; danger?: boolean } | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  useFocusTrap(confirmRef, confirm !== null, closeConfirm);
  const { prefs, setShowOrderId, setShowTableNumber, setAutoAcknowledge, setKdsZone, loading: prefsLoading } = useKdsPreferences();

  // Track previous order IDs for new-ticket arrival animation.
  const prevOrderIdsRef = useRef(new Set<string>());
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 3b: Offline resilience — cache, retry queue, optimistic updates.
  // OFF-07: the hook namespaces all localStorage by store scope so switching
  // stores on a shared terminal never leaks orders or queued mutations.
  const {
    online, pendingQueueLength, deadLetterLength,
    wrapFetch, wrapUpdate, retryPending, clearDeadLetter, requeueDeadLetter,
    forceRetryCounter, storageUnavailable,
  } = useKdsOffline(workspaceScope?.storeId);

  // P3-2: Chime when new tickets arrive (debounced to max 1 per 5s).
  useNewTicketSound(orders, settings.soundEnabled);
  const { speak, setSoundEnabled } = useSound();

  // The KDS sound preference drives the GLOBAL mute: SLA escalation
  // alerts (each card's own useSound instance) and TTS callouts route
  // through separate hook instances that previously never saw this
  // toggle, so a muted kitchen still got red-escalation sirens.
  useEffect(() => {
    setSoundEnabled(settings.soundEnabled);
  }, [setSoundEnabled, settings.soundEnabled]);

  // Re-show the offline banner after the next disconnection once
  // connectivity is restored.
  useEffect(() => {
    if (online) setOfflineDismissed(false);
  }, [online]);

  // PERF-KDS-01: the pending-queue length is only read inside the post-fetch
  // flush, never rendered from `fetchOrders`. Keeping it in a ref (instead of
  // the callback's dependency list) is what stops every queue mutation from
  // re-creating `fetchOrders` and therefore re-running the subscribe effect.
  const pendingQueueLengthRef = useRef(pendingQueueLength);
  pendingQueueLengthRef.current = pendingQueueLength;

  const fetchOrders = useCallback(async () => {
    const zone = prefs.kdsZone || undefined;
    const { orders: fetchedOrders, fromCache } = await wrapFetch(() =>
      getKdsQueueScoped(sessionToken, zone),
    );
    const activeStoreId = workspaceScope?.storeId;
    let filtered = fetchedOrders;
    if (activeStoreId) {
      filtered = fetchedOrders.filter((order) =>
        !order.store_id || order.store_id === activeStoreId,
      );
    }
    // A cancelled ticket is terminal history — it must never surface on
    // the active kitchen board (it would only show in the history panel).
    filtered = filtered.filter((order) => order.status !== 'cancelled');

    // Track new ticket IDs for arrival animation.
    const currentIds = new Set(filtered.map((o) => o.id));
    const arrivedIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevOrderIdsRef.current.has(id)) {
        arrivedIds.add(id);
      }
    }
    prevOrderIdsRef.current = currentIds;
    if (arrivedIds.size > 0) {
      setNewOrderIds(arrivedIds);
      // Clear the arrival highlight after 3s.
      if (arrivalTimerRef.current !== null) clearTimeout(arrivalTimerRef.current);
      arrivalTimerRef.current = setTimeout(() => setNewOrderIds(new Set()), 3000);
    }

    // PERF-KDS-01: replace the board only when the payload actually differs.
    // The kitchen board re-fetches on every `kds:orders-changed` push, and an
    // unconditional setOrders re-rendered every ticket card (each of which
    // runs a 1 Hz SLA timer) even when nothing changed.
    setOrders((prev) => (sameOrders(prev, filtered) ? prev : filtered));
    setInitialLoading(false);

    // On reconnect (fetch succeeded, not from cache), flush pending queue.
    if (!fromCache && pendingQueueLengthRef.current > 0) {
      retryPending(async (action) => {
        try {
          await updateKdsStatusScoped(sessionToken, action.orderId, action.targetStatus);
          // Voice callout if reconnected action targeted 'ready'.
          if (action.targetStatus === 'ready') {
            speak(`${requiredLocalized(l10n, 'kds-order-up-tts')} ${requiredLocalized(l10n, 'kds-ready-tts')}!`);
          }
          return true;
        } catch {
          return false;
        }
      });
    }
  }, [sessionToken, workspaceScope?.storeId, prefs.kdsZone, wrapFetch, retryPending, speak, l10n]);

  // PERF-KDS-01 / 1a (extracted): the whole realtime subscription block — the
  // `fetchOrdersRef` indirection (each subscription rebuild costs two WebView2
  // IPC round trips, so the ref must stay), the kds:orders-changed subscribe,
  // the visibilitychange fallback and their one unmount cleanup.
  useKdsRealtime({ fetchOrders, arrivalTimerRef });

  const clearError = useCallback(() => setError(null), []);

  const advanceStatus = useCallback(async (order: KdsOrder) => {
    const nextStatus = nextKdsStatus(order.status);
    if (!nextStatus) return;

    // 3b: Offline-aware status update — queue on failure + optimistic local update.
    const ok = await wrapUpdate(order.id, nextStatus, () =>
      updateKdsStatusScoped(sessionToken, order.id, nextStatus),
    );

    if (ok) {
      // 3d: Voice callout when a ticket hits 'ready' — "Order 42 up!"
      if (nextStatus === 'ready') {
        speak(`${requiredLocalized(l10n, 'kds-order-up-tts')} ${order.display_number} ${requiredLocalized(l10n, 'kds-ready-tts')}!`);
      }
      // No manual fetchOrders() — the kds:orders-changed event triggers a refresh.
    } else {
      // Optimistic update: advance locally so the kitchen can keep working.
      setOrders((prev) => prev.map((o) =>
        o.id === order.id ? { ...o, status: nextStatus } : o,
      ));
      // Show a user-friendly banner instead of raw error.
      setError(requiredLocalized(l10n, 'kds-offline-queued-update'));
    }
  }, [sessionToken, speak, l10n, wrapUpdate]);

  // ── Per-item status advance (TODO 3e) ──────────────────────────
  const advanceItemStatus = useCallback(async (item: KdsLineItem) => {
    // ITEM_STATUS_ORDER used to be re-declared here as a fresh array literal on every
    // call; the item ladder is the same progression as the ticket ladder, so it now
    // shares nextKdsStatus instead of duplicating it.
    const nextStatus = nextKdsStatus(item.item_status);
    if (!nextStatus) return;

    try {
      await updateKdsLineItemStatusScoped(sessionToken, item.id, nextStatus);
      // 3d: Voice callout when an item hits 'ready'.
      if (nextStatus === 'ready') {
        speak(`${requiredLocalized(l10n, 'kds-order-up-tts')} ${item.display_name} ${requiredLocalized(l10n, 'kds-ready-tts')}!`);
      }
    } catch {
      // Silent — the backend will emit kds:orders-changed on next poll.
    }
  }, [sessionToken, speak, l10n]);

  // OFF-04: reconnect is a first-class transition. When the OS fires an
  // `online` event the hook bumps forceRetryCounter; we turn that into a
  // bounded fetch/probe cycle. The probe succeeds only if the backend is
  // reachable, and the post-fetch flush replays any queued actions.
  const reconnectRef = useRef(false);
  useEffect(() => {
    if (forceRetryCounter === 0) return;
    // Serialize: skip if a fetch/retry is already in flight.
    if (reconnectRef.current) return;
    reconnectRef.current = true;
    void fetchOrders().finally(() => {
      reconnectRef.current = false;
    });
  }, [forceRetryCounter, fetchOrders]);

  // 1c: Auto-accept — when enabled, advance pending tickets to
  // preparing after acknowledgeDelayMin minutes without manual tap.
  // Must be placed AFTER advanceStatus declaration to avoid TDZ errors.
  // An in-flight set guards against double-fire: this effect re-runs on
  // every board refresh, and before the backend event replaces `orders`
  // the same still-pending ticket would be advanced again (each duplicate
  // replay used to overwrite the ticket's started_at on the backend).
  const autoAckInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!prefs.autoAcknowledge || prefs.acknowledgeDelayMin <= 0) return;

    const now = Date.now();

    for (const order of orders) {
      if (!isAutoAckEligible(order, autoAckInFlightRef.current, prefs, now)) continue;
      autoAckInFlightRef.current.add(order.id);
      // Fire-and-forget — advance silently without awaiting.
      void advanceStatus(order).finally(() => {
        autoAckInFlightRef.current.delete(order.id);
      });
    }
  }, [orders, prefs.autoAcknowledge, prefs.acknowledgeDelayMin, advanceStatus, prefs]);

  // Reset ephemeral dropdown zone selection when the persistent zone preference changes.
  useEffect(() => {
    setFilterCats(null);
  }, [prefs.kdsZone]);

  // 3a: Extract unique kitchen zones from orders for the zone-switching chips and filter grid.
  const zones = useMemo(() => {
    const zoneSet = new Set<string>();
    for (const order of orders) {
      if (order.kitchen_zone) zoneSet.add(order.kitchen_zone);
    }
    return [...zoneSet].sort();
  }, [orders]);

  // Filtered orders: All = all open orders; Prepared = only ready orders; Categories = zone filter.
  const filteredOrders = useMemo(() => {
    if (filterMode === 'prepared') return orders.filter((o) => o.status === 'ready');
    if (filterCats && filterCats.size > 0) {
      return orders.filter((o) => o.kitchen_zone && filterCats.has(o.kitchen_zone));
    }
    return orders;
  }, [orders, filterMode, filterCats]);

  // H3: the settings sliders are now wired — thresholds flow into every
  // card's useTicketSla. Memoized so KdsTicketCard's memo still holds when
  // unrelated state re-renders the screen.
  const slaThresholds = useMemo<SlaThresholds>(() => ({
    yellowAtSec: settings.yellowThresholdMin * 60,
    redAtSec: settings.redThresholdMin * 60,
  }), [settings.yellowThresholdMin, settings.redThresholdMin]);

  // KEY-07 (extracted): the board keyboard cluster - deselect-on-filter, the
  // mount autofocus and the document-level keydown handler with its editable +
  // modal guards. kdsRef comes back OUT because the region below binds it; the
  // selection state itself stays page-level (the layout props and render read it).
  const { kdsRef } = useKdsShortcuts({
    filteredOrders,
    selectedOrderId,
    setSelectedOrderId,
    advanceStatus,
  });

  // P7-3: Pull-to-refresh gesture on KDS ticket board
  const { containerProps: pullRefreshProps, state: pullState, pullDistance } = usePullToRefresh({
    onRefresh: fetchOrders,
  });

  // Swipe gesture between Open and Completed tabs (Android launcher pager feel)
  const swipeProps = useSwipe(
    {
      onSwipeLeft: () => {
        if (activeTab === 'open') setActiveTab('completed');
      },
      onSwipeRight: () => {
        if (activeTab === 'completed') setActiveTab('open');
      },
    },
    { minDistance: 60, maxTimeMs: 400 },
  );

  // KEY-07 (extracted): the roving-tabindex trio — zone-chip tablist, filter
  // popover listbox and the popover trigger — plus the popover's Escape /
  // outside-click dismiss. The three refs come back OUT because the markup that
  // binds them (KdsZoneChips / KdsHeaderLeft) is rendered here.
  const {
    zoneTabRefs,
    filterBtnRef,
    filterPanelRef,
    handleZoneTablistKeyDown,
    handleFilterPanelKeyDown,
    handleFilterBtnKeyDown,
  } = useKdsFilterNav({ zones, setKdsZone, showFilter, setShowFilter });

  // TAB-01 (extracted): the pill's measure + animate pair and its resize re-measure.
  // The four refs come back OUT because the tab markup binds them -- it now lives in
  // components/KdsHeaderTabs.tsx, which receives them as props. The call stays here on
  // purpose: React flushes child effects before parent effects, so moving it into that
  // component would re-order these two effects against the screen's own sequence.
  const { tabIndicator, tabsTrackRef, tabOpenRef, tabCompletedRef, tabIndicatorRef } =
    useKdsTabIndicator({ activeTab, orderCount: orders.length });

  // PERF-KDS-01: stable identity so `KdsTicketCard`'s memo actually holds.
  // An inline arrow here changed on every KdsScreen render, which invalidated
  // every card's props and re-rendered the whole board.
  const handleSaveItems = useCallback(async (orderId: string, itemsSummary: string, itemCount: number) => {
    try {
      await updateKdsOrderItemsScoped(sessionToken, { id: orderId, items_summary: itemsSummary, item_count: itemCount });
    } catch (e) {
      // Localized generic message in the role="alert" banner; raw detail to
      // the console for diagnosis (unlocalized internal error text must not
      // render to the operator).
      console.error('updateKdsOrderItems failed', e);
      setError(requiredLocalized(l10n, 'kds-error-update-failed'));
    }
  }, [sessionToken, l10n]);

  const boardFiltered = activeTab === 'completed'
    ? completedFilter !== 'all'
    : (filterMode === 'prepared' || (filterCats !== null && filterCats.size > 0));

  return (
    <KdsCardColorsProvider>
    <Profiler id="KdsScreen" onRender={(...args) => {
      if (typeof args[2] === 'number' && args[2] > 1) {
        console.debug('[Profiler] KdsScreen', args[1] === 'mount' ? '⚡mount' : '♻update', `${args[2].toFixed(1)}ms`);
      }
    }}>
    <div ref={kdsRef} className="kds" tabIndex={-1} role="region" aria-label={requiredLocalized(l10n, 'kds-screen-aria')}>
      {/* A11Y: non-visual announcement of arriving tickets — the chime and
          the 3s visual highlight are both invisible to screen reader users.
          Polite so it never collides with the role="alert" banners below. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="kds-new-orders-live">
        {newOrderIds.size > 0 && (
          <Localized id="kds-new-orders-announced" vars={{ count: newOrderIds.size }}>
            {`${newOrderIds.size} new orders`}
          </Localized>
        )}
      </div>
      <div className="kds-header">
      <KdsHeaderLeft
        zones={zones}
        boardFiltered={boardFiltered}
        filterBtnRef={filterBtnRef}
        filterPanelRef={filterPanelRef}
        activeTab={activeTab}
        showFilter={showFilter}
        setShowFilter={setShowFilter}
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        filterCats={filterCats}
        setFilterCats={setFilterCats}
        completedFilter={completedFilter}
        setCompletedFilter={setCompletedFilter}
        goToWorkspacePicker={goToWorkspacePicker}
        handleFilterBtnKeyDown={handleFilterBtnKeyDown}
        handleFilterPanelKeyDown={handleFilterPanelKeyDown}
      />

        <KdsHeaderTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          openCount={filteredOrders.length}
          tabIndicator={tabIndicator}
          tabsTrackRef={tabsTrackRef}
          tabOpenRef={tabOpenRef}
          tabCompletedRef={tabCompletedRef}
          tabIndicatorRef={tabIndicatorRef}
        />

        <KdsHeaderRight
          inShift={inShift}
          setInShift={setInShift}
          setConfirm={setConfirm}
          sessionToken={sessionToken}
          setShowEnrollment={setShowEnrollment}
          prefs={prefs}
          prefsLoading={prefsLoading}
          settings={settings}
          setSettings={setSettings}
          setAutoAcknowledge={setAutoAcknowledge}
          setShowOrderId={setShowOrderId}
          setShowTableNumber={setShowTableNumber}
          cardAnimations={cardAnimations}
          setCardAnimations={setCardAnimations}
        />
      </div>

      {/* ── Zone chips — secondary filter row below the header ────── */}
      <KdsZoneChips
        zones={zones}
        activeZone={prefs.kdsZone}
        onSelectZone={setKdsZone}
        onKeyDown={handleZoneTablistKeyDown}
        zoneTabRefs={zoneTabRefs}
      />

      <KdsNoticeBanners
        error={error}
        onRetryError={() => {
          clearError();
          fetchOrders();
        }}
        onDismissError={clearError}
        storageUnavailable={storageUnavailable}
        deadLetterLength={deadLetterLength}
        onRetryDeadLetter={() => {
          // OFF-05: requeue the dead-lettered actions into the pending
          // queue (preserving operator intent), then flush the queue.
          // The dismiss (×) button is the explicit "discard" path.
          requeueDeadLetter();
          retryPending(async (action) => {
            try {
              await updateKdsStatusScoped(sessionToken, action.orderId, action.targetStatus);
              return true;
            } catch {
              return false;
            }
          });
        }}
        onClearDeadLetter={clearDeadLetter}
        online={online}
        offlineDismissed={offlineDismissed}
        pendingQueueLength={pendingQueueLength}
        onRetryPending={() => {
          retryPending(async (action) => {
            try {
              await updateKdsStatusScoped(sessionToken, action.orderId, action.targetStatus);
              return true;
            } catch {
              return false;
            }
          });
          // The backend will emit kds:orders-changed on success,
          // which triggers fetchOrders via the event listener.
        }}
        onDismissOffline={() => setOfflineDismissed(true)}
      />

      {/* P7-3: Pull-to-refresh indicator */}
      {pullState !== 'idle' && (
        <div
          className="kds-pull-indicator"
          style={{
            transform: `translateY(${pullDistance}px)`,
            opacity: Math.min(1, pullDistance / 60),
          }}
        >
          {pullState === 'loading' && <span className="kds-refresh-spinner" />}
          {pullState === 'pulling' && <Localized id="kds-pull-to-refresh">Pull down to refresh</Localized>}
          {pullState === 'ready' && <Localized id="kds-release-to-refresh">Release to refresh</Localized>}
        </div>
      )}

      {/* ── Main content: loading skeleton, history panel, or layout ── */}
      <KdsMainContent
        initialLoading={initialLoading}
        activeTab={activeTab}
        settings={settings}
        prefs={prefs}
        pullRefreshProps={pullRefreshProps}
        swipeProps={swipeProps}
        filteredOrders={filteredOrders}
        boardFiltered={boardFiltered}
        onAdvance={advanceStatus}
        onAdvanceItem={advanceItemStatus}
        onSaveItems={handleSaveItems}
        onAddItems={setPickerOrderId}
        onReopen={() => setActiveTab('open')}
        selectedOrderId={selectedOrderId}
        sessionToken={sessionToken}
        newOrderIds={newOrderIds}
        slaThresholds={slaThresholds}
        completedFilter={completedFilter}
      />

      {/* 3f: Product picker modal for adding items mid-preparation */}
      <KdsProductPickerModal
        orderId={pickerOrderId ?? ''}
        sessionToken={sessionToken}
        isOpen={pickerOrderId !== null}
        pending={pickerSaving}
        onConfirm={async (result: ProductPickerResult) => {
          // Ignore re-entry while a confirm merge is in flight (double-tap).
          if (pickerSavingRef.current) return;
          pickerSavingRef.current = true;
          setPickerSaving(true);
          try {
            // Re-fetch existing line items to merge with new ones.
            const existing = await getKdsOrderLinesScoped(sessionToken, result.orderId);
            const mergedItems: CreateKdsLineItemInput[] = [
              ...existing.map((item) => ({
                sku: item.sku,
                display_name: item.display_name,
                qty: item.qty,
                course: item.course,
                modifiers: item.modifiers,
              })),
              ...result.items,
            ];
            await updateKdsOrderItemsScoped(sessionToken, {
              id: result.orderId,
              items_summary: '', // ignored — will be re-derived from line_items
              item_count: 0,     // ignored — will be re-derived from line_items
              line_items: mergedItems,
            });
          } catch (e) {
            console.error('picker merge failed', e);
            setError(requiredLocalized(l10n, 'kds-error-update-failed'));
          } finally {
            pickerSavingRef.current = false;
            setPickerSaving(false);
            setPickerOrderId(null);
          }
        }}
        onClose={() => setPickerOrderId(null)}
      />

      {/* KDS device enrollment modal */}
      <KdsEnrollmentModal
        sessionToken={sessionToken}
        restaurantPosId={terminalId}
        isOpen={showEnrollment}
        onEnrolled={() => {
          setShowEnrollment(false);
        }}
        onClose={() => setShowEnrollment(false)}
      />

      {/* Screen footer status bar */}
      <KdsScreenFooter />

      {/* Confirm modal — prototype .kds-modal-backdrop */}
      {confirm && (
        <div
          className="kds-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirm(null);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirm(null); }}
        >
          <div className="kds-modal-anchor">
            <div ref={confirmRef} className="kds-modal" role="dialog" aria-modal="true" aria-labelledby="kds-confirm-title" aria-describedby="kds-confirm-msg">
              <h2 className="kds-modal-title" id="kds-confirm-title">{confirm.title}</h2>
              <p className="kds-modal-msg" id="kds-confirm-msg">{confirm.message}</p>
              <div className="kds-modal-actions">
                <button className="kds-btn kds-btn--muted" type="button" onClick={() => setConfirm(null)} data-testid="kds-confirm-cancel">
                  <Localized id="kds-confirm-cancel">Cancel</Localized>
                </button>
                <button
                  className={`kds-btn${confirm.danger ? ' danger' : ''}`}
                  type="button"
                  onClick={() => { confirm.onOk(); setConfirm(null); }}
                  data-testid="kds-confirm-ok"
                >
                  <Localized id="kds-confirm-ok">Confirm</Localized>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </Profiler>
    </KdsCardColorsProvider>
  );
}
