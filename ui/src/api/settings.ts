// ── Settings: Store, Receipt, Setup Wizard, Feature Flags ──────────

import { loggedInvoke } from '@/utils/logged-invoke';
import type { UnlistenFn } from '@tauri-apps/api/event';

// ── Receipt Settings ─────────────────────────────────────────────

/** Receipt print layout and formatting settings. */
export interface ReceiptSettingsDto {
  showCurrency: boolean;
  decimalSeparator: string;
  showTax: boolean;
  footer: string;
  paperWidth: string;
  showTableNumber: boolean;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  /** Tax rounding mode: `'half_up'` or `'truncate'`. Default `'half_up'`. */
  taxRoundingMode?: string;
}

/** Get receipt settings resolved from a session token. ADR #7. */
export const getReceiptSettingsScoped = (sessionToken: string): Promise<ReceiptSettingsDto> =>
  loggedInvoke<ReceiptSettingsDto>('get_receipt_settings_scoped', { sessionToken });

/** Set receipt settings (scoped — ADR #7). */
export const setReceiptSettingsScoped = (sessionToken: string, args: ReceiptSettingsDto): Promise<void> =>
  loggedInvoke<void>('set_receipt_settings_scoped', { sessionToken, args });

// ── Store Settings ───────────────────────────────────────────────

/** Store-level settings (name, address, currency, etc). */
export interface StoreSettingsDto {
  name: string;
  address: string;
  taxId: string;
  currency: string;
  branch: string;
  logo?: string;
}

/** Get store settings resolved from a session token. ADR #7. */
export const getStoreSettingsScoped = (sessionToken: string): Promise<StoreSettingsDto> =>
  loggedInvoke<StoreSettingsDto>('get_store_settings_scoped', { sessionToken });

/** Set store settings (scoped — ADR #7). */
export const setStoreSettingsScoped = (sessionToken: string, args: StoreSettingsDto): Promise<void> =>
  loggedInvoke<void>('set_store_settings_scoped', { sessionToken, args });

// ── Deployment / version read (operator tooling, saas-3 L162) ───────────

/** Running deployment metadata (build version) for the Diagnostics "About" surface. */
export interface DeploymentInfo {
  /** The running build version, e.g. `0.0.37`. */
  appVersion: string;
}

/** Read the running app version (gated on `settings:read`). */
export const getDeploymentInfo = (sessionToken: string): Promise<DeploymentInfo> =>
  loggedInvoke<DeploymentInfo>('get_deployment_info', { sessionToken });

// ── Credit Settings ───────────────────────────────────────────

/** Credit / tab sale settings for the store. */
export interface CreditSettingsDto {
  enabled: boolean;
  reminderIntervalHours: number;
  maxLimitMinor: number;
}

/** A credit (tab) sale awaiting settlement. */
export interface CreditSaleDto {
  saleId: string;
  customerName: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  settledAt: string | null;
  cashierName: string;
}

/** Get credit settings (scoped — ADR #7). */
export const getCreditSettingsScoped = (sessionToken: string): Promise<CreditSettingsDto> =>
  loggedInvoke<CreditSettingsDto>('get_credit_settings_scoped', { sessionToken });

/** Set credit settings (scoped — ADR #7). */
export const setCreditSettingsScoped = (sessionToken: string, args: CreditSettingsDto): Promise<void> =>
  loggedInvoke<void>('set_credit_settings_scoped', { sessionToken, args });

/** List all credit sales for the store resolved from a session token. ADR #7. */
export const listCreditSalesScoped = (sessionToken: string): Promise<CreditSaleDto[]> =>
  loggedInvoke<CreditSaleDto[]>('list_credit_sales_scoped', { sessionToken });

/** Settle a credit sale (scoped — ADR #7). */
export const settleCreditScoped = (sessionToken: string, saleId: string): Promise<void> =>
  loggedInvoke<void>('settle_credit_scoped', { sessionToken, saleId });

// ── Hardware Settings (printer + scanner + scale + localPrefs) ──

/** Full terminal hardware and local-preference configuration. */
export interface HardwareSettingsDto {
  printerConnection: string;
  printerDevicePath: string;
  printerPaperSize: string;
  scannerDeviceId: string;
  scannerInputMode: string;
  scaleConnection: string;
  scaleDevicePath: string;
  scaleBaudRate: number;
  scaleZeroOnBoot: boolean;
  kitchenPrinterConnection: string;
  kitchenPrinterDevicePath: string;
  schemaVersion: number;
  soundVolume: number;
  darkMode: boolean;
  scaleAutoZero: boolean;
}

/** Get the hardware settings (printer, scanner, scale, localPrefs). */
export const getHardwareSettings = (): Promise<HardwareSettingsDto> =>
  loggedInvoke<HardwareSettingsDto>('get_hardware_settings');

/**
 * Get the hardware settings resolved from a session token. ADR #7.
 *
 * This is the only variant that works on desktop: get_hardware_settings is not registered in
 * apps/desktop-tauri/src/lib.rs (it sits in the desktop section of
 * scripts/ipc-parity-allowlist.json as a known F-008/F-050 gap), so the unscoped call rejects there
 * and callers fall back to defaults. get_hardware_settings_scoped is registered (lib.rs:933) on
 * both shells and enforces permissions::SETTINGS_READ (settings.rs:1166).
 */
