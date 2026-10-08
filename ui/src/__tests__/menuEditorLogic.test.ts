import { describe, it, expect } from 'vitest';
import {
  parsePriceToMinor,
  formatMinorForInput,
  generateMenuSku,
  filterMenuItems,
  sortMenuItems,
  createDuplicateDraft,
  parseDraftModifierGroups,
  serializeDraftModifierGroups,
} from '../features/restaurant/screens/menuEditorLogic';

// The price field is the one place a menu edit can silently corrupt an invoice,
// so the rounding boundary is pinned rather than assumed.

describe('parsePriceToMinor', () => {
  it('accepts a whole number of major units', () => {
    expect(parsePriceToMinor('50', 'IDR')).toBe(5000);
  });

  it('accepts two decimals as minor units', () => {
    expect(parsePriceToMinor('50.50', 'IDR')).toBe(5050);
    expect(parsePriceToMinor('50,50', 'IDR')).toBe(5050);
  });

  it('pads a single decimal to two minor digits', () => {
    expect(parsePriceToMinor('50.5', 'IDR')).toBe(5050);
  });

  it('strips dot grouping before deciding the decimal mark', () => {
    // 1.234.567 as grouping -> 1234567 major units, not 1.234567.
    expect(parsePriceToMinor('1.234.567', 'IDR')).toBe(123456700);
  });

  it('reads a three-digit dot-group as IDR grouping, not as three decimals', () => {
    // 50.123 is syntactically ambiguous. For IDR the grouped reading is the one
    // an operator means: a rupiah price is never written with three decimals,
    // and 50.123 as a decimal would not be representable in minor units anyway.
    expect(parsePriceToMinor('50.123', 'IDR')).toBe(5012300);
  });

  it('rejects a genuinely over-precise amount', () => {
    // Four decimals cannot be grouped into threes, so this is unambiguously a
    // decimal that IDR cannot hold.
    expect(parsePriceToMinor('50.1234', 'IDR')).toBeNull();
  });

  it('rejects empty and non-numeric input rather than coercing to zero', () => {
    // A silent 0 here would price an item as free.
    expect(parsePriceToMinor('', 'IDR')).toBeNull();
    expect(parsePriceToMinor('   ', 'IDR')).toBeNull();
    expect(parsePriceToMinor('abc', 'IDR')).toBeNull();
    expect(parsePriceToMinor('5o', 'IDR')).toBeNull();
  });
});

describe('formatMinorForInput', () => {
  it('renders whole major units without a decimal part', () => {
    expect(formatMinorForInput(5000)).toBe('50');
  });

  it('renders a fractional part with two digits', () => {
    expect(formatMinorForInput(5050)).toBe('50.50');
    expect(formatMinorForInput(5005)).toBe('50.05');
  });

  it('returns empty for values an operator could not have entered', () => {
    expect(formatMinorForInput(-1)).toBe('');
    expect(formatMinorForInput(Number.NaN)).toBe('');
  });
});

describe('generateMenuSku', () => {
  // foundation::validate_sku rejects empty, non-ASCII and non-alphanumeric input,
  // and the backend does NOT mint a SKU — so these assertions are the contract
  // between the editor and the store.
  const VALID_SKU = /^[A-Za-z0-9]+$/;

  it('produces an ASCII alphanumeric value with no separators', () => {
    // Hyphens and dots are explicitly rejected by validate_sku, so a
    // human-readable "MN-ABC-123" shape would fail on the backend.
    for (let i = 0; i < 25; i += 1) {
      const sku = generateMenuSku();
      expect(sku).toMatch(VALID_SKU);
      expect(sku).not.toContain('-');
      expect(sku).not.toContain('.');
      expect(sku.length).toBeGreaterThan(2);
    }
  });

  it('is prefixed so a generated item is recognisable in Products', () => {
    expect(generateMenuSku().startsWith('MN')).toBe(true);
  });

  it('never returns an empty body for an adverse seed', () => {
    for (const seed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(generateMenuSku(seed)).toMatch(VALID_SKU);
    }
  });

  it('does not collide across a burst of creations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generateMenuSku());
    expect(seen.size).toBe(200);
  });
});

