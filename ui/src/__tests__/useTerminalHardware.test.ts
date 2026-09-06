import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor, configure } from '@testing-library/react';
import {
  useTerminalHardware,
} from '@/hooks/useTerminalHardware';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

// ── Mock @/api/settings with configurable IPC responses ─────────────

const mockGetHardwareSettings = vi.fn();
const mockGetHardwareSettingsScoped = vi.fn();
const mockSetHardwareSettings = vi.fn();
const mockSetHardwareSettingsScoped = vi.fn();

vi.mock('@/api/settings', () => ({
  getHardwareSettings: () => mockGetHardwareSettings(),
  // Its own spy, not a delegate onto the unscoped one: a mirror registers a call on
  // the other spy and makes `not.toHaveBeenCalled()` unprovable.
  getHardwareSettingsScoped: (token: string) => mockGetHardwareSettingsScoped(token),
  setHardwareSettings: (...args: unknown[]) => mockSetHardwareSettings(...args),
  setHardwareSettingsScoped: (token: string, args: unknown) =>
    mockSetHardwareSettingsScoped(token, args),
}));

const defaultDto = {
  printerConnection: 'auto',
  printerDevicePath: '',
  printerPaperSize: '80',
  scannerDeviceId: '',
  scannerInputMode: 'auto',
} as const;

// Async settle can exceed the default 1s waitFor timeout under a loaded
// parallel run (same flake class as WorkspaceHome/SettingsPage); Vitest
// isolates module state per file, so this does not leak.
configure({ asyncUtilTimeout: 5000 });

// ── Tests ─────────────────────────────────────────────────────────

