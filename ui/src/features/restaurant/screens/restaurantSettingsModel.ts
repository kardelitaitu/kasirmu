/**
 * Pure model for the restaurant POS settings screen.
 *
 * WHY THIS FILE EXISTS: the screen used to load each key with
 * `.catch(() => null)`, which collapsed two different answers into one:
 *
 *   null  = "this key was never written"  -> the default is correct
 *   throw = "I could not ask"             -> the default is a LIE
 *
 * The second case then seeded the screen's `originalsRef` from the defaults, so
 * `dirty` read false, the screen looked saved, and the merchant's next Save wrote
 * those defaults over their real configuration. That is finding F4 in
 * `todo-restaurant-pos-reliability.md` — silent configuration loss.
 *
 * Keeping the two apart is therefore a data-loss guard, not a nicety, and it is
 * expressed here as a discriminated union so a caller CANNOT accidentally read a
 * value out of a failed load: `values` is unreachable without narrowing `ok`.
 *
 * The reader is injected rather than imported so this is unit-testable with no
 * module mocking and no DOM.
 */

/** The toggles this screen owns, in card order. */
export interface RestaurantSettingsValues {
  customerName: boolean;
  guestCount: boolean;
  orderTypePrompt: boolean;
  holdOrder: boolean;
  saveTab: boolean;
  courseFiring: boolean;
  autoPrintKitchen: boolean;
  soundChime: boolean;
  interactionSound: boolean;
  interactionVibration: boolean;
}

/**
 * The value to show when a key has never been written.
 *
 * These are the SAME defaults the screen previously applied, kept identical on
 * purpose: this change is about not applying them to a FAILED read, not about
 * moving what an unset key means.
 */
export const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettingsValues = {
  customerName: true,
  // TRUE, matching the runtime, and it used to be false. `PosScreen.tsx:1141` maps an
  // unset key with `guestCountEnabled ?? true`, and `CartPanel.tsx:759` shows the pax
  // field unless the gate is exactly `false` — so an unset `restaurant.guest_count`
  // SHOWS the field. The screen rendered this toggle OFF for that same state, i.e. it
  // described something the POS was not doing. The runtime's direction is the safe one
  // (`PosScreen.tsx:792-796`: a settings outage must not remove a POS capability), so
  // the default moved to meet it rather than the reverse. Pinned by
  // `__tests__/restaurantSettingDefaultsAgree.test.ts`.
  guestCount: true,
  orderTypePrompt: true,
  holdOrder: true,
  saveTab: true,
  courseFiring: false,
  autoPrintKitchen: false,
  soundChime: true,
  interactionSound: true,
  interactionVibration: true,
};

/** One toggle: the DB key behind it and the value an unset key falls back to. */
interface SettingSpec {
  field: keyof RestaurantSettingsValues;
  key: string;
  /** Used only when the key was read successfully AND returned null. */
  fallback: boolean;
}

/**
 * The ten DB-backed toggles.
 *
 * `interactionSound` / `interactionVibration` are the one pair whose fallback is
 * not a constant: they mirror a localStorage preference, so the caller passes
 * those two in (see `localFallbacks`). Everything else is a fixed default.
 */
export const RESTAURANT_SETTING_SPECS: readonly SettingSpec[] = [
  { field: 'customerName', key: 'restaurant.customer_name', fallback: DEFAULT_RESTAURANT_SETTINGS.customerName },
  { field: 'guestCount', key: 'restaurant.guest_count', fallback: DEFAULT_RESTAURANT_SETTINGS.guestCount },
  { field: 'orderTypePrompt', key: 'restaurant.order_type_prompt', fallback: DEFAULT_RESTAURANT_SETTINGS.orderTypePrompt },
  { field: 'holdOrder', key: 'restaurant.hold_order', fallback: DEFAULT_RESTAURANT_SETTINGS.holdOrder },
  { field: 'saveTab', key: 'restaurant.save_tab', fallback: DEFAULT_RESTAURANT_SETTINGS.saveTab },
  { field: 'courseFiring', key: 'restaurant.course_firing', fallback: DEFAULT_RESTAURANT_SETTINGS.courseFiring },
  { field: 'autoPrintKitchen', key: 'restaurant.auto_print_kitchen', fallback: DEFAULT_RESTAURANT_SETTINGS.autoPrintKitchen },
  { field: 'soundChime', key: 'restaurant.sound_chime', fallback: DEFAULT_RESTAURANT_SETTINGS.soundChime },
  { field: 'interactionSound', key: 'restaurant.interaction_sound', fallback: DEFAULT_RESTAURANT_SETTINGS.interactionSound },
  { field: 'interactionVibration', key: 'restaurant.interaction_vibration', fallback: DEFAULT_RESTAURANT_SETTINGS.interactionVibration },
];

/** Reads one raw setting. Rejects when the read FAILED (as opposed to returning null). */
export type SettingsReader = (token: string, key: string) => Promise<string | null>;

/** The localStorage-mirrored preferences, used when their DB key is unset. */
export interface LocalInteractionFallbacks {
  interactionSound: boolean;
  interactionVibration: boolean;
}

/** A load either produced every value, or names the keys it could not read. */
export type RestaurantSettingsLoad =
  | { ok: true; values: RestaurantSettingsValues }
  | { ok: false; failedKeys: string[] };

/**
 * Load every toggle, keeping "unset" and "unreadable" distinct.
 *
 * Resolves `ok: false` — with the keys that failed — the moment ANY read rejects.
 * It deliberately does NOT return a partial result: a caller that saved a
 * half-loaded screen would write defaults over the keys it never read, which is
 * the exact loss this guards.
 */
export async function loadRestaurantSettings(
  sessionToken: string,
  read: SettingsReader,
  localFallbacks: LocalInteractionFallbacks,
): Promise<RestaurantSettingsLoad> {
  const results = await Promise.all(
    RESTAURANT_SETTING_SPECS.map(async (spec) => {
      try {
        return { spec, raw: await read(sessionToken, spec.key) };
      } catch {
        return { spec, raw: null, failed: true as const };
      }
    }),
  );

  const failedKeys = results.filter((r) => 'failed' in r).map((r) => r.spec.key);
  if (failedKeys.length > 0) return { ok: false, failedKeys };

  const values = { ...DEFAULT_RESTAURANT_SETTINGS };
  for (const { spec, raw } of results) {
    if (spec.field === 'interactionSound' || spec.field === 'interactionVibration') {
      // The DB key wins; an unset key falls back to the local preference rather
      // than the constant, because that is the value the runtime already honours.
      values[spec.field] =
        raw === null
          ? localFallbacks[spec.field]
          : raw === 'true';
    } else {
      values[spec.field] = raw === null ? spec.fallback : raw === 'true';
    }
  }

  return { ok: true, values };
}