export const getHardwareSettingsScoped = (sessionToken: string): Promise<HardwareSettingsDto> =>
  loggedInvoke<HardwareSettingsDto>('get_hardware_settings_scoped', { sessionToken });

/**
 * Update the hardware settings (scoped — ADR #7).
 *
 * The unscoped `set_hardware_settings` wrapper that used to sit beside this is retired with T11:
 * it took `userId` from the renderer, which is exactly the actor the permission check asks about,
 * and desktop never registered the command at all -- so the fallback arm was a forgeable write on
 * one shell and a guaranteed rejection on the other. `useTerminalHardware.save()` now has one arm.
 */
export const setHardwareSettingsScoped = (sessionToken: string, args: HardwareSettingsDto): Promise<void> =>
  loggedInvoke<void>('set_hardware_settings_scoped', { sessionToken, args });

// ── First-run provisioning ───────────────────────────────────────

/** Which onboarding tier produced this terminal (ADR #56 §2.4). */
export type ProvisioningMode = 'local' | 'linked';

/** Whether a location trades as a shop or a restaurant (ADR #56 §2.3). */
export type LocationKind = 'retail' | 'restaurant';

/**
 * A store-type preset the first-run flow can ask for (ADR #56 §2.3).
 *
 * Moved here from `features/setup/SetupWizard.tsx` when that component was retired:
 * `ProvisioningFlow` is the live owner of this union, and the six slugs are the
 * ones `kasirmu_core::features::preset_registry` resolves. Keeping the type beside
 * the request shape it travels with means a slug the backend does not know is a
 * change in one file rather than two.
 */
export type Preset =
  | 'simple-retail'
  | 'restaurant'
  | 'full-store'
  | 'cafe'
  | 'franchise'
  | 'custom';

/**
 * The first-run state of one terminal (ADR #56 §2.1).
 *
 * A tagged union rather than a boolean: the two states are mutually exclusive at the type level, so
 * a component cannot render both, and there is no third value a partial read could invent. This
 * replaces `SetupStatus`/`getSetupStatus` — a boolean a failed read could forge, which is why the
 * shells carried a boot-retry workaround for a lost IPC response.
 */
export type FirstRunState =
  | { state: 'unprovisioned' }
  | {
      state: 'provisioned';
      location_id: string | null;
      owner_user_id: string | null;
      mode: ProvisioningMode;
      home_region: string;
      tenant_id: string | null;
    };

/** Arguments for provisioning this terminal (ADR #56 §2.1/§2.2). */
export interface ProvisionDeviceArgs {
  terminal_id: string;
  location_name: string;
  currency: string;
  timezone: string;
  owner_username: string;
  owner_display_name: string;
  owner_pin: string;
  preset: string;
  features: string[];
  location_kind: LocationKind;
  mode: ProvisioningMode;
  tenant_id?: string | null;
  device_credential_id?: string | null;
}

/** What provisioning created, so the shell can route with it. */
export interface ProvisionDeviceResult {
  terminal_id: string;
  location_id: string;
  owner_user_id: string;
  /** True on a fresh provision, false when an existing row was replayed. */
  created: boolean;
  mode: ProvisioningMode;
  home_region: string;
}

// `completeSetup` / `CompleteSetupArgs` were REMOVED with the command itself
// (ADR #56 §2.2/§2.3): it wrote the two booleans §2.1 retires, and nothing
// called it once both shells' first-run path became `provisionDevice`.

/**
 * Read this terminal's first-run state (ADR #56 §2.1).
 *
 * Replaces `getSetupStatus`. The shell renders the provisioning flow on `unprovisioned` and routes
 * to a session (or the login screen) on `provisioned`.
 */
export const getFirstRunState = (terminalId: string): Promise<FirstRunState> =>
  loggedInvoke<FirstRunState>('get_first_run_state', { terminalId });

/**
 * Provision this terminal in one idempotent transaction (ADR #56 §2.2).
 *
 * Creates the location, the workspaces that point at it, the owner, the features and the marker
 * together, or none of them. A retry returns the existing row and creates nothing.
 */
export const provisionDevice = (args: ProvisionDeviceArgs): Promise<ProvisionDeviceResult> =>
  loggedInvoke<ProvisionDeviceResult>('provision_device', { args });

/** Seed default roles for the store resolved from a session token. Returns the number of roles created. ADR #7. */
export const seedDefaultRolesScoped = (sessionToken: string): Promise<number> =>
  loggedInvoke<number>('seed_default_roles_scoped', { sessionToken });

// ── Feature Flags ────────────────────────────────────────────────

/** The set of feature flags that are currently enabled. */
export interface EnabledFeaturesResult {
  features: string[];
}

/** Get the list of enabled feature flags. */
export const getEnabledFeatures = (): Promise<EnabledFeaturesResult> =>
  loggedInvoke<EnabledFeaturesResult>('get_enabled_features');

