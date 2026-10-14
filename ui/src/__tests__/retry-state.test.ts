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
// ── Retry-state contract unit tests (ERR-09) ─────────────────────
//
// The async-load state contract standardizes idle/loading/refreshing/
// success/error so retry and refresh flows behave identically across
// screens. The critical rule: a reload with data on screen must derive
// `refreshing` (rows stay visible), never `loading` (blank skeleton).

import { describe, it, expect } from 'vitest';
import { deriveAsyncPhase, type AsyncPhase } from '@/utils/retry-state';

describe('deriveAsyncPhase (ERR-09 contract)', () => {
  it('derives idle when nothing loaded yet', () => {
    expect(deriveAsyncPhase({ loading: false, error: false, hasData: false })).toBe('idle');
  });

  it('derives loading for an initial load with no data', () => {
    expect(deriveAsyncPhase({ loading: true, error: false, hasData: false })).toBe('loading');
  });

  it('derives refreshing when a reload is in flight with data visible', () => {
    // The key rule: rows must stay on screen during a retry/refresh.
    expect(deriveAsyncPhase({ loading: true, error: false, hasData: true })).toBe('refreshing');
  });

  it('derives success when data is present and not loading', () => {
    expect(deriveAsyncPhase({ loading: false, error: false, hasData: true })).toBe('success');
  });

  it('derives error when the last load failed and no data is usable', () => {
    expect(deriveAsyncPhase({ loading: false, error: true, hasData: false })).toBe('error');
  });

  it('derives staleError when the last load failed but previous data remains', () => {
    expect(deriveAsyncPhase({ loading: false, error: true, hasData: true })).toBe('staleError');
  });

  it('loading wins over a stale error flag while a reload is in flight', () => {
    // While retrying after an initial failure, the phase is loading (not a
    // stale error) because a request is actively in flight.
    expect(deriveAsyncPhase({ loading: true, error: true, hasData: false })).toBe('loading');
  });

  it('covers the full AsyncPhase union exhaustively', () => {
    const all: AsyncPhase[] = [];
    const seen = new Set<AsyncPhase>();
    for (const loading of [false, true]) {
      for (const error of [false, true]) {
        for (const hasData of [false, true]) {
          const p = deriveAsyncPhase({ loading, error, hasData });
          all.push(p);
          seen.add(p);
        }
      }
    }
    // Every derived value is a member of the documented contract.
    for (const p of all) {
      expect(['idle', 'loading', 'refreshing', 'success', 'error', 'staleError']).toContain(p);
    }
    // The full contract surface is exercised (idle/loading/refreshing/success/error/staleError).
    expect(seen.size).toBe(6);
  });
});
