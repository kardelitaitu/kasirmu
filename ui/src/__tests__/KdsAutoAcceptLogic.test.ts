// Unit tests for auto-accept logic — the pure eligibility checks and delay
// calculation behind the auto-advance effect in KdsScreen.tsx.
//
// This suite used to declare its own delayMs() and isEligible(). The copy was not
// equivalent, and said so at the time:
//
//     if (inFlight.has(order.status)) return false; // simplified -- real impl checks order.id
//
// The production guard keys on ORDER ID. The copy keyed on STATUS, and the one test named
// "rejects when order is in-flight" fed it new Set(['pending']) -- a status -- so it passed
// against a rule the application does not implement. Two pending tickets sharing a status
// would have been blocked by the copy and are both advanced by production; nothing in the
// suite could tell the difference, because the suite and the copy agreed with each other.
//
// Everything now comes from kdsAutoAccept.ts, which KdsScreen's effect calls directly, and
// the in-flight cases use real ids. `now` is injectable, so the clock is an argument rather
// than a vi.useFakeTimers() side effect.

import { describe, it, expect } from 'vitest';
import {
  autoAckDelayMs,
  isAutoAckEligible,
} from '@/features/kds/kdsAutoAccept';

const NOW = Date.parse('2026-09-05T12:00:00Z');

/** Minimal order shape; the real one has more fields the decision never reads. */
function ord(over: Partial<{ id: string; status: string; received_at: string | null }> = {}) {
  // Presence checks, not `??`: `over.received_at ?? DEFAULT` silently replaces an
  // explicit null with the default, which is the very input the null-rejection case
  // exists to feed. The first run of this suite proved it -- that test passed a null and
  // received a timestamp.
  return {
    id: 'id' in over ? over.id! : 'o1',
    status: 'status' in over ? over.status! : 'pending',
    received_at: 'received_at' in over ? over.received_at : '2026-09-05T11:55:00Z',
  } as Parameters<typeof isAutoAckEligible>[0];
}

const prefs = (autoAcknowledge = true, acknowledgeDelayMin = 2) => ({
  autoAcknowledge,
  acknowledgeDelayMin,
});

describe('autoAckDelayMs', () => {
  it('converts 1 min to 60000ms', () => {
    expect(autoAckDelayMs(1)).toBe(60000);
  });

  it('converts 2 min to 120000ms', () => {
    expect(autoAckDelayMs(2)).toBe(120000);
  });

  it('converts 5 min to 300000ms', () => {
    expect(autoAckDelayMs(5)).toBe(300000);
  });

  it('converts 10 min to 600000ms', () => {
    expect(autoAckDelayMs(10)).toBe(600000);
  });
});

describe('isAutoAckEligible', () => {
  it('rejects when autoAcknowledge is off', () => {
    expect(isAutoAckEligible(ord(), new Set(), prefs(false, 2), NOW)).toBe(false);
  });

  it('rejects when delay is 0', () => {
    expect(isAutoAckEligible(ord(), new Set(), prefs(true, 0), NOW)).toBe(false);
  });

  it('rejects non-pending status', () => {
    expect(
      isAutoAckEligible(ord({ status: 'preparing' }), new Set(), prefs(), NOW),
    ).toBe(false);
  });

  it('rejects null received_at', () => {
    expect(
      isAutoAckEligible(ord({ received_at: null }), new Set(), prefs(), NOW),
    ).toBe(false);
  });

  it('rejects invalid received_at', () => {
    expect(
      isAutoAckEligible(ord({ received_at: 'not-a-date' }), new Set(), prefs(), NOW),
    ).toBe(false);
  });

  it('accepts when enough time has elapsed', () => {
    // received 5 minutes ago, delay is 2 minutes
    expect(
      isAutoAckEligible(
        ord({ received_at: '2026-09-05T11:55:00Z' }),
        new Set(),
        prefs(),
        NOW,
      ),
    ).toBe(true);
  });

  it('rejects when not enough time has elapsed', () => {
    // received 1 minute ago, delay is 2 minutes
    expect(
      isAutoAckEligible(
        ord({ received_at: '2026-09-05T11:59:00Z' }),
        new Set(),
        prefs(),
        NOW,
      ),
    ).toBe(false);
  });

  it('accepts exactly at the boundary', () => {
    // production uses `>=`, so an elapsed delay is due, not premature
    expect(
      isAutoAckEligible(
        ord({ received_at: '2026-09-05T11:58:00Z' }),
        new Set(),
        prefs(true, 2),
        NOW,
      ),
    ).toBe(true);
  });

  // ── The in-flight guard, keyed the way production keys it ──────────
  it('rejects when this order id is already in flight', () => {
    expect(
      isAutoAckEligible(ord({ id: 'o7' }), new Set(['o7']), prefs(), NOW),
    ).toBe(false);
  });

  it('still accepts a different order that merely shares a status', () => {
    // The case the old copy could not express: it blocked on inFlight.has(status), so
    // with 'pending' in the set it would return false here. Production advances both.
    expect(
      isAutoAckEligible(ord({ id: 'o8', status: 'pending' }), new Set(['o7']), prefs(), NOW),
    ).toBe(true);
  });

  it('blocks every pending ticket only if every id is in flight', () => {
    const ids = ['a', 'b', 'c'];
    const all = new Set(ids);
    for (const id of ids) {
      expect(isAutoAckEligible(ord({ id }), all, prefs(), NOW)).toBe(false);
    }
    expect(isAutoAckEligible(ord({ id: 'd' }), all, prefs(), NOW)).toBe(true);
  });
});
