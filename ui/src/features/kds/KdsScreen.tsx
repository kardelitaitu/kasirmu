import { useEffect, useState, useCallback, useMemo, useRef, Profiler } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { listen } from '@/api/tauri';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useSwipe } from '@/hooks/useSwipe';
import { useKdsOffline } from '@/hooks/useKdsOffline';
import { useWorkspaceScope, useWorkspace } from '@/contexts/WorkspaceContext';
import { getKdsQueueScoped, updateKdsStatusScoped, updateKdsOrderItemsScoped, updateKdsLineItemStatusScoped, getKdsOrderLinesScoped, type KdsOrder, type KdsLineItem, type CreateKdsLineItemInput } from '@/api/kds';
import { useKdsPreferences } from '@/features/kds/hooks/useKdsPreferences';
import { useNewTicketSound } from '@/features/kds/hooks/useNewTicketSound';
import type { SlaThresholds } from '@/features/kds/hooks/useTicketSla';
import { useSound } from '@/frontend/shared/useSound';
import { requiredLocalized, LoadingStatus } from '@/frontend/shared';
import { isEditableTarget } from '@/utils/isEditableTarget';
import { isAnyAriaModalOpen } from '@/utils/modal-guard';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { KdsLayoutMasonry } from '@/features/kds/KdsLayoutMasonry';
import { KdsHamburgerPanel } from '@/features/kds/KdsHamburgerPanel';
import { KdsCardColorsProvider } from '@/features/kds/KdsCardColorsContext';
import { KdsCompletedView } from '@/features/kds/KdsCompletedView';
import { type KdsSettings, DEFAULT_SETTINGS } from '@/features/kds/KdsSettingsPanel';
import { KdsProductPickerModal } from '@/features/kds/components/KdsProductPickerModal';
import type { ProductPickerResult } from '@/features/kds/components/KdsProductPickerModal';
import { KdsDeviceStatusIndicator } from '@/features/kds/components/KdsDeviceStatusIndicator';
import { KdsEnrollmentModal } from '@/features/kds/components/KdsEnrollmentModal';
import { KdsScreenFooter } from '@/features/kds/KdsScreenFooter';
import { nextKdsStatus } from '@/features/kds/kdsStatus';
import { isAutoAckEligible } from '@/features/kds/kdsAutoAccept';
import './KdsScreen.css';

/**
 * PERF-KDS-01: shallow structural comparison of two ticket boards.
 *
 * `kds:orders-changed` fires for every write anywhere in the order
 * pipeline, so most re-fetches return a payload identical to what is
 * already on screen. Replacing state unconditionally re-rendered every
 * ticket card (each running a 1 Hz SLA timer and a line-item fetch), which
 * on WebView2 saturated the PostMessage queue. Only the fields the board
 * actually renders are compared.
 */
