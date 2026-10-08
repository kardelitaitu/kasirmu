import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useActiveMarketProfile } from '@/hooks/useActiveMarketProfile';
import { getPrimaryLocationScoped } from '@/api/locations';
import { getActiveMarketProfileScoped, type ActiveMarketProfile } from '@/api/regional';

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: vi.fn(),
}));

vi.mock('@/api/regional', () => ({
  getActiveMarketProfileScoped: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'test-session-token',
  }),
}));

const mockPrimary = vi.mocked(getPrimaryLocationScoped);
const mockProfile = vi.mocked(getActiveMarketProfileScoped);

const sampleProfile: ActiveMarketProfile = {
  location_id: 'loc-test',
  legal_entity_id: 'ent-test',
  country_code: 'ID',
  currency: 'IDR',
  default_locale: 'id-ID',
  timezone: 'Asia/Jakarta',
  tax_regime: 'PB1',
  statutory_rounding: 'half_up',
  enabled_payment_rails: ['cash', 'card', 'qris'],
};

describe('useActiveMarketProfile', () => {
  beforeEach(() => {
    mockPrimary.mockReset();
    mockProfile.mockReset();
  });

  it('loads active market profile for the primary location', async () => {
    mockPrimary.mockResolvedValue({ id: 'loc-test' } as unknown as Awaited<ReturnType<typeof getPrimaryLocationScoped>>);
    mockProfile.mockResolvedValue(sampleProfile);

    const { result } = renderHook(() => useActiveMarketProfile());
    expect(result.current.loading).toBe(true);
    expect(result.current.profile).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toEqual(sampleProfile);
    expect(mockPrimary).toHaveBeenCalledWith('test-session-token');
    expect(mockProfile).toHaveBeenCalledWith('test-session-token', 'loc-test');
  });

  it('handles empty primary location gracefully', async () => {
    mockPrimary.mockResolvedValue(null);

    const { result } = renderHook(() => useActiveMarketProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('handles bridge failure and captures error', async () => {
    mockPrimary.mockResolvedValue({ id: 'loc-test' } as unknown as Awaited<ReturnType<typeof getPrimaryLocationScoped>>);
    mockProfile.mockRejectedValue(new Error('core error: db connection lost'));

    const { result } = renderHook(() => useActiveMarketProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.error?.message).toContain('core error');
  });

  it('shares single in-flight promise between concurrent callers', async () => {
    mockPrimary.mockResolvedValue({ id: 'loc-test' } as unknown as Awaited<ReturnType<typeof getPrimaryLocationScoped>>);
    mockProfile.mockResolvedValue(sampleProfile);

    const a = renderHook(() => useActiveMarketProfile());
    const b = renderHook(() => useActiveMarketProfile());

    await waitFor(() => {
      expect(a.result.current.profile).toEqual(sampleProfile);
      expect(b.result.current.profile).toEqual(sampleProfile);
    });

    expect(mockPrimary).toHaveBeenCalledTimes(1);
    expect(mockProfile).toHaveBeenCalledTimes(1);
  });

  it('allows manual reload to refresh the profile', async () => {
    mockPrimary.mockResolvedValue({ id: 'loc-test' } as unknown as Awaited<ReturnType<typeof getPrimaryLocationScoped>>);
    mockProfile.mockResolvedValue(sampleProfile);

    const { result } = renderHook(() => useActiveMarketProfile());
    await waitFor(() => expect(result.current.profile).toEqual(sampleProfile));

    const updatedProfile: ActiveMarketProfile = {
      ...sampleProfile,
      tax_regime: 'PPN',
    };
    mockProfile.mockResolvedValue(updatedProfile);

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.profile?.tax_regime).toBe('PPN'));
    expect(mockProfile).toHaveBeenCalledTimes(2);
  });
});
