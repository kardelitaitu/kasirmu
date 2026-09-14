// ExpoScreen (Expediter) tests — todo-kds-agents-3, M2.
//
// Conventions mirror KdsScreen.test.tsx: the @/api/kds module is mocked at
// the boundary via vi.hoisted fakes, useTicketSla/useSound are stubbed, and
// async mount effects render through renderWithFluent.
//
// FIRST TO FAIL PER SEEDED MUTATION (measured, 19 cases): ExpoScreen/10 ALONE
// (1 failed / 18 passed) — the `.then` guard at ExpoScreen.ts:195-196 replaced
// by an unconditional `unlisten = fn`, i.e. the late-settle cancel path deleted.
// /10 is the ONLY assertion of that branch in this file. It is the subscription
// arm only: the setInterval(EXPO_POLL_MS) backstop at :201-204, the
// visibilitychange listener at :206-209 and the clearInterval/remove pair at
// :214-215 are NOT covered by this case — one seam per idiom, because mixing a
// microtask-timing assertion with a timer assertion is how a pin turns flaky.
// (The other two sites of this guard shape: useKdsRealtime.ts:95, pinned by that
// file's late/2, and useUnsavedChangesGuard.ts:81, pinned by that file's /9.)

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

vi.mock('@/frontend/shared/useSound', () => ({
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
});
