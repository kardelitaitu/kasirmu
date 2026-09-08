// ── IPC contract tests for localApi.ts ──────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  getLocalApiStatusScoped,
  setLocalApiEnabledScoped,
  setLocalApiPortScoped,
  setLocalApiStoreScoped,
  rotateLocalApiSecretScoped,
  mintLocalApiTokenScoped,
  type LocalApiStatusDto,
  type LocalApiTokenDto,
} from '@/api/localApi';

const STATUS: LocalApiStatusDto = {
  enabled: true,
  running: true,
  port: 3099,
  baseUrl: 'http://127.0.0.1:3099/api/v1',
  storeId: 'store-1',
};

const TOKEN_DTO: LocalApiTokenDto = {
  token: 'jwt-like-token',
  expires_at: '2027-01-01T00:00:00Z',
  token_id: 'tok-1',
};

describe('localApi.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getLocalApiStatusScoped → local_api_status_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue(STATUS);
    const result = await getLocalApiStatusScoped('tok_api');
    expect(mockInvoke).toHaveBeenCalledWith('local_api_status_scoped', { sessionToken: 'tok_api' });
    expect(result).toEqual(STATUS);
  });

  it('setLocalApiEnabledScoped(true) → local_api_set_enabled_scoped with top-level enabled', async () => {
    mockInvoke.mockResolvedValue(STATUS);
    const result = await setLocalApiEnabledScoped('tok_api', true);
    expect(mockInvoke).toHaveBeenCalledWith('local_api_set_enabled_scoped', {
      sessionToken: 'tok_api',
      enabled: true,
    });
    expect(result).toEqual(STATUS);
  });

  it('setLocalApiEnabledScoped(false) sends the boolean, never a string', async () => {
    mockInvoke.mockResolvedValue({ ...STATUS, enabled: false, running: false });
    await setLocalApiEnabledScoped('tok_api', false);
    const call = mockInvoke.mock.calls[0];
    expect(call?.[1]).toEqual({ sessionToken: 'tok_api', enabled: false });
  });

  it('setLocalApiPortScoped → local_api_set_port_scoped with top-level port', async () => {
    mockInvoke.mockResolvedValue({ ...STATUS, port: 4000 });
    const result = await setLocalApiPortScoped('tok_api', 4000);
    expect(mockInvoke).toHaveBeenCalledWith('local_api_set_port_scoped', {
      sessionToken: 'tok_api',
      port: 4000,
    });
    expect(result.port).toBe(4000);
  });

  it('setLocalApiStoreScoped → local_api_set_store_scoped with top-level storeId', async () => {
    mockInvoke.mockResolvedValue({ ...STATUS, storeId: 'store-2' });
    const result = await setLocalApiStoreScoped('tok_api', 'store-2');
    expect(mockInvoke).toHaveBeenCalledWith('local_api_set_store_scoped', {
      sessionToken: 'tok_api',
      storeId: 'store-2',
    });
    expect(result.storeId).toBe('store-2');
  });

  it('setLocalApiStoreScoped sends the empty string that means "primary store"', async () => {
    mockInvoke.mockResolvedValue({ ...STATUS, storeId: 'default' });
    await setLocalApiStoreScoped('tok_api', '');
    expect(mockInvoke).toHaveBeenCalledWith('local_api_set_store_scoped', {
      sessionToken: 'tok_api',
      storeId: '',
    });
  });

  it('rotateLocalApiSecretScoped → local_api_rotate_secret_scoped with sessionToken only', async () => {
    mockInvoke.mockResolvedValue(STATUS);
    const result = await rotateLocalApiSecretScoped('tok_api');
    expect(mockInvoke).toHaveBeenCalledWith('local_api_rotate_secret_scoped', {
      sessionToken: 'tok_api',
    });
    expect(result).toEqual(STATUS);
  });

  it('mintLocalApiTokenScoped with expiryHours → local_api_mint_token_scoped with all three fields', async () => {
    mockInvoke.mockResolvedValue(TOKEN_DTO);
    const result = await mintLocalApiTokenScoped('tok_api', 'reporting cron', 720);
    expect(mockInvoke).toHaveBeenCalledWith('local_api_mint_token_scoped', {
      sessionToken: 'tok_api',
      label: 'reporting cron',
      expiryHours: 720,
    });
    expect(result).toEqual(TOKEN_DTO);
  });

  it('mintLocalApiTokenScoped without expiryHours omits the key entirely', async () => {
    mockInvoke.mockResolvedValue(TOKEN_DTO);
    await mintLocalApiTokenScoped('tok_api', 'backup script');
    const call = mockInvoke.mock.calls[0];
    expect(call?.[1]).toEqual({ sessionToken: 'tok_api', label: 'backup script' });
    expect(Object.keys((call?.[1] ?? {}) as Record<string, unknown>)).not.toContain('expiryHours');
  });

  it('mintLocalApiTokenScoped keeps expiryHours 0 (an explicit value, not "absent")', async () => {
    mockInvoke.mockResolvedValue(TOKEN_DTO);
    await mintLocalApiTokenScoped('tok_api', 'session only', 0);
    expect(mockInvoke).toHaveBeenCalledWith('local_api_mint_token_scoped', {
      sessionToken: 'tok_api',
      label: 'session only',
      expiryHours: 0,
    });
  });

  it('passes the snake_case token dto through unchanged', async () => {
    mockInvoke.mockResolvedValue(TOKEN_DTO);
    const result = await mintLocalApiTokenScoped('tok_api', 'l', 1);
    expect(result).toHaveProperty('expires_at');
    expect(result).toHaveProperty('token_id');
    expect(result).not.toHaveProperty('expiresAt');
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('missing permission: settings.edit'));
    await expect(setLocalApiEnabledScoped('tok_api', true)).rejects.toThrow(
      'missing permission: settings.edit',
    );
  });
});
