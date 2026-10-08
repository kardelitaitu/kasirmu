import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  setRegionalConfigScoped,
  getRegionalConfigScoped,
  getActiveMarketProfileScoped,
  type RegionalConfig,
  type ActiveMarketProfile,
} from '@/api/regional';

describe('regional.ts API contract', () => {
  const TOKEN = 'tok_regional';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getRegionalConfigScoped calls the canonical command with the location id', async () => {
    const config: RegionalConfig = {
      location_id: 'default',
      legal_entity_id: 'default:default-legal-entity',
      country_code: null,
      locale: { value: 'en-US', scope: 'built_in' },
      timezone: { value: 'Asia/Jakarta', scope: 'location' },
      currency: { value: 'IDR', scope: 'location' },
    };
    mockInvoke.mockResolvedValue(config);
    const result = await getRegionalConfigScoped(TOKEN, 'default');
    expect(mockInvoke).toHaveBeenCalledWith('get_regional_config_scoped', {
      sessionToken: TOKEN,
      locationId: 'default',
    });
    // The stored IANA name passes through untouched (ADR #48 — no offset
    // derivation client-side).
    expect(result.timezone.value).toBe('Asia/Jakarta');
    expect(result.timezone.scope).toBe('location');
  });

  it('setRegionalConfigScoped sends the config payload and the location id', async () => {
    mockInvoke.mockResolvedValue({
      location_id: 'default',
      legal_entity_id: 'default:default-legal-entity',
      country_code: 'ID',
      locale: { value: 'id-ID', scope: 'location' },
      timezone: { value: 'Asia/Makassar', scope: 'location' },
      currency: { value: 'IDR', scope: 'location' },
    });
    const result = await setRegionalConfigScoped(TOKEN, 'default', {
      locale: 'id-ID',
      timezone: 'Asia/Makassar',
      currency: 'IDR',
      country_code: 'ID',
    });
    // Slice-3 wire shape: the location id top-level, the axis payload as a
    // single `config` object (snake_case field names, like the read model).
    expect(mockInvoke).toHaveBeenCalledWith('set_regional_config_scoped', {
      sessionToken: TOKEN,
      locationId: 'default',
      config: {
        locale: 'id-ID',
        timezone: 'Asia/Makassar',
        currency: 'IDR',
        country_code: 'ID',
      },
    });
    expect(result.currency.value).toBe('IDR');
  });

  it('exposes the ADR #48 timezone presets for the card select', async () => {
    const { REGIONAL_TIMEZONE_PRESETS } = await import('@/api/regional');
    expect(REGIONAL_TIMEZONE_PRESETS).toEqual(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']);
  });

  it('getActiveMarketProfileScoped calls the canonical command with location id and session token', async () => {
    const profile: ActiveMarketProfile = {
      location_id: 'loc-1',
      legal_entity_id: 'ent-1',
      country_code: 'ID',
      currency: 'IDR',
      default_locale: 'id-ID',
      timezone: 'Asia/Jakarta',
      tax_regime: 'PB1',
      statutory_rounding: 'half_up',
      enabled_payment_rails: ['cash', 'card', 'qris'],
    };
    mockInvoke.mockResolvedValue(profile);
    const result = await getActiveMarketProfileScoped(TOKEN, 'loc-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_active_market_profile_scoped', {
      sessionToken: TOKEN,
      locationId: 'loc-1',
    });
    expect(result.location_id).toBe('loc-1');
    expect(result.country_code).toBe('ID');
    expect(result.statutory_rounding).toBe('half_up');
    expect(result.enabled_payment_rails).toEqual(['cash', 'card', 'qris']);
  });
});

