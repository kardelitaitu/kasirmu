/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCompletedSaleReceipt,
  buildKitchenChitReceipt,
  buildPreCheckoutBillReceipt,
  formatReceiptLineNote,
  isBeverageItem,
} from '@/features/sales/payment/completedSale';
import type { CartLine, Money } from '@/types/domain';
import type { SaleDetail, PaymentDto } from '@/api/sales';
import type { ActiveMarketProfile } from '@/api/regional';

const makeMoney = (minorUnits: number, currency = 'IDR'): Money => ({
  minor_units: minorUnits,
  currency,
});

const makeCartLine = (name: string, qty: number, unitPriceMinor: number, currency = 'IDR'): CartLine => ({
  id: `line-${name}` as unknown as CartLine['id'],
  sku: `SKU-${name}` as unknown as CartLine['sku'],
  name,
  qty,
  unit_price: makeMoney(unitPriceMinor, currency),
});

const makeSaleDetail = (overrides: Partial<SaleDetail> = {}): SaleDetail => ({
  id: 'sale-uuid-1234',
  total: makeMoney(10000),
  subtotal: makeMoney(9000),
  taxTotal: makeMoney(1000),
  lineCount: 1,
  // The bridge sends these unconditionally (`#[serde(default)]` on a bare i64,
  // history.rs:188-199), so a fixture omitting them is not a sale the wire can
  // produce. Added when the TS type stopped claiming they were optional.
  discountPercent: 0,
  tipMinor: 0,
  serviceChargeMinor: 0,
  status: 'completed',
  paymentMethod: 'cash',
  tenderedMinor: 10000,
  userId: 'user-1',
  createdAt: '2026-10-02T12:00:00Z',
  lines: [
    {
      id: 'sline-1',
      sku: 'SKU-Item',
      name: 'Item',
      qty: 1,
      unit_price: makeMoney(9000),
      total_minor: 9000,
      tax_amount: makeMoney(1000),
      tax_rate_id: null,
    },
  ],
  ...overrides,
});

const makeMarketProfile = (overrides: Partial<ActiveMarketProfile> = {}): ActiveMarketProfile => ({
  location_id: 'loc-1',
  legal_entity_id: 'ent-1',
  country_code: 'ID',
  currency: 'IDR',
  default_locale: 'id-ID',
  timezone: 'Asia/Jakarta',
  tax_regime: 'PB1',
  statutory_rounding: 'half_up',
  enabled_payment_rails: ['cash', 'qris'],
  ...overrides,
});

const makePayment = (method: string, minorUnits: number, currency = 'IDR'): PaymentDto => ({
  method,
  amount: { minorUnits, currency },
  change: null,
});

