import { useCallback, useReducer, useRef } from 'react';

/**
 * Typed state machine for the topology editor's save/apply lifecycle.
 *
 * This is the single source of truth for everything that used to be a
 * scatter of booleans in NodeTopologyEditor: whether the authoritative
 * load has settled, the branch document revision, and whether an Apply
 * request is in flight. Keeping these in one reducer makes the transitions
 * testable and prevents the false-success Apply path from ever flipping
 * UI state independently of the actual backend round-trip.
 *
 * Phases:
 *  - `loading`     initial state; the first authoritative load is in flight
 *  - `ready`       load settled; Apply is allowed
 *  - `applying`    an Apply request is in flight (button busy)
 *  - `load-error`  the authoritative load failed; Apply must stay disabled
 *
 * Derivable facts (exposed by the hook):
 *  - `busy`      = phase === 'applying'  (replaces the old `saving` boolean)
 *  - `settled`   = phase !== 'loading'   (replaces the old `topologyLoaded`)
 *  - `revision`  = the canonical branch document revision
 */
export type TopologySavePhase = 'loading' | 'ready' | 'applying' | 'load-error';

export type TopologySaveState = {
  phase: TopologySavePhase;
  revision: number;
};

export type TopologySaveAction =
  | { type: 'load-success'; revision: number }
  | { type: 'load-failure' }
  | { type: 'apply-start' }
  | { type: 'apply-success'; revision: number }
  | { type: 'apply-failure' };

export const initialTopologySaveState: TopologySaveState = {
  phase: 'loading',
  revision: 0,
};

export function topologySaveReducer(
  state: TopologySaveState,
  action: TopologySaveAction,
): TopologySaveState {
  switch (action.type) {
    case 'load-success':
      // A settled reload never interrupts an in-flight Apply (the post-save
      // reload lands while `applying`); it only refreshes the revision.
      return {
        phase: state.phase === 'applying' ? state.phase : 'ready',
        revision: action.revision,
      };
    case 'load-failure':
      // An authoritative load failure disables Apply until a later load
      // succeeds. An in-flight Apply is left alone (its own failure/success
      // action resolves the phase).
      return state.phase === 'applying'
        ? state
        : { ...state, phase: 'load-error' };
    case 'apply-start':
      // Idempotent under re-entrancy: the hook's in-flight ref is the
      // synchronous guard; the reducer refuses a second start anyway.
      return state.phase === 'applying' ? state : { ...state, phase: 'applying' };
    case 'apply-success':
      return { phase: 'ready', revision: action.revision };
    case 'apply-failure':
      // A failed Apply stays dirty and retryable: phase returns to `ready`
      // with the previous revision untouched.
      return state.phase === 'applying'
        ? { ...state, phase: 'ready' }
        : state;
  }
}

/**
 * Hook owning the save-lifecycle reducer plus the synchronous in-flight
 * guard. `beginApply` returns false for a second concurrent request (the
 * reducer alone cannot answer synchronously inside the same tick), and
 * `finishApply` / `failApply` release the guard and advance the phase.
 */
export function useTopologyEditorSaveLifecycle() {
  const [state, dispatch] = useReducer(topologySaveReducer, initialTopologySaveState);
  const inFlightRef = useRef(false);

  const loadSuccess = useCallback((revision: number) => {
    dispatch({ type: 'load-success', revision });
  }, []);
  const loadFailure = useCallback(() => {
    dispatch({ type: 'load-failure' });
  }, []);
  const beginApply = useCallback((): boolean => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    dispatch({ type: 'apply-start' });
    return true;
  }, []);
  const finishApply = useCallback((revision: number) => {
    inFlightRef.current = false;
    dispatch({ type: 'apply-success', revision });
  }, []);
  const failApply = useCallback(() => {
    inFlightRef.current = false;
    dispatch({ type: 'apply-failure' });
  }, []);

  return {
    phase: state.phase,
    revision: state.revision,
    /** True while an Apply request is in flight (button busy). */
    busy: state.phase === 'applying',
    /** True once the first authoritative load has settled (success or error). */
    settled: state.phase !== 'loading',
    /** True when the editor may start an Apply against a settled document. */
    canApply: state.phase === 'ready',
    loadSuccess,
    loadFailure,
    beginApply,
    finishApply,
    failApply,
  };
}
