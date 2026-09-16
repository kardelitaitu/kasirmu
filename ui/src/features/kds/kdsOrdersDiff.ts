// ── KDS ticket-board diffing ───────────────────────────────────────
//
// The pure comparison behind the PERF-KDS-01 render guard on both POS boards:
// given the orders already on screen and the payload a re-fetch just returned,
// are they the same board?
//
// This lived inside KdsScreen.tsx and was exported from there, which left
// ExpoScreen importing a comparator from a sibling *screen component* -- two
// boards sharing logic by one of them owning it. The function never referred to
// the screen, so the move is byte-for-byte.

import type { KdsOrder } from '@/api/kds';

/**
 * PERF-KDS-01: shallow structural comparison of two ticket boards.
 *
 * `kds:orders-changed` fires for every write anywhere in the order
 * pipeline, so most re-fetches return a payload identical to what is
 * already on screen. Replacing state unconditionally re-rendered every
 * ticket card (each running a 1 Hz SLA timer and a line-item fetch), which
 * on WebView2 saturated the PostMessage queue. Only the fields the board
 * actually renders are compared.
 */
export function sameOrders(a: KdsOrder[], b: KdsOrder[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.status !== y.status ||
      x.items_summary !== y.items_summary ||
      x.item_count !== y.item_count ||
      x.display_number !== y.display_number ||
      x.received_at !== y.received_at ||
      x.kitchen_zone !== y.kitchen_zone ||
      x.table_number !== y.table_number ||
      x.notes !== y.notes ||
      x.priority !== y.priority
    ) {
      return false;
    }
  }
  return true;
}
