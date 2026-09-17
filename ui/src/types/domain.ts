// Domain types mirrored from `kasirmu-core` (Rust).
//
// Newtypes use `& { readonly __brand }` so the TypeScript type system
// refuses to mix up `CartId` and `Sku`. Convert at the IPC boundary
// (`pos.ts` is the only place that talks to Rust).

/** Branded string type for cart identifiers. */
export type CartId = string & { readonly __brand: 'CartId' };
/** Branded string type for cart line identifiers. */
export type LineId = string & { readonly __brand: 'LineId' };
/** Branded string type for stock-keeping unit codes. */
export type Sku = string & { readonly __brand: 'Sku' };

import { getDecimalSep } from '@/utils/storage';

/** Money in minor units, paired with a 3-letter ISO-4217 code. */
export interface Money {
  readonly minor_units: number;
  readonly currency: string;
}

/**
 * Default low-stock threshold (units) applied when a product has no explicit
 * `low_stock_threshold`. Shared by the retail grid, POS screen, and the
 * add/edit product modals so they never drift apart.
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Default high-stock threshold (units) applied when a product has no explicit
 * `high_stock_threshold`.
 */
export const DEFAULT_HIGH_STOCK_THRESHOLD = 10;

/** Course identifier for restaurant order coursing — the canonical KDS
 * vocabulary (`appetizer | main | side | dessert | beverage`), shared with
 * the KDS sort, the picker, and the backend `course` column. The legacy POS
 * value `drinks` normalizes to `beverage` at every boundary.
 *
 * The empty string is the CLEAR sentinel, not a course: the chip's "None"
 * option and the panel's `onAssignCourse` pass `''` to unassign a line. It is
 * part of the type because three call sites were already writing
 * `'' as CourseId` to defeat it, and a cast is a worse place for a contract
 * than the type is. */
export type CourseId = 'appetizer' | 'main' | 'side' | 'dessert' | 'beverage' | '';
/** Legacy POS course value, kept only for normalizing persisted data. */
export type LegacyCourseId = CourseId | 'drinks';

/** Normalize a possibly-legacy course id to the canonical vocabulary. */
export function normalizeCourseId(course: string | null | undefined): CourseId | null {
  if (!course) return null;
  if (course === 'drinks') return 'beverage';
  return course as CourseId;
}

/** Coursing status — items on hold wait to be fired to the kitchen. */
export type CoursingStatus = 'hold' | 'fired';

/** All defined course types with their display labels. */
export const COURSES: { id: CourseId; label: string; emoji: string }[] = [
  { id: 'appetizer', label: 'Appetizer', emoji: '🥗' },
  { id: 'main', label: 'Main Course', emoji: '🍽️' },
  { id: 'side', label: 'Side', emoji: '🍟' },
  { id: 'dessert', label: 'Dessert', emoji: '🍰' },
  { id: 'beverage', label: 'Beverage', emoji: '🥤' },
];

/** A modifier selection for a cart line. Mirrors the backend KdsModifier type. */
export interface ModifierSelection {
  groupId: string;
  groupName: string;
  modifierId: string;
  modifierName: string;
  priceMinor: number;
}

/** Label for a given course ID (legacy `drinks` resolves to Beverage). */
export function courseLabel(courseId: CourseId | LegacyCourseId): string {
  const normalized = normalizeCourseId(courseId);
  return COURSES.find((c) => c.id === normalized)?.label ?? courseId;
}

/** Emoji for a given course ID (legacy `drinks` resolves to the beverage emoji). */
export function courseEmoji(courseId: CourseId | LegacyCourseId): string {
  const normalized = normalizeCourseId(courseId);
  return COURSES.find((c) => c.id === normalized)?.emoji ?? '🍽️';
}

/** A single line in a shopping cart. */
export interface CartLine {
  readonly id: LineId;
  readonly sku: Sku;
  /** Display name of the product (set at add time, may be absent from IPC). */
  readonly name?: string;
  /** Product category used to render a course chip on the cart line. */
  readonly category?: string;
  readonly qty: number;
  readonly unit_price: Money;
  /** Course assignment for restaurant coursing (undefined = not applicable). */
  readonly courseId?: CourseId;
  /** Coursing status — hold (not yet sent to kitchen) or fired. */
  readonly coursingStatus?: CoursingStatus;
  /** Optional modifier selections attached to this line. */
  readonly modifiers?: ModifierSelection[];
}

/**
 * A product that can be sold in the store.
 * Mirrors the product domain model from the backend.
 */
export interface Product {
  readonly sku: Sku;
  readonly name: string;
  readonly category: string;
  readonly price: Money;
  /** Barcode (EAN-13, UPC-A, etc.) if available. */
  readonly barcode: string | null;
  /** Whether the product is currently in stock. */
  readonly inStock: boolean;
  /** Current stock quantity, or null if tracking is disabled. */
  readonly stockQty: number | null;
  /** ISO-8601 creation timestamp. */
  readonly createdAt?: string;
  /** ISO-8601 timestamp of the last price change. */
  readonly priceUpdatedAt?: string;
  /** Product type: "retail" | "restaurant" | "both" | "service". */
  readonly productType: 'retail' | 'restaurant' | 'both' | 'service';
  /** Cost price in minor units (local-only, ADR #36). */
  readonly costMinor?: number;
  /** Brand (free text). */
  readonly brand?: string | null;
  /** Rack position code. */
  readonly rackLocation?: string | null;
  /** Free-text notes. */
  readonly notes?: string | null;
  /** Unit of measure. */
  readonly unit?: string | null;
  /** Active/sellable status. */
  readonly isActive?: boolean;
  /** Default supplier FK (local-only). */
  readonly defaultSupplierId?: string | null;
  /** Materialized popularity score (ADR #37) — retail grid sort key. */
  readonly popularityScore?: number;
}

