import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockGetKeyRotationInfo = vi.fn();
vi.mock('@/api/security', () => ({
  getKeyRotationInfo: (...args: unknown[]) => mockGetKeyRotationInfo(...args),
}));

// The reminder's messages go through Fluent (they were hardcoded English until
// 2026-10-25), so the hook needs a bundle. The mock resolves ids to readable text and
// honours the { $count } argument, which is what lets the plural case below assert on
// the rendered sentence rather than on the message id.
const mockL10n = vi.hoisted(() => ({
  getString: (id: string, args?: Record<string, unknown>) => {
    const n = args?.['count'];
    if (id === 'settings-key-rotation-overdue') return 'rotation overdue';
    if (id === 'settings-key-rotation-due') {
      return `rotation due in ${String(n)} ${n === 1 ? 'day' : 'days'}`;
    }
    return id;
  },
}));
vi.mock('@fluent/react', () => ({
  useLocalization: () => ({ l10n: mockL10n }),
}));
const mockAddToast = vi.fn();
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

import {
  getKeyAgeDays,
  getDaysUntilRotation,
  useKeyRotationReminder,
  setLocalCreatedAt,
} from '@/hooks/useKeyAge';

// ── getKeyAgeDays ──────────────────────────────────────────────────────

describe('getKeyAgeDays', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns backend ageDays when available', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2026-01-01T00:00:00Z',
      ageDays: 151,
    });

    const days = await getKeyAgeDays();
    expect(days).toBe(151);
  });

  it('syncs localStorage from backend value', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2026-03-01T00:00:00Z',
      ageDays: 92,
    });

    await getKeyAgeDays();
    expect(localStorage.getItem('oz-key-created-at')).toBe('2026-03-01T00:00:00Z');
  });

  it('falls back to localStorage when backend throws', async () => {
    mockGetKeyRotationInfo.mockRejectedValue(new Error('offline'));
    setLocalCreatedAt('2026-01-01T00:00:00Z');

    const days = await getKeyAgeDays();
    // Jan 1 to Jun 1 = 151 days
    expect(days).toBe(151);
  });

  it('returns null when both backend and localStorage are empty', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: false,
      createdAt: null,
      ageDays: null,
    });

    const days = await getKeyAgeDays();
    expect(days).toBeNull();
  });

  it('returns null when localStorage has no stored date', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: false,
      createdAt: null,
      ageDays: null,
    });

    const days = await getKeyAgeDays();
    expect(days).toBeNull();
  });
});

// ── getDaysUntilRotation ───────────────────────────────────────────────

describe('getDaysUntilRotation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns days until 90-day rotation', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2026-01-01T00:00:00Z',
      ageDays: 151,
    });

    const remaining = await getDaysUntilRotation();
    expect(remaining).toBe(-61); // overdue
  });

  it('returns null when key age is unknown', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: false,
      createdAt: null,
      ageDays: null,
    });

    const remaining = await getDaysUntilRotation();
    expect(remaining).toBeNull();
  });

  it('returns positive days when key is young', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2026-05-01T00:00:00Z',
      ageDays: 31,
    });

    const remaining = await getDaysUntilRotation();
    expect(remaining).toBe(59); // 90 - 31
  });
});

// ── useKeyRotationReminder ─────────────────────────────────────────────

describe('useKeyRotationReminder', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockAddToast.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows persistent warning when key is overdue', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2025-10-01T00:00:00Z',
      ageDays: 243,
    });

    renderHook(() => useKeyRotationReminder());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        duration: 0,
        // THE MESSAGE IS ASSERTED, not just the shape. Every case here checked
        // type and duration and none checked the text, which is exactly how two
        // hardcoded English strings survived in a project whose rule is that all
        // user-visible text comes from Fluent. A toast whose body is never read is
        // a toast whose body is never translated.
        message: 'rotation overdue',
      }),
    );
  });

  it('shows info toast when key rotation is due in <= 5 days', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2026-05-27T00:00:00Z',
      ageDays: 88,
    });

    renderHook(() => useKeyRotationReminder());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        duration: 10000,
      }),
    );
  });

  it('does not show toast when key is young', async () => {
    mockGetKeyRotationInfo.mockResolvedValue({
      hasKey: true,
      createdAt: '2026-03-01T00:00:00Z',
      ageDays: 30,
    });

    renderHook(() => useKeyRotationReminder());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockAddToast).not.toHaveBeenCalled();
  });
});
