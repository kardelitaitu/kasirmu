import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTopologyEditorSaveLifecycle,
  topologySaveReducer,
  initialTopologySaveState,
  type TopologySaveState,
} from '@/features/locations/nodeTopologyEditorSaveState';

describe('useTopologyEditorSaveLifecycle', () => {
  let hook: { result: { current: ReturnType<typeof useTopologyEditorSaveLifecycle> } };

  beforeEach(() => {
    hook = renderHook(() => useTopologyEditorSaveLifecycle());
  });

  it('initializes in loading phase with revision 0', () => {
    expect(hook.result.current.phase).toBe('loading');
    expect(hook.result.current.revision).toBe(0);
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.settled).toBe(false);
    expect(hook.result.current.canApply).toBe(false);
  });

  it('loadSuccess transitions from loading to ready with revision', () => {
    act(() => {
      hook.result.current.loadSuccess(42);
    });

    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(42);
    expect(hook.result.current.settled).toBe(true);
    expect(hook.result.current.canApply).toBe(true);
  });

  it('loadFailure transitions from loading to load-error', () => {
    act(() => {
      hook.result.current.loadFailure();
    });

    expect(hook.result.current.phase).toBe('load-error');
    expect(hook.result.current.revision).toBe(0);
    expect(hook.result.current.settled).toBe(true);
    expect(hook.result.current.canApply).toBe(false);
  });

  it('beginApply returns true and transitions to applying when in ready phase', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
    });

    let result = false;
    act(() => {
      result = hook.result.current.beginApply();
    });

    expect(result).toBe(true);
    expect(hook.result.current.phase).toBe('applying');
    expect(hook.result.current.busy).toBe(true);
    expect(hook.result.current.canApply).toBe(false);
  });

  it('beginApply returns false when already applying', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      hook.result.current.beginApply();
    });

    let result = false;
    act(() => {
      result = hook.result.current.beginApply();
    });

    expect(result).toBe(false);
    expect(hook.result.current.phase).toBe('applying');
  });

  it('beginApply transitions from load-error to applying (reducer allows apply-start from any non-applying phase)', () => {
    act(() => {
      hook.result.current.loadFailure();
    });

    let result = false;
    act(() => {
      result = hook.result.current.beginApply();
    });

    // beginApply returns true and reducer transitions to applying
    expect(result).toBe(true);
    expect(hook.result.current.phase).toBe('applying');
    expect(hook.result.current.busy).toBe(true);
    // canApply is false because phase is applying, not ready
    expect(hook.result.current.canApply).toBe(false);
  });

  it('finishApply transitions to ready with new revision', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      hook.result.current.beginApply();
    });

    act(() => {
      hook.result.current.finishApply(15);
    });

    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(15);
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.canApply).toBe(true);
  });

  it('failApply transitions back to ready with previous revision preserved', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      hook.result.current.beginApply();
    });

    act(() => {
      hook.result.current.failApply();
    });

    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(10);
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.canApply).toBe(true);
  });

  it('loadSuccess during applying updates revision but keeps applying phase', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      hook.result.current.beginApply();
    });

    act(() => {
      hook.result.current.loadSuccess(20);
    });

    expect(hook.result.current.phase).toBe('applying');
    expect(hook.result.current.revision).toBe(20);
    expect(hook.result.current.busy).toBe(true);
  });

  it('loadFailure during applying is ignored (phase stays applying)', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      hook.result.current.beginApply();
    });

    act(() => {
      hook.result.current.loadFailure();
    });

    expect(hook.result.current.phase).toBe('applying');
    expect(hook.result.current.revision).toBe(10);
    expect(hook.result.current.busy).toBe(true);
  });

  it('finishApply without prior beginApply still updates revision (reducer behavior)', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      // Not calling beginApply
      hook.result.current.finishApply(20);
    });

    // finishApply always updates revision per reducer
    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(20);
  });

  it('failApply without prior beginApply is ignored (reducer ignores non-applying)', () => {
    act(() => {
      hook.result.current.loadSuccess(10);
      hook.result.current.failApply();
    });

    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(10);
  });

  it('multiple loadSuccess calls update revision', () => {
    act(() => {
      hook.result.current.loadSuccess(1);
    });
    expect(hook.result.current.revision).toBe(1);

    act(() => {
      hook.result.current.loadSuccess(2);
    });
    expect(hook.result.current.revision).toBe(2);

    act(() => {
      hook.result.current.loadSuccess(3);
    });
    expect(hook.result.current.revision).toBe(3);
  });

  it('complete cycle: loading -> ready -> applying -> ready', () => {
    act(() => {
      hook.result.current.loadSuccess(1);
    });
    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(1);

    act(() => {
      hook.result.current.beginApply();
    });
    expect(hook.result.current.phase).toBe('applying');
    expect(hook.result.current.busy).toBe(true);

    act(() => {
      hook.result.current.finishApply(2);
    });
    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(2);
    expect(hook.result.current.busy).toBe(false);
  });

  it('failed cycle: loading -> ready -> applying -> ready (revision preserved)', () => {
    act(() => {
      hook.result.current.loadSuccess(1);
    });
    expect(hook.result.current.revision).toBe(1);

    act(() => {
      hook.result.current.beginApply();
    });
    expect(hook.result.current.phase).toBe('applying');

    act(() => {
      hook.result.current.failApply();
    });
    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(1); // Preserved
  });

  it('error recovery: loading -> load-error -> loading (via loadSuccess) -> ready', () => {
    act(() => {
      hook.result.current.loadFailure();
    });
    expect(hook.result.current.phase).toBe('load-error');
    expect(hook.result.current.canApply).toBe(false);

    act(() => {
      hook.result.current.loadSuccess(5);
    });
    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.revision).toBe(5);
    expect(hook.result.current.canApply).toBe(true);
  });
});

