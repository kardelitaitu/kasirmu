import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useTopologyEditorRestoreSeed,
  type TopologyRestoreSeed,
} from '@/features/locations/nodeTopologyEditorRestoreState';

const seed = (id: string): TopologyRestoreSeed => ({
  nodes: [{ id, type: 'store', name: id, x: 0, y: 0 }],
  wires: [],
});

describe('useTopologyEditorRestoreSeed', () => {
  it('applies each non-null seed object once and ignores clearing the prop', () => {
    const apply = vi.fn();
    const first = seed('first');
    const second = seed('second');
    type RestoreProps = { restoreSeed: TopologyRestoreSeed | null };
    const { rerender } = renderHook(
      ({ restoreSeed }: RestoreProps) => useTopologyEditorRestoreSeed(restoreSeed, apply),
      { initialProps: { restoreSeed: null } as RestoreProps },
    );

    rerender({ restoreSeed: first });
    rerender({ restoreSeed: first });
    rerender({ restoreSeed: null });
    rerender({ restoreSeed: second });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, first);
    expect(apply).toHaveBeenNthCalledWith(2, second);
  });

  it('does not apply a seed before the effect flushes', () => {
    const apply = vi.fn();
    const first = seed('first');
    renderHook(() => useTopologyEditorRestoreSeed(first, apply));
    expect(apply).toHaveBeenCalledTimes(1);
    act(() => undefined);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
