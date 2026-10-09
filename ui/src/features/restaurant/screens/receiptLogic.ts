//! Pure, deterministic helpers for the restaurant receipt settings screen.
//!
//! The RestaurantReceiptsScreen previously hosted a block of bespoke arithmetic
//! (paper geometry, font-size column estimation, id-ID price formatting and the
//! tax-preview sample totals) inline inside the component. Extracting that logic
//! here makes it exhaustively unit-testable without a DOM and keeps the screen
//! focused on state + rendering. Every function is deterministic: no globals,
//! no currency tables beyond the IDR-vs-other prefix rule and the canonical
//! minor-unit exponent (`minorUnitExponent`) that `formatPrice` needs to cap the
//! fractional digits it may show — the same exponent the printer's
//! `foundation::format_minor` applies.

import { minorUnitExponent } from '@/types/domain';

export type ReceiptFontSize = 'very_small' | 'small' | 'medium' | 'large';
export type ReceiptLogoPosition = 'top' | 'left' | 'right';
export type PaperWidth = 'standard' | 'narrow';
export type TaxRoundingMode = 'half_up' | 'truncate';

/** Clamp a value into [min, max]; NaN falls back to `min`. */
export const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, isNaN(val) ? min : val));

/** Physical roll width in mm for a paper-width preset. */
export const rollWidthMm = (paperWidth: PaperWidth): number => (paperWidth === 'narrow' ? 58 : 80);

/** Printable horizontal span after subtracting left+right margins, floored at 15mm. */
export const printableAreaMm = (rollWidth: number, marginLeft: number, marginRight: number): number =>
  Math.max(15, rollWidth - (marginLeft + marginRight));

/**
 * Approximate printable character columns for a paper/font combination.
 *
 * Mirror of the screen's inline logic: a base column count is derived from the
 * printable area (narrow and standard each have their own density formula and a
 * floor), then scaled by a per-font-size multiplier (very_small 1.25, small
 * 1.1, large 0.85, medium 1.0).
 */
export const approxCols = (
  paperWidth: PaperWidth,
  printableArea: number,
  fontSize: ReceiptFontSize,
): number => {
  const baseCols =
    paperWidth === 'narrow'
      ? Math.max(16, Math.round((printableArea / 52) * 32))
      : Math.max(20, Math.round((printableArea / 74) * 44));
  switch (fontSize) {
    case 'very_small':
      return Math.round(baseCols * 1.25);
    case 'small':
      return Math.round(baseCols * 1.1);
    case 'large':
      return Math.round(baseCols * 0.85);
    case 'medium':
    default:
      return baseCols;
  }
};

/** How fractional digits are displayed — mirrors the HAL `DecimalSeparator`. */
export type DecimalSeparator = 'dot' | 'comma' | 'none';

/**
 * Format a price for receipt display.
 *
 * Mirrors the ESC/POS renderer (kasirmu-hal `format_amount`): the major part
 * is rendered WITHOUT thousands grouping, an optional fractional part is joined
 * by the configured separator, and the currency prefix (`Rp ` for IDR, the raw
 * code otherwise — or nothing when `showCurrency` is false) is prepended.
 *
 * `decimalSeparator` is the SAME setting the printer resolves: `dot`/`comma`
 * choose the fractional separator and `none` truncates fractional digits, so
 * the preview cannot silently diverge from what actually prints. An integer
 * (`frac === 0`) renders identically under all three, as it does on paper.
 */
export const formatPrice = (
  amount: number,
  showCurrency: boolean,
  currency: string,
  decimalSeparator: DecimalSeparator = 'dot',
  fractionDigits = 0,
  showThousandsSeparator = false,
): string => {
  const negative = amount < 0;
  const rawMajor = Math.abs(Math.trunc(amount)).toString();
  const isIdr = (currency || 'IDR') === 'IDR';
  const sep = decimalSeparator === 'comma' ? ',' : '.';
  const thousandChar = sep === ',' ? '.' : ',';
  const major = showThousandsSeparator
    ? rawMajor.replace(/\B(?=(\d{3})+(?!\d))/g, thousandChar)
    : rawMajor;
  // ⚠️ The fraction is capped by the CURRENCY'S canonical exponent, because that is the
  // only thing the printer can render. `format_money`
  // (kasirmu-hal/src/drivers/receipt.rs:251) delegates the decimal math to
  // `foundation::format_minor`, which uses the currency's exponent — IDR is exp-0, so it
  // yields a bare major part and `fraac` is None. The renderer then falls to its
  // `(_, _)` arm and prints the major ALONE, whatever `decimal_separator` says.
  //
  // Without this cap, a caller passing `showDecimals ? 2 : 0` (as
  // `RestaurantReceiptsScreen.tsx:1210` does) made the IDR preview render
  // `Rp 1.500,00` while the paper printed `Rp 1500` — the exact divergence this
  // function's header promises cannot happen. The setting cannot reach the printer at
  // all: `ReceiptConfig` (receipt.rs:98-117) has no decimals field.
  const exponent = minorUnitExponent(currency);
  const effectiveDigits = Math.min(fractionDigits, exponent);
  const showFrac = decimalSeparator !== 'none' && effectiveDigits > 0;
  const fraction = showFrac ? `${sep}${'0'.repeat(effectiveDigits)}` : '';
  const prefix = showCurrency ? (isIdr ? 'Rp ' : `${currency || 'IDR'} `) : '';
  return `${negative ? '-' : ''}${prefix}${major}${fraction}`;
};

