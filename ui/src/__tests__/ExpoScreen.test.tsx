// ExpoScreen (Expediter) tests — todo-kds-agents-3, M2.
//
// Conventions mirror KdsScreen.test.tsx: the @/api/kds module is mocked at
// the boundary via vi.hoisted fakes, useTicketSla/useSound are stubbed, and
// async mount effects render through renderWithFluent.
//
// FIRST TO FAIL PER SEEDED MUTATION (all measured on this file, 21 cases):
//  - .then guard at ExpoScreen.ts:195-196 replaced by an unconditional
//    unlisten = fn (late-settle cancel path deleted): ExpoScreen/10 ALONE
//    (1 failed / 20 passed). /10 stays the subscription arm only — it
//    asserts nothing about the timer or listener arms.
//  - clearInterval(id) dropped from the cleanup (:214): /11 ALONE.
//  - removeEventListener dropped from the cleanup (:215): /11 ALONE.
//  - the !document.hidden gate on the poll tick (:203) removed: /12 ALONE.
// /10 + /11 + /12 pin the whole :188-217 effect, one seam per case — mixing
// a microtask-timing assertion with a timer assertion is how a pin turns
// flaky, which is why /11 owns interval-death AND listener balance (both are
// unmount-state claims) while /12 owns only the hidden gate and never
// unmounts. (The other two sites of this guard shape: useKdsRealtime.ts:95,
// pinned by that file's late/2, and useUnsavedChangesGuard.ts:81, pinned by
// that file's /9.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithFluent, renderWithFluentSync } from '@/__tests__/test-utils/render';
import ExpoScreen, {
  groupByStation,
  readyToServe,
  recallCandidates,
  minutesSinceServed,
  EXPO_POLL_MS,
} from '@/features/kds/ExpoScreen';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { KdsOrder } from '@/api/kds';

const { mockList, mockUpdateStatus, mockUpdateLineItem, mockLines, mockSpeak } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockUpdateStatus: vi.fn(),
  mockUpdateLineItem: vi.fn(),
  mockLines: vi.fn().mockResolvedValue([]),
  mockSpeak: vi.fn(),
}));

vi.mock('@/api/kds', () => ({
  listKdsOrdersScoped: (_token: string) => mockList(),
  updateKdsStatusScoped: (_token: string, id: string, status: string) => mockUpdateStatus(id, status),
  updateKdsLineItemStatusScoped: (_token: string, id: string, status: string) => mockUpdateLineItem(id, status),
  getKdsOrderLinesScoped: (_token: string, _orderId: string) => mockLines(),
}));

vi.mock('@/features/kds/hooks/useTicketSla', () => ({
  useTicketSla: () => ({ level: 'green', display: '0s', elapsedSeconds: 0 }),
}));

vi.mock('@/components/useSound', () => ({
  useSound: () => ({ playAlert: vi.fn(), speak: mockSpeak, setSoundEnabled: vi.fn() }),
}));

// KdsScreenFooter reads useAuth; same boundary stub as KdsScreen.test.tsx.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user_id: 'user-1', display_name: 'Alice', role_name: 'cashier' } }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'kds-expo',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: 'tok-expo',
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => null,
}));

// ── Seam: the Tauri event plugin (the subscription arm only) ─────────
// ExpoScreen subscribes through @/api/tauri's `listen` re-export. test-setup.ts:69
// already stubs @tauri-apps/api/event as `listen: () => Promise.resolve(() => {})`,
// so the .then at ExpoScreen.ts:194 DOES run here today — but into a SHARED,
// uncountable no-op, and always before an unmount, because every existing case
// awaits its render. That is why :195 is unasserted, and why this file needs its
// own seam: not to make the promise resolve, but to make the release OBSERVABLE.
// One counted unlisten per call, so "released exactly once" is a statement about
// the subscription THIS mount created. importOriginal leaves every other export
// (invoke / getCurrentWindow / getVersion) exactly as the global mocks have it.

interface FakeListen {
  event: string;
  unlisten: () => void;
  /** How many times this subscription's unlisten has been called. */
  calls: () => number;
}

