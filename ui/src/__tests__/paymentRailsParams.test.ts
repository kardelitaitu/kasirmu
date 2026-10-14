// ── Rail parameter sanitisation ─────────────────────────────
//
// Round 183. The rule that keeps provider credentials out of `local_payment_methods` was
// inline in `RestaurantPaymentsScreen.handleSave` — the rail payload sanitised Midtrans to
// `channels` and Stripe to `reader`/`currency`, dropping everything else. Nothing tested it,
// because a component body is not something a unit test can reach without rendering the
// whole screen and its eight IPC mocks.
//
// Extracted to `paymentRailsLogic.ts` as `sanitizeRailParams` and pinned here.
//
// The separation it defends: `setLocalPaymentMethodsScoped` writes the MARKET surface (which
// rails exist, what they are called, whether the site offers them). `setPaymentGatewayConfigScoped`
// writes CREDENTIALS, encrypted at rest. A provider key in the rail list is a credential in a
// table every terminal reads and syncs, without that encryption — so the sanitisation is a
// data-security boundary, not a formatting preference.

import { describe, it, expect } from 'vitest';
import { sanitizeRailParams } from '@/features/restaurant/screens/paymentRailsLogic';

describe('sanitizeRailParams', () => {
  it('strips Midtrans credentials, keeping only the market channels', () => {
    const dirty = JSON.stringify({
      channels: ['gopay', 'shopeepay'],
      merchantId: 'M-123',
      clientKey: 'SB-Mid-client-abc',
      serverKey: 'SB-Mid-server-SECRET',
    });

    const clean = sanitizeRailParams('midtrans', dirty);
    expect(JSON.parse(clean)).toEqual({ channels: ['gopay', 'shopeepay'] });
    expect(clean).not.toContain('SECRET');
  });

  it('strips Stripe credentials, keeping only reader and currency', () => {
    const dirty = JSON.stringify({
      reader: 'tmr_xyz',
      currency: 'idr',
      publishableKey: 'pk_test_abc',
      secretKey: 'sk_test_SECRET',
      mode: 'test',
    });

    const clean = sanitizeRailParams('stripe', dirty);
    expect(JSON.parse(clean)).toEqual({ reader: 'tmr_xyz', currency: 'idr' });
    expect(clean).not.toContain('SECRET');
  });

  it('is case-insensitive about the rail code', () => {
    const dirty = JSON.stringify({ channels: ['qris'], serverKey: 'SECRET' });
    expect(JSON.parse(sanitizeRailParams('MidTrans', dirty))).toEqual({ channels: ['qris'] });
    const stripeDirty = JSON.stringify({ reader: 'r', secretKey: 'S' });
    expect(JSON.parse(sanitizeRailParams('STRIPE', stripeDirty))).toEqual({ reader: 'r' });
  });

  it('leaves an unknown rail parameters intact — a site addition has no credential surface', () => {
    const siteRail = JSON.stringify({ outletId: 'o-1', tipPercent: 10 });
    expect(sanitizeRailParams('my-local-wallet', siteRail)).toBe(siteRail);
  });

  it('drops a malformed payload to empty rather than storing it', () => {
    // A rail whose `parameters` is not JSON must not carry the junk into the market row.
    expect(sanitizeRailParams('midtrans', 'not json')).toBe('{}');
  });
});