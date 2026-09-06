import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  listLocationsScoped,
  getLocationProfileScoped,
  getPrimaryLocationScoped,
  createLocationProfileScoped,
  updateLocationProfileScoped,
  setPrimaryLocationScoped,
  deleteLocationProfileScoped,
} from '@/api/locations';

describe('locations.ts API contract', () => {
  const TOKEN = 'tok_location';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listLocationsScoped calls the canonical command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listLocationsScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_locations_scoped', { sessionToken: TOKEN });
  });

  it('getLocationProfileScoped calls the canonical command', async () => {
    mockInvoke.mockResolvedValue({ id: 'location-1', name: 'Main Location' });
    const result = await getLocationProfileScoped(TOKEN, 'location-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_location_profile_scoped', {
      sessionToken: TOKEN,
      id: 'location-1',
    });
    expect(result?.id).toBe('location-1');
  });

  it('getPrimaryLocationScoped calls the canonical command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getPrimaryLocationScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_primary_location_scoped', { sessionToken: TOKEN });
  });

  it('createLocationProfileScoped calls the canonical command', async () => {
    const args = {
      id: 'location-2',
      name: 'New Location',
      address: '123 Main St',
      tax_id: '123',
      currency: 'IDR',
      timezone: 'Asia/Jakarta',
    };
    mockInvoke.mockResolvedValue(args);
    const result = await createLocationProfileScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('create_location_profile_scoped', {
      sessionToken: TOKEN,
      args,
    });
    expect(result.id).toBe('location-2');
  });

  it('updateLocationProfileScoped calls the canonical command', async () => {
    const args = {
      id: 'location-1',
      name: 'Updated Location',
      address: '456 New St',
      tax_id: '456',
      currency: 'IDR',
      timezone: 'Asia/Jakarta',
    };
    mockInvoke.mockResolvedValue(args);
    await updateLocationProfileScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('update_location_profile_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });

  it('setPrimaryLocationScoped calls the canonical command', async () => {
    mockInvoke.mockResolvedValue({ id: 'location-1' });
    await setPrimaryLocationScoped(TOKEN, 'location-1');
    expect(mockInvoke).toHaveBeenCalledWith('set_primary_location_scoped', {
      sessionToken: TOKEN,
      id: 'location-1',
    });
  });

  it('deleteLocationProfileScoped calls the canonical command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteLocationProfileScoped(TOKEN, 'location-1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_location_profile_scoped', {
      sessionToken: TOKEN,
      id: 'location-1',
    });
  });
});