const tauri = vi.hoisted(() => {
  const subs: Array<{ event: string; unlisten: () => void; calls: () => number }> = [];
  const listen = (event: string, _handler: (payload: unknown) => void): Promise<() => void> => {
    let n = 0;
    const unlisten = (): void => {
      n += 1;
    };
    subs.push({ event, unlisten, calls: () => n });
    return Promise.resolve(unlisten);
  };
  return { subs, listen };
});

vi.mock('@/api/tauri', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  listen: tauri.listen,
}));

/** The kds:orders-changed subscriptions made so far — the seam this case pins. */
function expoSubs(): FakeListen[] {
  return tauri.subs.filter((s) => s.event === 'kds:orders-changed');
}

function makeOrder(overrides: Partial<KdsOrder>): KdsOrder {
  return {
    id: 'order-x',
    sale_id: 'sale-x',
    store_id: null,
    status: 'pending',
    items_summary: '1x Item',
    item_count: 1,
    display_number: 1,
    received_at: new Date(Date.now() - 60_000).toISOString(),
    started_at: null,
    ready_at: null,
    served_at: null,
    prep_time_seconds: 0,
    kitchen_zone: null,
    notes: '',
    table_number: null,
    priority: false,
    ...overrides,
  };
}

function renderExpo() {
  return renderWithFluent(<ExpoScreen />, sharedFtl, kdsFtl);
}

// ── Seams for /11 and /12: the two arms /10 deliberately excluded ─────
// Counting machinery for the setInterval(EXPO_POLL_MS) handle and the
// visibilitychange pair. The listener half is the live-Set idiom from
// useKdsRealtime.test.ts:74-155 — removing a function OTHER than the one
// added leaves the original live, and a Set sees that while a counter does
// not. The interval half records {id, ms} from a wrapper around
// globalThis.setInterval and every globalThis.clearInterval id, so "cleared
// exactly once, by the unmount, never while mounted" is a claim about state.
// Both wrappers are installed INSIDE the two cases, not in beforeEach, so
// the other 19 mounts in this file never see them; the interval wrapper goes
// ON TOP of vi.useFakeTimers' own replacement (vi swaps the global itself —
// wrapping before it would be wrapped away). jsdom makes window ===
// globalThis, so KdsScreenFooter's 30s clock (KdsScreenFooter.tsx:45) is
// recorded too; the EXPO_POLL_MS delay filter picks Expo's handle out
// deterministically (the only other interval in this tree is that 30_000 one).

function installIntervalSeam() {
  const created: Array<{ id: number; ms: number }> = [];
  const cleared: number[] = [];
  const origSet = globalThis.setInterval;
  const origClear = globalThis.clearInterval;
  const setFn = origSet as unknown as (...args: unknown[]) => number;
  const clearFn = origClear as unknown as (id: unknown) => void;
  globalThis.setInterval = ((...args: unknown[]) => {
    const id = setFn(...args);
    // vi's fake setInterval returns an OBJECT whose valueOf is the numeric
    // timer id (sinon-style); the real one returns that number directly.
    // Number() on both sides is what makes created.id === cleared[i].
    created.push({ id: Number(id), ms: Number(args[1]) });
    return id;
  }) as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = ((id: unknown) => {
    if (id !== undefined && id !== null) cleared.push(Number(id));
    clearFn(id);
  }) as unknown as typeof globalThis.clearInterval;
  return {
    created,
    cleared,
    restore: () => {
      globalThis.setInterval = origSet;
      globalThis.clearInterval = origClear;
    },
  };
}

const VIS = 'visibilitychange';

function installVisibilitySeam() {
  const live = new Set<EventListener>();
  const adds: EventListener[] = [];
  const removes: EventListener[] = [];
  const origAdd = document.addEventListener;
  const origRemove = document.removeEventListener;
  const nativeAdd = origAdd.bind(document) as unknown as (
    t: string,
    l: EventListenerOrEventListenerObject | null,
    o?: boolean | AddEventListenerOptions,
  ) => void;
  const nativeRemove = origRemove.bind(document) as unknown as (
    t: string,
    l: EventListenerOrEventListenerObject | null,
    o?: boolean | EventListenerOptions,
  ) => void;
  document.addEventListener = ((
    t: string,
    l: EventListenerOrEventListenerObject | null,
    o?: boolean | AddEventListenerOptions,
  ) => {
    if (t === VIS && typeof l === 'function') {
      const fn = l as EventListener;
      live.add(fn);
      adds.push(fn);
    }
    nativeAdd(t, l, o);
  }) as unknown as typeof document.addEventListener;
  document.removeEventListener = ((
    t: string,
    l: EventListenerOrEventListenerObject | null,
    o?: boolean | EventListenerOptions,
  ) => {
    if (t === VIS && typeof l === 'function') {
      const fn = l as EventListener;
      live.delete(fn);
      removes.push(fn);
    }
    nativeRemove(t, l, o);
  }) as unknown as typeof document.removeEventListener;
  return {
    live,
    adds,
    removes,
    restore: () => {
      document.addEventListener = origAdd;
      document.removeEventListener = origRemove;
    },
  };
}

