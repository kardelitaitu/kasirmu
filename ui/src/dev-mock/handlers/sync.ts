/**
 * Dev-mock handlers — cloud-sync controls & receipt/drawer hardware stubs.
 *
 * Extracted verbatim out of `tauri-api.ts`'s `entryHandlers` literal by
 * todo-refactor-devmock-router-consolidation.md **Phase 5.3**. Every body here is
 * a self-contained literal (the only globals are `Date.now()` / `new Date()`), so
 * — like the bundles in Phase 5.2 and unlike the location family in Phase 5.1 —
 * the move needs no shared-state seam; it is a pure copy that preserves each
 * handler's behaviour and the `sync_pull` destructive-consent contract verbatim.
 *
 * Deferred by name, not forgotten: `get_local_ip` (a system singleton) and
 * `get_low_stock_alerts` (an inventory singleton) also sit in the Phase 5.3 list
 * but stay in the router for now, because folding them into a "sync" module would
 * misrepresent what this file owns; they want their own properly-named home.
 */
import type { MockHandler } from '../core/mockDispatcher';

export const syncHandlers: Record<string, MockHandler> = {
  'open_cash_drawer': () => ({ opened: true }),
  'print_receipt': () => ({ printedLines: 3 }),
  'retry_offline_sync': () => ({ syncedCount: 0, failedCount: 0, totalCount: 0 }),

  'get_sync_settings': () => ({ serverUrl: null, hasApiKey: false, enabled: false }),
  'get_sync_settings_scoped': () => ({ serverUrl: null, hasApiKey: false, enabled: false }),
  'update_sync_settings': () => null,
  'sync_run': () => ({ synced: 0, failed: 0, error: null }),

  'pending_sync_count': () => 0,
  'sync_pull': (args: unknown) => {
    // SYNC-03: reject without explicit destructive consent, mirroring the
    // backend command contract so dev-mode behaviour matches production.
    const a = (args ?? {}) as { confirmDestructive?: boolean };
    if (!a.confirmDestructive) {
      throw new Error('confirmDestructive must be true to proceed with sync pull');
    }
    return { productsPulled: 0, taxRatesPulled: 0, usersPulled: 0, error: null };
  },
  'test_sync_connection': () => ({ ok: true, status: 'connected', latencyMs: 12 }),
  'request_sync_token': () => ({ ok: true, token: 'mock-jwt-token', status: 'issued', expiresAt: new Date(Date.now() + 86400000).toISOString() }),

  // ── Sync-conflict review (scoped-only) ─────────────────────────────
  // Moved verbatim out of `tauri-api.ts`'s in-place `handlers['x'] = …`
  // patches by todo-refactor-devmock-router-consolidation.md Phase 5.5; both
  // keys `git grep`-confirmed single-defined so the move is a pure copy.
  // The mock has no cloud to ask, so it reports "nothing flagged" — the screen
  // must render its empty state rather than crash. The resolve stub returns
  // false, the honest answer for a row that does not exist: callers treat it as
  // "already resolved elsewhere", which is exactly what an empty mock is.
  'list_sync_conflicts_scoped': () => [],
  'resolve_sync_conflict_scoped': () => false,

  // Sales-receipt print — moved verbatim from `tauri-api.ts`'s entryHandlers
  // literal (Phase 5.5), next to its sibling `print_receipt` in the same
  // receipt-hardware family. Pure self-contained stub, single-defined (git
  // grep); the explicit `_scoped` twin is preserved verbatim so
  // applyScopedAliases (run later in the router) mirrors nothing over it.
  'print_sales_receipt': () => ({ printed: true }),
  'print_sales_receipt_scoped': () => ({ printed: true }),
};
