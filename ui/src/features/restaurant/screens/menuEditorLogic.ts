// ── RestaurantMenuEditorScreen pure logic ─────────────────────────────────
//
// Extracted from RestaurantMenuEditorScreen.tsx for the same two reasons
// receiptLogic.ts sits beside RestaurantReceiptsScreen.tsx: the screen file must
// export components only (react-refresh/only-export-components), and price
// parsing is arithmetic that deserves direct unit tests rather than a DOM.
//
// Money crosses this boundary as INTEGER MINOR UNITS in both directions. The
// operator types major units, so the conversion happens here and nowhere else --
// never by parsing to float and multiplying, which is where the 0.1 + 0.2 class
// of error enters an invoice.

/**
 * Parse operator input (major units, as typed) into integer minor units.
 *
 * Accepts both conventions because the same field serves IDR and foreign stores:
 * `1.234,50` and `1234.50`. Grouping dots (a dot followed by exactly three
 * digits at a group boundary) are stripped before the decimal mark is decided.
 *
 * @returns the minor-unit value, or null when the text is not a usable amount
 *   (empty, non-numeric, or more precision than the currency has).
 */
export function parsePriceToMinor(input: string, currency: string): number | null {
  const raw = input.trim();
  if (raw === '') return null;

  // Drop spaces and underscores first: both are common paste artefacts.
  const normalised = raw.replace(/[ _]/g, '');

  // A dot is a GROUPING mark only when every dot-group is exactly three digits
  // AND there is no comma acting as the decimal mark. This is what separates
  // `1.234.567` (1234567) from `50.123` (a decimal with three places, which
  // IDR cannot hold). Treating any dot-before-three-digits as grouping reads the
  // second as 50123 -- the exact mis-parse this branch exists to prevent.
  // `50.123` is ambiguous by syntax alone: it is either the grouped integer
  // 50123 or a three-decimal amount. The currency breaks the tie. IDR cannot
  // hold three decimal places, so for IDR the grouped reading is the only one
  // that yields a valid amount; for a currency that CAN hold three, the decimal
  // reading is the one the operator meant.
  const threePlaceGroups = /^\d{1,3}(\.\d{3})+$/.test(normalised);
  const multiGroup = threePlaceGroups && (normalised.match(/\./g) ?? []).length > 1;
  const looksGrouped =
    !normalised.includes(',') && threePlaceGroups && (currency === 'IDR' || multiGroup);
  const degrouped = looksGrouped ? normalised.replace(/\./g, '') : normalised;

  // A comma is the decimal mark only when no dot survived.
  const dotForm = degrouped.includes('.') ? degrouped : degrouped.replace(',', '.');

  if (!/^\d+(\.\d*)?$/.test(dotForm)) return null;

  const [whole = '0', frac = ''] = dotForm.split('.');
  // IDR has no sub-unit in practice; more than two decimals is a typo, not a value.
  if (frac.length > 2 && currency === 'IDR') return null;

  const padded = (frac + '00').slice(0, 2);
  const minor = Number(whole) * 100 + Number(padded);
  return Number.isFinite(minor) ? minor : null;
}

/**
 * Mint a SKU for a new menu item.
 *
 * The backend does NOT generate one: `create_product_scoped` passes
 * `args.sku` straight to the store, and `foundation::validate_sku` rejects
 * empty, non-ASCII and non-alphanumeric values — so a blank SKU is a hard
 * failure, not a default. A menu editor has no SKU field (nobody authoring a
 * dish wants to invent a stock code), so the editor mints one.
 *
 * The format is deliberately ASCII alphanumeric ONLY: `validate_sku` rejects
 * both hyphens and dots, which is why this does not use a `-${...}` style.
 * Prefixed `MN` so a generated item is recognisable in the Products workspace,
 * where a manager can rename it to the store's own scheme if it has one.
 */
let skuCounter = 0;

export function generateMenuSku(seed: number = Date.now()): string {
  skuCounter = (skuCounter + 1) % 10000;
  const stamp = Math.trunc(Math.abs(seed)).toString(36).toUpperCase();
  const seq = skuCounter.toString(36).toUpperCase();
  const salt = Math.random().toString(36).slice(2, 8).toUpperCase();
  // Strip anything the validator would reject, then guarantee non-empty:
  // an SKU of '' fails validate_sku, and so would the bare prefix if both
  // halves were somehow empty.
  const clean = (stamp + seq + salt).replace(/[^0-9A-Z]/g, '');
  return `MN${clean || 'ITEM'}`;
}

/**
 * Render integer minor units back into the plain digits the operator edits:
 * no currency symbol, no grouping separators. `5000` -> `"50"`, `5050` -> `"50.50"`.
 */
