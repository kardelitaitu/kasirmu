/**
 * Tests for the restore tab's submit guard (round 143).
 *
 * `submit` in hooks/useRestore is the one write on this surface and it has no
 * re-entry guard: `submitting` drives the button's `loading` prop, and React commits
 * that on its NEXT render -- after the second dispatch of a real double tap.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/api/data', () => ({
  listRestoreCandidates: vi.fn(),
  getRestoreStatus: vi.fn(),
  prepareRestore: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { renderHook, act } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { ReactNode } from 'react';
import { prepareRestore, listRestoreCandidates, getRestoreStatus, type RestoreCandidate } from '@/api/data';
import { useRestore } from '@/features/settings/hooks/useRestore';

const mockPrepare = prepareRestore as ReturnType<typeof vi.fn>;
const mockList = listRestoreCandidates as ReturnType<typeof vi.fn>;
const mockStatus = getRestoreStatus as ReturnType<typeof vi.fn>;

const candidate: RestoreCandidate = {
  generation: 1,
  path: '/db/store.db.bak-1',
  size_bytes: 2048,
  modified: '2026-10-01T00:00:00Z',
  verdict: 'Acceptable',
  restorable: true,
  reason: '',
  candidate_schema: '012',
  build_schema: '012',
};

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(sharedFtl));
const l10n = new ReactLocalization([bundle]);
function FluentWrapper({ children }: { children: ReactNode }) {
  return <LocalizationProvider l10n={l10n}>{children}</LocalizationProvider>;
}

function setup() {
  const { result } = renderHook(() => useRestore({ sessionToken: 'tok-1', open: true }), {
    wrapper: FluentWrapper,
  });
  act(() => { result.current.startConfirm(candidate); });
  act(() => { result.current.setConfirmName('My Store'); });
  return result;
}

describe('useRestore', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockStatus.mockReset();
    mockPrepare.mockReset();
    mockList.mockResolvedValue({ candidates: [] });
    mockStatus.mockResolvedValue({ pending: false });
  });

  // A double submit must not write the request TWICE.
  //
  // The bridge writes `<db>.restore-request.json` unconditionally (std::fs::write,
  // crates/kasirmu-bridge/src/data/restore.rs:256), so a second write REPLACES the
  // pending request and the LAST WRITE WINS. The pending restore is what actually runs
  // on the next boot, so an operator who double-taps Request restore -- or who picks a
  // different generation in that window -- silently changes which generation is
  // restored. Nothing in the UI reports it: the banner just shows one pending request.
  //
  // SHAPE 3 (round 139): both calls in ONE batch, because `submitting` is state and
  // React commits it after the second call in a real double tap.
  it('writes the restore request once for a double submit', async () => {
    let release: (v: unknown) => void = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    mockPrepare.mockImplementation(() => held as never);
    const result = setup();

    // Both submits before any state commit, which is the real double tap.
    const first = result.current.submit();
    const second = result.current.submit();

    expect(
      mockPrepare.mock.calls.length,
      'a second submit re-wrote the restore request while the first was in flight; the ' +
        'last write wins, so the pending restore silently points at another generation',
    ).toBe(1);

    release(undefined);
    await act(async () => { await first; });
    // The rejected duplicate must not become an unhandled rejection.
    await expect(second).resolves.toBeUndefined();
  });
});