describe('round trip', () => {
  it('survives parse -> format for representative prices', () => {
    for (const minor of [0, 1, 100, 5050, 123456700]) {
      const text = formatMinorForInput(minor);
      if (text === '') continue;
      expect(parsePriceToMinor(text, 'IDR')).toBe(minor);
    }
  });
});

describe('filterMenuItems', () => {
  const sampleItems = [
    { sku: 'MN1', name: 'Nasi Goreng Spesial', category: 'Main', notes: 'Extra pedas', is_active: true },
    { sku: 'MN2', name: 'Mie Goreng Seafood', category: 'Main', notes: 'No udang', is_active: false },
    { sku: 'MN3', name: 'Es Teh Manis', category: 'Drinks', notes: null, is_active: true },
    { sku: 'MN4', name: 'Kopi Tubruk', category: 'Drinks', notes: 'Gula aren', is_active: false },
  ];

  it('returns all items when category is empty or "all" with no query and "all" status', () => {
    const res = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: '',
      searchQuery: '',
      statusFilter: 'all',
    });
    expect(res).toHaveLength(4);

    const resAll = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: 'all',
      searchQuery: '',
      statusFilter: 'all',
    });
    expect(resAll).toHaveLength(4);
  });

  it('filters by category name', () => {
    const res = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: 'Drinks',
      searchQuery: '',
      statusFilter: 'all',
    });
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.sku)).toEqual(['MN3', 'MN4']);
  });

  it('filters by status: available vs hidden', () => {
    const available = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: '',
      searchQuery: '',
      statusFilter: 'available',
    });
    expect(available.map((r) => r.sku)).toEqual(['MN1', 'MN3']);

    const hidden = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: '',
      searchQuery: '',
      statusFilter: 'hidden',
    });
    expect(hidden.map((r) => r.sku)).toEqual(['MN2', 'MN4']);
  });

  it('searches by name, SKU, or notes', () => {
    // By name
    const byName = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: '',
      searchQuery: 'seafood',
      statusFilter: 'all',
    });
    expect(byName.map((r) => r.sku)).toEqual(['MN2']);

    // By SKU
    const bySku = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: '',
      searchQuery: 'MN3',
      statusFilter: 'all',
    });
    expect(bySku.map((r) => r.sku)).toEqual(['MN3']);

    // By notes
    const byNotes = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: '',
      searchQuery: 'aren',
      statusFilter: 'all',
    });
    expect(byNotes.map((r) => r.sku)).toEqual(['MN4']);
  });

  it('combines category, status, and search query filters', () => {
    const combined = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: 'Main',
      searchQuery: 'pedas',
      statusFilter: 'available',
    });
    expect(combined.map((r) => r.sku)).toEqual(['MN1']);

    const noMatch = filterMenuItems({
      items: sampleItems,
      selectedCategoryName: 'Drinks',
      searchQuery: 'pedas',
      statusFilter: 'available',
    });
    expect(noMatch).toHaveLength(0);
  });
});

describe('sortMenuItems', () => {
  const items = [
    { name: 'Burger', price: { minor_units: 45000 } },
    { name: 'Apple Pie', price: { minor_units: 20000 } },
    { name: 'Steak', price: { minor_units: 120000 } },
  ];

  it('preserves order on default sort', () => {
    expect(sortMenuItems(items, 'default')).toEqual(items);
  });

  it('sorts by name ascending and descending', () => {
    const asc = sortMenuItems(items, 'name-asc');
    expect(asc.map((i) => i.name)).toEqual(['Apple Pie', 'Burger', 'Steak']);

    const desc = sortMenuItems(items, 'name-desc');
    expect(desc.map((i) => i.name)).toEqual(['Steak', 'Burger', 'Apple Pie']);
  });

  it('sorts by price low-to-high and high-to-low', () => {
    const lowHigh = sortMenuItems(items, 'price-asc');
    expect(lowHigh.map((i) => i.price.minor_units)).toEqual([20000, 45000, 120000]);

    const highLow = sortMenuItems(items, 'price-desc');
    expect(highLow.map((i) => i.price.minor_units)).toEqual([120000, 45000, 20000]);
  });
});

