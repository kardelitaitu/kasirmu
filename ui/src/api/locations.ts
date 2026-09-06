import { loggedInvoke } from '@/utils/logged-invoke';

/** A physical location profile with address and local configuration. */
export interface LocationProfile {
  id: string;
  name: string;
  address: string;
  tax_id: string;
  currency: string;
  timezone: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

/** Arguments for creating a new location profile. */
export interface CreateLocationArgs {
  id: string;
  name: string;
  address?: string;
  tax_id?: string;
  currency?: string;
  timezone?: string;
}

/** Arguments for updating an existing location profile. */
export interface UpdateLocationArgs {
  id: string;
  name: string;
  address: string;
  tax_id: string;
  currency: string;
  timezone: string;
}

/** List all location profiles for the session's tenant (scoped — ADR #7). */
export const listLocationsScoped = (sessionToken: string): Promise<LocationProfile[]> =>
  loggedInvoke<LocationProfile[]>('list_locations_scoped', { sessionToken });

/** Get a single location profile by its identifier (scoped — ADR #7). */
export const getLocationProfileScoped = (
  sessionToken: string,
  id: string,
): Promise<LocationProfile | null> =>
  loggedInvoke<LocationProfile | null>('get_location_profile_scoped', { sessionToken, id });

/** Get the primary location profile (scoped — ADR #7). */
export const getPrimaryLocationScoped = (sessionToken: string): Promise<LocationProfile | null> =>
  loggedInvoke<LocationProfile | null>('get_primary_location_scoped', { sessionToken });

/** Create a new location profile (scoped — ADR #7). */
export const createLocationProfileScoped = (
  sessionToken: string,
  args: CreateLocationArgs,
): Promise<LocationProfile> =>
  loggedInvoke<LocationProfile>('create_location_profile_scoped', { sessionToken, args });

/** Update an existing location profile (scoped — ADR #7). */
export const updateLocationProfileScoped = (
  sessionToken: string,
  args: UpdateLocationArgs,
): Promise<LocationProfile> =>
  loggedInvoke<LocationProfile>('update_location_profile_scoped', { sessionToken, args });

/** Set a location as the primary location (scoped — ADR #7). */
export const setPrimaryLocationScoped = (sessionToken: string, id: string): Promise<LocationProfile> =>
  loggedInvoke<LocationProfile>('set_primary_location_scoped', { sessionToken, id });

/** Delete a location profile by its identifier (scoped — ADR #7). */
export const deleteLocationProfileScoped = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke<void>('delete_location_profile_scoped', { sessionToken, id });
