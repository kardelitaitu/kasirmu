// Unit tests for sameOrders — pure comparator that checks whether two
// KdsOrder arrays are structurally identical (shallow field comparison).
// Used to prevent unnecessary re-renders when the KDS queue is re-fetched.

import { describe, it, expect } from 'vitest';
import { sameOrders } from '@/features/kds/KdsScreen';
import type { KdsOrder } from '@/api/kds';

/** Minimal KdsOrder builder — only fields compared by sameOrders. */
function order(overrides: Partial<KdsOrder> = {}): KdsOrder {
  return {
    id: '1',
    sale_id: 'sale-1',
    store_id: 'store-1',
    target_instance_id: null,
    status: 'preparing',
    items_summary: '2 items',
    item_count: 2,
    display_number: 1,
    received_at: '2026-01-01T10:00:00Z',
    started_at: null,
    ready_at: null,
    served_at: null,
    prep_time_seconds: 0,
    kitchen_zone: 'front',
    notes: '',
    table_number: 'T1',
    priority: false,
    ...overrides,
  };
}

describe('sameOrders', () => {
  // ── Identity & empty ────────────────────────────────────────────

  it('returns true for the same reference', () => {
    const a = [order()];
    expect(sameOrders(a, a)).toBe(true);
  });

  it('returns true for two empty arrays', () => {
    expect(sameOrders([], [])).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(sameOrders([order()], [])).toBe(false);
    expect(sameOrders([], [order()])).toBe(false);
    expect(sameOrders([order(), order()], [order()])).toBe(false);
  });

  // ── Identical orders ────────────────────────────────────────────

  it('returns true when all compared fields match', () => {
    const a = [order({ id: '1', status: 'ready', kitchen_zone: 'back' })];
    const b = [order({ id: '1', status: 'ready', kitchen_zone: 'back' })];
    expect(sameOrders(a, b)).toBe(true);
  });

  it('returns true for multiple identical orders', () => {
    const a = [order({ id: '1' }), order({ id: '2' })];
    const b = [order({ id: '1' }), order({ id: '2' })];
    expect(sameOrders(a, b)).toBe(true);
  });

  // ── Field-by-field differences ──────────────────────────────────

  it('returns false when id differs', () => {
    const a = [order({ id: '1' })];
    const b = [order({ id: '2' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when status differs', () => {
    const a = [order({ status: 'pending' })];
    const b = [order({ status: 'preparing' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when items_summary differs', () => {
    const a = [order({ items_summary: '2 items' })];
    const b = [order({ items_summary: '3 items' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when item_count differs', () => {
    const a = [order({ item_count: 2 })];
    const b = [order({ item_count: 3 })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when display_number differs', () => {
    const a = [order({ display_number: 1 })];
    const b = [order({ display_number: 2 })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when received_at differs', () => {
    const a = [order({ received_at: '2026-01-01T10:00:00Z' })];
    const b = [order({ received_at: '2026-01-01T10:01:00Z' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when kitchen_zone differs', () => {
    const a = [order({ kitchen_zone: 'front' })];
    const b = [order({ kitchen_zone: 'back' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when table_number differs', () => {
    const a = [order({ table_number: 'T1' })];
    const b = [order({ table_number: 'T2' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when notes differs', () => {
    const a = [order({ notes: 'No onion' })];
    const b = [order({ notes: 'Extra cheese' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns false when priority differs', () => {
    const a = [order({ priority: false })];
    const b = [order({ priority: true })];
    expect(sameOrders(a, b)).toBe(false);
  });

  // ── Null fields ─────────────────────────────────────────────────

  it('returns true when both kitchen_zone are null', () => {
    const a = [order({ kitchen_zone: null })];
    const b = [order({ kitchen_zone: null })];
    expect(sameOrders(a, b)).toBe(true);
  });

  it('returns true when both table_number are null', () => {
    const a = [order({ table_number: null })];
    const b = [order({ table_number: null })];
    expect(sameOrders(a, b)).toBe(true);
  });

  it('returns false when one kitchen_zone is null and other is not', () => {
    const a = [order({ kitchen_zone: null })];
    const b = [order({ kitchen_zone: 'front' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns true when both display_number are null', () => {
    const a = [order({ display_number: null })];
    const b = [order({ display_number: null })];
    expect(sameOrders(a, b)).toBe(true);
  });

  it('returns false when one display_number is null and other is not', () => {
    const a = [order({ display_number: null })];
    const b = [order({ display_number: 1 })];
    expect(sameOrders(a, b)).toBe(false);
  });

  // ── Ignores non-compared fields ─────────────────────────────────

  it('returns true even when non-compared fields differ', () => {
    const a = [order({ sale_id: 'sale-1', started_at: null, prep_time_seconds: 0 })];
    const b = [order({ sale_id: 'sale-2', started_at: '2026-01-01T10:00:00Z', prep_time_seconds: 120 })];
    expect(sameOrders(a, b)).toBe(true);
  });

  // ── Order matters ───────────────────────────────────────────────

  it('returns false when orders are the same but in different positions', () => {
    const a = [order({ id: '1' }), order({ id: '2' })];
    const b = [order({ id: '2' }), order({ id: '1' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  // ── Mixed scenario ──────────────────────────────────────────────

  it('returns false when only one of many orders changes', () => {
    const a = [order({ id: '1' }), order({ id: '2', status: 'preparing' }), order({ id: '3' })];
    const b = [order({ id: '1' }), order({ id: '2', status: 'ready' }), order({ id: '3' })];
    expect(sameOrders(a, b)).toBe(false);
  });

  it('returns true when the middle order is identical in both', () => {
    const a = [order({ id: '1', notes: 'a' }), order({ id: '2', notes: 'b' }), order({ id: '3', notes: 'c' })];
    const b = [order({ id: '1', notes: 'a' }), order({ id: '2', notes: 'b' }), order({ id: '3', notes: 'c' })];
    expect(sameOrders(a, b)).toBe(true);
  });
});