describe('buildCompletedSaleReceipt', () => {
  it('does not throw when the read-back omits subtotal (degrades to the fallback)', () => {
    // MEASURED ON THE TABLET 2026-10-09. A completed sale went through the modal's
    // done-branch with NO receipt preview: `sales` row 01-01-261009-01-07 existed
    // (total 15000, tendered 999999, status completed) but the operator saw only the
    // bare 'Sale Complete' checkmark, so there was nothing to print.
    //
    // Cause: PaymentModal.tsx:1273-1327 wraps the read-back AND the receipt build in
    // a try whose catch is `// Receipt/KDS may not be configured - non-blocking`. A
    // throw from this builder is therefore swallowed, `setReceiptArgs` never runs,
    // and the modal falls to its no-receipt done branch. The declared type says
    // `subtotal: Money` is required, but the docstring two lines above the deref
    // claims a '-short or absent read-back- degrades gracefully' - and line 139 did
    // NOT guard it. A short read-back is exactly what the tablet produced.
    const sale = makeSaleDetail();
    // Deliberately strip the money fields a short read-back can omit.
    const short = { ...sale, subtotal: undefined } as unknown as SaleDetail;
    const receipt = buildCompletedSaleReceipt({
      saleId: 'sale-uuid-1234',
      saleTotal: makeMoney(10000),
      completedSale: short,
      cartLines: [makeCartLine('Item', 1, 9000)],
      cartCurrency: 'IDR',
      fallbackTotalMinor: 10000,
      payments: [makePayment('cash', 10000)],
    });
    // It must still produce a usable receipt, not explode.
    expect(receipt.total.minorUnits).toBe(10000);
    expect(receipt.items).toHaveLength(1);
  });

  it('does not throw when the read-back omits total or taxTotal', () => {
    const sale = makeSaleDetail();
    const short = { ...sale, total: undefined, taxTotal: undefined } as unknown as SaleDetail;
    const receipt = buildCompletedSaleReceipt({
      saleId: 'sale-uuid-1234',
      saleTotal: makeMoney(10000),
      completedSale: short,
      cartLines: [makeCartLine('Item', 1, 9000)],
      cartCurrency: 'IDR',
      fallbackTotalMinor: 10000,
      payments: [makePayment('cash', 10000)],
    });
    expect(receipt.total.minorUnits).toBe(10000);
  });
  it('prefers frozen receipt displayCode over synthetic SALE-<uuid>', () => {
    const sale = makeSaleDetail({ displayCode: '01-02-261002-05-000123' });
    const receipt = buildCompletedSaleReceipt({
      saleId: 'sale-uuid-1234',
      saleTotal: makeMoney(10000),
      completedSale: sale,
      cartLines: [makeCartLine('Item', 1, 9000)],
      cartCurrency: 'IDR',
      fallbackTotalMinor: 10000,
      payments: [makePayment('cash', 10000)],
    });

    expect(receipt.receiptNumber).toBe('01-02-261002-05-000123');
  });

  it('falls back to SALE-<uuid> when displayCode is missing or null', () => {
    const sale = makeSaleDetail({ displayCode: null });
    const receipt = buildCompletedSaleReceipt({
      saleId: 'sale-uuid-5678',
      saleTotal: makeMoney(10000),
      completedSale: sale,
      cartLines: [makeCartLine('Item', 1, 9000)],
      cartCurrency: 'IDR',
      fallbackTotalMinor: 10000,
      payments: [makePayment('cash', 10000)],
    });

    expect(receipt.receiptNumber).toBe('SALE-sale-uuid-5678');
  });

  it('derives dynamic tax registration label and tax regime across countries', () => {
    const countries = [
      { country: 'ID', expectedLabel: 'NPWP' },
      { country: 'SG', expectedLabel: 'GST Reg No' },
      { country: 'MY', expectedLabel: 'SST ID' },
      { country: 'AU', expectedLabel: 'ABN' },
      { country: 'GB', expectedLabel: 'VAT Reg No' },
      { country: 'US', expectedLabel: 'EIN' },
      { country: 'JP', expectedLabel: 'Tax ID' },
    ];

    for (const { country, expectedLabel } of countries) {
      const profile = makeMarketProfile({ country_code: country, tax_regime: 'VAT' });
      const receipt = buildCompletedSaleReceipt({
        saleId: 's1',
        saleTotal: makeMoney(5000),
        completedSale: null,
        cartLines: [],
        cartCurrency: 'USD',
        fallbackTotalMinor: 5000,
        payments: [],
        marketProfile: profile,
      });

      expect(receipt.taxIdLabel).toBe(expectedLabel);
      expect(receipt.taxRegime).toBe('VAT');
    }
  });

  it('omits taxRegime when tax_regime is NONE', () => {
    const profile = makeMarketProfile({ country_code: 'US', tax_regime: 'NONE' });
    const receipt = buildCompletedSaleReceipt({
      saleId: 's1',
      saleTotal: makeMoney(5000),
      completedSale: null,
      cartLines: [],
      cartCurrency: 'USD',
      fallbackTotalMinor: 5000,
      payments: [],
      marketProfile: profile,
    });

    expect(receipt.taxRegime).toBeUndefined();
  });

  it('carries statutory rounding from market profile', () => {
    const profile = makeMarketProfile({ statutory_rounding: 'truncate' });
    const receipt = buildCompletedSaleReceipt({
      saleId: 's1',
      saleTotal: makeMoney(5000),
      completedSale: null,
      cartLines: [],
      cartCurrency: 'IDR',
      fallbackTotalMinor: 5000,
      payments: [],
      marketProfile: profile,
    });

    expect(receipt.statutoryRounding).toBe('truncate');
  });

  it('formats as formal statutory tax invoice when statutoryNumber is present', () => {
    const sale = makeSaleDetail({ statutoryNumber: 'INV-2026-00042', displayCode: '01-02-261002-05-000123' });
    const receipt = buildCompletedSaleReceipt({
      saleId: 'sale-uuid-1234',
      saleTotal: makeMoney(10000),
      completedSale: sale,
      cartLines: [makeCartLine('Item', 1, 9000)],
      cartCurrency: 'IDR',
      fallbackTotalMinor: 10000,
      payments: [makePayment('cash', 10000)],
      customerName: 'Acme Corp',
      customerTaxId: '01.234.567.8-901.000',
    });

    expect(receipt.isInvoice).toBe(true);
    expect(receipt.documentKind).toBe('invoice');
    expect(receipt.statutoryNumber).toBe('INV-2026-00042');
    expect(receipt.receiptNumber).toBe('INV-2026-00042');
    expect(receipt.customerName).toBe('Acme Corp');
    expect(receipt.customerTaxId).toBe('01.234.567.8-901.000');
  });

  it('preserves modifiers and customer notes on completed sale receipt items', () => {
    const lines: CartLine[] = [
      {
        ...makeCartLine('Wagyu Burger', 1, 95000),
        modifiers: [
          { groupId: 'g1', groupName: 'Cheese', modifierId: 'm1', modifierName: 'Extra Cheddar', priceMinor: 10000 },
          { groupId: 'g2', groupName: 'Cook', modifierId: 'm2', modifierName: 'Medium Rare', priceMinor: 0 },
        ],
        note: 'No pickles',
      },
      {
        ...makeCartLine('Iced Latte', 2, 35000),
        modifiers: [
          { groupId: 'g3', groupName: 'Milk', modifierId: 'm3', modifierName: 'Oat Milk', priceMinor: 5000 },
        ],
      },
    ];

    const receipt = buildCompletedSaleReceipt({
      saleId: 's-mod-1',
      saleTotal: makeMoney(165000),
      completedSale: null,
      cartLines: lines,
      cartCurrency: 'IDR',
      fallbackTotalMinor: 165000,
      payments: [makePayment('cash', 165000)],
    });

    expect(receipt.items).toHaveLength(2);
    expect(receipt.items?.[0]?.note).toBe('Extra Cheddar, Medium Rare | No pickles');
    expect(receipt.items?.[1]?.note).toBe('Oat Milk');
  });
});