export function formatMinorForInput(minor: number): string {
  if (!Number.isFinite(minor) || minor < 0) return '';
  const whole = Math.trunc(minor / 100);
  const frac = Math.abs(minor % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

export type MenuItemStatusFilter = 'all' | 'available' | 'hidden';

export interface FilterMenuItemsParams<T> {
  items: T[];
  selectedCategoryName: string;
  searchQuery: string;
  statusFilter: MenuItemStatusFilter;
}

/**
 * Filter menu items by active category, status, and search query.
 *
 * Matching against name, SKU and kitchen notes allows cashiers and managers
 * to search by dish name ("Nasi Goreng"), code ("MN123") or ingredient/note ("sambal").
 */
export function filterMenuItems<
  T extends {
    name: string;
    sku: string;
    category?: string | null | undefined;
    notes?: string | null | undefined;
    is_active?: boolean | undefined;
  },
>({ items, selectedCategoryName, searchQuery, statusFilter }: FilterMenuItemsParams<T>): T[] {
  const query = searchQuery.trim().toLowerCase();
  return items.filter((p) => {
    // Category match: empty or 'all' means all categories
    if (selectedCategoryName && selectedCategoryName !== 'all') {
      if ((p.category ?? '') !== selectedCategoryName) return false;
    }

    // Status filter
    const isActive = p.is_active !== false;
    if (statusFilter === 'available' && !isActive) return false;
    if (statusFilter === 'hidden' && isActive) return false;

    // Search query match (name, sku, or notes)
    if (query) {
      const matchName = p.name.toLowerCase().includes(query);
      const matchSku = p.sku.toLowerCase().includes(query);
      const matchNotes = (p.notes ?? '').toLowerCase().includes(query);
      if (!matchName && !matchSku && !matchNotes) return false;
    }

    return true;
  });
}

export type MenuItemSortOption = 'default' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

/**
 * Sort menu items according to selected SaaS ordering criteria.
 */
export function sortMenuItems<
  T extends {
    name: string;
    price: { minor_units: number };
  },
>(items: T[], sortOption: MenuItemSortOption): T[] {
  if (sortOption === 'default') return items;
  return [...items].sort((a, b) => {
    switch (sortOption) {
      case 'name-asc':
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
      case 'price-asc':
        return a.price.minor_units - b.price.minor_units;
      case 'price-desc':
        return b.price.minor_units - a.price.minor_units;
      default:
        return 0;
    }
  });
}

/**
 * Create a clone draft from an existing menu item for quick duplication.
 */
export function createDuplicateDraft<
  T extends {
    name: string;
    category?: string | null | undefined;
    price: { minor_units: number };
    notes?: string | null | undefined;
    is_active?: boolean | undefined;
  },
>(item: T, copySuffix = ' (Copy)'): {
  sku: null;
  name: string;
  categoryName: string;
  priceMinor: number;
  isActive: boolean;
  notes: string;
  modifierGroups: DraftModifierGroup[];
} {
  const isJsonNotes = Boolean(item.notes?.startsWith('['));
  return {
    sku: null,
    name: `${item.name}${copySuffix}`,
    categoryName: item.category ?? '',
    priceMinor: item.price.minor_units,
    isActive: item.is_active !== false,
    notes: isJsonNotes ? '' : (item.notes ?? ''),
    modifierGroups: parseDraftModifierGroups(item.notes),
  };
}

export interface DraftModifierOption {
  id: string;
  name: string;
  priceMinor: number;
}

export interface DraftModifierGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: DraftModifierOption[];
}

/**
 * Parse modifier groups from dish notes when encoded as JSON.
 */
export function parseDraftModifierGroups(notes: string | null | undefined): DraftModifierGroup[] {
  if (!notes || !notes.startsWith('[')) return [];
  try {
    const parsed: unknown = JSON.parse(notes);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
      .map((g, gIdx) => ({
        id: typeof g['id'] === 'string' ? g['id'] : `mg-${gIdx}`,
        name: typeof g['name'] === 'string' ? g['name'] : '',
        minSelections: typeof g['minSelections'] === 'number' ? g['minSelections'] : 0,
        maxSelections: typeof g['maxSelections'] === 'number' ? g['maxSelections'] : 1,
        options: Array.isArray(g['modifiers'])
          ? g['modifiers']
              .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
              .map((m, mIdx) => ({
                id: typeof m['id'] === 'string' ? m['id'] : `opt-${mIdx}`,
                name: typeof m['name'] === 'string' ? m['name'] : '',
                priceMinor: typeof m['priceMinor'] === 'number' ? m['priceMinor'] : 0,
              }))
          : [],
      }));
  } catch {
    return [];
  }
}

/**
 * Serialize modifier groups into the JSON shape expected by `getProductModifierGroups`.
 */
export function serializeDraftModifierGroups(groups: DraftModifierGroup[]): string | null {
  const cleanGroups = groups
    .filter((g) => g.name.trim() !== '')
    .map((g, gIdx) => ({
      id: g.id || `mg-${Date.now().toString(36)}-${gIdx}`,
      name: g.name.trim(),
      minSelections: Math.max(0, g.minSelections),
      maxSelections: Math.max(1, g.maxSelections),
      sortOrder: gIdx,
      modifiers: g.options
        .filter((o) => o.name.trim() !== '')
        .map((o, oIdx) => ({
          id: o.id || `opt-${Date.now().toString(36)}-${oIdx}`,
          name: o.name.trim(),
          priceMinor: Math.max(0, o.priceMinor),
          sortOrder: oIdx,
          isDefault: oIdx === 0 && g.minSelections > 0,
        })),
    }))
    .filter((g) => g.modifiers.length > 0);

  if (cleanGroups.length === 0) return null;
  return JSON.stringify(cleanGroups);
}
