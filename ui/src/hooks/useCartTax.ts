// ── useCartTax — renderer-level cart-tax cache with failure severity ──
//
// T1 dossier D64 (F2, todo-global-saas ruling 4): a failed
// computeCartTax IPC must never be indistinguishable from a real zero
// (R36-19: the screens' .catch(() => setCartTax(0)) renders zero that is
// indistinguishable from a computed zero). This hook keeps a module-level,
// in-memory cache of the last SUCCESSFUL CartTaxResult per session token,
// tagged with the canonical signature of the cart it was computed for
// (sorted `sku:qty:unit_price_minor` parts + currency). When the live
// compute fails, the cached answer is classified by severity:
//
// - cache signature MATCHES the current cart → `caution`: proceed with
//   the cached display tax; it is tender-eligible (cacheFresh), and no
//   sale recompute flag is raised;
// - cache signature DIFFERS → `warn`: the cached tax is shown but marked
//   `estimated` — BINDING (D64 b): cacheFresh is false, so the consumer
//   must NOT add the display tax to the tender total;
// - no cache → `unknown`: zero is DISPLAYED but zero is NOT CLAIMED.
//
// The cache is deliberately not persisted to disk: it exists only to
// survive the failure window of one IPC call within one session.
// invalidateCartTaxCache() clears it — the tax-configuration writers
// call it after every tax-config write (F2-8, later slice) so a stale
// rate can never re-enter a payload.

import { useEffect, useState } from 'react';
import { computeCartTax, type CartLineTaxInput, type CartTaxResult } from '@/api/tax';

/** One cache entry: the last successful answer + the cart it answers for. */
interface CartTaxCacheEntry {
  result: CartTaxResult;
  signature: string;
  /** Performance.now-style marker of when the entry was written. */
  markedAt: number;
}

/** Module-level, in-memory only (never persisted) cache keyed by session. */
const cartTaxCache = new Map<string, CartTaxCacheEntry>();

/**
 * Canonical cart signature for cache classification: the lines'
 * `sku:qty:unit_price_minor` triples sorted (order-independent) and joined,
 * with the currency appended. Two carts with the same signature are the
 * same taxable question for the cache's purposes.
 */
export function cartTaxSignature(lines: CartLineTaxInput[], currency: string): string {
  const parts = lines.map((l) => `${l.sku}:${l.qty}:${l.unit_price_minor}`).sort();
  return `${parts.join('|')}|${currency}`;
}

/**
 * Drop every cache entry. The tax-configuration writers call this after
 * each successful tax-config write (F2-8, later slice) so a cached
 * answer computed under the OLD configuration can never flow into a
 * failure window under the new one. Purely in-memory; nothing persisted.
 */
export function invalidateCartTaxCache(): void {
  cartTaxCache.clear();
}

/**
 * Severity of the shown cart tax. `ok` = a fresh compute succeeded;
 * the three failure severities (D64 F2): `caution` = cached answer
 * matches the current cart (proceed, no sale flag), `warn` = cached
 * answer is for a different cart (estimated, NOT tender-eligible),
 * `unknown` = nothing to show but zero, and zero is not claimed.
 */
export type CartTaxSeverity = 'ok' | 'caution' | 'warn' | 'unknown';

/** What the hook reports about the shown cart tax. */
export interface CartTaxCacheState {
  severity: CartTaxSeverity;
  /** The tax to DISPLAY, minor units: the cached answer on a cache hit, 0 when unknown. */
  taxMinor: number;
  /** The cached result's hasExclusive; null when unknown (no cache). */
  hasExclusive: boolean | null;
  /** true when the shown value is a stale estimate (cache signature differs from the current cart). */
  estimated: boolean;
  /**
   * BINDING (D64 b): true exactly when the shown tax may be ADDED to the
   * tender total — a fresh successful compute, or a cache entry whose
   * signature matches the current cart (caution). false in `warn` and
   * `unknown`: the display tax must never reach the tender there.
   */
  cacheFresh: boolean;
}

const UNKNOWN_STATE: CartTaxCacheState = {
  severity: 'unknown',
  taxMinor: 0,
  hasExclusive: null,
  estimated: false,
  cacheFresh: false,
};

/**
 * Compute the cart's tax with a failure-window fallback, per the F2
 * dossier. A null session token classifies as `unknown` without an IPC
 * attempt (the API rejects null tokens since F2-2). Successes refresh
 * the module cache; failures classify the cache by signature, exactly
 * as documented at the top of this file.
 */
export function useCartTax(
  sessionToken: string | null,
  lines: CartLineTaxInput[],
  currency: string,
): CartTaxCacheState {
  const [state, setState] = useState<CartTaxCacheState>(UNKNOWN_STATE);
  // The signature (a string) is the dependency, not the lines array:
  // callers map fresh arrays every render, and a content-keyed dep is
  // what keeps one cart from re-computing per render.
  const signature = cartTaxSignature(lines, currency);

  useEffect(() => {
    if (!sessionToken) {
      setState(UNKNOWN_STATE);
      return;
    }
    let cancelled = false;
    computeCartTax(sessionToken, lines, currency)
      .then((result) => {
        if (cancelled) return;
        cartTaxCache.set(sessionToken, { result, signature, markedAt: Date.now() });
        setState({
          severity: 'ok',
          taxMinor: result.taxMinor,
          hasExclusive: result.hasExclusive,
          estimated: false,
          cacheFresh: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        const cached = cartTaxCache.get(sessionToken);
        if (!cached) {
          // Zero shown, zero NOT claimed.
          setState(UNKNOWN_STATE);
        } else if (cached.signature === signature) {
          // Same cart the cached answer was computed for: proceed.
          setState({
            severity: 'caution',
            taxMinor: cached.result.taxMinor,
            hasExclusive: cached.result.hasExclusive,
            estimated: false,
            cacheFresh: true,
          });
        } else {
          // Stale estimate: display only — never added to tender.
          setState({
            severity: 'warn',
            taxMinor: cached.result.taxMinor,
            hasExclusive: cached.result.hasExclusive,
            estimated: true,
            cacheFresh: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature IS the content key of lines
  }, [sessionToken, signature, currency]);

  return state;
}