describe('buildPreCheckoutBillReceipt', () => {
  it('formats pre-checkout bill receipt with table number, modifiers, and notes', () => {
    const lines: CartLine[] = [
      {
        ...makeCartLine('Grilled Salmon', 1, 120000),
        modifiers: [
          { groupId: 'g1', groupName: 'Side', modifierId: 'm1', modifierName: 'Mashed Potatoes', priceMinor: 0 },
        ],
        note: 'Sauce on side',
      },
    ];

    const bill = buildPreCheckoutBillReceipt({
      billNumber: 'BILL-007',
      cartLines: lines,
      cartCurrency: 'IDR',
      subtotal: makeMoney(120000),
      total: makeMoney(132000),
      taxAmount: makeMoney(12000),
      tableNumber: 'Table 4',
      customerName: 'Alice',
    });

    expect(bill.receiptNumber).toBe('BILL-007');
    expect(bill.tableNumber).toBe('Table 4');
    expect(bill.customerName).toBe('Alice');
    expect(bill.items?.[0]?.note).toBe('Mashed Potatoes | Sauce on side');
  });
});

describe('formatReceiptLineNote', () => {
  it('combines modifier names and note with pipe separator', () => {
    expect(formatReceiptLineNote([{ modifierName: 'Extra Cheese' }], 'Less salt')).toBe('Extra Cheese | Less salt');
    expect(formatReceiptLineNote([{ modifierName: 'Extra Cheese' }, { modifierName: 'Bacon' }], '')).toBe('Extra Cheese, Bacon');
    expect(formatReceiptLineNote([], 'Vegetarian')).toBe('Vegetarian');
    expect(formatReceiptLineNote(null, null)).toBeUndefined();
  });
});

