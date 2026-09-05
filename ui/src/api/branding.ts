// ── Brand / White-label API ───────────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** Brand and white-label settings for the store. */
export interface BrandSettings {
  primary_colour: string;
  logo_path: string | null;
  store_name: string;
}

/** Get the current brand settings. */
export const getBrandSettings = (): Promise<BrandSettings> =>
  loggedInvoke<BrandSettings>('get_brand_settings');

/** Get brand settings resolved from a session token. ADR #7. */
export const getBrandSettingsScoped = (sessionToken: string): Promise<BrandSettings> =>
  loggedInvoke<BrandSettings>('get_brand_settings_scoped', { sessionToken });

/**
 * Set the brand primary colour.
 *
 * The Rust command resolves the session from `sessionToken` and enforces
 * the SETTINGS_EDIT permission (F-017) — the unscoped `set_brand_
 * primary_colour` is NOT registered, so calls without a token fail at
 * the IPC boundary with "command not found".
 */
export const setBrandPrimaryColour = (
  sessionToken: string,
  colour: string,
): Promise<void> =>
  loggedInvoke<void>('set_brand_primary_colour_scoped', { sessionToken, colour });

/** Set the brand logo file path (SETTINGS_EDIT scoped). */
export const setBrandLogoPath = (
  sessionToken: string,
  path: string,
): Promise<void> =>
  loggedInvoke<void>('set_brand_logo_path_scoped', { sessionToken, path });

/** Set the store display name for branding (SETTINGS_EDIT scoped). */
export const setBrandStoreName = (
  sessionToken: string,
  name: string,
): Promise<void> =>
  loggedInvoke<void>('set_brand_store_name_scoped', { sessionToken, name });

/** Open a file picker dialog to select a logo image. Returns the chosen path or null. */
export const pickLogoFile = (): Promise<string | null> =>
  loggedInvoke<string | null>('pick_logo_file');
