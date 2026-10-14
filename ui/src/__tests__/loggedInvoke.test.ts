/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
/**
 * Tests for `loggedInvoke` — the ERR-06 IPC boundary wrapper.
 *
 * Every API call goes through this function. It adds timing, dev logging,
 * error classification, and telemetry events. The IPC contract tests mock
 * it entirely; this is the only place that tests the real wrapper.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the Tauri invoke _before_ the module import. vi.hoisted is required
// because vi.mock factories are hoisted above top-level declarations.
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

// The side-effect modules (perf-metrics, app-error) are spied dynamically
// inside each test so the spies attach after this module is imported.
import { loggedInvoke } from '@/utils/logged-invoke';

describe('loggedInvoke', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls invoke with the command and args', async () => {
    mockInvoke.mockResolvedValue('ok');
    const result = await loggedInvoke('test_cmd', { key: 'val' });
    expect(mockInvoke).toHaveBeenCalledWith('test_cmd', { key: 'val' });
    expect(result).toBe('ok');
  });

  it('calls invoke with no args by default', async () => {
    mockInvoke.mockResolvedValue(42);
    const result = await loggedInvoke('no_args');
    expect(mockInvoke).toHaveBeenCalledWith('no_args', undefined);
    expect(result).toBe(42);
  });

  it('re-throws the original error on failure', async () => {
    const original = new Error('backend error');
    mockInvoke.mockRejectedValue(original);
    await expect(loggedInvoke('fail_cmd')).rejects.toThrow('backend error');
  });

  it('records IPC timing on success via recordIpcTiming', async () => {
    const timingSpy = vi.spyOn(await import('@/utils/perf-metrics'), 'recordIpcTiming');
    mockInvoke.mockResolvedValue('ok');
    await loggedInvoke('timed_cmd');
    expect(timingSpy).toHaveBeenCalledWith('timed_cmd', expect.any(Number));
  });

  it('emits an IPC error event on failure', async () => {
    const errorSpy = vi.spyOn(await import('@/utils/app-error'), 'emitIpcError');
    mockInvoke.mockRejectedValue(new Error('fail'));
    await loggedInvoke('err_cmd').catch(() => {});
    expect(errorSpy).toHaveBeenCalledWith('err_cmd', expect.any(Error));
  });

  it('logs a dev message on success', async () => {
    mockInvoke.mockResolvedValue('ok');
    await loggedInvoke('dev_success');
    // Success logs a single message (no diagnostic arg — that's failure-only).
    expect(console.log).toHaveBeenLastCalledWith(
      expect.stringContaining('[tauri] dev_success → succeeded'),
    );
  });

  it('logs a dev message on failure', async () => {
    mockInvoke.mockRejectedValue(new Error('nope'));
    await loggedInvoke('dev_fail').catch(() => {});
    // The logged format now includes timing: "[tauri] dev_fail → failed (0ms)"
    // and a second argument with the redacted diagnostic
    expect(console.log).toHaveBeenLastCalledWith(
      expect.stringContaining('[tauri] dev_fail → failed'),
      expect.any(String),
    );
  });
});