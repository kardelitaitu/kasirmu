import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { getRegionalConfigScoped, type RegionalConfig } from '@/api/regional';

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
});
