// ── IPC contract tests for license.ts ─────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  getLicenseStatus,
  checkLicenseStatus,
  getMachineId,
  getHardwareFingerprint,
  activateLicense,
  renewLicense,
  pauseSubscription,
  resumeSubscription,
  testAuthConnection,
} from '@/api/license';

describe('license.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getLicenseStatus → get_license_status (no args)', async () => {
    mockInvoke.mockResolvedValue({ isActive: true, status: 'valid', tier: 'pro', payload: null, message: null });
    await getLicenseStatus();
    expect(mockInvoke).toHaveBeenCalledWith('get_license_status', undefined);
  });

  it('checkLicenseStatus → check_license_status (no args)', async () => {
    mockInvoke.mockResolvedValue({ tenantId: 't1', status: 'active', tier: 'pro', active: true, expiresAt: null, graceUntil: null, maxLocations: 5 });
    await checkLicenseStatus();
    expect(mockInvoke).toHaveBeenCalledWith('check_license_status', undefined);
  });

  it('getMachineId → get_machine_id (no args)', async () => {
    mockInvoke.mockResolvedValue('machine-123');
    await getMachineId();
    expect(mockInvoke).toHaveBeenCalledWith('get_machine_id', undefined);
  });

  it('getHardwareFingerprint → get_hardware_fingerprint (no args)', async () => {
    mockInvoke.mockResolvedValue('hw_abc123');
    await getHardwareFingerprint();
    expect(mockInvoke).toHaveBeenCalledWith('get_hardware_fingerprint', undefined);
  });

  it('activateLicense → activate_license with all required args', async () => {
    mockInvoke.mockResolvedValue(true);
    await activateLicense('KEY-123', 'test@example.com', 'machine-1', '+6281234567890');
    expect(mockInvoke).toHaveBeenCalledWith('activate_license', {
      key: 'KEY-123',
      email: 'test@example.com',
      machineId: 'machine-1',
      phone: '+6281234567890',
    });
  });

  it('activateLicense with trialVertical → activate_license includes trialVertical', async () => {
    mockInvoke.mockResolvedValue(true);
    await activateLicense('KEY-123', 'test@example.com', 'm1', '+1234567890', 'restaurant');
    expect(mockInvoke).toHaveBeenCalledWith('activate_license', {
      key: 'KEY-123',
      email: 'test@example.com',
      machineId: 'm1',
      phone: '+1234567890',
      trialVertical: 'restaurant',
    });
  });

  it('activateLicense with bundleId → activate_license includes bundleId', async () => {
    mockInvoke.mockResolvedValue(true);
    await activateLicense('KEY-123', 'test@example.com', 'm1', '+1234567890', undefined, 'restaurant_starter');
    expect(mockInvoke).toHaveBeenCalledWith('activate_license', {
      key: 'KEY-123',
      email: 'test@example.com',
      machineId: 'm1',
      phone: '+1234567890',
      bundleId: 'restaurant_starter',
    });
  });

  it('activateLicense with hardwareFingerprint → activate_license includes hardwareFingerprint', async () => {
    mockInvoke.mockResolvedValue(true);
    await activateLicense('KEY-123', 'test@example.com', 'm1', '+1234567890', undefined, undefined, 'hw_fp');
    expect(mockInvoke).toHaveBeenCalledWith('activate_license', {
      key: 'KEY-123',
      email: 'test@example.com',
      machineId: 'm1',
      phone: '+1234567890',
      hardwareFingerprint: 'hw_fp',
    });
  });

  it('renewLicense → renew_license with newKey', async () => {
    mockInvoke.mockResolvedValue(true);
    await renewLicense('NEW-KEY-456');
    expect(mockInvoke).toHaveBeenCalledWith('renew_license', { newKey: 'NEW-KEY-456' });
  });

  it('pauseSubscription → pause_subscription with pauseMonths', async () => {
    mockInvoke.mockResolvedValue({ status: 'paused', tierKey: 'pro' });
    await pauseSubscription(2);
    expect(mockInvoke).toHaveBeenCalledWith('pause_subscription', { pauseMonths: 2 });
  });

  it('resumeSubscription → resume_subscription (no args)', async () => {
    mockInvoke.mockResolvedValue({ status: 'active', tierKey: 'pro' });
    await resumeSubscription();
    expect(mockInvoke).toHaveBeenCalledWith('resume_subscription', undefined);
  });

  it('testAuthConnection → test_auth_connection (no args)', async () => {
    mockInvoke.mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 42 });
    await testAuthConnection();
    expect(mockInvoke).toHaveBeenCalledWith('test_auth_connection', undefined);
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('invalid license key'));
    await expect(activateLicense('BAD', 'e@m.com', 'm1', '+1234567890')).rejects.toThrow('invalid license key');
  });
});
