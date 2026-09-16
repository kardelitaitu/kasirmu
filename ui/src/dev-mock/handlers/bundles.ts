/**
 * Dev-mock handlers — product **bundles**.
 *
 * Extracted verbatim out of `tauri-api.ts`'s `entryHandlers` literal by
 * todo-refactor-devmock-router-consolidation.md **Phase 5.2**. These twelve
 * command stubs (six bundle CRUD/lookup names, each with an explicit `_scoped`
 * twin) were self-contained: they reference no router-local mutable state
 * (unlike the location family Phase 5.1 moved), so the extraction is a pure
 * copy — every handler body is byte-identical to what the router held, and
 * `applyScopedAliases()` still runs last in the router, so the explicit scoped
 * twins are preserved rather than clobbered.
 *
 * The registry position is unchanged for every other domain: `bundlesHandlers`
 * is registered by the router immediately after the remaining `entryHandlers`
 * literal, which is where these keys sat inside it.
 */
import type { MockHandler } from '../core/mockDispatcher';

export const bundlesHandlers: Record<string, MockHandler> = {
  'list_bundles': () => [
    {
      bundle: {
        id: 'bundle-1', bundle_sku: 'BNDL-PC-1', name: 'PC Starter Bundle',
        description: 'CPU + RAM + SSD combo', bundle_price_minor: 11500000, currency: 'IDR',
        active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      items: [
        { id: 'bundle-item-1', bundle_id: 'bundle-1', sku: 'CPU-R5-7600', qty: 1, unit_price_minor: 3150000 },
        { id: 'bundle-item-2', bundle_id: 'bundle-1', sku: 'RAM-D5-32GB-CR', qty: 1, unit_price_minor: 1850000 },
      ],
    },
  ],
  'list_bundles_scoped': () => [
    {
      bundle: {
        id: 'bundle-1', bundle_sku: 'BNDL-PC-1', name: 'PC Starter Bundle',
        description: 'CPU + RAM + SSD combo', bundle_price_minor: 11500000, currency: 'IDR',
        active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      items: [
        { id: 'bundle-item-1', bundle_id: 'bundle-1', sku: 'CPU-R5-7600', qty: 1, unit_price_minor: 3150000 },
        { id: 'bundle-item-2', bundle_id: 'bundle-1', sku: 'RAM-D5-32GB-CR', qty: 1, unit_price_minor: 1850000 },
      ],
    },
  ],
  'get_bundle': () => null,
  'get_bundle_scoped': () => null,
  'create_bundle': () => null,
  'create_bundle_scoped': () => null,
  'update_bundle': () => null,
  'update_bundle_scoped': () => null,
  'delete_bundle': () => null,
  'delete_bundle_scoped': () => null,
  'lookup_bundle_by_sku': () => null,
  'lookup_bundle_by_sku_scoped': () => null,
};
