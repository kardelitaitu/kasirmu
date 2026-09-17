import { loggedInvoke } from '@/utils/logged-invoke';

/**
 * The hierarchy level that supplied a resolved regional value.
 *
 * Mirrors `kasirmu_core::regional::ConfigScope`'s serde names verbatim
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
 * `kasirmu_core::timezone::business_date_in_zone`, never re-derived client-side.
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

/**
 * The regional write payload (slice 3). Field names match the axis columns in
 * `locations`/`legal_entities` (snake_case on the wire, like the read
 * model); `""` means "clear, inherit from the scope above".
 */
export interface SetRegionalConfigArgs {
  /** Locale override (BCP-47 shape); blank to inherit. */
  readonly locale: string;
  /** Timezone — an ADR #48 IANA preset or the legacy `UTC` sentinel. */
  readonly timezone: string;
  /** Currency override (ISO-4217 alpha-3); blank to inherit. */
  readonly currency: string;
  /** Market anchor (ISO-3166 alpha-2); blank leaves the entity's untouched. */
  readonly country_code: string;
}

/**
 * Write the regional configuration for one location (ADR #7 scoped, gated
 * `settings:edit` server-side).
 *
 * All validation happens in core — the ADR #48 timezone contract, ISO-4217 /
 * BCP-47 / ISO-3166 shapes — inside the transaction that writes the row; the
 * front-end never re-implements those rules. Returns the freshly resolved
 * config (read-after-write) so the caller can re-render provenance.
 */
export const setRegionalConfigScoped = (
  sessionToken: string,
  locationId: string,
  config: SetRegionalConfigArgs,
): Promise<RegionalConfig> =>
  loggedInvoke<RegionalConfig>('set_regional_config_scoped', { sessionToken, locationId, config });

/**
 * The ADR #48 write contract for `timezone`, mirrored for the regional
 * card's select: exactly the three Indonesian IANA presets, or the legacy
 * `UTC` sentinel for un-migrated rows. The backend rejects anything else
 * (typed `Validation`); this list is presentation, not validation.
 */
export const REGIONAL_TIMEZONE_PRESETS: readonly string[] = [
  'Asia/Jakarta',
  'Asia/Makassar',
  'Asia/Jayapura',
] as const;
