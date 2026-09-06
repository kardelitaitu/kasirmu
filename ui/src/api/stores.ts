import { loggedInvoke } from '@/utils/logged-invoke';
import type {
  CreateLocationArgs,
  LocationProfile,
  UpdateLocationArgs,
} from '@/api/locations';

/** @deprecated Use `LocationProfile`; Store is now Location. */
export type StoreProfile = LocationProfile;

/** @deprecated Use `CreateLocationArgs`; Store is now Location. */
export type CreateStoreArgs = CreateLocationArgs;

/** @deprecated Use `UpdateLocationArgs`; Store is now Location. */
export type UpdateStoreArgs = UpdateLocationArgs;

/** @deprecated Use `listLocationsScoped`; Store is now Location. */
export const listStoresScoped = (sessionToken: string): Promise<StoreProfile[]> =>
  loggedInvoke<StoreProfile[]>('list_store_profiles_scoped', { sessionToken });

/** @deprecated Use `getLocationProfileScoped`; Store is now Location. */
export const getStoreProfileScoped = (
  sessionToken: string,
  id: string,
): Promise<StoreProfile | null> =>
  loggedInvoke<StoreProfile | null>('get_store_profile_scoped', { sessionToken, id });

/** @deprecated Use `getPrimaryLocationScoped`; Store is now Location. */
export const getPrimaryStoreScoped = (sessionToken: string): Promise<StoreProfile | null> =>
  loggedInvoke<StoreProfile | null>('get_primary_store_scoped', { sessionToken });

/** @deprecated Use `createLocationProfileScoped`; Store is now Location. */
export const createStoreProfileScoped = (
  sessionToken: string,
  args: CreateStoreArgs,
): Promise<StoreProfile> =>
  loggedInvoke<StoreProfile>('create_store_profile_scoped', { sessionToken, args });

/** @deprecated Use `updateLocationProfileScoped`; Store is now Location. */
export const updateStoreProfileScoped = (
  sessionToken: string,
  args: UpdateStoreArgs,
): Promise<StoreProfile> =>
  loggedInvoke<StoreProfile>('update_store_profile_scoped', { sessionToken, args });

/** @deprecated Use `setPrimaryLocationScoped`; Store is now Location. */
export const setPrimaryStoreScoped = (sessionToken: string, id: string): Promise<StoreProfile> =>
  loggedInvoke<StoreProfile>('set_primary_store_scoped', { sessionToken, id });

/** @deprecated Use `deleteLocationProfileScoped`; Store is now Location. */
export const deleteStoreProfileScoped = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke<void>('delete_store_profile_scoped', { sessionToken, id });