describe('topologySaveReducer (unit)', () => {
  it('load-success from loading sets ready with revision', () => {
    const state = topologySaveReducer(initialTopologySaveState, { type: 'load-success', revision: 5 });
    expect(state).toEqual({ phase: 'ready', revision: 5 });
  });

  it('load-success from applying keeps applying but updates revision', () => {
    const applyingState: TopologySaveState = { phase: 'applying', revision: 1 };
    const state = topologySaveReducer(applyingState, { type: 'load-success', revision: 5 });
    expect(state).toEqual({ phase: 'applying', revision: 5 });
  });

  it('load-failure from loading sets load-error', () => {
    const state = topologySaveReducer(initialTopologySaveState, { type: 'load-failure' });
    expect(state).toEqual({ phase: 'load-error', revision: 0 });
  });

  it('load-failure from applying is ignored', () => {
    const applyingState: TopologySaveState = { phase: 'applying', revision: 1 };
    const state = topologySaveReducer(applyingState, { type: 'load-failure' });
    expect(state).toEqual({ phase: 'applying', revision: 1 });
  });

  it('apply-start from ready sets applying', () => {
    const readyState: TopologySaveState = { phase: 'ready', revision: 1 };
    const state = topologySaveReducer(readyState, { type: 'apply-start' });
    expect(state).toEqual({ phase: 'applying', revision: 1 });
  });

  it('apply-start from applying is idempotent', () => {
    const applyingState: TopologySaveState = { phase: 'applying', revision: 1 };
    const state = topologySaveReducer(applyingState, { type: 'apply-start' });
    expect(state).toEqual({ phase: 'applying', revision: 1 });
  });

  it('apply-success from applying sets ready with new revision', () => {
    const applyingState: TopologySaveState = { phase: 'applying', revision: 1 };
    const state = topologySaveReducer(applyingState, { type: 'apply-success', revision: 2 });
    expect(state).toEqual({ phase: 'ready', revision: 2 });
  });

  it('apply-failure from applying sets ready with preserved revision', () => {
    const applyingState: TopologySaveState = { phase: 'applying', revision: 1 };
    const state = topologySaveReducer(applyingState, { type: 'apply-failure' });
    expect(state).toEqual({ phase: 'ready', revision: 1 });
  });

  it('apply-failure from non-applying is ignored', () => {
    const readyState: TopologySaveState = { phase: 'ready', revision: 1 };
    const state = topologySaveReducer(readyState, { type: 'apply-failure' });
    expect(state).toEqual({ phase: 'ready', revision: 1 });
  });
});