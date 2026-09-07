//! Context-value stability probe for WorkspaceProvider.
//!
//! History: the provider passed its value as an inline object literal, so
//! EVERY provider re-render (auth churn, picker-ticket refreshes, parent
//! re-renders) handed all consumers a fresh object and re-rendered them
//! app-wide. The value is now useMemo'd; this probe pins that property.
//!
//! The harness subtlety: re-rendering the provider from a parent also
//! recreates the `children` element, which would re-render the consumer by
//! element identity and mask the context behaviour. Memoizing `children`
//! in the harness pins the element, so the ONLY thing that can re-render
//! the consumer is a context VALUE change — exactly the property under
//! test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useMemo, useReducer } from 'react';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import sharedFtl from '@/locales/shared.ftl?raw';
import { withFluent } from '@/locales/test-utils';

// Opt out of the global setup mock (test-setup.ts keeps the real exports
// but stubs the hooks) — this probe needs the REAL useWorkspace so the
// consumer actually subscribes to context value changes.
vi.unmock('@/contexts/WorkspaceContext');

// ── Dependencies the real provider pulls in (stable across re-renders) ──

vi.mock('@/contexts/AuthContext', () => {
  const AUTH_VALUE = {
    session: null,
    pickerTicket: null,
    updatePickerTicket: undefined,
  };
  return {
    useAuth: () => AUTH_VALUE,
  };
});

vi.mock('@/api/workspaces', () => ({
  listWorkspaces: vi.fn(() => Promise.resolve([])),
  listWorkspaceScreens: vi.fn(() => Promise.resolve([])),
  resolveBootStore: vi.fn(() =>
    Promise.resolve({ is_bound: false, store_id: 'default', instance_id: null }),
  ),
}));

vi.mock('@/api/staff', () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(() => Promise.resolve()),
  refreshPickerTicket: vi.fn(),
}));

vi.mock('@/api/system', () => ({
  getDeviceId: vi.fn(() => Promise.resolve('test-terminal')),
}));

// ── Render-count consumer ─────────────────────────────────────────

// Property mutation (not variable reassignment) keeps the render-purity
// lint quiet — same shape as nodeTopologyMemo's counting records.
const counts = vi.hoisted(() => ({ consumer: 0 }));

function CountingConsumer() {
  counts.consumer += 1;
  // Touch the value the way real consumers do (the hook throws outside a
  // provider, which also proves the provider is live).
  useWorkspace();
  return null;
}

// ── Harness: memoized children so only the context value can churn ──

function Harness() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const children = useMemo(() => <CountingConsumer />, []);
  return (
    <>
      <button type="button" onClick={force} data-testid="force-provider">
        force
      </button>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </>
  );
}

function renderHarness() {
  return render(withFluent(<Harness />, sharedFtl));
}

beforeEach(() => {
  counts.consumer = 0;
});

describe('WorkspaceProvider value stability', () => {
  it('provider re-renders that change no value field do not re-render consumers', () => {
    renderHarness();

    // Mount settles: initial render + the boot effects' state writes.
    const mountRenders = counts.consumer;
    expect(mountRenders).toBeGreaterThan(0);

    // Force the provider to re-render 5 times. Its state fields are
    // unchanged, every captured callback is useCallback-stable, so the
    // memoized value must keep its identity and the consumer must not
    // re-render even once.
    const forceButton = screen.getByTestId('force-provider');
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(forceButton);
    }

    expect(counts.consumer).toBe(mountRenders);
  });

  it('the value still updates when a real field changes', async () => {
    // Guard against over-memoizing: the memo is keyed on the value fields,
    // so a real field change must still propagate. The cheapest observable
    // field is loading — flipped by retry()'s setLoading via the error
    // path... but retry() bails without a picker ticket. Instead re-render
    // with a changed terminalId by remounting? Simplest honest check: the
    // terminalId effect resolves after mount and writes state, which must
    // reach the consumer.
    const probe = renderHarness();
    const initial = counts.consumer;

    // getDeviceId resolves → setTerminalId('test-terminal') → value change
    // → consumer re-render. (The state starts '' and becomes
    // 'test-terminal', a real field change.)
    await waitFor(() => {
      expect(counts.consumer).toBeGreaterThan(initial);
    });
    probe.unmount();
  });
});
