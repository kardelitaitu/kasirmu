import {
  createLocationProfileScoped,
  deleteLocationProfileScoped,
  getLocationProfileScoped,
  getPrimaryLocationScoped,
  listLocationsScoped,
  setPrimaryLocationScoped,
  updateLocationProfileScoped,
  type CreateLocationArgs,
  type LocationProfile,
  type UpdateLocationArgs,
} from '@/api/locations';

/** @deprecated Use `LocationProfile`; Store is now Location. */
export type StoreProfile = LocationProfile;

/** @deprecated Use `CreateLocationArgs`; Store is now Location. */
export type CreateStoreArgs = CreateLocationArgs;

/** @deprecated Use `UpdateLocationArgs`; Store is now Location. */
export type UpdateStoreArgs = UpdateLocationArgs;

/** @deprecated Use `listLocationsScoped`; Store is now Location. */
export const listStoresScoped = listLocationsScoped;

/** @deprecated Use `getLocationProfileScoped`; Store is now Location. */
export const getStoreProfileScoped = getLocationProfileScoped;

/** @deprecated Use `getPrimaryLocationScoped`; Store is now Location. */
export const getPrimaryStoreScoped = getPrimaryLocationScoped;

/** @deprecated Use `createLocationProfileScoped`; Store is now Location. */
export const createStoreProfileScoped = createLocationProfileScoped;

/** @deprecated Use `updateLocationProfileScoped`; Store is now Location. */
export const updateStoreProfileScoped = updateLocationProfileScoped;

/** @deprecated Use `setPrimaryLocationScoped`; Store is now Location. */
export const setPrimaryStoreScoped = setPrimaryLocationScoped;

/** @deprecated Use `deleteLocationProfileScoped`; Store is now Location. */
export const deleteStoreProfileScoped = deleteLocationProfileScoped;