/** Flip the webview's visibility WITHOUT dispatching anything: only the two
 * getters production reads (:203, :207) change. Restore re-exposes the
 * jsdom default (hidden === false, useKdsRealtime.test.ts:402). */
function setDocHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

function restoreDocHidden() {
  setDocHidden(false);
}

beforeEach(() => {
  localStorage.clear();
  mockList.mockReset().mockResolvedValue([]);
  mockUpdateStatus.mockReset().mockResolvedValue(undefined);
  mockUpdateLineItem.mockReset().mockResolvedValue(undefined);
  mockSpeak.mockReset();
  mockLines.mockReset().mockResolvedValue([]);
  // Per-test subscriptions: every case renders the screen, so without this the
  // counts below would accumulate across the file.
  tauri.subs.length = 0;
});

// ── 1. Pure helpers ─────────────────────────────────────────────────

describe('groupByStation', () => {
  it('partitions by kitchen zone, alphabetical, no-zone bucket last', () => {
    const columns = groupByStation([
      makeOrder({ id: 'a', kitchen_zone: 'grill' }),
      makeOrder({ id: 'b', kitchen_zone: 'fry' }),
      makeOrder({ id: 'c', kitchen_zone: null }),
      makeOrder({ id: 'd', kitchen_zone: 'grill' }),
    ]);
    expect(columns.map((c) => c.zone)).toEqual(['fry', 'grill', null]);
    expect(columns[1]!.orders.map((o) => o.id)).toEqual(['a', 'd']);
    expect(columns[2]!.orders.map((o) => o.id)).toEqual(['c']);
  });

  it('returns no columns for an empty board', () => {
    expect(groupByStation([])).toEqual([]);
  });
});

describe('readyToServe', () => {
  it('selects only tickets at the ready rung', () => {
    const ready = makeOrder({ id: 'r', status: 'ready' });
    const picked = readyToServe([ready, makeOrder({ id: 'p', status: 'pending' }), makeOrder({ id: 'prep', status: 'preparing' })]);
    expect(picked).toEqual([ready]);
  });
});

describe('recallCandidates', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');

  it('includes served tickets inside the window and excludes older ones', () => {
    const fresh = makeOrder({ id: 'fresh', status: 'served', served_at: new Date(now - 60_000).toISOString() });
    const stale = makeOrder({ id: 'stale', status: 'served', served_at: new Date(now - 16 * 60_000).toISOString() });
    const open = makeOrder({ id: 'open', status: 'ready' });
    expect(recallCandidates([fresh, stale, open], now)).toEqual([fresh]);
  });

  it('excludes served tickets with no served_at (window position unknowable)', () => {
    const noStamp = makeOrder({ id: 'nostamp', status: 'served', served_at: null });
    expect(recallCandidates([noStamp], now)).toEqual([]);
  });

  it('sorts newest bump first', () => {
    const older = makeOrder({ id: 'older', status: 'served', served_at: new Date(now - 120_000).toISOString() });
    const newer = makeOrder({ id: 'newer', status: 'served', served_at: new Date(now - 30_000).toISOString() });
    expect(recallCandidates([older, newer], now).map((o) => o.id)).toEqual(['newer', 'older']);
  });

  it('respects a custom window', () => {
    const ten = makeOrder({ id: 'ten', status: 'served', served_at: new Date(now - 10 * 60_000).toISOString() });
    expect(recallCandidates([ten], now, 5 * 60_000)).toEqual([]);
    expect(recallCandidates([ten], now, 15 * 60_000)).toEqual([ten]);
  });
});

