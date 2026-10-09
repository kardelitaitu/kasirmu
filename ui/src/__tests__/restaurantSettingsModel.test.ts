/**
 * @file restaurantSettingsModel.test.ts
 * @description Unit tests for the restaurant POS settings load model.
 *
 * The contract under test is finding F4 in todo-restaurant-pos-reliability.md:
 * a key that was NEVER WRITTEN and a key whose READ FAILED must not produce the
 * same screen, because the screen seeds its dirty-tracking originals from this
 * result — and saving a screen seeded from defaults overwrites the merchant's
 * real configuration.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RESTAURANT_SETTINGS,
  RESTAURANT_SETTING_SPECS,
  loadRestaurantSettings,
  type SettingsReader,
} from '@/features/restaurant/screens/restaurantSettingsModel';

const TOKEN = 'tok-1';
const LOCALS = { interactionSound: true, interactionVibration: true };

/** A reader backed by a map; keys absent from it resolve to null (never written). */
function readerOf(values: Record<string, string | null>, failKeys: string[] = []): SettingsReader {
  return (_token, key) => {
    if (failKeys.includes(key)) return Promise.reject(new Error('ipc down'));
    return Promise.resolve(key in values ? values[key]! : null);
  };
}

describe('loadRestaurantSettings', () => {
  it('treats a never-written key as unset and serves its default', async () => {
    const result = await loadRestaurantSettings(TOKEN, readerOf({}), LOCALS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toEqual(DEFAULT_RESTAURANT_SETTINGS);
  });

  it('reports a failed read instead of silently defaulting (the F4 guard)', async () => {
    const result = await loadRestaurantSettings(
      TOKEN,
      readerOf({}, ['restaurant.save_tab']),
      LOCALS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedKeys).toEqual(['restaurant.save_tab']);
  });

  it('names EVERY failed key, not just the first', async () => {
    const result = await loadRestaurantSettings(
      TOKEN,
      readerOf({}, ['restaurant.save_tab', 'restaurant.sound_chime']),
      LOCALS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedKeys.sort()).toEqual(['restaurant.save_tab', 'restaurant.sound_chime']);
  });

  it('reads stored "false" as false rather than falling back to the default', async () => {
    // The other half of the distinction: an explicit off must survive. A resolver
    // that used `raw || default` would turn "false" back into true.
    const result = await loadRestaurantSettings(
      TOKEN,
      readerOf({ 'restaurant.save_tab': 'false' }),
      LOCALS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.saveTab).toBe(false);
    // ...while a different unset key still takes its default.
    expect(result.values.customerName).toBe(DEFAULT_RESTAURANT_SETTINGS.customerName);
  });

  it('uses the LOCAL preference when an interaction key is unset', async () => {
    // These two mirror localStorage, so their unset fallback is the local value
    // the runtime already honours -- not the constant.
    const result = await loadRestaurantSettings(TOKEN, readerOf({}), {
      interactionSound: false,
      interactionVibration: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.interactionSound).toBe(false);
    expect(result.values.interactionVibration).toBe(false);
  });

  it('lets the DB value beat the local preference', async () => {
    const result = await loadRestaurantSettings(
      TOKEN,
      readerOf({ 'restaurant.interaction_sound': 'true' }),
      { interactionSound: false, interactionVibration: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.interactionSound).toBe(true);
  });

  it('covers every toggle exactly once, so no key can be dropped by accident', () => {
    const fields = RESTAURANT_SETTING_SPECS.map((s) => s.field);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields.sort()).toEqual(Object.keys(DEFAULT_RESTAURANT_SETTINGS).sort());
  });
});
