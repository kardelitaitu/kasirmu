/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── demo-mode tests ──────────────────────────────────────────────
//
// Covers the LOAD-03 demo-data gate: dev builds always allow demo
// data, production builds only with VITE_DEMO_MODE=1, and the exact
// '1' string match (no '0', '', or other truthy strings).
//
// Uses vi.stubEnv so each branch is exercised without rebuilds.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDemoMode } from '@/utils/demo-mode';

describe('isDemoMode (LOAD-03)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows demo data in dev builds regardless of the flag', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_DEMO_MODE', '');

    expect(isDemoMode()).toBe(true);
  });

  it('blocks demo data in prod builds when the flag is unset', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', '');

    expect(isDemoMode()).toBe(false);
  });

  it('allows demo data in prod builds opted in via VITE_DEMO_MODE=1', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', '1');

    expect(isDemoMode()).toBe(true);
  });

  it('rejects VITE_DEMO_MODE=0 in prod builds (exact match required)', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', '0');

    expect(isDemoMode()).toBe(false);
  });

  it('rejects other truthy-looking strings like "yes" in prod builds', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', 'yes');

    expect(isDemoMode()).toBe(false);
  });
});
