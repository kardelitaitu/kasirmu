// Unit tests for arrivedOrderIds and orderIdSet — the pair behind the KDS arrival
// animation.
//
// These had NO test before 2026-10-07. The loop they came from lived inline in
// KdsScreen.tsx fetchOrders, and the only two suites that mention newOrderIds
// (KdsLayoutMasonry, emptyStateCompliance) pass an empty Set as a PROP — so
// nothing exercised the diff itself. Extracting it to kdsOrdersDiff.ts, beside
// sameOrders, is what made it reachable; this file is the coverage that follows.

import { describe, it, expect } from 'vitest';
import { arrivedOrderIds, orderIdSet } from '@/features/kds/kdsOrdersDiff';
import type { KdsOrder } from '@/api/kds';

function order(id: string): KdsOrder {
  return { id } as KdsOrder;
}

function ids(...list: string[]): KdsOrder[] {
  return list.map(order);
}

describe('orderIdSet', () => {
  it('collects every id', () => {
    expect([...orderIdSet(ids('a', 'b', 'c'))]).toEqual(['a', 'b', 'c']);
  });

  it('is empty for an empty board', () => {
    expect(orderIdSet([]).size).toBe(0);
  });

  it('collapses duplicates, since it is a Set', () => {
    // Defensive: the API should not return duplicates, but the comparison the
    // caller makes is by membership, so a duplicate must not count twice.
    expect(orderIdSet(ids('a', 'a')).size).toBe(1);
  });
});

describe('arrivedOrderIds', () => {
  it('reports every id on a FIRST fetch, when the previous set is empty', () => {
    const out = arrivedOrderIds(new Set(), ids('a', 'b'));
    expect([...out].sort()).toEqual(['a', 'b']);
  });

  it('reports nothing when the board is unchanged', () => {
    expect(arrivedOrderIds(new Set(['a', 'b']), ids('a', 'b')).size).toBe(0);
  });

  it('reports only the genuinely new ticket', () => {
    const out = arrivedOrderIds(new Set(['a']), ids('a', 'b'));
    expect([...out]).toEqual(['b']);
  });

  it('does not re-report a ticket that changed status', () => {
    // The arrival animation is keyed on IDENTITY, not content: a ticket moving
    // preparing -> ready keeps its id and must not animate in again.
    const out = arrivedOrderIds(new Set(['a']), ids('a'));
    expect(out.size).toBe(0);
  });

  it('reports nothing when the board empties', () => {
    // A cleared board has no arrivals; the caller must not start its 3s timer.
    expect(arrivedOrderIds(new Set(['a', 'b']), []).size).toBe(0);
  });

  it('reports a ticket that REAPPEARS after being absent, because the diff is not a history', () => {
    // Deliberate, and worth pinning rather than assuming: the "previous" set is
    // the immediately prior board, not an accumulated one. A ticket excluded by
    // the zone filter and then included again IS compared against a set that did
    // not contain it, so it animates again. That is the behaviour the code has;
    // the case documents it instead of asserting the other one.
    const out = arrivedOrderIds(new Set(['b']), ids('a', 'b'));
    expect([...out]).toEqual(['a']);
  });

  it('does not mutate the previous set it is given', () => {
    const prev = new Set(['a']);
    arrivedOrderIds(prev, ids('a', 'b'));
    expect([...prev]).toEqual(['a']);
  });

  it('shares no identity with the input array', () => {
    const out = arrivedOrderIds(new Set(), ids('a'));
    expect(out).not.toBe(ids('a'));
    expect(out.has('a')).toBe(true);
  });
});
