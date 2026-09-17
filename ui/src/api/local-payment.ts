import { loggedInvoke } from '@/utils/logged-invoke';

// ── Local payment methods (regional slice 6) ────────────────────────

/**
 * Who supplied an effective payment rail (mirrors
 * `kasirmu_core::regional::ConfigScope`'s serde names verbatim).
 */
export type PaymentRailScope = 'location' | 'legal_entity';

/**
 * One effective payment rail for a location: the MARKET surface — which
 * rails exist, what they are called, whether the site offers them.
 *
 * Deliberately carries NO tier answer: `supports_qris` is a tier capability
 * from the license layer, never derivable from these rows, and no gateway
 * credential can appear in `parameters` (the backend write path rejects
 * credential-shaped keys).
 */
export interface LocalPaymentRail {
  /** Stable rail code (e.g. `qris`, `va-bca`). */
  rail_code: string;
  /** Display label. */
  label: string;
  /** Whether the site offers the rail. */
  is_enabled: boolean;
  /** Who answered: the market default (legal entity) or the site. */
  scope: PaymentRailScope;
  /** Per-rail market metadata (JSON object string). Never credentials. */
  parameters: string;
}

/** One rail in the card's replace-set submission. */
export interface LocalPaymentRailArgs {
  /** Stable rail code. */
  rail_code: string;
  /** Display label. */
  label: string;
  /** Whether the scope offers the rail. */
  is_enabled: boolean;
  /** Per-rail market metadata (JSON object string). Never credentials. */
  parameters: string;
}

/** Get the effective payment rails for one location (ADR #7 scoped,
 *  gated `settings:read` server-side). */
export const getLocalPaymentMethodsScoped = (
  sessionToken: string,
  locationId: string,
): Promise<LocalPaymentRail[]> =>
  loggedInvoke<LocalPaymentRail[]>('get_local_payment_methods_scoped', {
    sessionToken,
    locationId,
  });

/** Replace the location's rail list (the card's whole-list write) and get
 *  the freshly effective surface back (gated `settings:edit` server-side). */
export const setLocalPaymentMethodsScoped = (
  sessionToken: string,
  locationId: string,
  rails: LocalPaymentRailArgs[],
): Promise<LocalPaymentRail[]> =>
  loggedInvoke<LocalPaymentRail[]>('set_local_payment_methods_scoped', {
    sessionToken,
    locationId,
    rails,
  });

// ── The qris rail's static-QR payload (agents-5 R2) ─────────────────
//
// Key inside the per-rail `parameters` bag carrying the merchant's
// static EMVCo QRIS string. It is market metadata — the same code the
// printed counter poster encodes, scannable by anyone — never a
// credential, which is the distinction the backend's
// FORBIDDEN_PARAMETER_FRAGMENTS guard enforces on this exact bag.

export const STATIC_QR_PARAM = 'static_qr_payload';

/** Read the payload from a rail's parameters JSON; malformed or absent
 *  reads as null ("not configured") — the fail-open truth. */
export function readStaticQrPayload(parameters: string): string | null {
  try {
    const parsed: unknown = JSON.parse(parameters);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[STATIC_QR_PARAM];
      return typeof value === 'string' && value.length > 0 ? value : null;
    }
  } catch {
    /* malformed bag */
  }
  return null;
}

/** Write the payload into a parameters bag, preserving every other key
 *  (an empty value removes the key). A malformed incoming bag is NOT
 *  silently replaced — the backend rejects malformed bags too, so the
 *  first honest save must be a deliberate repair. */
export function writeStaticQrPayload(parameters: string, value: string): string {
  let parsed: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(parameters);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return parameters;
    parsed = raw as Record<string, unknown>;
  } catch {
    return parameters;
  }
  if (value.length === 0) delete parsed[STATIC_QR_PARAM];
  else parsed[STATIC_QR_PARAM] = value;
  return JSON.stringify(parsed);
}
