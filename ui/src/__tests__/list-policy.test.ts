import { describe, it, expect } from 'vitest';
import {
  LIST_PAGE_SIZE,
  LIST_VIRTUALIZE_THRESHOLD_PAGES,
  paginate,
  totalPages,
} from '@/utils/list-policy';

/**
 * PERF-07 — unit tests for the shared large-list policy.
 *
 * Includes 1k/10k-row fixtures proving DOM/node work stays bounded: the
 * paginated slice is always exactly one page regardless of dataset size.
 */
describe('list-policy (PERF-07)', () => {
  it('paginate returns the active page slice', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(items, 0)).toHaveLength(LIST_PAGE_SIZE);
    expect(paginate(items, 1)[0]).toBe(LIST_PAGE_SIZE);
    expect(paginate(items, 2)).toHaveLength(20);
  });

  it('paginate clamps negative pages and out-of-range pages to a valid slice', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(paginate(items, -5)).toHaveLength(LIST_PAGE_SIZE);
    expect(paginate(items, 99)).toHaveLength(0); // no crash, empty page
  });

  it('totalPages is always at least 1', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(1)).toBe(1);
    expect(totalPages(LIST_PAGE_SIZE)).toBe(1);
    expect(totalPages(LIST_PAGE_SIZE + 1)).toBe(2);
  });

  it('honours a custom page size', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(paginate(items, 0, 10)).toHaveLength(10);
    expect(totalPages(100, 10)).toBe(10);
  });

  it('keeps rendered rows bounded at 1k-row fixture (one page of DOM)', () => {
    const big = Array.from({ length: 1_000 }, (_, i) => i);
    const page = paginate(big, 7);
    expect(page).toHaveLength(LIST_PAGE_SIZE);
    expect(totalPages(big.length)).toBe(20);
    // Every page is exactly one page — never more.
    for (let p = 0; p < totalPages(big.length); p++) {
      const slice = paginate(big, p);
      expect(slice.length).toBeLessThanOrEqual(LIST_PAGE_SIZE);
    }
  });

  it('keeps rendered rows bounded at 10k-row fixture (one page of DOM)', () => {
    const huge = Array.from({ length: 10_000 }, (_, i) => i);
    const page = paginate(huge, 199);
    expect(page).toHaveLength(LIST_PAGE_SIZE);
    expect(totalPages(huge.length)).toBe(200);
    // Spot-check first/middle/last pages stay within the page bound.
    expect(paginate(huge, 0).length).toBeLessThanOrEqual(LIST_PAGE_SIZE);
    expect(paginate(huge, 100).length).toBeLessThanOrEqual(LIST_PAGE_SIZE);
    expect(paginate(huge, 199).length).toBeLessThanOrEqual(LIST_PAGE_SIZE);
  });

  it('page 2 offsets correctly — a page is a window, not a copy of page 1', () => {
    // R3 acceptance: the bounded list path must move by `page * pageSize`,
    // not re-render the first page. Every assertion below fails if `offset`
    // (the `start` in `paginate`) is ignored.
    const rows = Array.from({ length: 250 }, (_, i) => i);

    const page0 = paginate(rows, 0);
    const page1 = paginate(rows, 1);
    const page2 = paginate(rows, 2);

    // The window actually advances.
    expect(page0[0]).toBe(0);
    expect(page1[0]).toBe(LIST_PAGE_SIZE);
    expect(page2[0]).toBe(2 * LIST_PAGE_SIZE);
    expect(page2).toHaveLength(LIST_PAGE_SIZE);

    // Disjoint windows: an ignored offset makes these two identical.
    expect(page1).not.toEqual(page0);
    const overlap = page2.filter((row) => page1.includes(row));
    expect(overlap).toEqual([]);

    // Concatenating every page reproduces the dataset exactly once — no row
    // dropped by the offset arithmetic and none rendered twice.
    const reassembled = Array.from({ length: totalPages(rows.length) }, (_, p) =>
      paginate(rows, p),
    ).flat();
    expect(reassembled).toEqual(rows);
  });

  it('documents the virtualization threshold constant', () => {
    // The audit's contract: datasets beyond this many pages should be
    // evaluated for virtualization; below it bounded paging suffices.
    expect(LIST_VIRTUALIZE_THRESHOLD_PAGES).toBe(20);
    expect(LIST_VIRTUALIZE_THRESHOLD_PAGES * LIST_PAGE_SIZE).toBe(1_000);
  });
});
