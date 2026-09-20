import { describe, expect, it } from 'vitest';
import { schemaPrice } from '../schema-price.ts';
import { pricing as enPricing } from '../../content/pricing/en.ts';
import { pricing as idPricing } from '../../content/pricing/id.ts';

/**
 * `Offer.price` must be a number. These tests use the REAL pricing content, so
 * they fail if a new display format is introduced that the converter cannot
 * read — which is the drift that produced `"price": "$4.99"` in the first place.
 */
describe('schemaPrice', () => {
  it('reads USD display prices', () => {
    expect(schemaPrice('$0', 'USD')).toBe(0);
    expect(schemaPrice('$4.99', 'USD')).toBe(4.99);
    expect(schemaPrice('$399.99', 'USD')).toBe(399.99);
  });

  it('reads IDR display prices, where `.` is the thousands separator', () => {
    expect(schemaPrice('Rp 0', 'IDR')).toBe(0);
    expect(schemaPrice('Rp 49.000', 'IDR')).toBe(49000);
    expect(schemaPrice('Rp 1.000.000', 'IDR')).toBe(1000000);
    expect(schemaPrice('Rp 3.999.000', 'IDR')).toBe(3999000);
  });

  it('returns undefined for non-prices so the caller omits the offer', () => {
    expect(schemaPrice('Custom', 'USD')).toBeUndefined();
    expect(schemaPrice('Kustom', 'IDR')).toBeUndefined();
    expect(schemaPrice('', 'USD')).toBeUndefined();
    expect(schemaPrice('$', 'USD')).toBeUndefined();
  });

  it('converts every monthly price in the shipped content', () => {
    for (const tiers of [enPricing, idPricing]) {
      for (const tier of tiers) {
        const display = tier.prices.monthly.price;
        const value = schemaPrice(display, tier.currency);
        if (tier.tierKey === 'enterprise') {
          expect(value, `${tier.name} is quote-only`).toBeUndefined();
          continue;
        }
        expect(value, `${tier.name} (${display})`).toBeTypeOf('number');
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
