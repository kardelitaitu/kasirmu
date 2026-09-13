import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getHardwareSettings,
  getHardwareSettingsScoped,
  setHardwareSettings,
  setHardwareSettingsScoped,
  type HardwareSettingsDto,
} from '@/api/settings';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { plainErrorMessage } from '@/utils/app-error';

// ── Types ──────────────────────────────────────────────────────────

export type PrinterConnection = 'network' | 'usb' | 'serial' | 'auto' | 'disabled';
export type PaperSize = '58' | '80' | 'a4' | 'letter';
export type ScaleConnection = 'serial' | 'usb' | 'none';
export type ScannerMode = 'keyboard' | 'serial' | 'auto';

export interface PrinterConfig {
  connection: PrinterConnection;
  devicePath: string;
  paperSize: PaperSize;
  testPrintIp: string;
}

export interface ScaleConfig {
  connection: ScaleConnection;
  devicePath: string;
  baudRate: number;
  zeroOnBoot: boolean;
}

export interface ScannerConfig {
  mode: ScannerMode;
  deviceId: string;
}

export interface HardwareConfig {
  printer: PrinterConfig;
  kitchenPrinter: PrinterConfig;
  scale: ScaleConfig;
  scanner: ScannerConfig;
}

export interface LocalPrefs {
  soundVolume: number;
  darkMode: boolean;
  scaleAutoZero: boolean;
}

export interface TerminalHardwareProfile {
  terminalId: string;
  storeId: string;
  hardware: HardwareConfig;
  localPrefs: LocalPrefs;
  initialized: string;
  version: number;
  schemaVersion: number;
}

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_PRINTER: PrinterConfig = {
  connection: 'auto',
  devicePath: '',
  paperSize: '80',
  testPrintIp: '',
};

const DEFAULT_SCALE: ScaleConfig = {
  connection: 'none',
  devicePath: '',
  baudRate: 9600,
  zeroOnBoot: false,
};

const DEFAULT_SCANNER: ScannerConfig = {
  mode: 'auto',
  deviceId: '',
};

const DEFAULT_LOCAL_PREFS: LocalPrefs = {
  soundVolume: 80,
  darkMode: false,
  scaleAutoZero: true,
};

/** Create a default profile for a given terminal. */
export function createDefaultProfile(terminalId: string, storeId?: string): TerminalHardwareProfile {
  return {
    terminalId,
    storeId: storeId ?? '',
    hardware: {
      printer: { ...DEFAULT_PRINTER },
      kitchenPrinter: { ...DEFAULT_PRINTER, connection: 'disabled' },
      scale: { ...DEFAULT_SCALE },
      scanner: { ...DEFAULT_SCANNER },
    },
    localPrefs: { ...DEFAULT_LOCAL_PREFS },
    initialized: new Date().toISOString(),
    version: 1,
    schemaVersion: 1,
  };
}

// ── IPC ↔ Profile mapping ──────────────────────────────────────────

/** Extract the IPC-compatible DTO from a full profile. */
function toHardwareSettingsDto(profile: TerminalHardwareProfile): HardwareSettingsDto {
  return {
    printerConnection: profile.hardware.printer.connection,
    printerDevicePath: profile.hardware.printer.devicePath,
    printerPaperSize: profile.hardware.printer.paperSize,
    scannerDeviceId: profile.hardware.scanner.deviceId,
    scannerInputMode: profile.hardware.scanner.mode,
    scaleConnection: profile.hardware.scale.connection,
    scaleDevicePath: profile.hardware.scale.devicePath,
    scaleBaudRate: profile.hardware.scale.baudRate,
    scaleZeroOnBoot: profile.hardware.scale.zeroOnBoot,
    kitchenPrinterConnection: profile.hardware.kitchenPrinter.connection,
    kitchenPrinterDevicePath: profile.hardware.kitchenPrinter.devicePath,
    schemaVersion: profile.schemaVersion,
    soundVolume: profile.localPrefs.soundVolume,
    darkMode: profile.localPrefs.darkMode,
    scaleAutoZero: profile.localPrefs.scaleAutoZero,
  };
}

