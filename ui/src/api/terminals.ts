// ── Terminal Management ───────────────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** A registered POS terminal. */
export interface TerminalDto {
  id: string;
  name: string;
  deviceId: string;
  isActive: boolean;
  lastSeenAt: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Arguments for registering a new POS terminal. */
export interface RegisterTerminalArgs {
  name: string;
  deviceId: string;
  terminalSecret?: string | null;
  metadata?: string | null;
}

/** Arguments for updating an existing terminal. */
export interface UpdateTerminalArgs {
  id: string;
  name: string;
  deviceId: string;
  isActive: boolean;
  metadata?: string | null;
}

/** List all registered terminals (session-scoped — ADR #7). */
export const listTerminals = (sessionToken: string): Promise<TerminalDto[]> =>
  loggedInvoke<TerminalDto[]>('list_terminals_scoped', { sessionToken });

/** List terminals (scoped — ADR #7). */
export const listTerminalsScoped = (sessionToken: string): Promise<TerminalDto[]> =>
  loggedInvoke<TerminalDto[]>('list_terminals_scoped', { sessionToken });

/** Get a single terminal by its identifier (session-scoped — ADR #7). */
export const getTerminal = (sessionToken: string, id: string): Promise<TerminalDto | null> =>
  loggedInvoke<TerminalDto | null>('get_terminal_scoped', { sessionToken, id });

/** Get a terminal (scoped — ADR #7). */
export const getTerminalScoped = (sessionToken: string, id: string): Promise<TerminalDto | null> =>
  loggedInvoke<TerminalDto | null>('get_terminal_scoped', { sessionToken, id });

/** Register a new POS terminal (session-scoped — ADR #7). */
export const registerTerminal = (sessionToken: string, args: RegisterTerminalArgs): Promise<{ id: string }> =>
  loggedInvoke<{ id: string }>('register_terminal_scoped', { sessionToken, args });

/** Register a terminal (scoped — ADR #7). */
export const registerTerminalScoped = (sessionToken: string, args: RegisterTerminalArgs): Promise<{ id: string }> =>
  loggedInvoke<{ id: string }>('register_terminal_scoped', { sessionToken, args });

/** Update an existing terminal's details (session-scoped — ADR #7). */
export const updateTerminal = (sessionToken: string, args: UpdateTerminalArgs): Promise<{ id: string }> =>
  loggedInvoke<{ id: string }>('update_terminal_scoped', { sessionToken, args });

/** Update a terminal (scoped — ADR #7). */
export const updateTerminalScoped = (sessionToken: string, args: UpdateTerminalArgs): Promise<{ id: string }> =>
  loggedInvoke<{ id: string }>('update_terminal_scoped', { sessionToken, args });

/** Ping a terminal to check it is reachable (session-scoped — ADR #7). */
export const pingTerminal = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke<void>('ping_terminal_scoped', { sessionToken, id });

/** Ping a terminal (scoped — ADR #7). */
export const pingTerminalScoped = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke<void>('ping_terminal_scoped', { sessionToken, id });

/** Delete a terminal registration (session-scoped — ADR #7). */
export const deleteTerminal = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke<void>('delete_terminal_scoped', { sessionToken, id });

/** Delete a terminal (scoped — ADR #7). */
export const deleteTerminalScoped = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke<void>('delete_terminal_scoped', { sessionToken, id });

// ── Feature Overrides ──────────────────────────────────────────────

/** A feature override applied to a specific terminal. */
export interface TerminalFeatureOverride {
  terminalId: string;
  feature: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** List terminal overrides (scoped — ADR #7). */
export const listTerminalOverridesScoped = (sessionToken: string, terminalId: string): Promise<TerminalFeatureOverride[]> =>
  loggedInvoke<TerminalFeatureOverride[]>('list_terminal_overrides_scoped', { sessionToken, terminalId });

/** Set terminal override (scoped — ADR #7). */
export const setTerminalOverrideScoped = (
  sessionToken: string,
  terminalId: string,
  feature: string,
  enabled: boolean,
): Promise<void> =>
  loggedInvoke<void>('set_terminal_override_scoped', { sessionToken, terminalId, feature, enabled });

/** Delete terminal override (scoped — ADR #7). */
export const deleteTerminalOverrideScoped = (
  sessionToken: string,
  terminalId: string,
  feature: string,
): Promise<void> =>
  loggedInvoke<void>('delete_terminal_override_scoped', { sessionToken, terminalId, feature });

// ── Terminal Profiles ───────────────────────────────────────────────

/** A terminal profile defining its locked screen and profile type. */
export interface TerminalProfileDto {
  terminalId: string;
  profileType: string;
  lockedScreen: string | null;
  updatedAt: string;
}

/** Get terminal profile (scoped — ADR #7). */
export const getTerminalProfileScoped = (
  sessionToken: string,
  terminalId: string,
): Promise<TerminalProfileDto | null> =>
  loggedInvoke<TerminalProfileDto | null>('get_terminal_profile_scoped', { sessionToken, terminalId });

/** Set terminal profile (scoped — ADR #7). */
export const setTerminalProfileScoped = (
  sessionToken: string,
  terminalId: string,
  profileType: string,
  lockedScreen: string | null,
): Promise<void> =>
  loggedInvoke<void>('set_terminal_profile_scoped', {
    sessionToken,
    args: { terminalId, profileType, lockedScreen },
  });

/** List terminal profiles (scoped — ADR #7). */
export const listTerminalProfilesScoped = (sessionToken: string): Promise<TerminalProfileDto[]> =>
  loggedInvoke<TerminalProfileDto[]>('list_terminal_profiles_scoped', { sessionToken });

/** Delete terminal profile (scoped — ADR #7). */
export const deleteTerminalProfileScoped = (
  sessionToken: string,
  terminalId: string,
): Promise<void> =>
  loggedInvoke<void>('delete_terminal_profile_scoped', { sessionToken, terminalId });

// ── Device Binding (ADR #4 Phase 3) ────────────────────────────────

/** Device binding status with HMAC signature validation result. */
export interface DeviceBindingDto {
  bounded: boolean;
  boundStoreId: string | null;
  boundInstanceId: string | null;
  signatureValid: boolean;
}

/** Get device binding (scoped — ADR #7). */
export const getDeviceBindingScoped = (sessionToken: string, terminalId: string): Promise<DeviceBindingDto> =>
  loggedInvoke<DeviceBindingDto>('get_device_binding_scoped', { sessionToken, terminalId });

/** Set device binding (scoped — ADR #7). */
export const setDeviceBindingScoped = (
  sessionToken: string,
  terminalId: string,
  boundStoreId: string,
  boundInstanceId: string,
): Promise<void> =>
  loggedInvoke<void>('set_device_binding_scoped', {
    sessionToken,
    args: { terminalId, boundStoreId, boundInstanceId },
  });

/** Clear device binding (scoped — ADR #7). */
export const clearDeviceBindingScoped = (
  sessionToken: string,
  terminalId: string,
): Promise<void> =>
  loggedInvoke<void>('clear_device_binding_scoped', { sessionToken, terminalId });
