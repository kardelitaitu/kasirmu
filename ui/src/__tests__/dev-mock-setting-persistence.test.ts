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
import { getSettingScoped, setSettingScoped } from '@/api/settings';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// These two go through the REAL api layer, not a hand-rolled invoke wrapper.
//
// They used to be local arrows calling invoke('set_setting_scoped'/'get_setting_scoped')
// directly, which verify-test-shadow-copies.py flagged at similarity 1.0 against
// api/settings.ts:296 — correctly: a one-line `const getSetting = (key) => invoke(...)`
// has the same shape as the production `const getSetting = (key) => loggedInvoke(...)`,
// and the suite was therefore exercising its own wrapper.
//
// The fix is not a rename. api/settings.ts:340 exports the real `getSettingScoped`,
// which issues the SAME command with the same session handling, so importing it makes
// this file test what the POS actually calls. The unscoped round-trip case below still
// needs a raw `invoke`, and keeps it — that one deliberately reaches past the api layer
// to compare the two spellings.
const writeSetting = (key: string, value: string) =>
  setSettingScoped('mock-token', key, value);
const readSetting = (key: string): Promise<string | null> =>
  getSettingScoped('mock-token', key);

describe('dev-mock key/value setting persistence', () => {
  it('reads back a value it just wrote', async () => {
    const key = 'restaurant.auto_print_kitchen';
    await writeSetting(key, '1');
    expect(
      await readSetting(key),
      'a value written to set_setting_scoped must be readable from ' +
        'get_setting_scoped — the POS reads this key to decide whether to ' +
        'auto-print kitchen chits',
    ).toBe('1');
  });

  it('overwrites an existing value rather than accumulating', async () => {
    const key = 'restaurant.course_firing';
    await writeSetting(key, '0');
    expect(await readSetting(key)).toBe('0');
    await writeSetting(key, '1');
    expect(await readSetting(key), 'the later write must win').toBe('1');
  });

  it('answers null for a key that was never written', async () => {
    // The contract is string | null (api/settings.ts:340). A missing key must be
    // null, NOT an empty string: callers distinguish "unset" from "set to empty".
    expect(await readSetting(`never.written.${Date.now()}`)).toBeNull();
  });

  it('round-trips a JSON value', async () => {
    // RestaurantMenu stores the unavailable-SKU list as JSON text.
    const key = 'restaurant.unavailable_items';
    const value = JSON.stringify(['SKU-A', 'SKU-B']);
    await writeSetting(key, value);
    expect(await readSetting(key)).toBe(value);
    expect(JSON.parse((await readSetting(key))!)).toEqual(['SKU-A', 'SKU-B']);
  });

  it('mirrors the unscoped synonym onto the same store', async () => {
    // applyScopedAliases gives get_setting a _scoped twin; both must agree, or a
    // caller using the unscoped spelling sees a different value than the scoped
    // one writing it.
    await writeSetting('exchange.rate_sync_enabled', '1');
    const scoped = await readSetting('exchange.rate_sync_enabled');
    const unscoped = await invoke<string | null>('get_setting', { key: 'exchange.rate_sync_enabled' });
    expect(scoped).toBe(unscoped);
    expect(scoped).toBe('1');
  });
});
