import { describe, expect, it } from 'vitest';
import {
  coreRailWithheld,
  railParam,
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

/** Same rail with an operator-written `parameters` bag, for the F18 reads. */
const makeRailWithParams = (
  rail_code: string,
  parameters: string,
  is_enabled = true,
): LocalPaymentRail => ({
  rail_code,
  label: rail_code,
  is_enabled,
  scope: 'location',
  parameters,
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
  describe('coreRailWithheld (F16)', () => {
  describe('railParam (F18)', () => {
    // Every read has to tolerate a free-form `parameters` bag the operator wrote,
    // and every unreadable case must return the FALLBACK rather than false — a false
    // default would silently disable behaviour for stores that predate the toggle.

    it('reads a boolean the operator set', () => {
      const rails = [makeRailWithParams('cash', JSON.stringify({ autoKick: false }))];
      expect(railParam(rails, 'cash', 'autoKick', true)).toBe(false);
      expect(railParam(rails, 'cash', 'autoKick', false)).toBe(false);
    });

    it('returns the fallback for a missing key, rail, or bag', () => {
      expect(railParam(null, 'cash', 'autoKick', true)).toBe(true);
      expect(railParam([], 'cash', 'autoKick', true)).toBe(true);
      // No row for the rail at all.
      expect(railParam([makeRail('qris', true)], 'cash', 'autoKick', true)).toBe(true);
      // Row present, key absent — the store that predates the toggle.
      expect(railParam([makeRailWithParams('cash', '{}')], 'cash', 'autoKick', true)).toBe(true);
    });

    it('falls back on unparseable JSON and on a non-boolean value', () => {
      // A malformed bag is unreadable saved state, not a preference.
      expect(railParam([makeRailWithParams('cash', '{oops')], 'cash', 'autoKick', true)).toBe(true);
      expect(railParam([makeRailWithParams('cash', '[1,2]')], 'cash', 'autoKick', true)).toBe(true);
      // A string "false" is not the boolean false — guessing would be a lie.
      expect(railParam([makeRailWithParams('cash', JSON.stringify({ autoKick: 'false' }))], 'cash', 'autoKick', true)).toBe(true);
    });

    it('honours the fallback for a rail whose code is cased differently', () => {
      const rails = [makeRailWithParams('CASH', JSON.stringify({ autoKick: false }))];
      expect(railParam(rails, 'cash', 'autoKick', true)).toBe(false);
    });
  });
    // The three-state distinction `railOffered` cannot express for a CORE rail.
    // Using `railOffered` for `open_bill` withheld the tender from stores whose
    // rail list merely predated the row — a silent capability withdrawal.

    it('is false for a null or empty list', () => {
      expect(coreRailWithheld(null, 'open_bill')).toBe(false);
      expect(coreRailWithheld([], 'open_bill')).toBe(false);
    });

    it('is false when the rail row is ABSENT from a populated list', () => {
      // The case `railOffered` gets wrong: `qris` here IS withheld (unknown =>
      // false), but a core rail with no row was never switched off.
      const rails = [makeRail('qris', true), makeRail('cash', true)];
      expect(railOffered(rails, 'qris')).toBe(true);
      expect(railOffered(rails, 'open_bill')).toBe(false); // the trap
      expect(coreRailWithheld(rails, 'open_bill')).toBe(false);
    });

    it('is true ONLY for an explicit is_enabled false', () => {
      expect(coreRailWithheld([makeRail('open_bill', false)], 'open_bill')).toBe(true);
      expect(coreRailWithheld([makeRail('open_bill', true)], 'open_bill')).toBe(false);
    });

    it('matches a differently-cased rail code, like railOffered does', () => {
      expect(coreRailWithheld([makeRail('Open_Bill', false)], 'open_bill')).toBe(true);
    });
  });
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
    it('matches a rail whose code is stored in a different case (the settings screen does)', () => {
      // `RestaurantPaymentsScreen` normalises with `.toLowerCase()` at every one of
      // its 14 lookups (:371, :380, :394, :408, :420, :436, :517, :553, :588, :616,
      // :641, …), because `rail_code` is a free-form string the operator can create.
      // `railOffered` compared RAW, so a rail saved as 'QRIS' was configured by the
      // settings screen and then not matched here — falling through to
      // `rail ? rail.is_enabled : false` = false, which HIDES the tender the operator
      // just switched on. Nothing normalises on write either: the bridge passes
      // `rail_code` straight through (crates/kasimru-bridge/src/local_payment.rs:95)
      // and the column has no CHECK constraint.
      const rails = [makeRail('QRIS', true)];
      expect(railOffered(rails, 'qris')).toBe(true);

      const mixed = [makeRail('Qris', false)];
      expect(railOffered(mixed, 'qris')).toBe(false);
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
    // ── The open_bill / credit inconsistency, pinned so it cannot drift ──
    //
    // `visibleMethods` derives the QRIS/CARD/CASH tenders, but `open_bill` and
    // `credit` are NOT part of TENDER_RAILS: PaymentModal renders `open_bill` on
    // `isRestaurantPos` alone and `credit` unconditionally (PaymentModal.tsx:1910,
    // :1934). So NEITHER consults a rail's `is_enabled`.
    //
    // That matters because RestaurantPaymentsScreen now offers an enable toggle for
    // both (they left its `internalHiddenCodes` list and became ordinary cards). A
    // rail the operator can switch off here that the charge modal keeps offering is
    // the same class as the `midtrans isActive` disagreement being fixed in that
    // file. These cases pin TODAY'S behaviour — if the two surfaces are brought into
    // agreement, this is the test that must be edited deliberately.
    it('does not gate open_bill or credit on any rail flag (documented divergence)', () => {
      const rails = [makeRail('open_bill', false), makeRail('credit', false)];
      const methods = visibleMethods(rails, null);
      // Both are DISABLED rails, yet neither can be removed from the tender list
      // by a rail flag — the list is rail-derived for qris only.
      expect(methods).toContain('credit');
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


    it('matches the QRIS rail case-insensitively (same fix as railOffered)', () => {
      // Reached through the SAME divergence: the settings screen lowercases and
      // nothing normalises on write, so a rail stored as `QRIS` never matched here
      // and its configured label was ignored in favour of the market default.
      const rails = [makeRail('QRIS', true, 'Custom PayNow')];
      expect(resolveTenderDisplayName('qris', rails, null, 'QRIS')).toBe('Custom PayNow');
    });

    it('returns fallback for non-qris tenders', () => {
      const profile = makeProfile({ country_code: 'SG' });
      expect(resolveTenderDisplayName('cash', null, profile, 'Cash')).toBe('Cash');
      expect(resolveTenderDisplayName('card', null, profile, 'Card')).toBe('Card');
    });
  });
});
