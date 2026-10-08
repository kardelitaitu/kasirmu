import { describe, expect, it } from 'vitest';
import {
  railOffered,
  visibleMethods,
  resolveTenderDisplayName,
} from '@/features/sales/useLocalPaymentRails';
import type { LocalPaymentRail } from '@/api/local-payment';
import type { ActiveMarketProfile } from '@/api/regional';

const makeRail = (rail_code: string, is_enabled: boolean, label = rail_code): LocalPaymentRail => ({
  rail_code,
  label,
  is_enabled,
  scope: 'location',
  parameters: '{}',
});

const makeProfile = (overrides: Partial<ActiveMarketProfile> = {}): ActiveMarketProfile => ({
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

describe('useLocalPaymentRails helpers', () => {
  describe('railOffered', () => {
    it('fails open when rails list is null or empty', () => {
      expect(railOffered(null, 'qris')).toBe(true);
      expect(railOffered([], 'qris')).toBe(true);
    });

    it('returns is_enabled for matching rail', () => {
      const rails = [makeRail('qris', true), makeRail('card', false)];
      expect(railOffered(rails, 'qris')).toBe(true);
      expect(railOffered(rails, 'card')).toBe(false);
    });

    it('returns false for unknown rail in non-empty list', () => {
      const rails = [makeRail('cash', true)];
      expect(railOffered(rails, 'qris')).toBe(false);
    });
  });

  describe('visibleMethods', () => {
    it('returns default methods when no rails configured', () => {
      const methods = visibleMethods(null, null);
      expect(methods).toEqual(['cash', 'card', 'qris', 'credit']);
    });

    it('filters out disabled qris rail', () => {
      const rails = [makeRail('qris', false)];
      const methods = visibleMethods(rails, null);
      expect(methods).toEqual(['cash', 'card', 'credit']);
    });

    it('intersects with marketProfile enabled_payment_rails', () => {
      const profile = makeProfile({ enabled_payment_rails: ['cash', 'card'] });
      const methods = visibleMethods(null, profile);
      // qris is not in enabled_payment_rails, so it should be excluded
      expect(methods).toEqual(['cash', 'card', 'credit']);
    });
  });

  describe('resolveTenderDisplayName', () => {
    it('returns configured rail label when present', () => {
      const rails = [makeRail('qris', true, 'Custom PayNow')];
      const result = resolveTenderDisplayName('qris', rails, null, 'QRIS');
      expect(result).toBe('Custom PayNow');
    });

    it('resolves market standard QR name per country code when no custom label set', () => {
      const countries = [
        { code: 'SG', expected: 'PayNow / SGQR' },
        { code: 'MY', expected: 'DuitNow QR' },
        { code: 'TH', expected: 'PromptPay' },
        { code: 'IN', expected: 'UPI' },
        { code: 'BR', expected: 'PIX' },
        { code: 'US', expected: 'QR Code' },
        { code: 'GB', expected: 'QR Code' },
      ];

      for (const { code, expected } of countries) {
        const profile = makeProfile({ country_code: code });
        const result = resolveTenderDisplayName('qris', null, profile, 'QRIS');
        expect(result).toBe(expected);
      }
    });

    it('falls back to localized default for Indonesia (ID)', () => {
      const profile = makeProfile({ country_code: 'ID' });
      const result = resolveTenderDisplayName('qris', null, profile, 'QRIS');
      expect(result).toBe('QRIS');
    });

    it('returns fallback for non-qris tenders', () => {
      const profile = makeProfile({ country_code: 'SG' });
      expect(resolveTenderDisplayName('cash', null, profile, 'Cash')).toBe('Cash');
      expect(resolveTenderDisplayName('card', null, profile, 'Card')).toBe('Card');
    });
  });
});
