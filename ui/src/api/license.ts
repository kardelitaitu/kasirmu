import { loggedInvoke } from '@/utils/logged-invoke';
import type { WireHealth } from '@/hooks/connectionHealth';

/** Possible license verification outcomes. */
export type LicenseVerificationStatus = 'valid' | 'expired' | 'gracePeriod' | 'invalidSignature' | 'clockTampered' | 'missing';

/** License verification status returned by the backend (local, no network). */
export interface LicenseStatusDto {
  /** Whether the license is currently active and usable. */
  isActive: boolean;
  /** Categorized verification status of the license. */
  status: LicenseVerificationStatus;
  /** Subscription tier — available immediately from local data. */
  tier: string | null;
  /** Raw JSON payload of the signed license, if available. */
  payload: string | null;
  /** Human-readable message explaining the status or providing error details. */
  message: string | null;
}

/** Server-authoritative license status (from the license server). */
export interface ServerLicenseStatus {
  tenantId: string;
  status: string;
  tier: string;
  active: boolean;
  /**
   * Whether **this device** has been revoked by a tenant admin
   * (ADR #58 §2.4a.2). Server-authored; the shell refuses to open a session
   * while it is set.
   */
  deviceRevoked: boolean;
  expiresAt: string | null;
  graceUntil: string | null;
  /** Tier location quota — wire field keeps the historical `maxLocations` name (1g wire rename pending). */
  maxLocations: number;
}

/** Get the current license activation and verification status. */
export async function getLicenseStatus(): Promise<LicenseStatusDto> {
  return loggedInvoke('get_license_status');
}

/** Check license status against the PocketBase server for authoritative current state. */
export async function checkLicenseStatus(): Promise<ServerLicenseStatus> {
  return loggedInvoke('check_license_status');
}

/** Get the unique machine identifier for device-bound license activation. */
export async function getMachineId(): Promise<string> {
  return loggedInvoke('get_machine_id');
}

/** The account a device was linked to (ADR #54). */
export interface LinkedAccountDto {
  /** Tenant record id the identity was bound to. */
  tenantId: string;
  /** Provider key — `google` today. */
  provider: string;
  /** The address the provider verified. */
  email: string;
}

/**
 * Link this device to the account that signs in with Google (ADR #54 §2.5).
 *
 * Opens the system browser at Google's consent screen and waits for the licence server's
 * one-time code on a loopback port, so this call resolves only once the user has finished
 * (or the wait times out) — several minutes, not milliseconds. The device's own licence
 * credentials are read by the shell; no secret is passed from here.
 */
export async function linkDeviceGoogle(): Promise<LinkedAccountDto> {
  return loggedInvoke('link_device_google');
}

/** The account an emailed code proved (ADR #54 §2.6). */
export interface VerifiedAccountDto {
  /** Tenant record id the account belongs to. */
  tenantId: string;
  /** The address that received the code. */
  email: string;
  /** Whether the account now counts as verified. */
  verified: boolean;
}

/**
 * Ask the licence server to email a link code to this device's account address.
 *
 * The no-browser route: the tablet cannot use Google's browser flows. The server accepts only
 * the tenant's own address, so a rejected address surfaces as a validation on the email field
 * rather than as an outage.
 */
export async function requestDeviceLinkCode(email: string): Promise<void> {
  return loggedInvoke('link_device_email_request', { email });
}

/** Spend the emailed code and return the account it proved. */
export async function consumeDeviceLinkCode(code: string): Promise<VerifiedAccountDto> {
  return loggedInvoke('link_device_email_consume', { code });
}

/**
 * Get the device-level hardware fingerprint (SPEC-2026-TRIAL-LOCK):
 * "hw_" + SHA-256 hex of the hardware anchor, stable across reinstalls.
 * The license server's one-trial-per-device lock keys on it.
 */
export async function getHardwareFingerprint(): Promise<string> {
  return loggedInvoke('get_hardware_fingerprint');
}

