// ── Dev-mock: a written setting must be readable back ────────────────────
//
// FIFTH instance of one defect shape (KDS order create, refund persistence, KDS
// device registration, floor-plan tables): a command whose read-back disagrees
// with what it did.
//
// settingsHandlers had:
//   get_setting          -> () => null
//   set_setting_scoped   -> () => null
// and applyScopedAliases mirrors get_setting onto get_setting_scoped, so the
// scoped read the api layer actually issues (api/settings.ts:347) resolved to
// the same null stub. Every single-key setting therefore read as null AND every
// write was dropped.
//
// This is not a cosmetic gap. The key/value setting store backs, among others:
//   - 'restaurant.auto_print_kitchen'  (PosScreen.tsx:918)
//   - 'restaurant.course_firing'       (PosScreen.tsx:824)
//   - 'restaurant.order_type_prompt'   (PosScreen.tsx:884)
//   - the unavailable-items list       (RestaurantMenu.tsx:489/323)
//   - RATE_SYNC_ENABLED_KEY            (ExchangeRateScreen.tsx:191/210)
// so a switch the cashier flips refused to stay flipped, and the menu's
// unavailable state reset on every load.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const setSetting = (key: string, value: string) =>
  invoke('set_setting_scoped', { sessionToken: 'mock-token', key, value });
const getSetting = (key: string): Promise<string | null> =>
  invoke<string | null>('get_setting_scoped', { sessionToken: 'mock-token', key });

describe('dev-mock key/value setting persistence', () => {
  it('reads back a value it just wrote', async () => {
    const key = 'restaurant.auto_print_kitchen';
    await setSetting(key, '1');
    expect(
      await getSetting(key),
      'a value written to set_setting_scoped must be readable from ' +
        'get_setting_scoped — the POS reads this key to decide whether to ' +
        'auto-print kitchen chits',
    ).toBe('1');
  });

  it('overwrites an existing value rather than accumulating', async () => {
    const key = 'restaurant.course_firing';
    await setSetting(key, '0');
    expect(await getSetting(key)).toBe('0');
    await setSetting(key, '1');
    expect(await getSetting(key), 'the later write must win').toBe('1');
  });

  it('answers null for a key that was never written', async () => {
    // The contract is string | null (api/settings.ts:340). A missing key must be
    // null, NOT an empty string: callers distinguish "unset" from "set to empty".
    expect(await getSetting(`never.written.${Date.now()}`)).toBeNull();
  });

  it('round-trips a JSON value', async () => {
    // RestaurantMenu stores the unavailable-SKU list as JSON text.
    const key = 'restaurant.unavailable_items';
    const value = JSON.stringify(['SKU-A', 'SKU-B']);
    await setSetting(key, value);
    expect(await getSetting(key)).toBe(value);
    expect(JSON.parse((await getSetting(key))!)).toEqual(['SKU-A', 'SKU-B']);
  });

  it('mirrors the unscoped synonym onto the same store', async () => {
    // applyScopedAliases gives get_setting a _scoped twin; both must agree, or a
    // caller using the unscoped spelling sees a different value than the scoped
    // one writing it.
    await setSetting('exchange.rate_sync_enabled', '1');
    const scoped = await getSetting('exchange.rate_sync_enabled');
    const unscoped = await invoke<string | null>('get_setting', { key: 'exchange.rate_sync_enabled' });
    expect(scoped).toBe(unscoped);
    expect(scoped).toBe('1');
  });
});
