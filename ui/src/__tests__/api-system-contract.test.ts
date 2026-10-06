// ── IPC contract tests for system.ts ────────────────────────────
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
  ping,
  getVersion,
  getVersionScoped,
  getLocalIp,
  getDeviceId,
  getStorageHealth,
  exportDiagnostics,
} from '@/api/system';

const VERSION = {
  name: 'kasirmu-app',
  version: '0.0.37',
  rustVersion: '1.82.0',
  target: 'x86_64-pc-windows-msvc',
};

describe('system.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('ping → ping (no args) and passes "pong" through', async () => {
    mockInvoke.mockResolvedValue('pong');
    const result = await ping();
    expect(mockInvoke).toHaveBeenCalledWith('ping', undefined);
    expect(result).toBe('pong');
  });

  it('getVersion → version (no args) and passes the build info through', async () => {
    mockInvoke.mockResolvedValue(VERSION);
    const result = await getVersion();
    expect(mockInvoke).toHaveBeenCalledWith('version', undefined);
    expect(result).toEqual(VERSION);
  });

  it('getVersionScoped → version_scoped with sessionToken (ADR #7)', async () => {
    mockInvoke.mockResolvedValue(VERSION);
    const result = await getVersionScoped('tok_sys');
    expect(mockInvoke).toHaveBeenCalledWith('version_scoped', { sessionToken: 'tok_sys' });
    expect(result.version).toBe('0.0.37');
  });

  it('getVersionScoped falls back to getVersion when version_scoped is not found', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('Command version_scoped not found'))
      .mockResolvedValueOnce(VERSION);
    const result = await getVersionScoped('tok_sys');
    expect(mockInvoke).toHaveBeenCalledWith('version_scoped', { sessionToken: 'tok_sys' });
    expect(mockInvoke).toHaveBeenCalledWith('version', undefined);
    expect(result.version).toBe('0.0.37');
  });


  it('getLocalIp → get_local_ip (no args)', async () => {
    mockInvoke.mockResolvedValue('192.168.1.100');
    const result = await getLocalIp();
    expect(mockInvoke).toHaveBeenCalledWith('get_local_ip', undefined);
    expect(result).toBe('192.168.1.100');
  });

  it('getDeviceId → get_device_id (no args)', async () => {
    mockInvoke.mockResolvedValue('device-abc');
    const result = await getDeviceId();
    expect(mockInvoke).toHaveBeenCalledWith('get_device_id', undefined);
    expect(result).toBe('device-abc');
  });

  it('getStorageHealth → get_storage_health (no args)', async () => {
    const health = {
      availableBytes: 1000000000,
      totalBytes: 50000000000,
      isLowSpace: false,
      thresholdBytes: 524288000,
    };
    mockInvoke.mockResolvedValue(health);
    const result = await getStorageHealth();
    expect(mockInvoke).toHaveBeenCalledWith('get_storage_health', undefined);
    expect(result).toEqual(health);
  });

  it('every unscoped helper forwards exactly one argument', async () => {
    mockInvoke.mockResolvedValue(null);
    await Promise.all([ping(), getVersion(), getLocalIp(), getDeviceId(), getStorageHealth()]);
    for (const call of mockInvoke.mock.calls) {
      expect(call?.[1]).toBeUndefined();
    }
    expect(mockInvoke).toHaveBeenCalledTimes(5);
  });

  it('exportDiagnostics → export_diagnostics with sessionToken and outputPath', async () => {
    const exportResult = {
      path: '/tmp/diag.zip',
      sizeBytes: 1024,
      filesIncluded: ['system_info.json'],
    };
    mockInvoke.mockResolvedValue(exportResult);
    const result = await exportDiagnostics('tok_test', '/tmp/diag.zip');
    expect(mockInvoke).toHaveBeenCalledWith('export_diagnostics', {
      sessionToken: 'tok_test',
      outputPath: '/tmp/diag.zip',
    });
    expect(result).toEqual(exportResult);
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('session expired'));
    await expect(getVersionScoped('tok_sys')).rejects.toThrow('session expired');
  });
});