/** Mirrors `AppError` in `apps/desktop-client/src/error.rs`. */
export type AppError =
  | { kind: 'core'; subKind: string; message: string }
  | { kind: 'hardware'; subKind: string; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'permissionDenied'; message: string }
  | { kind: 'invalidSession'; message?: string }
  | { kind: 'internal'; message: string };

/**
 * Type guard that checks whether an unknown value is an AppError.
 *
 * Tauri serializes the Rust `AppError` with a `kind` discriminator
 * (`core`, `hardware`, `invalid`, `permissionDenied`, `invalidSession`,
 * `internal`). The typed shape is always preferred over string parsing
 * — see `ui/src/utils/app-error.ts` for the full normalizer.
 */
export const isAppError = (e: unknown): e is AppError =>
  typeof e === 'object' && e !== null && 'kind' in e;

/** ISO-4217 minor-unit exponent (decimal places) — IDR/JPY/KRW/VND = 0, KWD = 3, USD/EUR = 2.
 *  Canonical frontend convention; `formatMoney` and money-input parsing share
 *  this via `minorUnitExponent`. Aligned with the Rust side: `Currency::minor_unit_exponent`
 *  (foundation/src/money.rs), the `006_currencies.sql` migration, `kasirmu-cli`
 *  init-db, and this map all treat IDR as 0 (the Rupiah has no circulating
 *  minor unit). */
export const MINOR_UNIT_EXPONENT: Record<string, number> = {
  IDR: 0, JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0,
  KWD: 3, OMR: 3, BHD: 3, JOD: 3, TND: 3,
};

/** Minor-unit exponent (decimal places) for an ISO-4217 currency code. */
export const minorUnitExponent = (currency: string): number =>
  MINOR_UNIT_EXPONENT[currency] ?? 2;

/** Strict decimal literal: optional sign, digits and/or a fractional part. */
const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/**
 * Parse a user-entered decimal string into scaled integer units EXACTLY
 * (MONEY-02, 2026-08-31) — `scaleExponent` is the currency's minor-unit
 * exponent, or 6 for fixed-point rate millionths.
 *
 * Replaces the `Math.round(parseFloat(s) * 10**exp)` pattern, which
 * mis-rounds boundary decimals ("1.005" → 100.49999… → 100 instead of
 * 101) and silently accepts non-decimal garbage ("1e3" → 1000,
 * "1,500" → 1). The whole computation is BigInt; ties round half-up
 * toward +Infinity, the same rule `Math.round` applies to positives.
 *
 * Returns `null` for anything that is not a plain decimal literal or
 * whose scaled result exceeds the safe integer range — callers must
 * handle `null` as invalid input, never as zero.
 */
export function parseMinorUnits(input: string, scaleExponent: number): number | null {
  const m = DECIMAL_RE.exec(input.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] ?? '';
  const fracPart = m[3] ?? '';
  if (intPart === '' && fracPart === '') return null; // '', '+', '.', '5.'
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '');
  // value = sign × digits / 10^fracLen; result = value × 10^scaleExponent
  const num = sign * BigInt(digits) * 10n ** BigInt(scaleExponent);
  const den = 10n ** BigInt(fracPart.length);
  let q = num / den;
  let r = num % den;
  if (r < 0n) {
    // BigInt division truncates toward zero; move to floor so the
    // half-up tie rule is uniform across signs.
    q -= 1n;
    r += den;
  }
  if (2n * r >= den) q += 1n;
  if (q > BigInt(Number.MAX_SAFE_INTEGER) || q < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(q);
}

/** Render a fixed-point millionths value (LOYALTY-01 tier multipliers)
 *  as a plain decimal string without trailing zeros: 1_400_000 → "1.4",
 *  1_000_000 → "1", 1_070_000 → "1.07". Pure integer arithmetic — the
 *  value never passes through a binary float, so "1.4" round-trips
 *  exactly (the whole point of the millionths storage). */
export function millionthsToDecimalString(millionths: number): string {
  const neg = millionths < 0;
  const abs = Math.abs(millionths);
  const whole = Math.floor(abs / 1_000_000);
  const frac = abs - whole * 1_000_000;
  const body = frac === 0
    ? String(whole)
    : `${whole}.${String(frac).padStart(6, '0').replace(/0+$/, '')}`;
  return neg ? `-${body}` : body;
}

/** Format `Money` for display. Defaults to Indonesian locale (id-ID).
 *  `decimalSep` overrides the per‑store receipt setting (read from
 *  localStorage when omitted). */
export const formatMoney = (
  m: Money,
  locale: string = 'id-ID',
  decimalSep?: 'dot' | 'comma' | 'none',
): string => {
  const sep = decimalSep ?? getDecimalSep();
  const hideDecimals = sep === 'none';
  const exp = minorUnitExponent(m.currency);
  const major = m.minor_units / 10 ** exp;
  const decimals = hideDecimals || exp === 0 ? 0 : exp;
  const fmt = new Intl.NumberFormat(locale, {
    style: 'decimal',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // Known currency → symbol mapping
  const symbols: Record<string, string> = {
    USD: '$', IDR: 'Rp', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩',
    SGD: 'S$', MYR: 'RM', PHP: '₱', VND: '₫', THB: '฿', CNY: '¥',
    AUD: 'A$', CAD: 'C$', HKD: 'HK$', TWD: 'NT$', INR: '₹',
  };
  const prefix = symbols[m.currency] ?? m.currency;
  return `${prefix} ${fmt.format(major)}`;
};
