import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  topologyConnectionReducer,
  useTopologyEditorConnection,
  initialTopologyConnectionState,
  type TopologyConnectionState,
  type TopologyPickerState,
} from '@/features/locations/nodeTopologyEditorConnectionState';

const picker = (): TopologyPickerState => ({
  fromNodeId: 'ws-1',
  fromPort: 'right',
  fromVariantIndex: 0,
  toNodeId: 'wh-1',
  toPort: 'left',
  toVariantIndex: 0,
  options: [],
});

describe('topologyConnectionReducer', () => {
  it('starts with no connection and no picker', () => {
    expect(initialTopologyConnectionState).toEqual({
      fromNodeId: null,
      fromPort: null,
      fromVariantIndex: 0,
      picker: null,
    });
  });

  it('begin arms a connection from a node port', () => {
    const next = topologyConnectionReducer(initialTopologyConnectionState, {
      type: 'begin',
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
    });
    expect(next.fromNodeId).toBe('ws-1');
    expect(next.fromPort).toBe('right');
    expect(next.fromVariantIndex).toBe(0);
    expect(next.picker).toBeNull();
  });

  it('begin closes any open picker when re-arming from a fresh port', () => {
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: picker(),
    };
    const next = topologyConnectionReducer(withPicker, {
      type: 'begin',
      fromNodeId: 'ws-9',
      fromPort: 'bottom',
      fromVariantIndex: 0,
    });
    expect(next.fromNodeId).toBe('ws-9');
    expect(next.picker).toBeNull();
  });

  it('open-picker keeps the armed connection and records the pending choice', () => {
    const armed: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: null,
    };
    const next = topologyConnectionReducer(armed, { type: 'open-picker', picker: picker() });
    expect(next.picker).toEqual(picker());
    expect(next.fromNodeId).toBe('ws-1');
  });

  it('cancel clears BOTH the connection and the picker atomically', () => {
    // Regression: dismissing the picker (canvas click, drag start, touch)
    // must also clear the armed connection — a stale source port click must
    // not be able to complete a wire after the choice was abandoned.
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: picker(),
    };
    const next = topologyConnectionReducer(withPicker, { type: 'cancel' });
    expect(next).toEqual({ fromNodeId: null, fromPort: null, fromVariantIndex: 0, picker: null });
  });

  it('cancel is a no-op when nothing is in flight', () => {
    const next = topologyConnectionReducer(initialTopologyConnectionState, { type: 'cancel' });
    expect(next).toEqual(initialTopologyConnectionState);
  });

  it('dismiss-picker clears both when a picker is open (canvas click away)', () => {
    // Clicking away from an open picker must behave like Escape: the whole
    // gesture dies, so no stale source port click can complete a wire.
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: picker(),
    };
    const next = topologyConnectionReducer(withPicker, { type: 'dismiss-picker' });
    expect(next).toEqual({ fromNodeId: null, fromPort: null, fromVariantIndex: 0, picker: null });
  });

  it('dismiss-picker leaves a plain armed connection alone (carry behavior)', () => {
    // A connection with NO picker open survives a canvas click — the user
    // may be panning to a distant target. Only an open picker makes the
    // dismissal a full cancel.
    const armed: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: null,
    };
    const next = topologyConnectionReducer(armed, { type: 'dismiss-picker' });
    expect(next).toEqual(armed);
  });
});

describe('useTopologyEditorConnection', () => {
  it('exposes the connection and picker state', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());
    expect(result.current.fromNodeId).toBeNull();
    expect(result.current.fromPort).toBeNull();
    expect(result.current.picker).toBeNull();
  });

  it('cancelConnection clears the connection AND an open picker together', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.openPicker(picker()));
    expect(result.current.picker).not.toBeNull();

    act(() => result.current.cancelConnection());
    expect(result.current.fromNodeId).toBeNull();
    expect(result.current.fromPort).toBeNull();
    expect(result.current.picker).toBeNull();
  });

  it('beginConnection closes any open picker when a fresh connection starts', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.openPicker(picker()));
    act(() => result.current.beginConnection('store-1', 'right'));
    expect(result.current.fromNodeId).toBe('store-1');
    expect(result.current.picker).toBeNull();
  });

  it('dismissPicker clears an open picker and its connection, but not a plain armed connection', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());

    // Open picker: dismissal is a full cancel.
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.openPicker(picker()));
    act(() => result.current.dismissPicker());
    expect(result.current.fromNodeId).toBeNull();
    expect(result.current.picker).toBeNull();

    // Plain armed connection (no picker): survives a canvas click.
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.dismissPicker());
    expect(result.current.fromNodeId).toBe('ws-1');
    expect(result.current.picker).toBeNull();
  });
});
