// ── Dev-mock DTO conformance for the setup + auth surfaces ─────────────
//
// WHY THIS EXISTS. The mock registry is typed `(args: unknown) => unknown`, so nothing
// checks that a handler answers the shape its consumer declares. Two real defects
// shipped through that hole:
//
//   - `start_device_pairing` answered `base_url` + `qr_payload`, fields that exist on
//     no Rust struct, so `qr_url` was undefined and both pairing screens printed the
//     literal Fluent pattern "…or visit {$url}" (round 26).
//   - `check_license_status` omitted `deviceRevoked`, so the DTO did not match its own
//     declared interface (round 27).
//
// The ~50 `api-*-contract` suites do NOT cover this: they assert the correct IPC command
// NAME is called, never the payload's shape. `api-license-contract.test.ts:38`
// hand-writes a `check_license_status` fixture missing `deviceRevoked` and nothing
// complains, because `mockResolvedValue` accepts any object.
//
// HOW IT WORKS. Each entry pairs a command with a fixture TYPED AS THE DTO, so `tsc`
// forces the fixture to stay complete — add a field to the interface and this file stops
// compiling. The runtime then compares the fixture's key set against what the mock
// actually returns. A drift reports both sides by name.
//
// The fixture VALUES are deliberately meaningless: only the key set is compared.

import { describe, it, expect, vi } from 'vitest';
// test-setup.ts globally mocks `@tauri-apps/api/event`; this file imports the real
// dev-mock modules, so the mock must be lifted (same reason as dev-mock-auth-contract).
vi.unmock('@tauri-apps/api/event');
import { invoke } from '@/dev-mock/tauri-api';
import type { LicenseStatusDto, ServerLicenseStatus, LinkedAccountDto, VerifiedAccountDto } from '@/api/license';
import type { HasUsersResult } from '@/api/staff';
import type { ProvisionDeviceResult, EnabledFeaturesResult } from '@/api/settings';

const LICENSE: LicenseStatusDto = { isActive: false, status: 'missing', tier: null, payload: null, message: null };
const SERVER_LICENSE: ServerLicenseStatus = {
  tenantId: '', status: '', tier: '', active: false, deviceRevoked: false,
  expiresAt: null, graceUntil: null, maxLocations: 0,
};
const USERS: HasUsersResult = { has_users: false };
const PROVISION: ProvisionDeviceResult = {
  terminal_id: '', location_id: '', owner_user_id: '', created: false, mode: 'local', home_region: '',
};
const LINKED: LinkedAccountDto = { tenantId: '', provider: '', email: '' };
const FEATURES: EnabledFeaturesResult = { features: [] };
const VERIFIED: VerifiedAccountDto = { tenantId: '', email: '', verified: true };

/** Commands this objective's flows read fields from, paired with their declared DTO. */
const CASES: { command: string; shape: object; dto: string; args?: unknown }[] = [
  { command: 'get_license_status', shape: LICENSE, dto: 'LicenseStatusDto' },
  { command: 'check_license_status', shape: SERVER_LICENSE, dto: 'ServerLicenseStatus' },
  { command: 'has_users', shape: USERS, dto: 'HasUsersResult' },
  { command: 'provision_device', shape: PROVISION, dto: 'ProvisionDeviceResult' },
  // The linking commands take args; the mock ignores them and answers a linked account.
  { command: 'link_device_google', shape: LINKED, dto: 'LinkedAccountDto', args: {} },
  { command: 'link_device_email_consume', shape: VERIFIED, dto: 'VerifiedAccountDto', args: { code: '123456' } },
  { command: 'get_preset_features', shape: FEATURES, dto: 'EnabledFeaturesResult', args: { preset: 'simple-retail' } },
];

describe('dev-mock DTO conformance (setup + auth)', () => {
  it.each(CASES)('$command answers exactly $dto', async ({ command, shape, dto, args }) => {
    const raw = (await invoke(command, args === undefined ? {} : { args })) as Record<string, unknown>;

    expect(raw, `${command} answered ${raw === null ? 'null (unhandled command)' : typeof raw}`).not.toBeNull();

    const want = Object.keys(shape).sort();
    const have = Object.keys(raw).sort();
    // Field-by-field, so a failure names the offending field rather than one big diff.
    expect(have, `${command} must match ${dto}`).toEqual(want);
  });

  it('poll_device_pairing carries the one required field of PairingPollResponse', async () => {
    // `PairingPollResponse` is partial BY DESIGN — `tenant_id`, `email` and `terminal`
    // are optional because a pending poll has none of them. Key equality would be the
    // wrong assertion here; the required field is `status`, and its absence would make
    // every poll look like a failure rather than a pending claim.
    const poll = (await invoke('poll_device_pairing', {})) as Record<string, unknown>;
    expect(poll).not.toBeNull();
    expect(['pending', 'claimed']).toContain(poll['status']);
  });

  it('start_device_pairing answers the Rust PairingSessionStart fields', async () => {
    // Listed separately because its shape is the one that shipped wrong: the mock
    // answered `base_url` + `qr_payload`, and `qr_url` — the field both pairing
    // screens interpolate — was therefore undefined.
    const session = (await invoke('start_device_pairing', {})) as Record<string, unknown>;
    expect(Object.keys(session).sort()).toEqual(['code', 'expires_at', 'poll_token', 'qr_url']);
    expect(session['qr_url']).toEqual(expect.any(String));
    expect(String(session['qr_url'])).not.toHaveLength(0);
  });
});
