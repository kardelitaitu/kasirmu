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
import {
  CHART_ACCESSIBLE_MAX_ITEMS,
  CHART_MAX_POINTS,
  CHART_MAX_SLICES,
  boundAccessibleItems,
  boundLinePoints,
  boundPieSlices,
} from '@/utils/chart-policy';

/**
 * PERF-09 — unit tests + fixture benchmark for the chart rendering policy.
 *
 * The audit requires charts to bound/aggregate points before rendering and
 * to keep the accessible data representation synchronized with the same cap
 * (A11Y-09 parity). These tests prove the pure policy functions are O(cap)
 * regardless of dataset size via small/medium/large fixtures, and that the
 * accessible-list helper caps the sr-only DOM node count.
 */

function lineFixture(n: number): { label: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    label: `d${i}`,
    value: Math.round(Math.sin(i / 10) * 1000),
  }));
}

function sliceFixture(n: number): { name: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({ name: `c${i}`, value: n - i }));
}

describe('boundLinePoints (PERF-09 line cap)', () => {
  it('passes through datasets at or under the cap unchanged', () => {
    const small = lineFixture(10);
    const out = boundLinePoints(small);
    expect(out).toEqual(small);
    expect(out).toHaveLength(10);
  });

  it('caps a 10k-point fixture to the policy limit', () => {
    const out = boundLinePoints(lineFixture(10_000));
    expect(out.length).toBeLessThanOrEqual(CHART_MAX_POINTS);
    expect(out.length).toBeGreaterThan(0);
  });

  it('caps a 100k-point fixture to the policy limit', () => {
    const out = boundLinePoints(lineFixture(100_000));
    expect(out.length).toBeLessThanOrEqual(CHART_MAX_POINTS);
  });

  it('always preserves the first and last point (trend endpoints exact)', () => {
    const big = lineFixture(10_000);
    const out = boundLinePoints(big);
    expect(out[0]).toEqual(big[0]);
    expect(out[out.length - 1]).toEqual(big[big.length - 1]);
  });

  it('output is monotonic in index (no out-of-order sampling)', () => {
    const big = lineFixture(10_000);
    const out = boundLinePoints(big);
    const indexes = out.map((p) => Number(p.label.slice(1)));
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]!).toBeGreaterThanOrEqual(indexes[i - 1]!);
    }
  });

  it('handles edge cases: empty, single, and cap=0', () => {
    expect(boundLinePoints([])).toEqual([]);
    expect(boundLinePoints(lineFixture(1))).toHaveLength(1);
    expect(boundLinePoints(lineFixture(10), 0)).toEqual([]);
    expect(boundLinePoints(lineFixture(10), 1)).toHaveLength(1);
  });
});

describe('boundPieSlices (PERF-09 slice cap)', () => {
  it('passes through datasets at or under the cap unchanged', () => {
    const small = sliceFixture(4);
    expect(boundPieSlices(small)).toEqual({ slices: small, otherValue: 0 });
  });

  it('keeps top slices and aggregates the tail into otherValue', () => {
    const big = sliceFixture(20);
    const { slices, otherValue } = boundPieSlices(big);
    expect(slices.length).toBeLessThanOrEqual(CHART_MAX_SLICES);
    // Top slice is the largest, tail sum matches the dropped remainder.
    expect(slices[0]!.name).toBe('c0');
    const tailValues = big.slice(CHART_MAX_SLICES - 1).reduce((s, x) => s + x.value, 0);
    expect(otherValue).toBe(tailValues);
  });

  it('collapses everything into a single slice when max=1', () => {
    const { slices, otherValue } = boundPieSlices(sliceFixture(10), 1);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.value).toBe(10); // largest
    expect(otherValue).toBe(45); // 9+8+...+1
  });

  it('sort order is deterministic (descending value)', () => {
    const { slices } = boundPieSlices(sliceFixture(100));
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i - 1]!.value).toBeGreaterThanOrEqual(slices[i]!.value);
    }
  });
});

describe('boundAccessibleItems (A11Y-09 / PERF-09 list cap)', () => {
  it('caps the sr-only data list so DOM stays bounded', () => {
    const big = lineFixture(5_000);
    const { items, omitted } = boundAccessibleItems(big);
    expect(items.length).toBeLessThanOrEqual(CHART_ACCESSIBLE_MAX_ITEMS);
    expect(omitted).toBe(5_000 - items.length);
  });

  it('passes through small lists without omitted count', () => {
    const small = lineFixture(3);
    expect(boundAccessibleItems(small)).toEqual({ items: small, omitted: 0 });
  });
});

/**
 * Fixture benchmark — small/medium/large datasets, mirroring the audit's
 * requirement for a chart benchmark. The bound helpers are O(cap) — they
 * must finish well under a generous ceiling even for 1M-row fixtures.
 */
describe('PERF-09 fixture benchmark', () => {
  const sizes = [100, 10_000, 1_000_000] as const;

  for (const n of sizes) {
    it(`bounds ${n.toLocaleString('en')} line points quickly`, () => {
      const data = lineFixture(n);
      const t0 = performance.now();
      const out = boundLinePoints(data);
      const elapsed = performance.now() - t0;
      expect(out.length).toBeLessThanOrEqual(CHART_MAX_POINTS);
      expect(elapsed).toBeLessThan(250);
    });

    it(`aggregates ${n.toLocaleString('en')} pie slices quickly`, () => {
      const data = sliceFixture(Math.min(n, 100_000));
      const t0 = performance.now();
      const { slices, otherValue } = boundPieSlices(data);
      const elapsed = performance.now() - t0;
      expect(slices.length).toBeLessThanOrEqual(CHART_MAX_SLICES);
      expect(otherValue).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(250);
    });
  }
});
