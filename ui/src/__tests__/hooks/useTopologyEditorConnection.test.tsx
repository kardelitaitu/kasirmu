import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTopologyEditorConnection,
  topologyConnectionReducer,
  initialTopologyConnectionState,
  type TopologyConnectionState,
  type TopologyPickerState,
} from '@/features/locations/nodeTopologyEditorConnectionState';

describe('useTopologyEditorConnection', () => {
  let hook: { result: { current: ReturnType<typeof useTopologyEditorConnection> } };

  beforeEach(() => {
    hook = renderHook(() => useTopologyEditorConnection());
  });

  it('initializes with no connection or picker', () => {
    expect(hook.result.current.fromNodeId).toBeNull();
    expect(hook.result.current.fromPort).toBeNull();
    expect(hook.result.current.picker).toBeNull();
  });

  it('beginConnection sets source and clears picker', () => {
    act(() => {
      hook.result.current.beginConnection('n1', 'right');
    });

    expect(hook.result.current.fromNodeId).toBe('n1');
    expect(hook.result.current.fromPort).toBe('right');
    expect(hook.result.current.picker).toBeNull();
  });

  it('openPicker sets picker state', () => {
    const picker: TopologyPickerState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      toNodeId: 'n2',
      toPort: 'left',
      toVariantIndex: 0,
      options: [{ fromPortId: 'operation-out', toPortId: 'operation-in', relationshipType: 'generic', labelId: 'test' }],
    };

    act(() => {
      hook.result.current.beginConnection('n1', 'right');
      hook.result.current.openPicker(picker);
    });

    expect(hook.result.current.picker).toEqual(picker);
    expect(hook.result.current.fromNodeId).toBe('n1');
    expect(hook.result.current.fromPort).toBe('right');
  });

  it('cancelConnection clears both connection and picker', () => {
    const picker: TopologyPickerState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      toNodeId: 'n2',
      toPort: 'left',
      toVariantIndex: 0,
      options: [],
    };

    act(() => {
      hook.result.current.beginConnection('n1', 'right');
      hook.result.current.openPicker(picker);
    });

    act(() => {
      hook.result.current.cancelConnection();
    });

    expect(hook.result.current.fromNodeId).toBeNull();
    expect(hook.result.current.fromPort).toBeNull();
    expect(hook.result.current.picker).toBeNull();
  });

  it('dismissPicker clears picker and connection when picker exists', () => {
    const picker: TopologyPickerState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      toNodeId: 'n2',
      toPort: 'left',
      toVariantIndex: 0,
      options: [],
    };

    act(() => {
      hook.result.current.beginConnection('n1', 'right');
      hook.result.current.openPicker(picker);
    });

    act(() => {
      hook.result.current.dismissPicker();
    });

    expect(hook.result.current.fromNodeId).toBeNull();
    expect(hook.result.current.fromPort).toBeNull();
    expect(hook.result.current.picker).toBeNull();
  });

  it('dismissPicker keeps connection when no picker', () => {
    act(() => {
      hook.result.current.beginConnection('n1', 'right');
    });

    act(() => {
      hook.result.current.dismissPicker();
    });

    expect(hook.result.current.fromNodeId).toBe('n1');
    expect(hook.result.current.fromPort).toBe('right');
    expect(hook.result.current.picker).toBeNull();
  });

  it('beginConnection closes existing picker', () => {
    const picker: TopologyPickerState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      toNodeId: 'n2',
      toPort: 'left',
      toVariantIndex: 0,
      options: [],
    };

    act(() => {
      hook.result.current.beginConnection('n1', 'right');
      hook.result.current.openPicker(picker);
    });

    act(() => {
      hook.result.current.beginConnection('n3', 'left');
    });

    expect(hook.result.current.fromNodeId).toBe('n3');
    expect(hook.result.current.fromPort).toBe('left');
    expect(hook.result.current.picker).toBeNull();
  });

  it('beginConnection replaces existing connection', () => {
    act(() => {
      hook.result.current.beginConnection('n1', 'right');
    });

    act(() => {
      hook.result.current.beginConnection('n2', 'left');
    });

    expect(hook.result.current.fromNodeId).toBe('n2');
    expect(hook.result.current.fromPort).toBe('left');
    expect(hook.result.current.picker).toBeNull();
  });
});

describe('topologyConnectionReducer (unit)', () => {
  it('begin sets connection and clears picker', () => {
    const state = topologyConnectionReducer(initialTopologyConnectionState, {
      type: 'begin',
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
    });
    expect(state).toEqual({ fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, picker: null });
  });

  it('open-picker sets picker', () => {
    const withConnection: TopologyConnectionState = { fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, picker: null };
    const picker: TopologyPickerState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      toNodeId: 'n2',
      toPort: 'left',
      toVariantIndex: 0,
      options: [],
    };
    const state = topologyConnectionReducer(withConnection, { type: 'open-picker', picker });
    expect(state).toEqual({ fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, picker });
  });

  it('cancel clears both connection and picker', () => {
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: { fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, toNodeId: 'n2', toPort: 'left', toVariantIndex: 0, options: [] },
    };
    const state = topologyConnectionReducer(withPicker, { type: 'cancel' });
    expect(state).toEqual({ fromNodeId: null, fromPort: null, fromVariantIndex: 0, picker: null });
  });

  it('dismiss-picker clears both when picker exists', () => {
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: { fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, toNodeId: 'n2', toPort: 'left', toVariantIndex: 0, options: [] },
    };
    const state = topologyConnectionReducer(withPicker, { type: 'dismiss-picker' });
    expect(state).toEqual({ fromNodeId: null, fromPort: null, fromVariantIndex: 0, picker: null });
  });

  it('dismiss-picker keeps connection when no picker', () => {
    const withConnection: TopologyConnectionState = { fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, picker: null };
    const state = topologyConnectionReducer(withConnection, { type: 'dismiss-picker' });
    expect(state).toEqual({ fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, picker: null });
  });

  it('begin replaces existing connection and picker', () => {
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'n1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: { fromNodeId: 'n1', fromPort: 'right', fromVariantIndex: 0, toNodeId: 'n2', toPort: 'left', toVariantIndex: 0, options: [] },
    };
    const state = topologyConnectionReducer(withPicker, {
      type: 'begin',
      fromNodeId: 'n3',
      fromPort: 'left',
      fromVariantIndex: 0,
    });
    expect(state).toEqual({ fromNodeId: 'n3', fromPort: 'left', fromVariantIndex: 0, picker: null });
  });
});