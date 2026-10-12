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
import { describe, it, expect } from 'vitest';
import { addStationToList } from '@/features/kds/components/KdsEnrollmentModal';

describe('addStationToList', () => {
  it('appends a new trimmed station', () => {
    expect(addStationToList(['Front Bar'], 'Kitchen')).toEqual(['Front Bar', 'Kitchen']);
  });

  it('trims surrounding whitespace', () => {
    expect(addStationToList(['A'], '  Bar  ')).toEqual(['A', 'Bar']);
  });

  it('rejects empty / whitespace-only input', () => {
    expect(addStationToList(['A'], '')).toEqual(['A']);
    expect(addStationToList(['A'], '   ')).toEqual(['A']);
  });

  it('rejects a duplicate (case-sensitive)', () => {
    expect(addStationToList(['Kitchen'], 'Kitchen')).toEqual(['Kitchen']);
    expect(addStationToList(['Kitchen'], 'kitchen')).toEqual(['Kitchen', 'kitchen']);
  });

  it('rejects a duplicate that only differs by trailing whitespace', () => {
    expect(addStationToList(['Bar'], 'Bar  ')).toEqual(['Bar']);
  });

  it('returns the same array reference when unchanged', () => {
    const input = ['A'];
    expect(addStationToList(input, '  ')).toBe(input);
  });

  it('handles an empty initial list', () => {
    expect(addStationToList([], 'First')).toEqual(['First']);
  });
});