describe('createDuplicateDraft', () => {
  it('creates an un-minted draft copying name, price, category, notes, and active status', () => {
    const original = {
      sku: 'MN001',
      name: 'Nasi Goreng',
      category: 'Mains',
      price: { minor_units: 35000 },
      notes: 'Extra pedas',
      is_active: true,
    };

    const draft = createDuplicateDraft(original);
    expect(draft.sku).toBeNull();
    expect(draft.name).toBe('Nasi Goreng (Copy)');
    expect(draft.categoryName).toBe('Mains');
    expect(draft.priceMinor).toBe(35000);
    expect(draft.notes).toBe('Extra pedas');
    expect(draft.isActive).toBe(true);
    expect(draft.modifierGroups).toEqual([]);
  });

  it('parses modifier groups into draft when notes contains serialized groups', () => {
    const original = {
      sku: 'MN002',
      name: 'Kopi Susu',
      category: 'Drinks',
      price: { minor_units: 18000 },
      notes: JSON.stringify([
        {
          id: 'g1',
          name: 'Sweetness',
          modifiers: [{ id: 'm1', name: 'Less Sugar', priceMinor: 0 }],
        },
      ]),
      is_active: true,
    };

    const draft = createDuplicateDraft(original);
    expect(draft.name).toBe('Kopi Susu (Copy)');
    expect(draft.notes).toBe('');
    expect(draft.modifierGroups).toHaveLength(1);
    expect(draft.modifierGroups[0]?.name).toBe('Sweetness');
  });
});

describe('modifier groups serialization & parsing', () => {
  it('parses empty array for missing or plain text notes', () => {
    expect(parseDraftModifierGroups(null)).toEqual([]);
    expect(parseDraftModifierGroups('')).toEqual([]);
    expect(parseDraftModifierGroups('Allergens: nuts')).toEqual([]);
    expect(parseDraftModifierGroups('{invalid')).toEqual([]);
  });

  it('parses valid modifier groups from JSON notes', () => {
    const json = JSON.stringify([
      {
        id: 'mg-1',
        name: 'Size',
        minSelections: 1,
        maxSelections: 1,
        modifiers: [
          { id: 'opt-reg', name: 'Regular', priceMinor: 0 },
          { id: 'opt-lrg', name: 'Large', priceMinor: 5000 },
        ],
      },
    ]);

    const parsed = parseDraftModifierGroups(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe('Size');
    expect(parsed[0]?.options).toHaveLength(2);
    expect(parsed[0]?.options[1]?.priceMinor).toBe(5000);
  });

  it('serializes draft groups into JSON compatible with domain getProductModifierGroups', () => {
    const draftGroups = [
      {
        id: 'mg-1',
        name: 'Spice Level',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'opt-1', name: 'Mild', priceMinor: 0 },
          { id: 'opt-2', name: 'Hot', priceMinor: 2000 },
        ],
      },
    ];

    const serialized = serializeDraftModifierGroups(draftGroups);
    expect(serialized).not.toBeNull();
    expect(serialized?.startsWith('[')).toBe(true);

    const decoded = JSON.parse(serialized!);
    expect(decoded[0].modifiers[0].isDefault).toBe(true);
    expect(decoded[0].modifiers[1].priceMinor).toBe(2000);
  });

  it('returns null when groups are empty or have no options', () => {
    expect(serializeDraftModifierGroups([])).toBeNull();
    expect(serializeDraftModifierGroups([{ id: '1', name: '', minSelections: 0, maxSelections: 1, options: [] }])).toBeNull();
  });
});
