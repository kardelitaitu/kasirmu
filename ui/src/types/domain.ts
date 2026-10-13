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

import { getDecimalSep, getThousandsSep } from '@/utils/storage';

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

/** A single modifier option within a group (e.g. "Rare", "Fries"). */
export interface ModifierOption {
  id: string;
  name: string;
  priceMinor: number;
  sortOrder: number;
  isDefault: boolean;
}

/** A modifier group for customizable items (e.g. "Doneness", "Sides"). */
export interface ModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  modifiers: ModifierOption[];
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
  /** Optional customer/kitchen note for this item (e.g. "pedas", "less ice"). */
  readonly note?: string;
  /** Quantity that has already been dispatched to the kitchen. */
  readonly dispatchedQty?: number;
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
  /** Product type: "retail" | "restaurant" | "service". */
  readonly productType: 'retail' | 'restaurant' | 'service';
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
  /** Optional modifier groups configured for this item. */
  readonly modifierGroups?: ModifierGroup[];
}

/** A retail product with physical barcode, ledger inventory, and shelf placement. */
export interface RetailProduct extends Product {
  readonly productType: 'retail';
}

/** A restaurant menu item with courses, modifier customizations, and recipe deduction. */
export interface RestaurantMenuItem extends Product {
  readonly productType: 'restaurant';
}

/** A service item (untracked stock, appointment or hourly rate). */
export interface ServiceItem extends Product {
  readonly productType: 'service';
}

/** Discriminated union of typed catalog domain models. */
export type CatalogItem = RetailProduct | RestaurantMenuItem | ServiceItem;

/** Type guard for retail products. */
export function isRetailProduct(p: Product): p is RetailProduct {
  return p.productType === 'retail';
}

/** Type guard for restaurant menu items. */
export function isRestaurantMenuItem(p: Product): p is RestaurantMenuItem {
  return p.productType === 'restaurant';
}

/** Type guard for service items. */
export function isServiceItem(p: Product): p is ServiceItem {
  return p.productType === 'service';
}

/** A single recipe ingredient item for a composite dish or drink. */
export interface RecipeItem {
  readonly id: string;
  readonly parentProductId: string;
  readonly ingredientProductId: string;
  readonly ingredientSku: string;
  readonly ingredientName: string;
  readonly quantityRequired: number;
  readonly unit: string;
  readonly costMinor: number;
}

/** Input row for editing or creating an ingredient in a recipe. */
export interface RecipeIngredientInput {
  ingredientProductId: string;
  quantityRequired: number;
  unit: string;
}

/** Extract configured modifier groups from a product or its serialized metadata. */
export function getProductModifierGroups(product: Product): ModifierGroup[] {
  if (product.modifierGroups && product.modifierGroups.length > 0) {
    return product.modifierGroups;
  }
    if (product.notes && product.notes.startsWith('[')) {
    try {
      const parsed = JSON.parse(product.notes);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].modifiers) {
        return parsed as ModifierGroup[];
      }
    } catch { /* malformed notes */ }
  }
  if (product.notes && product.notes.startsWith('{')) {
    try {
      const parsed = JSON.parse(product.notes);
      if (parsed && typeof parsed === 'object') {
        const groups =
          (parsed as { modifierGroups?: unknown; modifiers?: unknown }).modifierGroups ||
          (parsed as { modifierGroups?: unknown; modifiers?: unknown }).modifiers;
        if (Array.isArray(groups) && groups.length > 0 && groups[0].modifiers) {
          return groups as ModifierGroup[];
        }
      }
    } catch { /* malformed notes */ }
  }
  return [];
}

/** Mirrors `AppError` in `apps/desktop-tauri/src/error.rs`. */
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

/**
 * Render integer minor units as the plain decimal literal an editable amount
 * `<input>` needs — 350 with exp 2 → "3.50", 10000 with exp 0 → "10000" — so the
 * value round-trips back through `parseMinorUnits` / `parseMoneyInput` unchanged.
 *
 * Integer-only arithmetic, no floating-point rounding.
 */
export function minorUnitsToInputString(minor: number, exp: number): string {
  if (!Number.isFinite(minor)) return '';
  const digits = String(Math.trunc(Math.abs(minor))).padStart(exp + 1, '0');
  const body = exp > 0
    ? `${digits.slice(0, digits.length - exp)}.${digits.slice(digits.length - exp)}`
    : digits;
  return minor < 0 ? `-${body}` : body;
}

/**
 * Format integer minor units for editable input fields according to currency rules.
 * For exponent-0 currencies (IDR, JPY, KRW): integer digits only ("5000", "0").
 * For decimal currencies (USD, EUR, GBP): trimmed decimals ("50", "50.50", "0.05", "0").
 */