describe('useTerminalHardware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHardwareSettings.mockResolvedValue(defaultDto);
    // Configured in parallel with the unscoped one, not by delegating to it.
    mockGetHardwareSettingsScoped.mockResolvedValue(defaultDto);
    mockSetHardwareSettings.mockResolvedValue(undefined);
    mockSetHardwareSettingsScoped.mockResolvedValue(undefined);
  });

  // ── Session scoping (F-017) ─────────────────────────────────────

  it('loads through the scoped command, passing the session token', async () => {
    // get_hardware_settings is NOT registered in apps/desktop-client/src/lib.rs --
    // it sits in the desktop section of scripts/ipc-parity-allowlist.json as a known
    // F-008/F-050 gap -- so on desktop the unscoped call rejects and the hook's catch
    // silently falls back to defaults. get_hardware_settings_scoped IS registered
    // (lib.rs:933) and is the only path that actually reaches the DTO.
    const { result } = renderHook(() => useTerminalHardware('term-001'));

    // Wait for the load to SETTLE (isLoading false), not merely for the spy
    // to have been invoked: under a loaded parallel run waitFor can exit in
    // the gap between the call and the promise resolution, flaking on the
    // isLoading assertion below.
    await waitFor(() => {
      expect(mockGetHardwareSettingsScoped).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
      expect(result.current.isLoading).toBe(false);
    });
    expect(mockGetHardwareSettings).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('saves through the scoped command, passing the session token', async () => {
    // set_hardware_settings does not exist in apps/desktop-client at all -- only
    // set_hardware_settings_scoped (settings.rs:650, registered lib.rs:704) does, and it is the
    // one that writes hardware_profiles and the JSON profile. So the unscoped call the hook made
    // rejected on every desktop save. The scoped setter takes no userId: it derives the user from
    // the session, which is the point.
    const { result } = renderHook(() => useTerminalHardware('term-s'));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.save('user-1');
    });

    await waitFor(() => {
      expect(mockSetHardwareSettingsScoped).toHaveBeenCalledWith(
        HARNESS_SESSION_TOKEN,
        expect.objectContaining({ printerConnection: 'auto' }),
      );
    });
    expect(mockSetHardwareSettings).not.toHaveBeenCalled();
  });

  // ── Initial load ──────────────────────────────────────────────

  it('loads profile from IPC on mount', async () => {
    mockGetHardwareSettingsScoped.mockResolvedValue({
      ...defaultDto,
      printerConnection: 'network',
      printerDevicePath: '192.168.1.50',
    });

    const { result } = renderHook(() => useTerminalHardware('term-001'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.profile).not.toBeNull();
    expect(result.current.profile!.terminalId).toBe('term-001');
    expect(result.current.profile!.hardware.printer.connection).toBe('network');
    expect(result.current.profile!.hardware.printer.devicePath).toBe('192.168.1.50');
    // Fields not in IPC DTO get defaults
    expect(result.current.profile!.hardware.scale.connection).toBe('none');
    expect(result.current.profile!.localPrefs.soundVolume).toBe(80);
  });

  it('loads default profile when IPC fails', async () => {
    mockGetHardwareSettingsScoped.mockRejectedValue(new Error('IPC unavailable'));

    const { result } = renderHook(() => useTerminalHardware('term-002'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.profile).not.toBeNull();
    expect(result.current.profile!.terminalId).toBe('term-002');
    expect(result.current.profile!.hardware.printer.connection).toBe('auto');
    expect(result.current.profile!.hardware.scanner.mode).toBe('auto');
  });

  it('returns null for empty terminalId', async () => {
    const { result } = renderHook(() => useTerminalHardware(''));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.profile).toBeNull();
  });

  it('initialized contains a valid ISO date', async () => {
    const { result } = renderHook(() => useTerminalHardware('term-m'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const date = new Date(result.current.profile!.initialized);
    expect(date.getTime()).toBeGreaterThan(0);
  });

  // ── Update helpers (local state) ──────────────────────────────

  it('updatePrinter modifies local state without persisting', async () => {
    const { result } = renderHook(() => useTerminalHardware('term-e'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updatePrinter({ connection: 'usb', devicePath: 'COM5' });
    });

    expect(result.current.profile!.hardware.printer.connection).toBe('usb');
    expect(result.current.profile!.hardware.printer.devicePath).toBe('COM5');

    // Not yet persisted
    expect(mockSetHardwareSettings).not.toHaveBeenCalled();
  });

  it('updateScale modifies local state', async () => {
    const { result } = renderHook(() => useTerminalHardware('term-f'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateScale({ connection: 'serial', devicePath: 'COM3', baudRate: 115200 });
    });

    expect(result.current.profile!.hardware.scale.connection).toBe('serial');
    expect(result.current.profile!.hardware.scale.baudRate).toBe(115200);
  });

  it('updateScanner modifies local state', async () => {
    const { result } = renderHook(() => useTerminalHardware('term-g'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateScanner({ mode: 'keyboard', deviceId: 'HID-001' });
    });

    expect(result.current.profile!.hardware.scanner.mode).toBe('keyboard');
    expect(result.current.profile!.hardware.scanner.deviceId).toBe('HID-001');
  });

  it('updateLocalPrefs modifies local state', async () => {
    const { result } = renderHook(() => useTerminalHardware('term-h'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateLocalPrefs({ soundVolume: 42, darkMode: true });
    });

    expect(result.current.profile!.localPrefs.soundVolume).toBe(42);
    expect(result.current.profile!.localPrefs.darkMode).toBe(true);
  });

  // ── Save (persist to IPC) ─────────────────────────────────────

  it('save calls setHardwareSettings with DTO subset', async () => {
    const { result } = renderHook(() => useTerminalHardware('term-i'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updatePrinter({ devicePath: '192.168.1.99' });
    });

    await act(async () => {
      await result.current.save('user-1');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSetHardwareSettingsScoped).toHaveBeenCalledTimes(1);
    const call = mockSetHardwareSettingsScoped.mock.calls[0] as [string, Record<string, unknown>];
    const token = call[0];
    const dto = call[1];
    expect(dto['printerDevicePath']).toBe('192.168.1.99');
    expect(dto['printerConnection']).toBe('auto');
    expect(token).toBe(HARNESS_SESSION_TOKEN);
    // The scoped setter derives the user from the session, so the caller's userId is not sent.
    expect(mockSetHardwareSettings).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('save reports error on IPC failure', async () => {
    mockSetHardwareSettingsScoped.mockRejectedValue(new Error('Disk full'));

    const { result } = renderHook(() => useTerminalHardware('term-k'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updatePrinter({ devicePath: 'after-change' });
    });

    await act(async () => {
      await result.current.save();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // ERR-05: raw backend text never surfaces — the safe fallback copy does.
    expect(result.current.error).toBe('Failed to save hardware profile');
    expect(result.current.error).not.toBe('Disk full');
  });

  // ── Reload ──────────────────────────────────────────────────────

  it('reload re-reads from IPC', async () => {
    mockGetHardwareSettingsScoped.mockResolvedValue({
      ...defaultDto,
      printerDevicePath: 'v1',
    });

    const { result } = renderHook(() => useTerminalHardware('term-l'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.profile!.hardware.printer.devicePath).toBe('v1');

    // Change IPC response
    mockGetHardwareSettingsScoped.mockResolvedValue({
      ...defaultDto,
      printerDevicePath: 'v2',
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.profile!.hardware.printer.devicePath).toBe('v2');
  });

  // ── Edge cases ──────────────────────────────────────────────────

  it('save is no-op when profile is null', async () => {
    const { result } = renderHook(() => useTerminalHardware(''));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockSetHardwareSettings).not.toHaveBeenCalled();
  });
});
