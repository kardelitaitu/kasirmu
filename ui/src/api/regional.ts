import { loggedInvoke } from '@/utils/logged-invoke';

/**
 * The hierarchy level that supplied a resolved regional value.
 *
 * Mirrors `oz_core::regional::ConfigScope`'s serde names verbatim
 * (snake_case) — the core model promises these names to later slices, so the
 * front-end re-exports them as-is rather than re-decorating them.
 */
export type RegionalScope = 'location' | 'legal_entity' | 'organization' | 'built_in';

/** One resolved regional axis: the effective value and who answered for it. */
export interface RegionalValue {
  /** The effective value. */
  value: string;
  /** The scope that supplied {@link value}. */
  scope: RegionalScope;
}

/**
 * The effective regional configuration for one location (regional slice 2,
 * saas-2 design slice queue #2).
 *
 * ADR #48 (87114abf6): `timezone.value` is the **stored** IANA zone name —
 * offsets are derived at display/report time via
 * `oz_core::timezone::business_date_in_zone`, never re-derived client-side.
 */
export interface RegionalConfig {
  /** The location this was resolved for. */
  location_id: string;
  /** The legal entity owning the location, when the link is populated. */
  legal_entity_id: string | null;
  /** ISO-3166 alpha-2 market code, or null when no entity declares one. */
  country_code: string | null;
  /** Effective BCP-47 locale with its provenance. */
  locale: RegionalValue;
  /** Effective timezone with its provenance (stored IANA name — see ADR #48). */
  timezone: RegionalValue;
  /** Effective ISO-4217 currency code with its provenance. */
  currency: RegionalValue;
}

/** Get the effective regional configuration for one location (ADR #7 scoped,
 *  gated `settings:read` server-side). */
export const getRegionalConfigScoped = (
  sessionToken: string,
  locationId: string,
): Promise<RegionalConfig> =>
  loggedInvoke<RegionalConfig>('get_regional_config_scoped', { sessionToken, locationId });
