import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockGetKeyRotationInfo = vi.fn();
vi.mock('@/api/security', () => ({
  getKeyRotationInfo: (...args: unknown[]) => mockGetKeyRotationInfo(...args),
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