export function sameOrders(a: KdsOrder[], b: KdsOrder[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.status !== y.status ||
      x.items_summary !== y.items_summary ||
      x.item_count !== y.item_count ||
      x.display_number !== y.display_number ||
      x.received_at !== y.received_at ||
      x.kitchen_zone !== y.kitchen_zone ||
      x.table_number !== y.table_number ||
      x.notes !== y.notes ||
      x.priority !== y.priority
    ) {
      return false;
    }
  }
  return true;
}

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
  // KEY-07: ARIA tabs pattern — zone chips get roving tabindex + arrow keys.
  const zoneTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Open/Completed tab indicator: measured from the track + active tab.
  const tabsTrackRef = useRef<HTMLDivElement>(null);
  const tabOpenRef = useRef<HTMLButtonElement>(null);
  const tabCompletedRef = useRef<HTMLButtonElement>(null);
  const tabIndicatorRef = useRef<HTMLSpanElement>(null);
  const isTabMountedRef = useRef(false);
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number }>({ left: 3, width: 0 });
  // Filter dropdown — view mode (All / Prepared) matching the prototype filter.
  const [filterMode, setFilterMode] = useState<'all' | 'prepared'>('all');
  const [filterCats, setFilterCats] = useState<Set<string> | null>(null);
  const [completedFilter, setCompletedFilter] = useState<'all' | 'dinein' | 'takeaway'>('all');
  const [showFilter, setShowFilter] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
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

  // PERF-KDS-01: the realtime subscription must not be torn down and rebuilt
  // whenever `fetchOrders` changes identity — each rebuild costs two extra
  // WebView2 IPC round trips (`plugin:event|listen` + `unlisten`), and the
  // old code re-subscribed on every fetch. The listener reads the latest
  // fetch through this ref instead.
  const fetchOrdersRef = useRef(fetchOrders);
  fetchOrdersRef.current = fetchOrders;

  // 1a: Real-time push via Tauri events — replaces adaptive polling.
  // Listens for kds:orders-changed emitted by the Rust backend after
  // order creation or status updates. Falls back to re-fetch on tab
  // visibility change to catch any events missed while hidden.
  // Subscribes exactly once per mount.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // Subscribe to real-time KDS order changes (push, not poll).
    listen<null>('kds:orders-changed', () => {
      void fetchOrdersRef.current();
    }).then((fn) => {
      // The component may already have unmounted while `listen` was in
      // flight; without this guard the subscription would leak.
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {
      /* event plugin unavailable (e.g. plain browser) — push is optional */
    });

    // Visibility change fallback — re-fetch when tab becomes visible
    // to catch any events missed while the tab was hidden.
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void fetchOrdersRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (arrivalTimerRef.current !== null) clearTimeout(arrivalTimerRef.current);
    };
  }, []);

  // Fetch whenever the query inputs change (mount, session, store, zone).
  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

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
  }, [orders, prefs.autoAcknowledge, prefs.acknowledgeDelayMin, advanceStatus]);

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

  // Deselect if currently selected order is filtered out.
  useEffect(() => {
    if (selectedOrderId && !filteredOrders.some((o) => o.id === selectedOrderId)) {
      setSelectedOrderId(null);
    }
  }, [selectedOrderId, filteredOrders]);

  // 2d: Keyboard shortcuts — number keys to select, Space to advance, Arrows/Escape to navigate.
  const kdsRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedOrderId);
  selectedRef.current = selectedOrderId;

  // Auto-focus the container on mount so keyboard shortcuts work immediately.
  useEffect(() => {
    kdsRef.current?.focus();
  }, []);

  // KEY-07: managed screen-level listener with editable + modal guards.
  // Previously the handler was bound to the root element, so shortcuts stopped
  // working whenever focus left the region. Binding to `document` (with guards)
  // keeps 1-9/Arrow/Space/Escape working regardless of where focus lands, and
  // the KDS component unmounting removes the listener.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard: never intercept while the user is typing in an editable target.
      if (isEditableTarget(e.target)) return;
      // Guard: never intercept while a modal owns the keyboard.
      if (isAnyAriaModalOpen()) return;

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < filteredOrders.length) {
          setSelectedOrderId(filteredOrders[idx]!.id);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedOrderId((prev) => {
          const currentIdx = prev ? filteredOrders.findIndex((o) => o.id === prev) : -1;
          const nextIdx = Math.min(currentIdx + 1, filteredOrders.length - 1);
          return nextIdx >= 0 ? filteredOrders[nextIdx]!.id : null;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedOrderId((prev) => {
          const currentIdx = prev ? filteredOrders.findIndex((o) => o.id === prev) : filteredOrders.length;
          const nextIdx = Math.max(currentIdx - 1, 0);
          return filteredOrders.length > 0 ? filteredOrders[nextIdx]!.id : null;
        });
      } else if (e.key === ' ' && selectedRef.current) {
        // Skip if a ticket button already has focus (its onClick will handle advance).
        if ((e.target as HTMLElement).closest('.kds-ticket')) return;
        e.preventDefault();
        const selected = filteredOrders.find((o) => o.id === selectedRef.current);
        if (selected) {
          advanceStatus(selected);
        }
      } else if (e.key === 'Escape') {
        setSelectedOrderId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredOrders, advanceStatus]);

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

  // KEY-07: ARIA tabs pattern — ArrowLeft/ArrowRight/Home/End move between the
  // zone chips (roving tabindex: the selected chip keeps tabIndex 0, others -1),
  // and the chip reached by arrow keys becomes the active zone filter.
  const handleZoneTablistKeyDown = useCallback((e: React.KeyboardEvent) => {
    const chips = zoneTabRefs.current;
    if (!chips || chips.length === 0) return;
    const current = chips.findIndex((c) => c === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowRight') {
      next = current < 0 ? 0 : (current + 1) % chips.length;
    } else if (e.key === 'ArrowLeft') {
      next = current < 0 ? chips.length - 1 : (current - 1 + chips.length) % chips.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = chips.length - 1;
    }
    if (next < 0) return;
    e.preventDefault();
    chips[next]?.focus();
    // chip 0 = "All" (zone ''), chips 1..n = zones[0..n-1]
    setKdsZone(next === 0 ? '' : (zones[next - 1] ?? ''));
  }, [zones, setKdsZone]);

  // Open/Completed tab indicator: measure the active tab button inside
  // the track and slide the blue pill to it (prototype .kds-tab-indicator).
  useEffect(() => {
    const tab = activeTab === 'open' ? tabOpenRef.current : tabCompletedRef.current;
    if (!tab) return;
    setTabIndicator({
      left: tab.offsetLeft,
      width: tab.offsetWidth,
    });
    if (isTabMountedRef.current && tabIndicatorRef.current && typeof tabIndicatorRef.current.animate === 'function') {
      /* 2-axis motion: squeeze (narrow+short) mid-flight → overshoot on landing → settle */
      tabIndicatorRef.current.animate([
        { transform: 'scale(1, 1)' },
        { transform: 'scale(0.82, 0.85)', offset: 0.45 },
        { transform: 'scale(1.08, 1.18)', offset: 0.85 },
        { transform: 'scale(1, 1)' },
      ], { duration: 340, easing: 'ease-in-out' });
    }
    isTabMountedRef.current = true;
  }, [activeTab]);

  useEffect(() => {
    const updateIndicator = () => {
      const tab = activeTab === 'open' ? tabOpenRef.current : tabCompletedRef.current;
      if (!tab) return;
      setTabIndicator({
        left: tab.offsetLeft,
        width: tab.offsetWidth,
      });
    };
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeTab, orders.length]);

  // Filter dropdown: close on outside click and Escape.
  useEffect(() => {
    if (!showFilter) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFilter(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node) &&
        filterBtnRef.current && !filterBtnRef.current.contains(e.target as Node)
      ) {
        setShowFilter(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilter]);

  // Keyboard navigation for the filter dropdown listbox.
  const handleFilterPanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    const panel = filterPanelRef.current;
    if (!panel) return;
    const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('.kds-filter-option'));
    if (options.length === 0) return;
    const currentIndex = options.findIndex((opt) => opt === document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
      options[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
      options[nextIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      options[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      options[options.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowFilter(false);
      filterBtnRef.current?.focus();
    }
  }, []);

  const handleFilterBtnKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setShowFilter(true);
      setTimeout(() => {
        const panel = filterPanelRef.current;
        if (!panel) return;
        const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('.kds-filter-option'));
        if (options.length > 0) {
          const target = e.key === 'ArrowDown' ? options[0] : options[options.length - 1];
          target?.focus();
        }
      }, 0);
    }
  }, []);

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

  // ── Initial loading skeleton ──────────────────────────────────
  const renderContent = () => {
    if (initialLoading) {
      // LOAD-05: the skeleton columns are decorative; the localized
      // status line (role=status) is what screen readers announce.
      return (
        <LoadingStatus className="kds-loading-container" label={requiredLocalized(l10n, 'kds-loading')}>
            <div className="kds-loading-columns">
              {['pending', 'preparing', 'ready'].map((status) => (
                <div key={status} className="kds-loading-column">
                  <div className="kds-loading-header" />
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="kds-loading-card">
                      <div className="kds-loading-line kds-loading-line--short" />
                      <div className="kds-loading-line kds-loading-line--long" />
                      <div className="kds-loading-line kds-loading-line--medium" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </LoadingStatus>
        );
    }

    return (
      <div className="kds-main-viewport" {...swipeProps}>
        <div className={`kds-main-track active-${activeTab}`}>
          <div
            className="kds-main-pane kds-main-pane--open"
            aria-hidden={activeTab !== 'open'}
          >
            <div className={`kds-content-wrap${settings.density <= 2 ? ' kds--compact' : ''}`} {...pullRefreshProps}>
              <KdsLayoutMasonry
                orders={filteredOrders}
                filtered={boardFiltered}
                onAdvance={advanceStatus}
                showOrderId={prefs.showOrderId}
                showTableNumber={prefs.showTableNumber}
                selectedOrderId={selectedOrderId}
                sessionToken={sessionToken}
                onSaveItems={handleSaveItems}
                onAdvanceItem={advanceItemStatus}
                onAddItems={setPickerOrderId}
                newOrderIds={newOrderIds}
                slaThresholds={slaThresholds}
              />
            </div>
          </div>
          <div
            className="kds-main-pane kds-main-pane--completed"
            aria-hidden={activeTab !== 'completed'}
          >
            <KdsCompletedView
              onReopen={() => setActiveTab('open')}
              completedFilter={completedFilter}
              active={activeTab === 'completed'}
            />
          </div>
        </div>
      </div>
    );
  };

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
        <div className="kds-header-left">
          <button
            type="button"
            className="kds-btn kds-btn--icon kds-back-btn"
            onClick={goToWorkspacePicker}
            aria-label={requiredLocalized(l10n, 'kds-back-aria')}
            title={requiredLocalized(l10n, 'kds-back-aria')}
            data-testid="kds-topbar-back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
          {/* Filter dropdown — tab-aware (Open: All/Prepared/Cats, Completed: All/Dine in/Takeaway) */}
          <div className="kds-filter">
            <button
              ref={filterBtnRef}
              className={`kds-btn kds-btn--filter${!boardFiltered ? ' kds-btn--filter--all' : ' kds-btn--filter--active'}${showFilter ? ' kds-btn--filter--open' : ''}`}
              onClick={() => setShowFilter((p) => !p)}
              onKeyDown={handleFilterBtnKeyDown}
              aria-haspopup="listbox"
              aria-expanded={showFilter}
              data-testid="kds-topbar-filter"
            >
              <span>
                {activeTab === 'completed' ? (
                  completedFilter === 'dinein' ? (
                    <Localized id="kds-filter-dinein"><span>Dine in</span></Localized>
                  ) : completedFilter === 'takeaway' ? (
                    <Localized id="kds-filter-takeaway"><span>Takeaway</span></Localized>
                  ) : (
                    <Localized id="kds-filter-completed-all"><span>All</span></Localized>
                  )
                ) : filterMode === 'prepared' ? (
                  <Localized id="kds-filter-prepared"><span>Prepared</span></Localized>
                ) : filterCats && filterCats.size > 0 ? (
                  filterCats.size === 1 ? (
                    [...filterCats][0]
                  ) : (
                    requiredLocalized(l10n, 'kds-filter-selected', { count: filterCats.size })
                  )
                ) : (
                  <Localized id="kds-filter-all"><span>All Categories</span></Localized>
                )}
              </span>
              <span className="caret" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h12l-6 7z" /></svg>
              </span>
            </button>
            {showFilter && (
              <div
                ref={filterPanelRef}
                className="kds-filter-panel"
                role="listbox"
                tabIndex={-1}
                aria-multiselectable={activeTab !== 'completed'}
                aria-label={requiredLocalized(l10n, 'kds-filter-aria')}
                onKeyDown={handleFilterPanelKeyDown}
              >
                {activeTab === 'completed' ? (
                  <div className="kds-filter-modes no-sep">
                    <button
                      className={`kds-filter-option${completedFilter === 'all' ? ' checked' : ''}`}
                      role="option"
                      aria-selected={completedFilter === 'all'}
                      onClick={() => { setCompletedFilter('all'); setShowFilter(false); }}
                      data-testid="kds-filter-completed-all"
                    >
                      <Localized id="kds-filter-completed-all">All</Localized>
                    </button>
                    <button
                      className={`kds-filter-option${completedFilter === 'dinein' ? ' checked' : ''}`}
                      role="option"
                      aria-selected={completedFilter === 'dinein'}
                      onClick={() => { setCompletedFilter('dinein'); setShowFilter(false); }}
                      data-testid="kds-filter-completed-dinein"
                    >
                      <Localized id="kds-filter-dinein">Dine in</Localized>
                    </button>
                    <button
                      className={`kds-filter-option${completedFilter === 'takeaway' ? ' checked' : ''}`}
                      role="option"
                      aria-selected={completedFilter === 'takeaway'}
                      onClick={() => { setCompletedFilter('takeaway'); setShowFilter(false); }}
                      data-testid="kds-filter-completed-takeaway"
                    >
                      <Localized id="kds-filter-takeaway">Takeaway</Localized>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="kds-filter-modes">
                      <button
                        className={`kds-filter-option${filterMode === 'all' && (!filterCats || filterCats.size === 0) ? ' checked' : ''}`}
                        role="option"
                        aria-selected={filterMode === 'all' && (!filterCats || filterCats.size === 0)}
                        onClick={() => { setFilterMode('all'); setFilterCats(null); setShowFilter(false); }}
                        data-testid="kds-filter-mode-all"
                      >
                        <Localized id="kds-filter-all">All orders</Localized>
                      </button>
                      <button
                        className={`kds-filter-option${filterMode === 'prepared' ? ' checked' : ''}`}
                        role="option"
                        aria-selected={filterMode === 'prepared'}
                        onClick={() => { setFilterMode('prepared'); setFilterCats(null); setShowFilter(false); }}
                        data-testid="kds-filter-mode-prepared"
                      >
                        <Localized id="kds-filter-prepared">Prepared</Localized>
                      </button>
                    </div>
                    {zones.length > 0 && (
                      <div className="kds-filter-grid">
                        {zones.map((zone) => (
                          <button
                            key={zone}
                            className={`kds-filter-option${filterCats?.has(zone) ? ' checked' : ''}`}
                            role="option"
                            aria-selected={filterCats?.has(zone) ?? false}
                            onClick={() => {
                              setFilterMode('all');
                              setFilterCats((prev) => {
                                const next = new Set(prev ?? []);
                                if (next.has(zone)) next.delete(zone); else next.add(zone);
                                return next.size === 0 ? null : next;
                              });
                            }}
                            data-testid={`kds-filter-zone-${zone}`}
                          >
                            <span>{zone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Open/Completed tabs — prototype .kds-tabs */}
        <div className="kds-tabs" ref={tabsTrackRef} role="tablist" aria-label={requiredLocalized(l10n, 'kds-tablist-aria')}>
          <span
            ref={tabIndicatorRef}
            className="kds-tab-indicator"
            style={{ left: tabIndicator.left, width: tabIndicator.width }}
          />
          <button
            ref={tabOpenRef}
            className={`kds-tab${activeTab === 'open' ? ' active' : ''}`}
            onClick={() => setActiveTab('open')}
            role="tab"
            aria-selected={activeTab === 'open'}
            data-testid="kds-tab-open"
          >
            <Localized id="kds-tab-open"><span>Open</span></Localized>
            <span className="kds-tab-count">{filteredOrders.length}</span>
          </button>
          <button
            ref={tabCompletedRef}
            className={`kds-tab${activeTab === 'completed' ? ' active' : ''}`}
            onClick={() => setActiveTab('completed')}
            role="tab"
            aria-selected={activeTab === 'completed'}
            data-testid="kds-tab-completed"
          >
            <Localized id="kds-tab-completed"><span>Completed</span></Localized>
          </button>
        </div>

        <div className="kds-header-right">
          {/* Shift start/stop button — prototype .kds-btn--shift .kds-btn--stack */}
          <button
            className={`kds-btn kds-btn--shift kds-btn--stack${inShift ? ' is-active' : ''}`}
            onClick={() => {
              if (inShift) {
                setConfirm({
                  title: requiredLocalized(l10n, 'kds-shift-end-title'),
                  message: requiredLocalized(l10n, 'kds-shift-end-msg'),
                  onOk: () => setInShift(false),
                  danger: true,
                });
              } else {
                setInShift(true);
              }
            }}
            data-testid="kds-topbar-shift"
          >
            <span className={!inShift ? 'visible' : ''}><Localized id="kds-shift-start">Start Shift</Localized></span>
            <span className={inShift ? 'visible' : ''}><Localized id="kds-shift-end">End Shift</Localized></span>
          </button>
          {/* Device status indicator */}
          <KdsDeviceStatusIndicator sessionToken={sessionToken} onEnrollDevice={() => setShowEnrollment(true)} />
          {/* Hamburger settings panel — only when prefs loaded */}
          {!prefsLoading && (
            <KdsHamburgerPanel
              settings={{ ...settings, autoAcknowledge: prefs.autoAcknowledge }}
              onChangeSound={(v) => setSettings((s) => ({ ...s, soundEnabled: v }))}
              onChangeYellowThreshold={(v) => setSettings((s) => ({
                ...s,
                // Fixed range 3–30, but also ensure yellow < red
                yellowThresholdMin: Math.max(3, Math.min(v, s.redThresholdMin - 1, 30)),
              }))}
              onChangeRedThreshold={(v) => setSettings((s) => ({
                ...s,
                // Fixed range 4–60, then force yellow below new red
                redThresholdMin: Math.max(4, Math.min(v, 60)),
                yellowThresholdMin: Math.min(s.yellowThresholdMin, Math.max(4, Math.min(v, 60)) - 1),
              }))}
              onChangeAutoAcknowledge={(v) => setAutoAcknowledge(v)}
              onChangeDensity={(v) => setSettings((s) => ({ ...s, density: v }))}
              showOrderId={prefs.showOrderId}
              showTableNumber={prefs.showTableNumber}
              onToggleOrderId={setShowOrderId}
              onToggleTableNumber={setShowTableNumber}
              cardAnimations={cardAnimations}
              onChangeCardAnimations={setCardAnimations}
            />
          )}
        </div>
      </div>

      {/* ── Zone chips — secondary filter row below the header ────── */}
      {zones.length > 0 && (
        <div className="kds-zone-chips" role="tablist" aria-label={requiredLocalized(l10n, 'kds-zone-filter-aria')} onKeyDown={handleZoneTablistKeyDown} tabIndex={0}>
          <button
            className={`kds-zone-chip${!prefs.kdsZone ? ' kds-zone-chip--active' : ''}`}
            onClick={() => setKdsZone('')}
            role="tab"
            aria-selected={!prefs.kdsZone}
            tabIndex={!prefs.kdsZone ? 0 : -1}
            ref={(el) => { zoneTabRefs.current[0] = el; }}
            data-testid="kds-zone-chip-all"
          >
            <Localized id="kds-zone-all">All</Localized>
          </button>
          {zones.map((zone, i) => (
            <button
              key={zone}
              className={`kds-zone-chip${prefs.kdsZone === zone ? ' kds-zone-chip--active' : ''}`}
              onClick={() => setKdsZone(zone)}
              role="tab"
              aria-selected={prefs.kdsZone === zone}
              tabIndex={prefs.kdsZone === zone ? 0 : -1}
              ref={(el) => { zoneTabRefs.current[i + 1] = el; }}
              data-testid={`kds-zone-chip-${zone}`}
            >
              {zone}
            </button>
          ))}
        </div>
      )}

      {/* ── Error banner (dismissible + retry) ──────────────────── */}
      {error && (
        <div className="kds-error-banner" role="alert">
          <span className="kds-error-banner-text">{error}</span>
          <button
            className="kds-error-retry-btn"
            onClick={() => {
              clearError();
              fetchOrders();
            }}
            aria-label={requiredLocalized(l10n, 'kds-error-retry-aria')}
          >
            <Localized id="kds-offline-retry">Retry</Localized>
          </button>
          <button
            className="kds-error-dismiss-btn"
            onClick={clearError}
            aria-label={requiredLocalized(l10n, 'kds-error-dismiss-aria')}
          >
            &times;
          </button>
        </div>
      )}

      {/* OFF-08: local persistence is unavailable — queued actions are not durable */}
      {storageUnavailable && (
        <div className="kds-offline-banner kds-offline-banner--storage" role="alert">
          <span className="kds-offline-banner-text">
            {requiredLocalized(l10n, 'kds-offline-storage-unavailable')}
          </span>
        </div>
      )}

      {/* OFF-05: actions that exhausted retries and need operator attention */}
      {deadLetterLength > 0 && (
        <div className="kds-offline-banner kds-offline-banner--deadletter" role="alert">
          <span className="kds-offline-banner-text">
            {requiredLocalized(l10n, 'kds-offline-dead-letter', { count: deadLetterLength })}
          </span>
          <button
            className="kds-offline-retry-btn"
            onClick={() => {
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
            aria-label={requiredLocalized(l10n, 'kds-offline-retry-aria')}
          >
            <Localized id="kds-offline-retry">Retry</Localized>
          </button>
          <button
            className="kds-offline-dismiss-btn"
            onClick={clearDeadLetter}
            aria-label={requiredLocalized(l10n, 'kds-offline-dead-letter-clear-aria')}
          >
            &times;
          </button>
        </div>
      )}

      {/* 3b: Offline banner — shown when backend is unreachable or actions are queued */}
      {!online && !offlineDismissed && (
        <div className="kds-offline-banner" role="alert">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-.47.81c-.54.5-1.1 1.36-1.1 2.52V8l4.89-4.89c-.04-.26-.14-.52-.34-.73zM5.99 5.58l-2.84 2.84a1.532 1.532 0 000 2.16l7.29 7.29c.39.39 1.02.39 1.41 0l2.84-2.84-5.99-5.99-2.71-2.76v.3zm10.02 2.46l2.13 2.13a1.532 1.532 0 010 2.16l-2.13 2.13a.5.5 0 01-.71-.71l2.13-2.13a.532.532 0 000-.75l-2.13-2.13a.5.5 0 01.71-.71zm-5.02 5.32a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" clipRule="evenodd" />
          </svg>
          <span className="kds-offline-banner-text">
            {pendingQueueLength > 0
              ? requiredLocalized(l10n, 'kds-offline-queued', { count: pendingQueueLength })
              : requiredLocalized(l10n, 'kds-offline-label')}
          </span>
          {pendingQueueLength > 0 && (
            <button
              className="kds-offline-retry-btn"
              onClick={() => {
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
              aria-label={requiredLocalized(l10n, 'kds-offline-retry-aria')}
            >
              <Localized id="kds-offline-retry">Retry</Localized>
            </button>
          )}
          <button
            className="kds-offline-dismiss-btn"
            onClick={() => setOfflineDismissed(true)}
            aria-label={requiredLocalized(l10n, 'kds-offline-dismiss-aria')}
          >
            &times;
          </button>
        </div>
      )}

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
      {renderContent()}

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
