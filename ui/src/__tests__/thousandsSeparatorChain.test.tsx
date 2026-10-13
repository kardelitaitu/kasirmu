// ── The thousands-separator chain, end to end ───────────────────────
//
// Every link below has a unit test. None of them proves the links join:
//
//   StoreSettingsDto.thousandsSeparator   (the Rust passthrough, e84ccdc62)
//     -> SettingsContext writes localStorage  (BOTH loads, 443349a60)
//       -> formatMoney reads that bridge       (the default, e0ffa8213)
//         -> a screen's rendered figure
//
// Rounds 49-52 built those links one at a time, and round 52 found the last one was
// inert — the value was seeded and the formatter still defaulted to a literal. A unit
// test per link could not see that, because each link was correct.
//
// This file drives the CHAIN with the real SettingsProvider and the real formatMoney.
// It is the only test that fails if any single link is removed while its siblings stay
// green — kill-tested by reverting e0ffa8213's one-line default, which fails exactly
// the 'comma' case below.
//
// Mocks follow SettingsContext.test.tsx's per-module pattern (one vi.mock per api
// module). Mocking them all out of @/api/settings instead was caught by
// mockSurfaceStatic.test.ts: four names I invented there do not exist in the real
// module, which is precisely the dead-key class that guard exists to find.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { formatMoney } from '@/types/domain';
import { getThousandsSep } from '@/utils/storage';

const { mockStoreSettings } = vi.hoisted(() => ({
  mockStoreSettings: {
    name: 'Test Store',
    address: '123 Main St',
    taxId: 'TAX-001',
    currency: 'IDR',
    branch: '',
    thousandsSeparator: undefined as string | undefined,
  },
}));

vi.mock('@/api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/settings')>();
  return {
    ...actual,
    getStoreSettingsScoped: () => Promise.resolve({ ...mockStoreSettings }),
    getReceiptSettingsScoped: () => Promise.resolve(actual.getReceiptSettingsScoped('t')),
  };
});
vi.mock('@/api/offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/offline')>();
  return {
    ...actual,
    getSyncSettingsScoped: () => Promise.resolve(null),
    pendingOfflineCountScoped: actual.pendingOfflineCountScoped,
  };
});
vi.mock('@/api/currency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/currency')>();
  return { ...actual, listCurrenciesScoped: () => Promise.resolve([]) };
});
vi.mock('@/api/branding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/branding')>();
  return { ...actual, getBrandSettingsScoped: () => Promise.resolve(null) };
});
vi.mock('@/api/system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/system')>();
  return {
    ...actual,
    getVersionScoped: () => Promise.resolve(null),
    getDeviceId: () => Promise.resolve('test-device-id'),
  };
});
vi.mock('@/api/terminals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/terminals')>();
  return { ...actual, listTerminalsScoped: () => Promise.resolve([]) };
});

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'test-token', storeId: 'test-store' }),
  useWorkspaceScope: () => ({ storeId: 'test-store' }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

const IDR_15000 = { minor_units: 15000, currency: 'IDR' };

describe('the thousands separator reaches a rendered figure', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Mount the real provider, which runs the real load and write-through. */
  async function mountProvider() {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    return result;
  }

  it('a store that configures dot groups money with dots on screen', async () => {
    mockStoreSettings.thousandsSeparator = 'dot';
    await mountProvider();

    expect(getThousandsSep()).toBe('dot');
    expect(formatMoney(IDR_15000, 'id-ID', 'comma')).toBe('Rp 15.000');
  });

  it('a store that configures comma groups money with commas on screen', async () => {
    // The reason the printer honours a vocabulary: an Indonesian store can ask for
    // the international convention, and the PREVIEW must follow its choice.
    mockStoreSettings.thousandsSeparator = 'comma';
    await mountProvider();

    expect(getThousandsSep()).toBe('comma');
    expect(formatMoney(IDR_15000, 'id-ID', 'comma')).toBe('Rp 15,000');
  });

  it('a store that configures none gets no store opinion, and the locale decides', async () => {
    // 'Rp 15.000' — measured, and this is the case that corrected my own
    // understanding. 'none' means NO store opinion, so the formatter falls through to
    // `Intl.NumberFormat`, whose grouping for id-ID is dots. For an INDONESIAN store
    // that is the same string 'dot' produces, so the two agree by a coincidence of the
    // locale rather than by design.
    //
    // That coincidence is why the vocabulary exists: 'comma' is the only way an
    // Indonesian store gets the international convention, and 'space' the only way it
    // gets a French-style gap. An earlier draft of this case asserted 'Rp 15000' on the
    // assumption that 'none' meant ungrouped — it does not.
    mockStoreSettings.thousandsSeparator = 'none';
    await mountProvider();

    expect(getThousandsSep()).toBe('none');
    expect(formatMoney(IDR_15000, 'id-ID', 'comma')).toBe('Rp 15.000');
  });

  it('a store that never configured anything is not restyled', async () => {
    // An absent field and an explicit 'none' must land on the SAME default, which is
    // the assertion this case is about: they do. Both render 'Rp 15.000' through the
    // id-ID locale, so a payload that stops carrying the field changes nothing about
    // what a store already prints.
    mockStoreSettings.thousandsSeparator = undefined;
    await mountProvider();

    expect(getThousandsSep(), 'an absent field must not invent a separator').toBe('none');
    expect(formatMoney(IDR_15000, 'id-ID', 'comma')).toBe('Rp 15.000');
  });

  it('relies on the load, not on a seeded store initial value', async () => {
    // The write-through must come from the DTO. If SettingsContext stopped reading
    // `thousandsSeparator`, formatMoney would silently fall back to the locale and
    // this figure — which asks for the international convention — would come back
    // ungrouped-by-store, which is exactly the divergence rounds 49-52 closed.
    mockStoreSettings.thousandsSeparator = 'comma';
    await mountProvider();

    expect(formatMoney(IDR_15000, 'id-ID', 'comma')).toBe('Rp 15,000');
  });
});
