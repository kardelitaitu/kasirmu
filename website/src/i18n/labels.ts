/**
 * Client-side label lookup for hydrated islands.
 *
 * Every island used to `import { t } from './index'`, which statically pulls
 * `en.json` + `id.json` — measured 19 KB gzip of dictionary shipped to the
 * browser so a component could read five keys. An island now receives the
 * strings it needs as a `labels` prop (built on the server by `labelMap`) and
 * resolves them here; this module imports no dictionary, so it adds only its own
 * few bytes to a page.
 *
 * The keys an island needs are declared in that island's root module (e.g.
 * `PRICING_LABELS` in `PricingGrid.tsx`) so there is exactly one owner per
 * island, and `src/__tests__/island-label-coverage.test.ts` asserts the declared
 * list and the call sites cannot drift apart.
 */
export type Labels = Record<string, string>;

/** Look up `key` in the map an island received as a prop. Falls back to the key. */
export function t(labels: Labels, key: string): string {
  return labels[key] ?? key;
}
