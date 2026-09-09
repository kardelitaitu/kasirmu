import { loggedInvoke } from '@/utils/logged-invoke';

// ── Local payment methods (regional slice 6) ────────────────────────

/**
 * Who supplied an effective payment rail (mirrors
 * `oz_core::regional::ConfigScope`'s serde names verbatim).
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