describe('minutesSinceServed', () => {
  it('floors elapsed minutes and clamps clock skew to zero', () => {
    const now = Date.parse('2026-09-08T12:05:30Z');
    expect(minutesSinceServed(makeOrder({ served_at: '2026-09-08T12:00:00Z' }), now)).toBe(5);
    expect(minutesSinceServed(makeOrder({ served_at: '2026-09-08T13:00:00Z' }), now)).toBe(0);
  });

  it('falls back to received_at when served_at is missing', () => {
    const now = Date.parse('2026-09-08T12:10:00Z');
    expect(minutesSinceServed(makeOrder({ served_at: null, received_at: '2026-09-08T12:00:00Z' }), now)).toBe(10);
  });
});

// ── 2. Screen rendering ─────────────────────────────────────────────

describe('ExpoScreen', () => {
  it('renders one column per station plus a no-station bucket', async () => {
    mockList.mockResolvedValue([
      makeOrder({ id: 'g1', display_number: 11, kitchen_zone: 'grill' }),
      makeOrder({ id: 'u1', display_number: 12, kitchen_zone: null }),
    ]);
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-station-grill')).toBeInTheDocument();
    });
    expect(screen.getByTestId('kds-expo-station-none')).toBeInTheDocument();
    expect(screen.getByText('grill')).toBeInTheDocument();
    expect(screen.getByText('No station')).toBeInTheDocument();
  });

  it('shows the ready-to-serve strip with the count and highlights up tickets only', async () => {
    mockList.mockResolvedValue([
      makeOrder({ id: 'r1', display_number: 21, status: 'ready' }),
      makeOrder({ id: 'p1', display_number: 22, status: 'preparing' }),
    ]);
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-ready-strip')).toBeInTheDocument();
    });
    expect(screen.getByTestId('kds-expo-ready-strip')).toHaveTextContent('1 ticket ready to serve');
    expect(screen.getByTestId('kds-expo-slot-21')).toHaveClass('kds-expo-ticket-slot--ready');
    expect(screen.getByTestId('kds-expo-slot-22')).not.toHaveClass('kds-expo-ticket-slot--ready');
  });

  it('serves a ready ticket through the card advance (ready → served)', async () => {
    mockList.mockResolvedValue([makeOrder({ id: 'r1', display_number: 31, status: 'ready' })]);
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-order-card-31-status-advance')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('kds-order-card-31-status-advance'));
    await vi.waitFor(() => {
      expect(mockUpdateStatus).toHaveBeenCalledWith('r1', 'served');
    });
  });

  it('shows a localized error banner when the initial load fails, and retry re-fetches', async () => {
    mockList.mockRejectedValueOnce(new Error('boom'));
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-error')).toBeInTheDocument();
    });
    // ERR-10: the banner shows the localized fallback, never the raw message.
    expect(screen.getByTestId('kds-expo-error')).toHaveTextContent('Failed to load expo orders');
    expect(screen.getByTestId('kds-expo-error')).not.toHaveTextContent('boom');
    const callsBefore = mockList.mock.calls.length;
    fireEvent.click(screen.getByTestId('kds-expo-error-retry'));
    await vi.waitFor(() => {
      expect(mockList.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('lists recallable tickets and restores one with a served → ready transition', async () => {
    const served = makeOrder({
      id: 'srv-1',
      display_number: 41,
      status: 'served',
      served_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      kitchen_zone: 'grill',
    });
    mockList.mockResolvedValue([served]);
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-recall-open')).toBeInTheDocument();
    });
    // Badge counts recallable tickets; the active board excludes served ones.
    expect(screen.getByTestId('kds-expo-recall-open')).toHaveTextContent('1');
    expect(screen.queryByTestId('kds-expo-slot-41')).toBeNull();

    fireEvent.click(screen.getByTestId('kds-expo-recall-open'));
    const dialog = await screen.findByTestId('kds-expo-recall-dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Recently served');
    expect(screen.getByTestId('kds-expo-recall-restore-srv-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('kds-expo-recall-restore-srv-1'));
    await vi.waitFor(() => {
      expect(mockUpdateStatus).toHaveBeenCalledWith('srv-1', 'ready');
    });
  });

  it('shows the empty recall dialog when nothing was served recently', async () => {
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-recall-open')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('kds-expo-recall-open'));
    await screen.findByTestId('kds-expo-recall-dialog');
    expect(screen.getByText('No tickets served recently')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('kds-expo-recall-close'));
    await vi.waitFor(() => {
      expect(screen.queryByTestId('kds-expo-recall-dialog')).toBeNull();
    });
  });

  it('surfaces a failed restore as a localized alert, not a raw message', async () => {
    mockUpdateStatus.mockRejectedValue(new Error('backend rejected backward move'));
    const served = makeOrder({
      id: 'srv-2',
      display_number: 42,
      status: 'served',
      served_at: new Date(Date.now() - 60_000).toISOString(),
    });
    mockList.mockResolvedValue([served]);
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-recall-open')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('kds-expo-recall-open'));
    fireEvent.click(await screen.findByTestId('kds-expo-recall-restore-srv-2'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('kds-expo-error')).not.toHaveTextContent('backend rejected');
  });

  it('polls the order list on the Expo interval while visible', async () => {
    vi.useFakeTimers();
    try {
      mockList.mockResolvedValue([]);
      await act(async () => {
        await renderExpo();
      });
      const before = mockList.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(EXPO_POLL_MS + 500);
      });
      expect(mockList.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters the board to a chosen station via the selector and persists it', async () => {
    mockList.mockResolvedValue([
      makeOrder({ id: 'g1', display_number: 51, kitchen_zone: 'grill' }),
      makeOrder({ id: 'f1', display_number: 52, kitchen_zone: 'fry' }),
    ]);
    await renderExpo();
    await vi.waitFor(() => {
      expect(screen.getByTestId('kds-expo-station-grill')).toBeInTheDocument();
    });
    expect(screen.getByTestId('kds-expo-station-fry')).toBeInTheDocument();
    expect(screen.getByTestId('kds-expo-station-open')).toHaveTextContent('All stations');

    fireEvent.click(screen.getByTestId('kds-expo-station-open'));
    fireEvent.click(await screen.findByTestId('kds-station-option-grill'));

    await vi.waitFor(() => {
      expect(screen.queryByTestId('kds-expo-station-fry')).toBeNull();
    });
    expect(screen.getByTestId('kds-expo-station-grill')).toBeInTheDocument();
    expect(screen.getByTestId('kds-expo-station-open')).toHaveTextContent('grill');
    // Per-user persistence (the modal closed after selection).
    expect(localStorage.getItem('oz-kds-expo-station-user-1')).toBe('grill');
    expect(screen.queryByTestId('kds-station-dialog')).toBeNull();
  });

  // ── the late-settle branch: listen resolves after the screen is gone ──
  it('calls the returned unlisten itself when the subscription settles after the screen unmounted', async () => {
    // ExpoScreen.ts:195 `if (cancelled) fn();` — the third copy of this guard
    // (the others: useKdsRealtime.ts:95, pinned by that file's late/2, and
    // useUnsavedChangesGuard.ts:81, pinned by /9 of its own file). It is NOT
    // reachable through this file's usual `renderExpo()`: that helper awaits
    // (renderInAct), which crosses a microtask boundary, so the .then has
    // always landed and taken the else at :196 long before an unmount. Here the
    // SYNC variant renders and unmounts with no await between them, so the
    // cleanup runs while `unlisten` is still undefined (:213 is a no-op) with
    // :212 having set cancelled = true. After the flush, :195 is the only code
    // left that can release fn — drop the guard and the expo board keeps a live
    // 'kds:orders-changed' handler pointing at an unmounted screen.
    //
    // ONE SEAM ONLY, deliberately: the setInterval(EXPO_POLL_MS) arm at :201
    // and the visibilitychange arm at :206-209 are NOT asserted here, and
    // nothing in this case is a statement about them or about clearInterval.
    const { unmount } = renderWithFluentSync(<ExpoScreen />, sharedFtl, kdsFtl);
    const subs = expoSubs();

    // The subscription exists — it is only its RELEASE that is still pending.
    expect(subs).toHaveLength(1);
    expect(subs[0]!.calls()).toBe(0);

    unmount();

    // Still unreleased: the cleanup had no unlisten to call yet.
    expect(subs[0]!.calls()).toBe(0);

    // Deliver the in-flight resolution, now that the mount is gone.
    await act(async () => {});

    // The guard ran, exactly once, and no second subscription appeared.
    expect(subs[0]!.calls()).toBe(1);
    expect(expoSubs()).toHaveLength(1);
  });

  // ── /11 — the cleanup PAIR: same unmount releases subscription, interval,
  // listener; nothing is released early; the interval is provably dead ──
  it('clears the poll interval with the same cleanup that releases the subscription, never while mounted', async () => {
    vi.useFakeTimers();
    const timers = installIntervalSeam();
    const vis = installVisibilitySeam();
    try {
      mockList.mockResolvedValue([]);
      const { unmount } = await renderExpo();
      // Unlike /10, the .then at :194 HAS settled here (renderWithFluent
      // crosses a microtask boundary), so :196 assigned unlisten and the
      // :213 release below is the real one, made by the cleanup.
      const subs = expoSubs();
      expect(subs).toHaveLength(1);
      expect(subs[0]!.calls()).toBe(0);

      const expoTicks = timers.created.filter((t) => t.ms === EXPO_POLL_MS);
      expect(expoTicks).toHaveLength(1);
      const expoId = expoTicks[0]!.id;
      expect(vis.adds).toHaveLength(1);
      expect(vis.removes).toHaveLength(0);
      expect(vis.live.size).toBe(1);

      // Alive while mounted: one interval's advance reaches the IPC...
      const beforePoll = mockList.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(EXPO_POLL_MS + 500);
      });
      expect(mockList.mock.calls.length).toBeGreaterThan(beforePoll);
      // ...and NOTHING was released to get there — no early clearInterval,
      // no detached listener, no cancelled subscription (a self-clearing
      // tick or a double-run cleanup dies on these three lines).
      expect(timers.cleared).not.toContain(expoId);
      expect(vis.live.size).toBe(1);
      expect(subs[0]!.calls()).toBe(0);

      unmount();

      // ONE cleanup, three releases: :213 unlisten, :214 clearInterval,
      // :215 removeEventListener. The removed handler is the exact function
      // that was added — Set identity, not a call tally.
      expect(subs[0]!.calls()).toBe(1);
      expect(timers.cleared.filter((id) => id === expoId)).toHaveLength(1);
      expect(vis.removes).toHaveLength(1);
      expect(vis.removes[0]).toBe(vis.adds[0]);
      expect(vis.live.size).toBe(0);

      // The interval is DEAD, not merely unobserved: three more periods
      // produce zero further IPC. Delete clearInterval(id) from ExpoScreen
      // and a ghost 5s poll outlives the screen — this line is its noose.
      const afterUnmount = mockList.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(3 * EXPO_POLL_MS + 1500);
      });
      expect(mockList.mock.calls.length).toBe(afterUnmount);
    } finally {
      vis.restore();
      timers.restore();
      vi.useRealTimers();
    }
  });

  // ── /12 — the hidden-webview gate on the poll arm (:203) ────────────
  it('skips the poll IPC while the webview is hidden and resumes it when visible', async () => {
    vi.useFakeTimers();
    const timers = installIntervalSeam();
    setDocHidden(true);
    try {
      mockList.mockResolvedValue([]);
      await act(async () => {
        await renderExpo();
      });
      // Hidden at mount still REGISTERS the backstop — :203 gates the tick,
      // not the setInterval itself.
      expect(timers.created.filter((t) => t.ms === EXPO_POLL_MS)).toHaveLength(1);
      const mounted = mockList.mock.calls.length; // the mount fetch (:220-222)
      expect(mounted).toBeGreaterThanOrEqual(1);

      await act(async () => {
        vi.advanceTimersByTime(3 * EXPO_POLL_MS + 1500);
      });
      // Three ticks fired, zero IPC: a hidden board costs nothing. Drop the
      // !document.hidden check at :203 and this line is the first to know.
      expect(mockList.mock.calls.length).toBe(mounted);

      setDocHidden(false);
      await act(async () => {
        vi.advanceTimersByTime(EXPO_POLL_MS + 500);
      });
      // Visible again with NO event dispatched and no re-subscribe: the SAME
      // interval resumes, which also proves the skip above was the gate and
      // not a dead timer.
      expect(mockList.mock.calls.length).toBeGreaterThan(mounted);
    } finally {
      restoreDocHidden();
      timers.restore();
      vi.useRealTimers();
    }
  });
});
