// ── Dev-mock staff identity: ONE source of truth ───────────────────
//
// The preview keeps a login seed (MOCK_STAFF, keyed by username) and a
// roster (list_staff_scoped). They describe the SAME five people, so a
// session minted by staff_login must name a row the roster actually
// returns — otherwise the first self-guard anyone adds (disabling delete
// or impersonate on your own row) silently never matches in the browser
// preview, while the ids look plausible enough that nobody notices.
//
// The seed's is_active was also never read by staff_login, so the roster's
// flag was the only load-bearing one: the roster decides whether the
// delete affordance appears. Both now state the same fact, and the login
// gate reads it the way kasirmu-bridge auth.rs:403 does.
//
// These cases are the invariant, not a snapshot of the values: they read
// the real mock handlers and fail if either side drifts again.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';
import { MOCK_STAFF } from '@/dev-mock/core/mockSeedData';
import type { StaffLoginResult, StaffMemberDto } from '@/api/staff';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const listStaff = (): Promise<StaffMemberDto[]> =>
  invoke<StaffMemberDto[]>('list_staff_scoped', { sessionToken: 'mock-token' });

const login = (username: string, pin: string): Promise<StaffLoginResult> =>
  invoke<StaffLoginResult>('staff_login', { args: { username, pin } });

describe('dev-mock staff identity is one source of truth', () => {
  it('gives every login seed a user_id that names exactly one person', () => {
    const ids = Object.values(MOCK_STAFF).map((s) => s.user_id);
    expect(new Set(ids).size, 'two seeds must not share a user_id').toBe(ids.length);
  });

  it('makes every seed user_id a row the roster returns', async () => {
    const rosterIds = new Set((await listStaff()).map((m) => m.id));
    for (const [username, seed] of Object.entries(MOCK_STAFF)) {
      expect(
        rosterIds.has(seed.user_id),
        `"${username}" logs in as ${seed.user_id}, which list_staff_scoped does not return`,
      ).toBe(true);
    }
  });

  it('states the SAME active flag in the seed and the roster', async () => {
    const roster = new Map((await listStaff()).map((m) => [m.id, m]));
    for (const [username, seed] of Object.entries(MOCK_STAFF)) {
      const row = roster.get(seed.user_id);
      expect(row, `"${username}" (${seed.user_id}) must be in the roster`).toBeTruthy();
      expect(
        row?.is_active,
        `"${username}" (${seed.user_id}) disagrees between MOCK_STAFF and the roster`,
      ).toBe(seed.is_active);
    }
  });

  it('logs in every ACTIVE seed and mints the roster id as the session user', async () => {
    for (const [username, seed] of Object.entries(MOCK_STAFF)) {
      if (!seed.is_active) continue;
      const session = await login(username, seed.pin_hash);
      expect(session.session.user_id).toBe(seed.user_id);
    }
  });

  it('refuses an INACTIVE account with the backend uniform error', async () => {
    // The real command answers an inactive account with the same "invalid
    // username or PIN" it gives a wrong PIN (kasirmu-bridge auth.rs:403), so
    // the client cannot enumerate deactivated accounts. The roster's inactive
    // auditor is therefore not a usable preview login, and the mock must say so
    // rather than serve a session the backend would refuse.
    const inactive = Object.entries(MOCK_STAFF).find(([, seed]) => !seed.is_active);
    expect(inactive, 'the roster needs one inactive identity for this branch').toBeTruthy();
    const [username, seed] = inactive!;
    await expect(login(username, seed.pin_hash)).rejects.toThrow(/invalid credentials/i);
  });
});
