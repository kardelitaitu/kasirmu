import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useKdsPreferences } from '@/features/kds/hooks/useKdsPreferences';

// ── Mocks ────────────────────────────────────────────────────────────

let mockUserId = 'user-1';
let mockSessionToken = 'token-1';
let mockServerPrefs: Record<string, string> | null = null;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: mockUserId ? { user_id: mockUserId } : null,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: mockSessionToken,
  }),
}));

vi.mock('@/api/settings', () => ({
  getUserPreferencesScoped: vi.fn(async () => mockServerPrefs ?? {}),
  setUserPreferencesScoped: vi.fn(async () => {}),
}));

// ── Wrapper ──────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useKdsPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUserId = 'user-1';
    mockSessionToken = 'token-1';
    mockServerPrefs = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns defaults when no localStorage and no server data', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    // Before server resolves — may show defaults.
    expect(['kanban', 'focus', 'metro']).toContain(result.current.prefs.layout);
  });

  it('setLayout updates layout preference', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    act(() => {
      result.current.setLayout('focus');
    });
    expect(result.current.prefs.layout).toBe('focus');
  });

  it('setShowOrderId updates showOrderId preference', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    act(() => {
      result.current.setShowOrderId(false);
    });
    expect(result.current.prefs.showOrderId).toBe(false);
  });

  it('setShowTableNumber updates showTableNumber preference', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    act(() => {
      result.current.setShowTableNumber(false);
    });
    expect(result.current.prefs.showTableNumber).toBe(false);
  });

  it('setKdsZone updates kdsZone preference', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    act(() => {
      result.current.setKdsZone('grill');
    });
    expect(result.current.prefs.kdsZone).toBe('grill');
  });

  it('setAutoAcknowledge updates autoAcknowledge preference', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    act(() => {
      result.current.setAutoAcknowledge(true);
    });
    expect(result.current.prefs.autoAcknowledge).toBe(true);
  });

  it('setAcknowledgeDelay clamps to [1, 10] range', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    // Clamp low.
    act(() => {
      result.current.setAcknowledgeDelay(0);
    });
    expect(result.current.prefs.acknowledgeDelayMin).toBe(1);
    // Clamp high.
    act(() => {
      result.current.setAcknowledgeDelay(100);
    });
    expect(result.current.prefs.acknowledgeDelayMin).toBe(10);
    // Valid value.
    act(() => {
      result.current.setAcknowledgeDelay(5);
    });
    expect(result.current.prefs.acknowledgeDelayMin).toBe(5);
  });

  it('persists to localStorage', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    act(() => {
      result.current.setLayout('metro');
    });
    const stored = localStorage.getItem('oz-kds-prefs-user-1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.layout).toBe('metro');
  });

  it('reads from localStorage on initialization', async () => {
    // Pre-populate localStorage.
    localStorage.setItem('oz-kds-prefs-user-1', JSON.stringify({
      layout: 'focus',
      showOrderId: false,
      showTableNumber: true,
      kdsZone: 'fry',
      autoAcknowledge: true,
      acknowledgeDelayMin: 3,
    }));
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    expect(result.current.prefs.layout).toBe('focus');
    expect(result.current.prefs.showOrderId).toBe(false);
    expect(result.current.prefs.kdsZone).toBe('fry');
    expect(result.current.prefs.autoAcknowledge).toBe(true);
    expect(result.current.prefs.acknowledgeDelayMin).toBe(3);
  });

  it('returns loading=true initially', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    expect(result.current.loading).toBe(true);
  });

  it('sets loading=false after server fetch completes', async () => {
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.loading).toBe(false);
  });

  // A store switch must not let a SLOWER earlier read win -- and here the damage is
  // written to storage rather than rendered (guard added in e19e412e4).
  //
  // Observable is localStorage, which is why this one IS pinnable while the DOM-based
  // guards in this class are not: the success path calls writeLocalPrefs(userId, ...),
  // so a stale read persists the PREVIOUS store's KDS layout under the current user,
  // where it survives a reload and is read back on the next mount before the server
  // answers. The comment at useKdsPreferences.ts:86 calls local storage the INSTANT
  // RESTORE source.
  //
  // The two reads answer with DISTINCTLY DIFFERENT layouts. Same values would make
  // this pass with the guard removed, because the late write would be
  // indistinguishable from the correct one.
  it('ignores a slower earlier server fetch after the token changes', async () => {
    let releaseStale: (v: unknown) => void = () => {};
    const stalePending = new Promise((resolve) => { releaseStale = resolve; });

    // First read held open; it will answer with the PREVIOUS store's layout.
    const api = await import('@/api/settings');
    vi.mocked(api.getUserPreferencesScoped).mockImplementationOnce(
      () => stalePending as never,
    );

    const { rerender } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });

    // Switch stores while the first read is still in flight.
    mockSessionToken = 'token-2';
    mockServerPrefs = { kds_layout: 'focus' };
    rerender();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Now let the stale read land, after the current one already won.
    await act(async () => {
      releaseStale({ kds_layout: 'metro' });
      await stalePending;
      vi.advanceTimersByTime(100);
    });

    // The guard held: storage carries the CURRENT store's layout, not 'metro'.
    const stored = localStorage.getItem('oz-kds-prefs-user-1');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).layout).toBe('focus');
  });

  it('falls back to defaults when localStorage has invalid layout', async () => {
    localStorage.setItem('oz-kds-prefs-user-1', JSON.stringify({
      layout: 'invalid-layout',
      showOrderId: true,
      showTableNumber: true,
      kdsZone: '',
      autoAcknowledge: false,
      acknowledgeDelayMin: 2,
    }));
    const { result } = renderHook(() => useKdsPreferences(), { wrapper: Wrapper });
    expect(result.current.prefs.layout).toBe('kanban');
  });
});
