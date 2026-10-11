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

import { parseMoneyInput, formatMoneyInput } from '@/types/domain';

/**
 * Parse operator input (major units, as typed) into integer minor units.
 * Delegated to canonical `parseMoneyInput` in `@/types/domain`.
 */
export function parsePriceToMinor(input: string, currency: string = 'IDR'): number | null {
  return parseMoneyInput(input, currency);
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
 * no currency symbol, no grouping separators.
 * Delegated to canonical `formatMoneyInput` in `@/types/domain`.
 */
export function formatMinorForInput(minor: number, currency: string = 'IDR'): string {
  return formatMoneyInput(minor, currency);
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
  return {
    sku: null,
    name: `${item.name}${copySuffix}`,
    categoryName: item.category ?? '',
    priceMinor: item.price.minor_units,
    isActive: item.is_active !== false,
    notes: parseDraftNotes(item.notes),
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
 * Extract human-readable dish notes/description when encoded as plain text or JSON metadata.
 */
export function parseDraftNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  if (notes.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(notes);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { description?: unknown }).description === 'string'
      ) {
        return (parsed as { description: string }).description;
      }
    } catch {
      return '';
    }
  }
  if (notes.startsWith('[')) return '';
  return notes;
}

/**
 * Parse modifier groups from dish notes when encoded as JSON array or object.
 */
export function parseDraftModifierGroups(notes: string | null | undefined): DraftModifierGroup[] {
  if (!notes) return [];
  let rawArray: unknown[] = [];
  if (notes.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(notes);
      if (Array.isArray(parsed)) rawArray = parsed;
    } catch {
      return [];
    }
  } else if (notes.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(notes);
      if (parsed && typeof parsed === 'object') {
        const candidate =
          (parsed as { modifierGroups?: unknown; modifiers?: unknown }).modifierGroups ||
          (parsed as { modifierGroups?: unknown; modifiers?: unknown }).modifiers;
        if (Array.isArray(candidate)) rawArray = candidate;
      }
    } catch {
      return [];
    }
  } else {
    return [];
  }

  return rawArray
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

/**
 * Serialize dish description notes and modifier groups together, preserving both without data loss.
 */
export function serializeDraftMenuNotes(
  notes: string,
  groups: DraftModifierGroup[],
): string | null {
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

  const trimmedDesc = notes.trim();

  if (cleanGroups.length > 0 && trimmedDesc) {
    return JSON.stringify({
      description: trimmedDesc,
      modifierGroups: cleanGroups,
    });
  }

  if (cleanGroups.length > 0) {
    return JSON.stringify(cleanGroups);
  }

  return trimmedDesc || null;
}
