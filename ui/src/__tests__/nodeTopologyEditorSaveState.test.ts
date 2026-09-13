import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  topologySaveReducer,
  useTopologyEditorSaveLifecycle,
  initialTopologySaveState,
  type TopologySaveState,
} from '@/features/locations/nodeTopologyEditorSaveState';

describe('topologySaveReducer', () => {
  it('starts in the loading phase with revision 0', () => {
    expect(initialTopologySaveState).toEqual({ phase: 'loading', revision: 0 });
  });

  it('moves loading → ready with the loaded revision on load-success', () => {
    const next = topologySaveReducer(initialTopologySaveState, { type: 'load-success', revision: 7 });
    expect(next).toEqual({ phase: 'ready', revision: 7 });
  });

  it('moves loading → load-error on load-failure (Apply disabled)', () => {
    const next = topologySaveReducer(initialTopologySaveState, { type: 'load-failure' });
    expect(next.phase).toBe('load-error');
  });

  it('moves load-error → ready when a later load succeeds', () => {
    const afterFailure = topologySaveReducer(initialTopologySaveState, { type: 'load-failure' });
    const next = topologySaveReducer(afterFailure, { type: 'load-success', revision: 3 });
    expect(next).toEqual({ phase: 'ready', revision: 3 });
  });

  it('refuses apply-start while applying (idempotent re-entrancy)', () => {
    const ready: TopologySaveState = { phase: 'ready', revision: 1 };
    const applying = topologySaveReducer(ready, { type: 'apply-start' });
    expect(applying.phase).toBe('applying');
    const again = topologySaveReducer(applying, { type: 'apply-start' });
    expect(again).toBe(applying);
  });

  it('returns to ready with the NEW revision on apply-success', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const next = topologySaveReducer(applying, { type: 'apply-success', revision: 2 });
    expect(next).toEqual({ phase: 'ready', revision: 2 });
  });

  it('returns to ready with the SAME revision on apply-failure (stays dirty, retryable)', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 5 };
    const next = topologySaveReducer(applying, { type: 'apply-failure' });
    expect(next).toEqual({ phase: 'ready', revision: 5 });
  });

  it('keeps an in-flight Apply busy when a post-save reload lands (load-success)', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const next = topologySaveReducer(applying, { type: 'load-success', revision: 2 });
    expect(next.phase).toBe('applying');
    expect(next.revision).toBe(2);
  });

  it('does not interrupt an in-flight Apply on load-failure', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const next = topologySaveReducer(applying, { type: 'load-failure' });
    expect(next.phase).toBe('applying');
  });
});

describe('useTopologyEditorSaveLifecycle', () => {
  it('exposes busy/settled/canApply derived from the phase', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    expect(result.current.phase).toBe('loading');
    expect(result.current.busy).toBe(false);
    expect(result.current.settled).toBe(false);
    expect(result.current.canApply).toBe(false);
    expect(result.current.revision).toBe(0);
  });

  it('guards concurrent Apply requests synchronously', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    act(() => result.current.loadSuccess(1));
    expect(result.current.canApply).toBe(true);

    let first = false;
    let second = false;
    act(() => {
      first = result.current.beginApply();
      second = result.current.beginApply();
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.busy).toBe(true);

    act(() => result.current.finishApply(2));
    expect(result.current.busy).toBe(false);
    expect(result.current.phase).toBe('ready');
    expect(result.current.revision).toBe(2);
  });

  it('releases the guard and stays retryable after apply-failure', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    act(() => result.current.loadSuccess(3));
    act(() => {
      result.current.beginApply();
      result.current.failApply();
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.phase).toBe('ready');
    expect(result.current.revision).toBe(3);
    expect(result.current.canApply).toBe(true);
  });

  it('moves to load-error and stays settled (Apply disabled) after a load failure', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    act(() => result.current.loadFailure());
    expect(result.current.phase).toBe('load-error');
    expect(result.current.settled).toBe(true);
    expect(result.current.canApply).toBe(false);
  });
});
