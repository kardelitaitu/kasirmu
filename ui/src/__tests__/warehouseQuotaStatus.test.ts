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
import { describe, it, expect } from 'vitest';
import { warehouseQuotaStatus } from '@/features/locations/WarehouseQuotaChip';

describe('warehouseQuotaStatus', () => {
  it('treats unlimited tiers (null cap) as never over/at', () => {
    expect(warehouseQuotaStatus(0, null)).toBe('unlimited');
    expect(warehouseQuotaStatus(5, null)).toBe('unlimited');
  });
  it('is ok when below the cap', () => {
    expect(warehouseQuotaStatus(1, 3)).toBe('ok');
    expect(warehouseQuotaStatus(0, 2)).toBe('ok');
  });
  it('is at when equal to the cap', () => {
    expect(warehouseQuotaStatus(2, 2)).toBe('at');
    expect(warehouseQuotaStatus(1, 1)).toBe('at');
  });
  it('is over when above the cap (downgrade scenario)', () => {
    expect(warehouseQuotaStatus(3, 2)).toBe('over');
    expect(warehouseQuotaStatus(4, 3)).toBe('over');
  });
});
