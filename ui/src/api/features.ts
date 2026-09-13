import { loggedInvoke } from '@/utils/logged-invoke';

/** A feature flag definition. */
export interface FeatureInfo {
  key: string;
  name: string;
  description: string;
  group: string;
  enabled: boolean;
  dependencies: string[];
}

/** Response from listing all feature flags. */
export interface ListAllFeaturesResult {
  features: FeatureInfo[];
}

/** Response from toggling a single feature. */
export interface SetFeatureResult {
  success: boolean;
  features: FeatureInfo[];
  auto_enabled: string[];
}

/** List all feature flags with their current state. */
export const listAllFeatures = (): Promise<ListAllFeaturesResult> =>
  loggedInvoke<ListAllFeaturesResult>('list_all_features');

/**
 * ADR #7: list feature flags for the store resolved from a session token.
 *
 * `set_feature` and `set_features_bulk` below already take a sessionToken, so the write side of this
 * screen has always resolved through the session while the read did not -- the same asymmetry item 65
 * and item 66 track. Registered by both shells as of this writing (desktop since the ADR #7 sweep,
 * tablet alongside this wrapper).
 */
export const listAllFeaturesScoped = (sessionToken: string): Promise<ListAllFeaturesResult> =>
  loggedInvoke<ListAllFeaturesResult>('list_all_features_scoped', { sessionToken });

/** Toggle a single feature flag on or off. Requires SETTINGS_EDIT permission. */
export const setFeature = (sessionToken: string, key: string, enabled: boolean): Promise<SetFeatureResult> =>
  loggedInvoke<SetFeatureResult>('set_feature', { sessionToken, args: { key, enabled } });

/** Bulk-toggle multiple feature flags. Requires SETTINGS_EDIT permission. */
export const setFeaturesBulk = (sessionToken: string, keys: string[], enabled: boolean): Promise<ListAllFeaturesResult> =>
  loggedInvoke<ListAllFeaturesResult>('set_features_bulk', { sessionToken, args: { keys, enabled } });