/** Build a full profile from IPC DTO + defaults for unsupported fields. */
function fromHardwareSettingsDto(
  terminalId: string,
  storeId: string | undefined,
  dto: HardwareSettingsDto,
): TerminalHardwareProfile {
  const defaults = createDefaultProfile(terminalId, storeId);
  return {
    ...defaults,
    schemaVersion: dto.schemaVersion ?? defaults.schemaVersion,
    hardware: {
      ...defaults.hardware,
      printer: {
        ...defaults.hardware.printer,
        connection: (dto.printerConnection as PrinterConnection) || defaults.hardware.printer.connection,
        devicePath: dto.printerDevicePath ?? defaults.hardware.printer.devicePath,
        paperSize: (dto.printerPaperSize as PaperSize) || defaults.hardware.printer.paperSize,
      },
      kitchenPrinter: {
        ...defaults.hardware.kitchenPrinter,
        connection: (dto.kitchenPrinterConnection as PrinterConnection) || defaults.hardware.kitchenPrinter.connection,
        devicePath: dto.kitchenPrinterDevicePath ?? defaults.hardware.kitchenPrinter.devicePath,
      },
      scanner: {
        ...defaults.hardware.scanner,
        deviceId: dto.scannerDeviceId ?? defaults.hardware.scanner.deviceId,
        mode: (dto.scannerInputMode as ScannerMode) || defaults.hardware.scanner.mode,
      },
      scale: {
        ...defaults.hardware.scale,
        connection: (dto.scaleConnection as ScaleConnection) || defaults.hardware.scale.connection,
        devicePath: dto.scaleDevicePath ?? defaults.hardware.scale.devicePath,
        baudRate: dto.scaleBaudRate ?? defaults.hardware.scale.baudRate,
        zeroOnBoot: dto.scaleZeroOnBoot ?? defaults.hardware.scale.zeroOnBoot,
      },
    },
    localPrefs: {
      ...defaults.localPrefs,
      soundVolume: dto.soundVolume ?? defaults.localPrefs.soundVolume,
      darkMode: dto.darkMode ?? defaults.localPrefs.darkMode,
      scaleAutoZero: dto.scaleAutoZero ?? defaults.localPrefs.scaleAutoZero,
    },
  };
}

// ── Hook return type ────────────────────────────────────────────────

export interface UseTerminalHardwareResult {
  /** The current hardware profile (never null after initial load). */
  profile: TerminalHardwareProfile | null;
  /** True during initial load or save. */
  isLoading: boolean;
  /** Error from the most recent operation, or null. */
  error: string | null;
  /** Update printer configuration (local state only, call save() to persist). */
  updatePrinter: (partial: Partial<PrinterConfig>) => void;
  /** Update kitchen printer configuration. */
  updateKitchenPrinter: (partial: Partial<PrinterConfig>) => void;
  /** Update scale configuration. */
  updateScale: (partial: Partial<ScaleConfig>) => void;
  /** Update scanner configuration. */
  updateScanner: (partial: Partial<ScannerConfig>) => void;
  /** Update local preferences. */
  updateLocalPrefs: (partial: Partial<LocalPrefs>) => void;
  /** Persist full hardware + localPrefs to filesystem via IPC. */
  save: (userId?: string) => Promise<void>;
  /** Re-read profile from IPC. */
  reload: () => void;
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Hook to manage terminal hardware bindings (printer, scale, scanner)
 * stored in the filesystem via Tauri IPC (terminal_profiles/{id}.json).
 *
 * Full terminal profile (printer, scanner, scale, localPrefs) is
 * persisted via getHardwareSettings / setHardwareSettings IPC.
 *
 * @param terminalId - Unique terminal identifier
 * @param storeId - Optional store identifier for the profile
 */
export function useTerminalHardware(
  terminalId: string,
  storeId?: string,
): UseTerminalHardwareResult {
  const [profile, setProfile] = useState<TerminalHardwareProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';

  // ── Load profile from IPC on mount ──────────────────────────

  const loadProfile = useCallback(async () => {
    if (!terminalId) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // ADR #7 conditional scoping. On desktop this is not merely the permission-checked path:
      // get_hardware_settings is unregistered, so the unscoped call is the one that fails.
      const dto = sessionToken
        ? await getHardwareSettingsScoped(sessionToken)
        : await getHardwareSettings();
      const resolved = fromHardwareSettingsDto(terminalId, storeId, dto);
      setProfile(resolved);
      setIsLoading(false);
    } catch {
      // IPC unavailable (non-Tauri env, dev mock) — use defaults
      setProfile(createDefaultProfile(terminalId, storeId));
      setIsLoading(false);
    }
  }, [terminalId, storeId, sessionToken]);

