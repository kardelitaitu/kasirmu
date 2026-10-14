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
// ── hasChanges helper tests ────────────────────────────────────────
//
// Pure function used by all workspace cards for dirty tracking.
//
// ADR #22 Phase 1 testing gate (§9).

import { describe, expect, it } from 'vitest';
import { hasChanges } from '@/features/settings/workspace-cards/helpers';

describe('hasChanges', () => {
  it('returns true when a value differs', () => {
    expect(hasChanges({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(true);
  });

  it('returns false when all values match', () => {
    expect(hasChanges({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(false);
  });

  it('returns true when keys differ (extra key in draft)', () => {
    expect(hasChanges({ a: 1, b: 2 }, { a: 1 } as Record<string, unknown>)).toBe(true);
  });

  it('returns false for two empty objects', () => {
    expect(hasChanges({}, {})).toBe(false);
  });
});