export function formatMoneyInput(minor: number, currency: string = 'IDR'): string {
  if (!Number.isFinite(minor) || minor < 0) return '';
  const exp = minorUnitExponent(currency);
  if (exp === 0) {
    return String(Math.trunc(minor));
  }
  const factor = 10 ** exp;
  const whole = Math.trunc(minor / factor);
  const frac = Math.abs(minor % factor);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(exp, '0')}`;
}

/**
 * Parse operator input (major units, as typed) into integer minor units across any currency.
 *
 * Handles grouping dots/commas safely:
 * - Currencies with exponent 0 (IDR, JPY, KRW, VND):
 *   "5000" -> 5000, "5.000" -> 5000, "50.000" -> 50000, "50,000" -> 50000, "1.234.567" -> 1234567.
 *   Rejects fractional decimals ("50.5") that the currency cannot represent.
 * - Currencies with exponent > 0 (USD, EUR, SGD):
 *   "50" -> 5000, "50.50" -> 5050, "50,50" -> 5050, "1,234.50" -> 123450, "1.234,50" -> 123450.
 *   Rejects over-precision ("50.123" for USD).
 *
 * Returns integer minor units, or null if input is non-numeric, negative, or invalid.
 */
export function parseMoneyInput(input: string, currency: string = 'IDR'): number | null {
  const raw = input.trim();
  if (raw === '') return null;

  // Strip spaces and underscores
  const normalised = raw.replace(/[ _]/g, '');

  const exp = minorUnitExponent(currency);

  let degrouped = normalised;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(normalised)) {
    // Dot grouping followed by comma decimal (e.g. 1.234,50): strip dots, comma becomes dot
    degrouped = normalised.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+\.\d+$/.test(normalised)) {
    // Comma grouping followed by dot decimal (e.g. 1,234.50): strip commas
    degrouped = normalised.replace(/,/g, '');
  } else {
    // Single separator type or no decimals:
    const threePlaceDotGroups = /^\d{1,3}(\.\d{3})+$/.test(normalised);
    const multiDotGroup = threePlaceDotGroups && (normalised.match(/\./g) ?? []).length > 1;
    const looksDotGrouped =
      !normalised.includes(',') && threePlaceDotGroups && (exp === 0 || multiDotGroup);

    const threePlaceCommaGroups = /^\d{1,3}(,\d{3})+$/.test(normalised);
    const multiCommaGroup = threePlaceCommaGroups && (normalised.match(/,/g) ?? []).length > 1;
    const looksCommaGrouped =
      !normalised.includes('.') && threePlaceCommaGroups && (exp === 0 || multiCommaGroup);

    if (looksDotGrouped) {
      degrouped = normalised.replace(/\./g, '');
    } else if (looksCommaGrouped) {
      degrouped = normalised.replace(/,/g, '');
    } else {
      // If a comma is present and no dot, treat comma as potential decimal point
      degrouped = normalised.includes('.') ? normalised : normalised.replace(',', '.');
    }
  }

  if (!/^\d+(\.\d*)?$/.test(degrouped)) return null;

  const [whole = '0', frac = ''] = degrouped.split('.');

  if (exp === 0) {
    // Currencies with exponent 0 (IDR, JPY, KRW, VND) have no circulating minor units.
    if (frac !== '' && !/^0+$/.test(frac)) {
      return null;
    }
    const minor = Number(whole);
    return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
  }

  // Reject input with more decimal places than currency exponent
  if (frac.length > exp) return null;

  const padded = frac.padEnd(exp, '0');
  const minor = Number(whole) * 10 ** exp + Number(padded);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

/**
 * Parse a user-entered balance or money amount in major units
 * (e.g. "100" for USD $100.00 -> 10000 minor units; "100000" or "100.000" for IDR -> 100000 minor units)
 * scaled to the currency's minor units.
 *
 * Returns null if input is invalid or negative; empty string parses to 0.
 */
export function parseBalanceInput(input: string, currency: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  return parseMoneyInput(trimmed, currency);
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
  thousandsSep?: 'comma' | 'dot' | 'space' | 'none',
): string => {
  if (!m || typeof m !== 'object' || typeof m.currency !== 'string') {
    return 'Rp 0';
  }
  const sep = decimalSep ?? getDecimalSep();
  const hideDecimals = sep === 'none';
  const exp = minorUnitExponent(m.currency);
  const major = m.minor_units / 10 ** exp;
  const decimals = hideDecimals || exp === 0 ? 0 : exp;
  // The store's thousands separator, when one is configured.
  //
  // `Intl.NumberFormat` derives grouping from the LOCALE, so before this the
  // preview could not agree with the paper: the printer honours
  // `currency.thousands_separator` through `ReceiptConfig.grouping`
  // (receipt.rs:193) while this formatter grouped the Indonesian way whatever the
  // store asked for. Passing `useGrouping: false` and grouping the integer part
  // ourselves is the only way to express a separator the locale does not choose.
  //
    // Defaults through the localStorage bridge, exactly as `decimalSep` does on the
  // line above. The two settings are the printer's own pair — `ReceiptConfig` carries
  // `decimal_separator` (:181) and `grouping` (:193) — so the preview must resolve both
  // the same way or it can only ever agree with the paper on half the figures.
  //
  // An explicit argument still wins, so a caller with a reason can override.
  const tsep = thousandsSep ?? getThousandsSep();
  const groupChar = tsep === 'comma' ? ',' : tsep === 'dot' ? '.' : tsep === 'space' ? ' ' : null;
  const fmt = new Intl.NumberFormat(locale, {
    style: 'decimal',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...(groupChar ? { useGrouping: false } : {}),
  });
  // Known currency → symbol mapping
  const symbols: Record<string, string> = {
    USD: '$', IDR: 'Rp', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩',
    SGD: 'S$', MYR: 'RM', PHP: '₱', VND: '₫', THB: '฿', CNY: '¥',
    AUD: 'A$', CAD: 'C$', HKD: 'HK$', TWD: 'NT$', INR: '₹',
  };
  const prefix = symbols[m.currency] ?? m.currency;
  const formatted = fmt.format(major);
  if (!groupChar) return `${prefix} ${formatted}`;
  // Group the INTEGER part only, so a separator can never split the fraction.
  // `fmt.format` already emitted the digits with the locale's own grouping
  // suppressed, and the decimal mark is whatever `Intl` chose for `locale`.
  const [intPart, fracPart] = formatted.split(/(?=[.,])/);
  const grouped = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, groupChar);
  return `${prefix} ${grouped}${fracPart ?? ''}`;
};
