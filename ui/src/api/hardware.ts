// ── Hardware: Barcode scanner, cash drawer, printer ──────────────

import { loggedInvoke } from '@/utils/logged-invoke';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ── Cash Drawer ──────────────────────────────────────────────────

/** Arguments for opening a cash drawer. */
export interface OpenCashDrawerArgs {
  deviceId?: string;
}

/**
 * Serialize [`OpenCashDrawerArgs`] for the wire. The Rust `OpenCashDrawerArgs`
 * (`crates/oz-bridge/src/hardware.rs:46` and its tablet twin
 * `apps/tablet-client/src/commands/hardware.rs:30`) carries no
 * `#[serde(rename_all)]`, so its field is `device_id`. It is also
 * `#[serde(default)] Option<String>`, which makes a camelCase `deviceId` key
 * fail *silently*: serde drops the unknown field, the option stays `None` and
 * the drawer registered as `"default"` opens instead of the requested one.
 * Omitting the key when unset keeps the empty-args payload shape.
 */
const cashDrawerWireArgs = (args: OpenCashDrawerArgs): { device_id?: string } =>
  args.deviceId === undefined ? {} : { device_id: args.deviceId };

/** Result of attempting to open a cash drawer. */
export interface OpenCashDrawerResult {
  opened: boolean;
}

// ── Receipt Printing (raw) ───────────────────────────────────────

/** Arguments for printing a raw receipt. */
export interface PrintReceiptArgs {
  body: string;
}

/** Result of printing a raw receipt. */
export interface PrintReceiptResult {
  printedLines: number;
}

/**
 * Arguments for printing a structured sales receipt.
 * @deprecated Prefer using `printSalesReceiptScoped` in multi-store deployments.
 */
export interface PrintSalesReceiptArgs {
  date: string;
  receiptNumber: string;
  items: {
    name: string;
    quantity: number;
    unitPrice: { minorUnits: number; currency: string };
    totalPrice: { minorUnits: number; currency: string };
    taxAmount?: { minorUnits: number; currency: string } | null;
  }[];
  subtotal: { minorUnits: number; currency: string };
  tax?: { minorUnits: number; currency: string } | null;
  total: { minorUnits: number; currency: string };
  payments: {
    method: string;
    amount: { minorUnits: number; currency: string };
    change?: { minorUnits: number; currency: string } | null;
  }[];
  tableNumber?: string | null;
}

/** Print a structured sales receipt (scoped — ADR #7). */
export const printSalesReceiptScoped = (
  sessionToken: string,
  args: PrintSalesReceiptArgs,
): Promise<{ printed: boolean }> =>
  loggedInvoke<{ printed: boolean }>('print_sales_receipt_scoped', { sessionToken, args });

// ── Barcode Scanner ──────────────────────────────────────────────

/**
 * Error thrown by scanner-related operations when the scanner hardware
 * encounters a recoverable or unrecoverable failure.
 *
 * The `code` field identifies the specific type of failure so callers
 * can surface appropriate diagnostics or recovery prompts.
 */
export class ScannerError extends Error {
  /**
   * @param message  Human-readable description of the failure.
   * @param code     Machine-readable error code (see `ScannerError.codes`).
   * @param scannerId  Optional id of the scanner that failed.
   */
  constructor(
    message: string,
    public readonly code: string,
    public readonly scannerId?: string,
  ) {
    super(message);
    this.name = 'ScannerError';
  }

  /** Canonical error codes emitted by the scanner subsystem. */
  static codes = {
    /** Scanner was physically disconnected mid-operation. */
    DISCONNECTED: 'SCANNER_DISCONNECTED',
    /** Scanner did not respond within the expected time frame. */
    TIMEOUT: 'SCANNER_TIMEOUT',
    /** Generic hardware failure (e.g. USB error, power issue). */
    HARDWARE_FAILURE: 'SCANNER_HARDWARE_FAILURE',
    /** Scanner is already claimed by another process. */
    CONFLICT: 'SCANNER_CONFLICT',
  } as const;
}

/** Information about a connected barcode scanner. */
export interface ScannerInfo {
  id: string;
}

/** Payload delivered when a barcode is scanned. */
export interface BarcodeScannedPayload {
  code: string;
  symbology: string;
}

/** Subscribe to barcode-scanned events. Returns an unsubscribe function. */
export const onBarcodeScanned = (handler: (payload: BarcodeScannedPayload) => void): Promise<UnlistenFn> =>
  listen<BarcodeScannedPayload>('barcode:scanned', (e) => handler(e.payload));

