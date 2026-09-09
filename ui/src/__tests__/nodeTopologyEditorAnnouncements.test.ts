import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactLocalization } from '@fluent/react';
import {
  SELECTION_ANNOUNCE_SETTLE_MS,
  useTopologyEditorAnnouncements,
} from '../features/locations/nodeTopologyEditorAnnouncements';

/** Stand-in ReactLocalization: announces the key plus any args so each
 *  test can pin exactly which key (and args) the hook requested. */
const l10nOf = () => ({
  getString: (key: string, args?: Record<string, unknown>) =>
    args?.['name'] !== undefined
      ? `${key}:${String(args['name'])}`
      : args?.['count'] !== undefined
        ? `${key}:${String(args['count'])}`
        : key,
}) as unknown as ReactLocalization;

type AnnounceDeps = Parameters<typeof useTopologyEditorAnnouncements>[0];

const defaultDeps: AnnounceDeps = {
  alignmentGuide: null,
  selectedNodeIds: new Set<string>(),
  selectedWireId: null,
  nodeMap: new Map<string, { name: string }>([['a', { name: 'Assembly' }]]),
  l10nRef: { current: l10nOf() },
};

/** Delta-merge harness: rerender props override only the fields they
 *  carry, so a test can change one dep without rebuilding the rest. */
const harness = () =>
  renderHook((delta: Partial<AnnounceDeps>) => useTopologyEditorAnnouncements({ ...defaultDeps, ...delta }), {
    initialProps: {},
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('snap-announcement entry latch', () => {
  it('announces once on null → guide entry', () => {
    const h = harness();
    expect(h.result.current.announcement).toBe('');
    h.rerender({ alignmentGuide: { x: 10 } });
    expect(h.result.current.announcement).toBe('topology-snap-announce');
  });

  it('does not re-announce while the guide stays visible (recreated object)', () => {
    const h = harness();
    h.rerender({ alignmentGuide: { x: 10 } });
    const afterEntry = h.result.current.announcement;
    h.rerender({ alignmentGuide: { x: 10 } });
    expect(h.result.current.announcement).toBe(afterEntry);
  });

  it('re-announces after the guide clears and a new approach enters', () => {
    const h = harness();
    h.rerender({ alignmentGuide: { x: 10 } });
    h.rerender({ alignmentGuide: null });
    h.rerender({ alignmentGuide: { y: 20 } });
    expect(h.result.current.announcement).toBe('topology-snap-announce');
  });
});

describe('selection settle debounce', () => {
  it('announces a single selection by node name after the settle window', () => {
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['a']) });
    expect(h.result.current.announcement).toBe('');
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-announce:Assembly');
  });

  it('announces a multi-selection as a count', () => {
    const h = harness();
    h.rerender({
      nodeMap: new Map([['a', { name: 'A' }], ['b', { name: 'B' }]]),
      selectedNodeIds: new Set(['a', 'b']),
    });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-status-selection:2');
  });

  it('announces wire selection and the empty selection (clear)', () => {
    const h = harness();
    h.rerender({ selectedWireId: 'w1' });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-wire-announce');

    h.rerender({ selectedWireId: null, selectedNodeIds: new Set() });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-clear-announce');
  });

  it('folds a marquee flicker 1→2→3 into one announcement with the final set', () => {
    const h = harness();
    const wide = new Map([['a', { name: 'A' }], ['b', { name: 'B' }], ['c', { name: 'C' }]]);
    h.rerender({ selectedNodeIds: new Set(['a']) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS - 1);
    h.rerender({ nodeMap: wide, selectedNodeIds: new Set(['a', 'b']) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS - 1);
    h.rerender({ selectedNodeIds: new Set(['a', 'b', 'c']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-status-selection:3');
  });

  it('does not re-announce when the selection content is unchanged (new Set, same ids)', () => {
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['a']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    const settled = h.result.current.announcement;
    h.rerender({ selectedNodeIds: new Set(['a']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe(settled);
  });

  it('never announces on the initial empty selection', () => {
    const h = harness();
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS * 2));
    expect(h.result.current.announcement).toBe('');
  });

  it('falls back to the raw id when a selected node is missing from the map', () => {
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['ghost']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-announce:ghost');
  });

  it('clears the pending settle timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['a']) });
    clearTimeoutSpy.mockClear();
    h.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('imperative one-shot announcements', () => {
  it('writes the message immediately (layout, duplicate, migration paths)', () => {
    const h = harness();
    act(() => h.result.current.announce('topology-layout-announce'));
    expect(h.result.current.announcement).toBe('topology-layout-announce');
    act(() => h.result.current.announce('topology-duplicate-cancel-announce'));
    expect(h.result.current.announcement).toBe('topology-duplicate-cancel-announce');
  });
});