/**
 * Activate the license with a key, email, phone, and machine identifier.
 * Returns true if activation succeeded.
 *
 * `trialVertical` is the optional segmented-trial vertical (C2.1): the
 * server only reads it for trial keys and mints a 14-day Plus / 14-day Pro
 * / 30-day Pro trial per subscription-tiers.md §4 (e.g. detected from a
 * `?v=restaurant` landing-page URL param). Paid keys ignore it.
 *
 * `bundleId` is the optional vertical-bundle id (C3.2): "restaurant_starter"
 * unlocks the kds workspace type at the Plus trial tier (e.g. detected from
 * a `?bundle=restaurant_starter` landing-page URL param). The server honors
 * it for trial keys only.
 *
 * `hardwareFingerprint` is the device-level fingerprint (SPEC-2026-TRIAL-LOCK):
 * the server's one-trial-per-device lock keys on it, falling back to
 * machineId when omitted, and never gates paid keys.
 */
export async function activateLicense(
  key: string,
  email: string,
  machineId: string,
  phone: string,
  trialVertical?: string,
  bundleId?: string,
  hardwareFingerprint?: string
): Promise<boolean> {
  return loggedInvoke('activate_license', {
    key,
    email,
    machineId,
    phone,
    ...(trialVertical ? { trialVertical } : {}),
    ...(bundleId ? { bundleId } : {}),
    ...(hardwareFingerprint ? { hardwareFingerprint } : {}),
  });
}

/** Renew an existing license with a new license key. Returns true if renewal succeeded. */
export async function renewLicense(newKey: string): Promise<boolean> {
  return loggedInvoke('renew_license', { newKey });
}

/** Pause/resume subscription response from the license server. */
export interface PauseResumeResponse {
  status: string;
  tierKey: string;
  pausedAt?: string;
  pausedUntil?: string;
}

/** Pause the current subscription for 1–3 months. */
export async function pauseSubscription(pauseMonths: number): Promise<PauseResumeResponse> {
  return loggedInvoke('pause_subscription', { pauseMonths });
}

/**
 * Pause a subscription resolved from a session token. ADR #7.
 *
 * pause_subscription_scoped (license.rs:806) enforces permissions::SETTINGS_EDIT before
 * delegating. The unscoped command reads the stored API key and calls the billing server with no
 * session and no permission check at all -- pausing a subscription is a billing action.
 */
export async function pauseSubscriptionScoped(
  sessionToken: string,
  pauseMonths: number,
): Promise<PauseResumeResponse> {
  return loggedInvoke('pause_subscription_scoped', { sessionToken, pauseMonths });
}

/** Resume a paused subscription. */
export async function resumeSubscription(): Promise<PauseResumeResponse> {
  return loggedInvoke('resume_subscription');
}

/**
 * Resume a subscription resolved from a session token. ADR #7.
 *
 * Same differential as pauseSubscriptionScoped: resume_subscription_scoped (license.rs:820)
 * enforces SETTINGS_EDIT; the unscoped variant checks nothing.
 */
export async function resumeSubscriptionScoped(
  sessionToken: string,
): Promise<PauseResumeResponse> {
  return loggedInvoke('resume_subscription_scoped', { sessionToken });
}

/**
 * Auth-server probe result (mirrors the sync `PingResult` so both pills
 * render from one shape). `state` and `cause` are optional because a desktop
 * build predating them sends neither, and the hook must then fall back to the
 * reachability answer rather than invent a health reading.
 */
export interface AuthPingResult {
  ok: boolean;
  status: string;
  latencyMs: number | null;
  /** Health read from the server's own payload — see `WireHealth`. */
  state?: WireHealth;
  /** Named broken subsystem when `state` is `'degraded'`. */
  cause?: string | null;
}

/**
 * Ping the license server's /api/health endpoint to verify reachability.
 * Unlike checkLicenseStatus, no stored license key is required — the login
 * / lock-screen connection pill uses this so it shows green as soon as the
 * auth server is reachable, before any license is activated.
 */
export async function testAuthConnection(): Promise<AuthPingResult> {
  return loggedInvoke('test_auth_connection');
}