/** Subscribe to barcode scanner error events. Returns an unsubscribe function. */
export const onBarcodeError = (handler: (error: string) => void): Promise<UnlistenFn> =>
  listen<{ error: string }>('barcode:error', (e) => handler(e.payload.error));

// ── Customer Display ──────────────────────────────────────────────

/** Arguments for showing content on a customer-facing display. */
export interface DisplayShowArgs {
  displayId: string;
  line1: string;
  line2: string;
}

/**
 * Serialize [`DisplayShowArgs`] for the wire. The Rust `DisplayShowArgs`
 * (`crates/oz-bridge/src/hardware.rs:397` and its tablet twin
 * `apps/tablet-client/src/commands/hardware.rs:679`) carries no
 * `#[serde(rename_all)]`, so its field is `display_id` — a required
 * `String`, so a camelCase `displayId` key is a hard missing-field error on
 * both shells rather than a silent default.
 */
const displayShowWireArgs = (args: DisplayShowArgs): {
  display_id: string;
  line1: string;
  line2: string;
} => ({ display_id: args.displayId, line1: args.line1, line2: args.line2 });

// ── Weight Scale ────────────────────────────────────────────────────

/** A weight reading from a connected scale. */
export interface WeightReading {
  weightGrams: number;
  stable: boolean;
}

/** Read the current weight from the registered scale, or null if none is registered. */
export const readScaleWeight = (): Promise<WeightReading | null> =>
  loggedInvoke<WeightReading | null>('read_scale_weight');

// ── Device Discovery ──────────────────────────────────────────────────

/** Categories of USB hardware devices that can be discovered. */
export type DeviceCategory = 'Scanner' | 'Printer' | 'Scale' | 'Other';

/** Information about a discovered USB hardware device. */
export interface UsbDeviceInfo {
  vid: number;
  pid: number;
  manufacturer: string;
  product: string;
  serial: string;
  interfaceNumber: number;
  endpointIn: number;
  endpointOut: number | null;
  category: DeviceCategory;
  label: string;
}

// ── Scoped variants (ADR #7) ───────────────────────────────────────

/** Open a cash drawer (scoped). */
export const openCashDrawerScoped = (sessionToken: string, args: OpenCashDrawerArgs = {}): Promise<OpenCashDrawerResult> =>
  loggedInvoke<OpenCashDrawerResult>('open_cash_drawer_scoped', { sessionToken, args: cashDrawerWireArgs(args) });

/** Print a raw text receipt (scoped). */
export const printReceiptScoped = (sessionToken: string, args: PrintReceiptArgs): Promise<PrintReceiptResult> =>
  loggedInvoke<PrintReceiptResult>('print_receipt_scoped', { sessionToken, args });

/** List all registered barcode scanners (scoped). */
export const listScannersScoped = (sessionToken: string): Promise<ScannerInfo[]> =>
  loggedInvoke<ScannerInfo[]>('list_scanners_scoped', { sessionToken });

/** Start a barcode scanner (scoped). */
export const startScannerScoped = (sessionToken: string, scannerId: string): Promise<void> =>
  loggedInvoke<void>('start_scanner_scoped', { sessionToken, scannerId });

/** Stop the active barcode scanner (scoped). */
export const stopScannerScoped = (sessionToken: string): Promise<void> =>
  loggedInvoke<void>('stop_scanner_scoped', { sessionToken });

/** List all registered customer displays (scoped). */
export const listDisplaysScoped = (sessionToken: string): Promise<string[]> =>
  loggedInvoke<string[]>('list_displays_scoped', { sessionToken });

/** Show content on a customer-facing pole display (scoped). */
export const displayShowScoped = (sessionToken: string, args: DisplayShowArgs): Promise<void> =>
  loggedInvoke<void>('display_show_scoped', { sessionToken, args: displayShowWireArgs(args) });

/** Clear a customer-facing pole display (scoped). */
export const displayClearScoped = (sessionToken: string, displayId: string): Promise<void> =>
  loggedInvoke<void>('display_clear_scoped', { sessionToken, displayId });

/** Discover all connected USB hardware devices (scoped). */
export const discoverHardwareScoped = (sessionToken: string): Promise<UsbDeviceInfo[]> =>
  loggedInvoke<UsbDeviceInfo[]>('discover_hardware_scoped', { sessionToken });

/** Read the current weight from the registered scale (scoped). */
export const readScaleWeightScoped = (sessionToken: string): Promise<WeightReading | null> =>
  loggedInvoke<WeightReading | null>('read_scale_weight_scoped', { sessionToken });
