// ── Tax Rates ──────────────────────────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** A tax rate definition in basis points. */
export interface TaxRateDto {
  id: string;
  name: string;
  rate_bps: number;
  is_default: boolean;
  is_inclusive: boolean;
  display_rate: string;
  created_at: string;
  updated_at: string;
  /** The rate's authoring scope (Option B side-channel join — the
   *  backend composes it from list_tax_rate_scopes, it is not stored on
   *  the core struct). null when the active row has no scope entry. */
  scope: TaxRateScope | null;
  /** The rate's validity window, joined the same way. */
  window: TaxRateWindow | null;
}

/** The authoring scope of a tax-rate row. Mirrors the backend's
 *  TaxRateScopeDto (camelCase wire). */
export interface TaxRateScope {
  /** "global" | "legal_entity" | "location". */
  scope: string;
  /** The owning legal entity, for entity-scoped rows. */
  legalEntityId: string | null;
  /** The owning location, for location-scoped rows. */
  locationId: string | null;
}

/** The validity window of a tax-rate row. Mirrors the backend's
 *  TaxRateWindowDto (camelCase wire). */
export interface TaxRateWindow {
  /** Inclusive first business date, "YYYY-MM-DD". null = no lower bound. */
  effectiveFrom: string | null;
  /** EXCLUSIVE last business date, "YYYY-MM-DD". null = never expires. */
  effectiveTo: string | null;
}

/** Arguments for creating a new tax rate.
 *
 *  Scope/window fields are OPTIONAL and mutually exclusive:
 *  legalEntityId XOR locationId (sending both is refused with a typed
 *  validation error); omitting every scope/window field keeps the legacy
 *  tenant-global write. Dates are strict "YYYY-MM-DD"; the exclusive end
 *  must be after the start. */
export interface CreateTaxRateArgs {
  name: string;
  rateBps: number;
  isDefault: boolean;
  isInclusive: boolean;
  /** Scope the rate to this legal entity (mutually exclusive with
   *  locationId; omit both for the tenant-global arm). */
  legalEntityId?: string;
  /** Scope the rate to this location (mutually exclusive with
   *  legalEntityId). */
  locationId?: string;
  /** Inclusive first business date, "YYYY-MM-DD". undefined = no bound. */
  effectiveFrom?: string;
  /** EXCLUSIVE last business date, "YYYY-MM-DD". undefined = never
   *  expires. */
  effectiveTo?: string;
}

/** Arguments for updating an existing tax rate. Optional scope/window
 *  fields follow the same routing rule as {@link CreateTaxRateArgs}.
 *  NOTE: moving a rate between tiers silently empties the vacated tier's
 *  default — the configuration UI must warn before saving. */
export interface UpdateTaxRateArgs {
  id: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
  isInclusive: boolean;
  /** New legal-entity scope (mutually exclusive with locationId). */
  legalEntityId?: string;
  /** New location scope (mutually exclusive with legalEntityId). */
  locationId?: string;
  /** New inclusive first business date, "YYYY-MM-DD". */
  effectiveFrom?: string;
  /** New exclusive last business date, "YYYY-MM-DD". */
  effectiveTo?: string;
}

/** A product category and its assigned tax rate identifiers. */
export interface CategoryTaxRateRow {
  category_id: string;
  tax_rate_ids: string[];
}

/** Arguments for setting tax rates on a product category. */
export interface SetCategoryTaxRatesArgs {
  categoryId: string;
  taxRateIds: string[];
}

/** Reference counts for a tax rate (TAX-03) — used by the delete confirmation UI. */
export interface TaxRateDependencyCounts {
  products: number;
  categories: number;
  sale_lines: number;
}

/** A cart line for computing tax in a live preview. */
export interface CartLineTaxInput {
  sku: string;
  qty: number;
  unit_price_minor: number;
}

/** Result of a cart-level tax preview. */
export interface CartTaxResult {
  /** Total tax across all lines/rates, in minor units. */
  taxMinor: number;
  /** True when at least one applied rate is exclusive (tax added on top
   *  of the price). When false, all rates were inclusive or none applied.
   *  The frontend must add `taxMinor` to the payable total ONLY when
   *  `hasExclusive` is true — inclusive tax is already embedded in the
   *  displayed price, so adding it again would double-charge. */
  hasExclusive: boolean;
}

/** Compute total tax for a set of cart lines (live preview) using the scoped variant (ADR #7). */
export const computeCartTax = (
  sessionToken: string | null,
  lines: CartLineTaxInput[],
  currency: string,
): Promise<CartTaxResult> =>
  sessionToken
    ? loggedInvoke<CartTaxResult>('compute_cart_tax_scoped', { sessionToken, lines, currency })
    : Promise.resolve({ taxMinor: 0, hasExclusive: false });

/** List all tax rates for the store resolved from a session token. ADR #7. */
export const listTaxRatesScoped = (sessionToken: string): Promise<TaxRateDto[]> =>
  loggedInvoke<TaxRateDto[]>('list_tax_rates_scoped', { sessionToken });

/** Create a tax rate in the store resolved from a session token. ADR #7. */
export const createTaxRateScoped = (
  sessionToken: string,
  args: CreateTaxRateArgs,
): Promise<TaxRateDto> =>
  loggedInvoke<TaxRateDto>('create_tax_rate_scoped', { sessionToken, args });

/** Update a tax rate in the store resolved from a session token. ADR #7. */
export const updateTaxRateScoped = (
  sessionToken: string,
  args: UpdateTaxRateArgs,
): Promise<TaxRateDto> =>
  loggedInvoke<TaxRateDto>('update_tax_rate_scoped', { sessionToken, args });

/** Delete a tax rate in the store resolved from a session token. ADR #7. */
export const deleteTaxRateScoped = (sessionToken: string, id: string): Promise<void> =>
  loggedInvoke('delete_tax_rate_scoped', { sessionToken, id });

/** Get reference counts for a tax rate in the session store (TAX-03). */
export const getTaxRateDependencyCountsScoped = (
  sessionToken: string,
  id: string,
): Promise<TaxRateDependencyCounts> =>
  loggedInvoke<TaxRateDependencyCounts>('get_tax_rate_dependency_counts_scoped', {
    sessionToken,
    id,
  });

/** List category-to-tax-rate assignments for a session store. ADR #7. */
export const listCategoryTaxRatesScoped = (sessionToken: string): Promise<CategoryTaxRateRow[]> =>
  loggedInvoke<CategoryTaxRateRow[]>('list_category_tax_rates_scoped', { sessionToken });

/** Set category tax rates in the store resolved from a session token. ADR #7. */
export const setCategoryTaxRatesScoped = (
  sessionToken: string,
  args: SetCategoryTaxRatesArgs,
): Promise<void> =>
  loggedInvoke<void>('set_category_tax_rates_scoped', {
    sessionToken,
    args: {
      category_id: args.categoryId,
      tax_rate_ids: args.taxRateIds,
    },
  });
