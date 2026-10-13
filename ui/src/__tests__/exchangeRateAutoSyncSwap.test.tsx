// ── Does a token swap race the auto-sync guard? (shared-ref, no remount) ──
//
// Round 80 measured that switching the token through the workspace mock REMOUNTS the
// screen, so the guard cannot fire (each instance gets its own `useRef`). This file
// asks the question that measurement left open: is there a path where the ref IS
// shared, so the guard is load-bearing?
//
// There is. `WorkspaceContext.swapSessionToken` (ADR #6) hot-swaps the token WITHOUT
// resetting the active workspace or instance -- it exists for FastPINOverlay, i.e. a
// SHARED TOUCHSCREEN where one operator hands over to the next. The screen stays
// mounted. `loadAutoSync` deps on `[sessionToken]`, so the callback identity changes,
// the effect re-runs, and BOTH reads share one `autoSyncSeqRef`.
//
// This is the scenario the guard was written for. If the mutation survives HERE too,
// then the guard is dead code and should be deleted rather than annotated.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProvidersSync, rerenderWithProviders } from '@/__tests__/test-utils/render';
import currencyFtl from '@/locales/currency.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import ExchangeRateScreen from '@/features/currency/ExchangeRateScreen';

const workspaceMock = vi.hoisted(() => ({ sessionToken: 'token-A' }));
const mockGetSettingScoped = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: workspaceMock.sessionToken,
    activeWorkspace: 'store-pos',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    availableWorkspaces: [],
  }),
}));

vi.mock('@/api/settings', () => ({
  getSettingScoped: mockGetSettingScoped,
  setSettingScoped: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/currency', () => ({
  listExchangeRatesScoped: vi.fn().mockResolvedValue([]),
  listCurrenciesScoped: vi.fn().mockResolvedValue([]),
  createExchangeRateScoped: vi.fn(),
  deleteExchangeRateScoped: vi.fn(),
}));

function autoSyncSwitch(): HTMLInputElement {
  return screen.getByRole('switch', { name: /auto-update rates/i }) as HTMLInputElement;
}

describe('ExchangeRateScreen — auto-sync on a hot token swap', () => {
  beforeEach(() => {
    mockGetSettingScoped.mockReset();
    workspaceMock.sessionToken = 'token-A';
  });

  it('keeps the newer read\'s answer when the older one settles late', async () => {
    let releaseStale: (v: string | null) => void = () => {};
    const stalePending = new Promise<string | null>((resolve) => { releaseStale = resolve; });
    let n = 0;
    mockGetSettingScoped.mockImplementation(() => {
      n += 1;
      // Read 1 (token-A) hangs and will answer ON. Read 2 (token-B) answers OFF.
      return n === 1 ? stalePending : Promise.resolve('0');
    });

    const view = renderWithProvidersSync(<ExchangeRateScreen />, currencyFtl, sharedFtl);
    await waitFor(() => expect(mockGetSettingScoped).toHaveBeenCalledTimes(1));

    workspaceMock.sessionToken = 'token-B';
    await act(async () => {
      rerenderWithProviders(view, <ExchangeRateScreen />, currencyFtl, sharedFtl);
    });
    await waitFor(() => expect(mockGetSettingScoped).toHaveBeenCalledTimes(2));

    // The hot swap\'s read won: the switch is OFF.
    await waitFor(() => expect(autoSyncSwitch().checked).toBe(false));

    // The superseded read now settles with ON.
    await act(async () => {
      releaseStale('1');
      await stalePending;
    });

    expect(
      autoSyncSwitch().checked,
      'the SUPERSEDED read set autoSync after the hot swap\'s read had already won. ' +
        'On a shared touchscreen this shows the next operator an ON switch for a store ' +
        'whose rate_sync.enabled is 0.',
    ).toBe(false);
  });

  it('issues both reads against ONE shared sequence ref', async () => {
    // The premise this file rests on. If the second read starts from a fresh ref, the
    // guard cannot fire and the case below would pass for the wrong reason.
    let n = 0;
    const seqs: number[] = [];
    mockGetSettingScoped.mockImplementation(() => {
      seqs.push(++n);
      return Promise.resolve('0');
    });

    const view = renderWithProvidersSync(<ExchangeRateScreen />, currencyFtl, sharedFtl);
    await waitFor(() => expect(mockGetSettingScoped).toHaveBeenCalledTimes(1));

    workspaceMock.sessionToken = 'token-B';
    await act(async () => {
      rerenderWithProviders(view, <ExchangeRateScreen />, currencyFtl, sharedFtl);
    });
    await waitFor(() => expect(mockGetSettingScoped).toHaveBeenCalledTimes(2));

    expect(seqs, 'each read must advance the SAME counter for the race to exist').toEqual([1, 2]);
  });
});
