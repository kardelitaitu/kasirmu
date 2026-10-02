import { describe, expect, it } from 'vitest';
import { buildCompletedSaleReceipt } from '@/features/sales/payment/completedSale';
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
});
