/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// Unit tests for itemDone — pure predicate that checks whether a KDS
// line item has been served or cancelled (i.e., is "done").

import { describe, it, expect } from 'vitest';
import { itemDone } from '@/features/kds/components/KdsTicketCard';
import type { KdsLineItem } from '@/api/kds';

function makeItem(status: string): KdsLineItem {
  return {
    id: '1',
    kds_order_id: 'order-1',
    sku: 'SKU',
    display_name: 'Item',
    qty: 1,
    course: null,
    modifiers: [],
    line_position: 0,
    item_status: status,
    started_at: null,
    ready_at: null,
    served_at: null,
    created_at: new Date().toISOString(),
  };
}

describe('itemDone', () => {
  it('returns true for served items', () => {
    expect(itemDone(makeItem('served'))).toBe(true);
  });

  it('returns true for cancelled items', () => {
    expect(itemDone(makeItem('cancelled'))).toBe(true);
  });

  it('returns false for pending items', () => {
    expect(itemDone(makeItem('pending'))).toBe(false);
  });

  it('returns false for preparing items', () => {
    expect(itemDone(makeItem('preparing'))).toBe(false);
  });

  it('returns false for ready items', () => {
    expect(itemDone(makeItem('ready'))).toBe(false);
  });

  it('returns false for unknown statuses', () => {
    expect(itemDone(makeItem('unknown'))).toBe(false);
    expect(itemDone(makeItem(''))).toBe(false);
  });
});
