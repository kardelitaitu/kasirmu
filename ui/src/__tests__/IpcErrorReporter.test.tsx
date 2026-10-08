import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { emitIpcError } from '@/utils/app-error';
import { IpcErrorReporter, __resetIpcFailuresForTests } from '@/components/IpcErrorReporter';

/**
 * Contract tests for the field-diagnostics IPC failure recorder (ERR-06).
 *
 * WHY THIS EXISTS — measured 2026-10-07: the tablet cold start intermittently
 * rejects one settings fan-out source and toasts "Some settings could not be
 * loaded", with no way to name the command from a device walk. Patching
 * `window.__TAURI_INTERNALS__.invoke` from CDP is INERT against this app's
 * transport, so the recorder subscribes through the app's own ERR-06 boundary
 * (`emitIpcError`) instead — it sees every failure by construction.
 */

describe('IpcErrorReporter', () => {
  beforeEach(() => {
    cleanup();
    __resetIpcFailuresForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as { __ipcFailures?: unknown }).__ipcFailures;
  });

  it('starts with an empty bounded log on window', () => {
    render(<IpcErrorReporter />);
    expect(window.__ipcFailures).toEqual([]);
  });

  it('records command, redacted message and user key on failure', () => {
    render(<IpcErrorReporter />);
    emitIpcError('list_currencies_scoped', new Error('IPC timeout: did not respond'));
    expect(window.__ipcFailures).toHaveLength(1);
    const entry = window.__ipcFailures![0]!;
    expect(entry.command).toBe('list_currencies_scoped');
    expect(entry.message).toContain('IPC timeout');
    expect(entry.userKey).toBeTruthy();
    expect(typeof entry.at).toBe('number');
  });

  it('keeps only the last 40 entries', () => {
    render(<IpcErrorReporter />);
    for (let i = 0; i < 45; i += 1) {
      emitIpcError(`cmd_${i}`, new Error(`boom ${i}`));
    }
    expect(window.__ipcFailures).toHaveLength(40);
    expect(window.__ipcFailures![0]!.command).toBe('cmd_5');
    expect(window.__ipcFailures![39]!.command).toBe('cmd_44');
  });

  it('stops recording after unmount (StrictMode/HMR safety)', () => {
    const { unmount } = render(<IpcErrorReporter />);
    emitIpcError('fine_command', new Error('first'));
    expect(window.__ipcFailures).toHaveLength(1);
    unmount();
    emitIpcError('fine_command', new Error('after unmount'));
    expect(window.__ipcFailures).toHaveLength(1);
    expect(window.__ipcFailures![0]!.command).toBe('fine_command');
  });
});
