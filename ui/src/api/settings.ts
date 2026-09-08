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
 * apps/desktop-client/src/lib.rs (it sits in the desktop section of
 * scripts/ipc-parity-allowlist.json as a known F-008/F-050 gap), so the unscoped call rejects there
 * and callers fall back to defaults. get_hardware_settings_scoped is registered (lib.rs:933) on
 * both shells and enforces permissions::SETTINGS_READ (settings.rs:1166).
 */
export const getHardwareSettingsScoped = (sessionToken: string): Promise<HardwareSettingsDto> =>
  loggedInvoke<HardwareSettingsDto>('get_hardware_settings_scoped', { sessionToken });

/** Update the hardware settings. */
export const setHardwareSettings = (args: HardwareSettingsDto, userId: string): Promise<void> =>
  loggedInvoke<void>('set_hardware_settings', { args, userId });

/** Set hardware settings (scoped — ADR #7). */
export const setHardwareSettingsScoped = (sessionToken: string, args: HardwareSettingsDto): Promise<void> =>
  loggedInvoke<void>('set_hardware_settings_scoped', { sessionToken, args });

// ── Setup Wizard ─────────────────────────────────────────────────

/** Arguments for completing the initial setup wizard. */
export interface CompleteSetupArgs {
  preset: string;
  features: string[];
  default_currency?: string;
}

/** Whether the initial setup wizard has been completed. */
export interface SetupStatus {
  completed: boolean;
  preset: string | null;
}

/** Complete the initial setup wizard with a preset and enabled features. */
export const completeSetup = (args: CompleteSetupArgs): Promise<void> =>
  loggedInvoke<void>('complete_setup', { args });

/** Dismiss the setup wizard without completing it. */
export const dismissSetupWizard = (): Promise<void> =>
  loggedInvoke<void>('dismiss_setup_wizard');

/** Get the current setup wizard completion status. */
export const getSetupStatus = (): Promise<SetupStatus> =>
  loggedInvoke<SetupStatus>('get_setup_status');

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
 * Write (or overwrite) a single raw setting value. Unscoped —
 * reads/writes to the primary store database. Requires a valid
 * `userId` for the SETTINGS_EDIT permission check.
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