/**
 * Get the feature keys a store-type preset enables.
 *
 * The preset→features fact has exactly one owner
 * (`kasirmu_core::features::preset_feature_keys`); this reads it rather than
 * letting the UI keep a second copy of the lists, which is the drift
 * `ProvisionDeviceArgs.preset`'s own doc warns against. Called by the first-run
 * flow BEFORE a session exists, so it resolves no session.
 */
export const getPresetFeatures = (preset: string): Promise<EnabledFeaturesResult> =>
  loggedInvoke<EnabledFeaturesResult>('get_preset_features', { preset });

// ── User Preferences ─────────────────────────────────────────

/** A single user preference key-value pair. */
export interface UserPrefEntry {
  key: string;
  value: string;
}

/**
 * Get user preferences (scoped — ADR #7). Uses session.user_id for lookup.
 */
export const getUserPreferencesScoped = (sessionToken: string): Promise<Record<string, string>> =>
  loggedInvoke<Record<string, string>>('get_user_preferences_scoped', { sessionToken });

/** Set user preferences (scoped — ADR #7). Uses session.user_id for write. */
export const setUserPreferencesScoped = (sessionToken: string, prefs: UserPrefEntry[]): Promise<void> =>
  loggedInvoke<void>('set_user_preferences_scoped', { sessionToken, prefs });

// ── Generic key/value settings ───────────────────────────────────

/**
 * Read a single raw setting value by key. Returns `null` when the key
 * has never been written. Callers are responsible for parsing (e.g.
 * JSON.parse) the returned string.
 */
export const getSetting = (key: string): Promise<string | null> =>
  loggedInvoke<string | null>('get_setting', { key });

/**
 * Write (or overwrite) a single raw setting value. Unscoped, and unscoped
 * here means the GLOBAL IDENTITY DATABASE, not a store database: the
 * `set_setting` command locks the bridge's global identity connection
 * (`ctx.db`). `setSettingScoped` is the store-scoped twin — it resolves the
 * session and writes that store's own database.
 *
 * The two are NOT interchangeable for device-global keys: repointing a call
 * changes which database is read, so what one writes the other never sees.
 * Requires a valid `userId` for the SETTINGS_EDIT permission check.
 *
 * Prefer `setSettings` (batch) for multiple keys to reduce IPC
 * round-trips. This variant exists for single-key callers.
 */
export const setSetting = (key: string, value: string, userId: string): Promise<void> =>
  loggedInvoke<void>('set_setting', { key, value, userId });

/**
 * Write (or overwrite) a single raw setting value using the scoped variant (ADR #7).
 *
 * Requires a valid `sessionToken` from `useWorkspace()`. When the token is null
 * the call is rejected — callers should guard or catch accordingly.
 * Pass an empty string to store an empty value.
 */
export const setSettingScoped = (
  sessionToken: string | null,
  key: string,
  value: string,
): Promise<void> => {
  if (!sessionToken) {
    return Promise.reject(new Error('No session token'));
  }
  return loggedInvoke<void>('set_setting_scoped', { sessionToken, key, value });
};

/**
 * Read a single raw setting value using the scoped variant (ADR #7).
 *
 * Requires a valid `sessionToken` from `useWorkspace()`. When the token
 * is null the call is rejected — callers should guard or catch accordingly.
 */
export const getSettingScoped = (
  sessionToken: string | null,
  key: string,
): Promise<string | null> => {
  if (!sessionToken) {
    return Promise.reject(new Error('No session token'));
  }
  return loggedInvoke<string | null>('get_setting_scoped', {
    sessionToken,
    key,
  });
};

/**
 * Write multiple settings atomically using the scoped variant (ADR #7).
 *
 * Requires a valid `sessionToken` from `useWorkspace()`. When the token
 * is null the call is rejected — callers should guard or catch accordingly.
 */
export const setSettingsScoped = (
  sessionToken: string | null,
  entries: Record<string, string>,
): Promise<void> => {
  if (!sessionToken) {
    return Promise.reject(new Error('No session token'));
  }
  return loggedInvoke<void>('set_settings_scoped', { sessionToken, entries });
};

// ── Settings events ──────────────────────────────────────────────

/** Payload broadcast on the `settings_updated` event when settings change. */
export interface SettingsUpdatedPayload {
  changed_keys: string[];
  terminal_id: string;
}

/**
 * Subscribe to `settings_updated` broadcasts (fired when any terminal
 * changes settings). Returns an unsubscribe function.
 *
 * Golden rule 5: the event wiring lives here, not in components/contexts.
 * `@tauri-apps/api/event` is loaded via dynamic import to preserve the
 * browser-dev fallback exactly as the previous in-component wiring did:
 * outside a Tauri webview the import fails and this resolves to a no-op
 * unlisten (silent). A `listen()` rejection is returned unawaited, so it
 * still surfaces to callers for logging.
 */
export const onSettingsUpdated = async (
  handler: (payload: SettingsUpdatedPayload) => void,
): Promise<UnlistenFn> => {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<SettingsUpdatedPayload>('settings_updated', (event) => handler(event.payload));
  } catch {
    // @tauri-apps/api/event not available — running outside Tauri (e.g. browser dev).
    return async () => {};
  }
};
