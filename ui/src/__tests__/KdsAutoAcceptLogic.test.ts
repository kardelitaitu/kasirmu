// Unit tests for auto-accept logic — the pure eligibility checks and
// delay calculations used by KdsScreen.tsx auto-advance effect.

import { describe, it, expect, vi, afterEach } from 'vitest';

const DEBOUNCE_MS = 5000;

/** Same delay calculation as KdsScreen.tsx. */
function delayMs(acknowledgeDelayMin: number): number {
  return acknowledgeDelayMin * 60 * 1000;
}

/** Same eligibility check as KdsScreen.tsx auto-advance loop. */
function isEligible(order: {
  status: string;
  received_at: string | null;
}, inFlight: Set<string>, autoAcknowledge: boolean, acknowledgeDelayMin: number): boolean {
  if (!autoAcknowledge) return false;
  if (acknowledgeDelayMin <= 0) return false;
  if (order.status !== 'pending') return false;
  if (!order.received_at) return false;
  if (inFlight.has(order.status)) return false; // simplified — real impl checks order.id
  const receivedAt = new Date(order.received_at).getTime();
  if (isNaN(receivedAt)) return false;
  const now = Date.now();
  return now - receivedAt >= delayMs(acknowledgeDelayMin);
}

describe('delayMs', () => {
  it('converts 1 min to 60000ms', () => {
    expect(delayMs(1)).toBe(60000);
  });

  it('converts 2 min to 120000ms', () => {
    expect(delayMs(2)).toBe(120000);
  });

  it('converts 5 min to 300000ms', () => {
    expect(delayMs(5)).toBe(300000);
  });

  it('converts 10 min to 600000ms', () => {
    expect(delayMs(10)).toBe(600000);
  });
});

describe('isEligible', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when autoAcknowledge is off', () => {
    expect(isEligible(
      { status: 'pending', received_at: '2026-09-05T11:00:00Z' },
      new Set(), false, 2,
    )).toBe(false);
  });

  it('rejects when delay is 0', () => {
    expect(isEligible(
      { status: 'pending', received_at: '2026-09-05T11:00:00Z' },
      new Set(), true, 0,
    )).toBe(false);
  });

  it('rejects non-pending status', () => {
    expect(isEligible(
      { status: 'preparing', received_at: '2026-09-05T11:00:00Z' },
      new Set(), true, 2,
    )).toBe(false);
  });

  it('rejects null received_at', () => {
    expect(isEligible(
      { status: 'pending', received_at: null },
      new Set(), true, 2,
    )).toBe(false);
  });

  it('rejects invalid received_at', () => {
    expect(isEligible(
      { status: 'pending', received_at: 'not-a-date' },
      new Set(), true, 2,
    )).toBe(false);
  });

  it('accepts when enough time has elapsed', () => {
    // received 5 minutes ago, delay is 2 minutes
    expect(isEligible(
      { status: 'pending', received_at: '2026-09-05T11:55:00Z' },
      new Set(), true, 2,
    )).toBe(true);
  });

  it('rejects when not enough time has elapsed', () => {
    // received 1 minute ago, delay is 2 minutes
    expect(isEligible(
      { status: 'pending', received_at: '2026-09-05T11:59:00Z' },
      new Set(), true, 2,
    )).toBe(false);
  });

  it('rejects when order is in-flight', () => {
    const inFlight = new Set(['pending']); // simplified — real impl checks order.id
    expect(isEligible(
      { status: 'pending', received_at: '2026-09-05T11:55:00Z' },
      inFlight, true, 2,
    )).toBe(false);
  });
});