/** The paper modifier class token for each font-size preset. */
export const FONT_SIZE_CLASS: Record<ReceiptFontSize, string> = {
  very_small: 'resto-receipt-paper--font-very-small',
  small: 'resto-receipt-paper--font-small',
  medium: 'resto-receipt-paper--font-medium',
  large: 'resto-receipt-paper--font-large',
};

/** Look up the CSS class token for a font-size preset. */
export const fontSizeClass = (fontSize: ReceiptFontSize): string => FONT_SIZE_CLASS[fontSize];

export interface ReceiptPreviewInput {
  taxRatePercent: number;
  showTax: boolean;
  taxRoundingMode: TaxRoundingMode;
}

export interface ReceiptPreviewResult {
  /** Rounded per-line item prices (Nasi Goreng 35k, Es Teh 16k, Ayam Bakar 42k net of tax). */
  itemPrices: [number, number, number];
  subtotal: number;
  tax: number;
  total: number;
  /** Change from a fixed Rp 100.000 cash note. */
  change: number;
}

/**
 * Compute the thermal-preview sample totals.
 *
 * The three sample gross prices (35.000 / 16.000 / 42.000) are netted to
 * `100/(100+rate)` when tax is shown; subtotal is the rounded net sum, tax is
 * derived from the unrounded net subtotal and rounded per the rounding mode, and
 * the grand total is subtotal + tax. With tax hidden, gross prices are used and
 * the subtotal is a flat 93.000. Change is floored at zero.
 */
export const computeReceiptPreview = ({
  taxRatePercent,
  showTax,
  taxRoundingMode,
}: ReceiptPreviewInput): ReceiptPreviewResult => {
  const taxMultiplier = showTax ? 100 / (100 + taxRatePercent) : 1;
  const item1Exact = 35000 * taxMultiplier;
  const item2Exact = 16000 * taxMultiplier;
  const item3Exact = 42000 * taxMultiplier;

  const itemPrices: [number, number, number] = [
    Math.round(item1Exact),
    Math.round(item2Exact),
    Math.round(item3Exact),
  ];

  const exactSubtotal = item1Exact + item2Exact + item3Exact;
  const subtotal = showTax ? Math.round(exactSubtotal) : 93000;
  const rawTax = showTax ? exactSubtotal * (taxRatePercent / 100) : 0;
  const tax = taxRoundingMode === 'truncate' ? Math.floor(rawTax) : Math.round(rawTax);
  const total = showTax ? subtotal + tax : subtotal;
  const cash = 100000;
  const change = Math.max(0, cash - total);

  return { itemPrices, subtotal, tax, total, change };
};

// ── Test Print Result Codes & Logic ────────────────────────────────

export const TEST_PRINT_CODES = {
  /** Success: Test receipt sent and accepted by printer driver. */
  SUCCESS: 'PRN_SUCCESS_200',
  /** Error: User authentication token is missing or expired. */
  ERR_AUTH_REQUIRED: 'PRN_ERR_AUTH_REQUIRED',
  /** Error: Printer connection is set to 'disabled'. */
  ERR_PRINTER_DISABLED: 'PRN_ERR_DISABLED',
  /** Error: Network connection selected but IP address / hostname is empty. */
  ERR_MISSING_HOST: 'PRN_ERR_MISSING_HOST',
  /** Error: USB/Serial connection selected but device port/path is empty. */
  ERR_MISSING_PORT: 'PRN_ERR_MISSING_PORT',
  /** Error: No printer registered in HAL or driver not found. */
  ERR_PRINTER_NOT_FOUND: 'PRN_ERR_NOT_FOUND',
  /** Error: Paper out, paper jam, or cover open. */
  ERR_PAPER_FAULT: 'PRN_ERR_PAPER_FAULT',
  /** Error: Connection timeout or unreachable network host. */
  ERR_TIMEOUT: 'PRN_ERR_TIMEOUT',
  /** Error: Device or port currently busy with another print job. */
  ERR_BUSY: 'PRN_ERR_BUSY',
  /** Error: System permission denied accessing printer device or port. */
  ERR_PERMISSION_DENIED: 'PRN_ERR_PERMISSION_DENIED',
  /** Error: I/O or serial/USB port communication failure. */
  ERR_COMMUNICATION: 'PRN_ERR_COMMUNICATION',
  /** Error: Printer completed job without output confirmation. */
  ERR_UNCONFIRMED: 'PRN_ERR_UNCONFIRMED',
  /** Error: Generic fallback print failure. */
  ERR_GENERAL: 'PRN_ERR_GENERAL',
} as const;

export type TestPrintCode = (typeof TEST_PRINT_CODES)[keyof typeof TEST_PRINT_CODES];

export interface TestPrintResult {
  code: TestPrintCode;
  message: string;
  type: 'success' | 'error';
  timestamp: number;
}