describe('buildKitchenChitReceipt', () => {
  it('formats kitchen order ticket with delta items, table number, modifiers, and notes', () => {
    const lines: CartLine[] = [
      {
        ...makeCartLine('Nasi Goreng Spesial', 2, 35000),
        courseId: 'main',
        note: 'Pedas level 3, tanpa timun',
        modifiers: [
          { groupId: 'grp-1', groupName: 'Add-ons', modifierId: 'mod-1', modifierName: 'Extra Telur', priceMinor: 5000 },
        ],
      },
      {
        ...makeCartLine('Es Teh Manis', 1, 6000),
        courseId: 'beverage',
      },
    ];

    const chit = buildKitchenChitReceipt({
      chitNumber: 'KOT-12-001',
      cartLines: lines,
      cartCurrency: 'IDR',
      tableNumber: '12',
      customerName: 'Bpk. Ahmad',
    });

    expect(chit.receiptNumber).toBe('KOT-12-001');
    expect(chit.tableNumber).toBe('12');
    expect(chit.customerName).toBe('Bpk. Ahmad');
    expect(chit.items).toHaveLength(2);

    const [first, second] = chit.items ?? [];
    expect(first?.name).toBe('[Main Course] Nasi Goreng Spesial');
    expect(first?.quantity).toBe(2);
    expect(first?.note).toBe('Extra Telur | Pedas level 3, tanpa timun');

    expect(second?.name).toBe('[Beverage] Es Teh Manis');
    expect(second?.quantity).toBe(1);
    expect(second?.note).toBeUndefined();
  });

  it('generates a fallback receiptNumber when chitNumber is omitted', () => {
    const lines: CartLine[] = [makeCartLine('Mie Goreng', 1, 25000)];
    const chit = buildKitchenChitReceipt({
      cartLines: lines,
      cartCurrency: 'IDR',
      tableNumber: 'Table 5',
    });

    expect(chit.receiptNumber).toMatch(/^KOT-5-\d+$/);
    expect(chit.items).toHaveLength(1);
    expect(chit.items?.[0]?.quantity).toBe(1);
  });

  it('honours explicit printerTarget and documentKind for bar routing', () => {
    const lines: CartLine[] = [makeCartLine('Es Kopi Susu', 2, 20000)];
    const chit = buildKitchenChitReceipt({
      cartLines: lines,
      cartCurrency: 'IDR',
      tableNumber: '4',
      printerTarget: 'bar',
      documentKind: 'bar',
    });

    expect(chit.printerTarget).toBe('bar');
    expect(chit.documentKind).toBe('bar');
  });

  it('sorts line items by course order and tags held items with [HOLD]', () => {
    const lines: CartLine[] = [
      {
        ...makeCartLine('Lava Cake', 1, 30000),
        courseId: 'dessert',
        coursingStatus: 'hold',
      },
      {
        ...makeCartLine('Spring Rolls', 2, 20000),
        courseId: 'appetizer',
        coursingStatus: 'fired',
      },
      {
        ...makeCartLine('Beef Steak', 1, 75000),
        courseId: 'main',
        coursingStatus: 'fired',
      },
    ];

    const chit = buildKitchenChitReceipt({
      cartLines: lines,
      cartCurrency: 'IDR',
      tableNumber: '7',
    });

    expect(chit.items).toHaveLength(3);
    expect(chit.items?.[0]?.name).toBe('[Appetizer] Spring Rolls');
    expect(chit.items?.[1]?.name).toBe('[Main Course] Beef Steak');
    expect(chit.items?.[2]?.name).toBe('[HOLD] [Dessert] Lava Cake');
  });

  it('uses customerName when tableNumber is absent for takeaway chit numbering', () => {
    const lines: CartLine[] = [makeCartLine('Paket Hemat', 1, 25000)];
    const chit = buildKitchenChitReceipt({
      cartLines: lines,
      cartCurrency: 'IDR',
      customerName: 'Bpk. Ahmad',
    });

    expect(chit.receiptNumber).toMatch(/^KOT-BPKAHMAD-\d+$/);
  });
});

describe('isBeverageItem', () => {
  it('identifies items with beverage or legacy drinks courseId', () => {
    expect(isBeverageItem({ ...makeCartLine('Item 1', 1, 10000), courseId: 'beverage' })).toBe(true);
    expect(isBeverageItem({ ...makeCartLine('Item 2', 1, 10000), courseId: 'drinks' as never })).toBe(true);
  });

  it('identifies items with beverage-related category names', () => {
    expect(isBeverageItem({ ...makeCartLine('Item 3', 1, 10000), category: 'Hot Beverages' })).toBe(true);
    expect(isBeverageItem({ ...makeCartLine('Item 4', 1, 10000), category: 'Cold Drinks' })).toBe(true);
    expect(isBeverageItem({ ...makeCartLine('Item 5', 1, 10000), category: 'Aneka Minuman' })).toBe(true);
    expect(isBeverageItem({ ...makeCartLine('Item 6', 1, 10000), category: 'Bar Station' })).toBe(true);
  });

  it('returns false for food items', () => {
    expect(isBeverageItem({ ...makeCartLine('Item 7', 1, 10000), courseId: 'main', category: 'Main Course' })).toBe(false);
    expect(isBeverageItem({ ...makeCartLine('Item 8', 1, 10000), courseId: 'appetizer', category: 'Starters' })).toBe(false);
  });
});