  useEffect(() => {
    if (!initializedRef.current || terminalId !== profile?.terminalId) {
      initializedRef.current = true;
      loadProfile();
    }
  }, [terminalId, loadProfile, profile?.terminalId]);

  // ── Update helpers (local state only) ───────────────────────

  const updatePrinter = useCallback((partial: Partial<PrinterConfig>) => {
    setProfile((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hardware: {
          ...prev.hardware,
          printer: { ...prev.hardware.printer, ...partial },
        },
      };
    });
  }, []);

  const updateKitchenPrinter = useCallback((partial: Partial<PrinterConfig>) => {
    setProfile((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hardware: {
          ...prev.hardware,
          kitchenPrinter: { ...prev.hardware.kitchenPrinter, ...partial },
        },
      };
    });
  }, []);

  const updateScale = useCallback((partial: Partial<ScaleConfig>) => {
    setProfile((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hardware: {
          ...prev.hardware,
          scale: { ...prev.hardware.scale, ...partial },
        },
      };
    });
  }, []);

  const updateScanner = useCallback((partial: Partial<ScannerConfig>) => {
    setProfile((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hardware: {
          ...prev.hardware,
          scanner: { ...prev.hardware.scanner, ...partial },
        },
      };
    });
  }, []);

  const updateLocalPrefs = useCallback((partial: Partial<LocalPrefs>) => {
    setProfile((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        localPrefs: { ...prev.localPrefs, ...partial },
      };
    });
  }, []);

  // ── Save to IPC ─────────────────────────────────────────────

  const save = useCallback(async (userId?: string) => {
    if (!profile || !terminalId) return;

    setIsLoading(true);
    setError(null);

    try {
      // ADR #7 conditional scoping. On desktop this is not merely the permission-checked path:
      // set_hardware_settings is not registered there at all (only set_hardware_settings_scoped,
      // settings.rs:650 / lib.rs:704), so the unscoped call rejected on every save. The scoped
      // setter derives the user from the session, so `userId` is only meaningful on the fallback.
      if (sessionToken) {
        await setHardwareSettingsScoped(sessionToken, toHardwareSettingsDto(profile));
      } else {
        await setHardwareSettings(toHardwareSettingsDto(profile), userId ?? '');
      }
      setIsLoading(false);
    } catch (err) {
      const msg = plainErrorMessage(err, 'Failed to save hardware profile');
      setError(msg);
      setIsLoading(false);
    }
  }, [profile, terminalId, sessionToken]);

  // ── Reload ──────────────────────────────────────────────────

  const reload = useCallback(() => {
    loadProfile();
  }, [loadProfile]);

  return {
    profile,
    isLoading,
    error,
    updatePrinter,
    updateKitchenPrinter,
    updateScale,
    updateScanner,
    updateLocalPrefs,
    save,
    reload,
  };
}