/** Format a canonical test print code with its user-facing message. */
export function formatTestPrintResult(
  code: TestPrintCode,
  customDetail?: string,
): { code: TestPrintCode; message: string; type: 'success' | 'error' } {
  switch (code) {
    case TEST_PRINT_CODES.SUCCESS:
      return {
        code,
        type: 'success',
        message: 'Test receipt was sent to the printer successfully.',
      };
    case TEST_PRINT_CODES.ERR_AUTH_REQUIRED:
      return {
        code,
        type: 'error',
        message: 'Authentication session token is missing. Please sign in to test print.',
      };
    case TEST_PRINT_CODES.ERR_PRINTER_DISABLED:
      return {
        code,
        type: 'error',
        message: 'Receipt printer is currently disabled in settings. Enable a connection (Network, USB, Serial, or Auto) before test printing.',
      };
    case TEST_PRINT_CODES.ERR_MISSING_HOST:
      return {
        code,
        type: 'error',
        message: 'Network printer IP address or hostname is not specified. Please enter a valid host address.',
      };
    case TEST_PRINT_CODES.ERR_MISSING_PORT:
      return {
        code,
        type: 'error',
        message: 'Printer device port or path is not configured. Please enter the port or path.',
      };
    case TEST_PRINT_CODES.ERR_PRINTER_NOT_FOUND:
      return {
        code,
        type: 'error',
        message: 'No receipt printer is registered or detected on this device.',
      };
    case TEST_PRINT_CODES.ERR_PAPER_FAULT:
      return {
        code,
        type: 'error',
        message: 'Printer fault: check paper roll supply, cover latch, or paper jam.',
      };
    case TEST_PRINT_CODES.ERR_TIMEOUT:
      return {
        code,
        type: 'error',
        message: 'Printer communication timed out. Verify network connection, cable, and device power.',
      };
    case TEST_PRINT_CODES.ERR_BUSY:
      return {
        code,
        type: 'error',
        message: 'Printer or communication port is currently busy with another operation.',
      };
    case TEST_PRINT_CODES.ERR_PERMISSION_DENIED:
      return {
        code,
        type: 'error',
        message: 'Permission denied when accessing printer hardware port.',
      };
    case TEST_PRINT_CODES.ERR_COMMUNICATION:
      return {
        code,
        type: 'error',
        message: customDetail
          ? `Printer device communication error: ${customDetail}`
          : 'Communication failed between the system and printer hardware.',
      };
    case TEST_PRINT_CODES.ERR_UNCONFIRMED:
      return {
        code,
        type: 'error',
        message: 'Printer completed operation without confirming printed receipt output.',
      };
    case TEST_PRINT_CODES.ERR_GENERAL:
    default:
      return {
        code: TEST_PRINT_CODES.ERR_GENERAL,
        type: 'error',
        message: customDetail
          ? `Test print failed: ${customDetail}`
          : 'An unexpected error occurred while sending the test print job.',
      };
  }
}

/** Classify an unknown error thrown during test printing into a canonical code. */
export function classifyTestPrintError(err: unknown): { code: TestPrintCode; detail?: string } {
  let raw = '';
  if (typeof err === 'string') {
    raw = err;
  } else if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'object' && err !== null) {
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
      raw = (err as { message: string }).message;
    } else {
      raw = JSON.stringify(err);
    }
  }

  const lower = raw.toLowerCase();

  if (
    lower.includes('no receipt printer registered') ||
    lower.includes('no printer registered') ||
    lower.includes('printer not registered') ||
    lower.includes('printer not found') ||
    lower.includes('device not found')
  ) {
    return { code: TEST_PRINT_CODES.ERR_PRINTER_NOT_FOUND };
  }
  if (
    lower.includes('paper supply') ||
    lower.includes('cover') ||
    lower.includes('out of paper') ||
    lower.includes('paper jam') ||
    lower.includes('not ready') ||
    lower.includes('check paper')
  ) {
    return { code: TEST_PRINT_CODES.ERR_PAPER_FAULT };
  }
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('connection refused') ||
    lower.includes('unreachable') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('host unreachable')
  ) {
    return { code: TEST_PRINT_CODES.ERR_TIMEOUT };
  }
  if (
    lower.includes('busy') ||
    lower.includes('in use') ||
    lower.includes('conflict') ||
    lower.includes('device locked')
  ) {
    return { code: TEST_PRINT_CODES.ERR_BUSY };
  }
  if (
    lower.includes('permission') ||
    lower.includes('access denied') ||
    lower.includes('forbidden') ||
    lower.includes('unauthorized')
  ) {
    return { code: TEST_PRINT_CODES.ERR_PERMISSION_DENIED };
  }
  if (
    lower.includes('io error') ||
    lower.includes('serial') ||
    lower.includes('usb') ||
    lower.includes('socket') ||
    lower.includes('pipe') ||
    lower.includes('broken')
  ) {
    return { code: TEST_PRINT_CODES.ERR_COMMUNICATION, detail: raw };
  }

  return { code: TEST_PRINT_CODES.ERR_GENERAL, detail: raw };
}
